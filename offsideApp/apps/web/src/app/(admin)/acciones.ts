'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { CAPABILITIES } from '@/lib/permissions';
import { exigirLimitePorUsuario } from '@/lib/rate-limit-actions';
import { respuestaDeError } from '@/lib/errores';
import type { EstadoFormulario } from '@/lib/formulario';
import { requireCapabilitySessionUser } from '@/lib/session';
import { setCommissionRateBasisPoints } from '@/modules/config/services/settings.service';
import { setSetting } from '@/modules/config/services/setting-store.service';
import { isSettingKey, definitionOf } from '@/modules/config/services/settings-registry';
import { resolve as resolverDisputaService } from '@/modules/disputes/services/dispute.service';
import { endPromotionByAdmin } from '@/modules/listings/services/promotion.service';
import { refundPayment } from '@/modules/payments/services/refund.service';
import { reviewReport } from '@/modules/reports/services/report.service';
import { grantTiendaLevel } from '@/modules/reputation/services/reputation.service';
import { assignTierManually } from '@/modules/sellers/services/seller-tier.service';
import { applySanction, liftSanction } from '@/modules/trust/services/sanction.service';

import { TIPOS_DE_SANCION } from './vocabulario';

/**
 * Server Actions del back-office.
 *
 * ⚠️ CADA ACCION EXIGE SU CAPACIDAD POR SU CUENTA, con el mismo mapa
 * (`lib/permissions.ts`) que usan los endpoints. Son alcanzables por POST
 * directo: que la pantalla haya hecho el guard no protege a la accion. Esta es
 * exactamente la vía de escalada que DEC-023 pide cerrar.
 *
 * ⚠️ EL AUTOR DEL CAMBIO SALE DE LA SESION, NUNCA DEL FORMULARIO. Un campo
 * `updatedBy` en el body permitiria firmar un cambio a nombre de otro.
 *
 * ⚠️ TAMBIEN SE LIMITAN, aunque exijan capacidad administrativa. Tener la
 * capacidad no vuelve inofensiva la repeticion: cada cambio de comision inserta
 * una fila nueva de configuracion, y cada reembolso llama a Mercado Pago con
 * plata real. Es ademas el techo que queda si una sesion de admin se filtra.
 */

/**
 * ⚠️ ES UN ALIAS DEL CONTRATO COMPARTIDO. Era un tipo propio con solo `error`,
 * asi que este grupo no podia devolver errores por campo ni conservar lo
 * tipeado aunque el formulario ya supiera mostrarlos.
 */
export type EstadoAdmin = EstadoFormulario;

function texto(formData: FormData, nombre: string): string | undefined {
  const valor = formData.get(nombre);

  return typeof valor === 'string' && valor !== '' ? valor : undefined;
}

/**
 * ⚠️⚠️ TODOS LOS SCHEMAS DE ACA LLEVAN SU MENSAJE EN CASTELLANO, Y NO ES
 * PROLIJIDAD: SIN EL, ZOD RESPONDE EN INGLES.
 *
 * `texto()` devuelve `undefined` cuando el campo llega vacío —que es lo que
 * manda el navegador para un `<input>` sin completar—, así que un
 * `z.string().min(1, '…')` **nunca llega a su `.min()`**: falla antes por tipo y
 * el mensaje que sale es el de fábrica. Verificado contra el servidor: mandar la
 * sanción sin motivo devolvía `"Invalid input: expected string, received
 * undefined"` y eso se mostraba tal cual al lado del campo.
 *
 * Los dos helpers ponen el MISMO mensaje en el caso "no vino" y en el caso "vino
 * vacío": para quien completa el formulario son el mismo problema.
 */
const textoRequerido = (mensaje: string, maximo = 2_000) =>
  z
    .string({ error: mensaje })
    .trim()
    .min(1, mensaje)
    .max(maximo, `Admite hasta ${maximo} caracteres`);

/** Un id que viaja en un campo oculto. Que falte o esté mal es un formulario roto. */
const idRequerido = (mensaje: string) => z.string({ error: mensaje }).uuid(mensaje);

/* --------------------------------------------------------------- comision -- */

/**
 * ⚠️ SE INGRESA EN PORCENTAJE Y SE GUARDA EN BASIS POINTS. La fuente de verdad
 * es el entero en bp (600 = 6%): un porcentaje en punto flotante no sobrevive
 * el viaje —`0.06` no es representable en binario—. El formulario acepta hasta
 * dos decimales y se multiplica por 100 con redondeo.
 */
const comisionSchema = z.object({
  porcentaje: z.coerce
    .number({ error: 'Escribí la comisión nueva' })
    .min(0, 'La comisión no puede ser negativa')
    .max(100, 'La comisión no puede superar el 100%'),
});

/**
 * Cambia la comisión por defecto (DEC-013 / DEC-038).
 *
 * ⚠️ NO RECALCULA NADA. Las órdenes ya creadas conservan el snapshot que se
 * congeló al crearlas (DEC-030): la tasa nueva rige para las próximas.
 */
export async function cambiarComision(
  _estado: EstadoAdmin,
  formData: FormData,
): Promise<EstadoAdmin> {
  try {
    const admin = await requireCapabilitySessionUser(CAPABILITIES.SYSTEM_CONFIG_MANAGE);
    await exigirLimitePorUsuario('system-config', admin.id);

    const { porcentaje } = comisionSchema.parse({ porcentaje: texto(formData, 'porcentaje') });
    const basisPoints = Math.round(porcentaje * 100);

    await setCommissionRateBasisPoints(basisPoints, admin.id);
  } catch (error) {
    return respuestaDeError(error, {
      ambito: 'admin',
      formData,
      preservar: ['porcentaje', 'montoPesos', 'motivo'],
    });
  }

  // La pantalla lee el valor vigente; sin esto seguiria mostrando el anterior.
  revalidatePath('/admin/comision');

  return { ok: 'Comisión actualizada. Rige para las órdenes nuevas.' };
}

/* ---------------------------------------------------------------- refunds -- */

const reembolsoSchema = z.object({
  paymentId: idRequerido('Falta el pago que se quiere reembolsar'),
  /** Vacío = reembolso total. Con importe = parcial, en pesos. */
  montoPesos: z.coerce.number().positive('El importe tiene que ser mayor a cero').optional(),
  motivo: z.string().trim().max(500, 'El motivo admite hasta 500 caracteres').optional(),
});

/**
 * Emite un reembolso.
 *
 * ⚠️ ESTO MUEVE DINERO REAL Y NO SE PROBÓ NUNCA CONTRA MERCADO PAGO. El código
 * y sus tests existen; la ejecución contra la API real, no. Se avisa en la
 * pantalla.
 *
 * ⚠️ LA POLÍTICA DE CUÁNDO CORRESPONDE UN REEMBOLSO SIGUE 🟡 sin definir
 * (`orders-and-refunds.md` §5.5). Esta pantalla ejecuta la mecánica; la decisión
 * la toma una persona.
 */
export async function reembolsar(_estado: EstadoAdmin, formData: FormData): Promise<EstadoAdmin> {
  let resultado: string;

  try {
    const admin = await requireCapabilitySessionUser(CAPABILITIES.PAYMENTS_REFUND);
    await exigirLimitePorUsuario('refund', admin.id);

    const input = reembolsoSchema.parse({
      paymentId: texto(formData, 'paymentId'),
      montoPesos: texto(formData, 'montoPesos'),
      motivo: texto(formData, 'motivo'),
    });

    const refund = await refundPayment(admin, {
      paymentId: input.paymentId,
      amountCents:
        input.montoPesos === undefined ? null : BigInt(Math.round(input.montoPesos * 100)),
      reason: input.motivo ?? null,
    });

    resultado = `Reembolso ${refund.type === 'FULL' ? 'total' : 'parcial'} en estado ${refund.status}.`;
  } catch (error) {
    return respuestaDeError(error, {
      ambito: 'admin',
      formData,
      preservar: ['porcentaje', 'montoPesos', 'motivo'],
    });
  }

  revalidatePath('/admin/pagos');

  return { ok: resultado };
}

/* ------------------------------------------------- config store (todo el) -- */

/**
 * Campos que se devuelven al formulario cuando algo falla.
 *
 * ⚠️ ES UNA LISTA EXPLICITA, NO "TODO LO QUE VINO". `valoresDelFormulario`
 * ademas descarta los sensibles. Sin esto, un valor JSON de treinta lineas mal
 * tipeado se pierde entero y hay que escribirlo de nuevo.
 */
const PRESERVAR = [
  'porcentaje',
  'montoPesos',
  'motivo',
  'valor',
  'nota',
  'sellerId',
  'tierCode',
  'hasta',
] as const;

function errorDeAdmin(error: unknown, formData: FormData): EstadoAdmin {
  return respuestaDeError(error, { ambito: 'admin', formData, preservar: PRESERVAR });
}

/**
 * Corta con un error ATADO A UN CAMPO, no con un mensaje suelto.
 *
 * ⚠️ SE LANZA UN `ZodError` A PROPOSITO: es lo unico que `respuestaDeError`
 * convierte en `errores[campo]`, que es lo que el formulario usa para marcar el
 * control y mover el foco. Un `Error` comun terminaria en "Tuvimos un
 * problema", sin decir cual de los dos campos esta mal.
 */
function errorDeCampo(campo: string, mensaje: string): never {
  throw new z.ZodError([{ code: 'custom', path: [campo], message: mensaje, input: undefined }]);
}

/**
 * Convierte lo que escribio la persona al tipo que la clave espera.
 *
 * ⚠️ EL TIPO SALE DEL REGISTRO, NO DEL FORMULARIO. Un `<input>` siempre manda
 * texto: `"30"` no es `30` y `"false"` es un string verdadero. Mandarle el
 * texto crudo a `setSetting` haria que TODA clave numerica o booleana se
 * rechace por schema —o peor, que un `"false"` se guarde como bool `true`—.
 *
 * ⚠️ EL JSON SE PARSEA ACA PARA PODER EXPLICAR EL ERROR. `setSetting` valida
 * la FORMA del valor; si le llegara el texto sin parsear, el mensaje diria que
 * "se esperaba un objeto" y no que faltaba una coma.
 */
function valorTipado(clave: string, crudo: string): unknown {
  const { valueType } = definitionOf(assertClave(clave));

  if (valueType === 'bool') return crudo === 'true';
  if (valueType === 'number' || valueType === 'rate') {
    const numero = Number(crudo);
    if (crudo.trim() === '' || !Number.isFinite(numero))
      errorDeCampo('valor', 'Tiene que ser un número');

    return numero;
  }
  if (valueType === 'json') {
    try {
      return JSON.parse(crudo);
    } catch {
      errorDeCampo('valor', 'No es JSON válido. Revisá las comillas, las comas y las llaves.');
    }
  }

  return crudo;
}

/** La clave tiene que estar en el registro; nunca se confia en el formulario. */
function assertClave(clave: string): Parameters<typeof definitionOf>[0] {
  if (!isSettingKey(clave)) errorDeCampo('clave', 'Esa clave no existe en el registro');

  return clave;
}

const ajusteSchema = z.object({
  clave: textoRequerido('Falta la clave que se quiere cambiar', 200),
  /** Puede ser cadena vacía: una clave de texto admite vaciarse. */
  valor: z.string({ error: 'Escribí el valor nuevo' }),
});

/**
 * Cambia CUALQUIER clave del Config Store, en ámbito global (DEC-013/DEC-038).
 *
 * ⚠️ ESCRIBE UNA VERSION NUEVA, NO PISA LA ANTERIOR. `app_settings` es
 * versionada: la fila vieja queda con su `updated_by` y su fecha, y es lo que
 * el historial de la pantalla lee.
 *
 * ⚠️ NO TOCA LOS OVERRIDES POR AMBITO. Editar el valor de un tier o de una
 * categoría pide elegir el ámbito, y esa pantalla no existe: acá se ven y no
 * se editan. Reportado.
 *
 * ⚠️ `updatedBy` SALE DE LA SESION. Un campo en el cuerpo permitiría firmar un
 * cambio a nombre de otro.
 */
export async function cambiarAjuste(
  _estado: EstadoAdmin,
  formData: FormData,
): Promise<EstadoAdmin> {
  let resultado: string;

  try {
    const admin = await requireCapabilitySessionUser(CAPABILITIES.SYSTEM_CONFIG_MANAGE);
    await exigirLimitePorUsuario('system-config', admin.id);

    const { clave, valor } = ajusteSchema.parse({
      clave: texto(formData, 'clave'),
      valor: formData.get('valor') ?? '',
    });

    const escrito = await setSetting(assertClave(clave), valorTipado(clave, valor), admin.id);

    resultado = `"${escrito.key}" quedó en la versión ${escrito.version}.`;
  } catch (error) {
    return errorDeAdmin(error, formData);
  }

  revalidatePath('/admin/configuracion');
  // La comisión tiene su propia pantalla y se guarda en la MISMA tabla.
  revalidatePath('/admin/comision');

  return { ok: resultado };
}

/* ----------------------------------------------------------------- tiers -- */

const tierSchema = z.object({
  sellerId: idRequerido('El id del vendedor no es válido'),
  tierCode: textoRequerido('Elegí un nivel', 100),
  motivo: textoRequerido('Indicá el motivo del cambio de nivel', 500),
});

/**
 * Asigna un nivel de vendedor a mano (BR-051 / DEC-037).
 *
 * ⚠️ ACEPTA BAJAR, y es deliberado: la decisión la tomó una persona y queda
 * auditada con su id. Es exactamente lo que `seller_tier_auto_downgrade`
 * apagado deja en manos de administración.
 *
 * ⚠️ EL MOTIVO ES OBLIGATORIO Y VA A LA AUDITORÍA. Cambiar el nivel a mano le
 * cambia la comisión que se le cobra a esa persona: sin el motivo, dentro de
 * seis meses el registro dice quién y cuándo, y nadie puede responder por qué.
 */
export async function asignarNivel(_estado: EstadoAdmin, formData: FormData): Promise<EstadoAdmin> {
  let resultado: string;

  try {
    const admin = await requireCapabilitySessionUser(CAPABILITIES.SYSTEM_CONFIG_MANAGE);
    await exigirLimitePorUsuario('admin-tier', admin.id);

    const input = tierSchema.parse({
      sellerId: texto(formData, 'sellerId'),
      tierCode: texto(formData, 'tierCode'),
      motivo: texto(formData, 'motivo'),
    });

    const cambio = await assignTierManually(input.sellerId, input.tierCode, admin.id, input.motivo);

    resultado = cambio.changed
      ? `El vendedor pasó a ${cambio.tier.name}.`
      : `El vendedor ya estaba en ${cambio.tier.name}: no se cambió nada.`;
  } catch (error) {
    return errorDeAdmin(error, formData);
  }

  revalidatePath('/admin/niveles');
  revalidatePath('/admin/vendedores');

  return { ok: resultado };
}

/* -------------------------------------------------------------- disputas -- */

const resolucionSchema = z.object({
  disputeId: idRequerido('Falta el reclamo que se está resolviendo'),
  resolucion: textoRequerido('Elegí una resolución', 100),
  /** En pesos. Sólo para reembolso parcial o para una sanción con devolución. */
  montoPesos: z.coerce.number().positive('El importe tiene que ser mayor a cero').optional(),
  nota: textoRequerido('La resolución necesita una nota'),
});

/**
 * Resuelve un reclamo (TS-054).
 *
 * ⚠️ PUEDE MOVER DINERO Y PUEDE SANCIONAR A UNA PERSONA, las dos cosas sin
 * pasar por `payments:refund` ni por `trust:moderate`: el Service lo permite
 * porque OR-001/OR-002 dicen que el refund SE ORIGINA en la resolución. Por eso
 * la capacidad es `disputes:resolve` y la nota es obligatoria.
 *
 * ⚠️ EL RESULTADO DEL REEMBOLSO SE DEVUELVE TAL CUAL. Si Mercado Pago lo
 * rechaza, la resolución igual quedó escrita: decir sólo "listo" escondería que
 * la plata no volvió. Y si el motivo fue saldo insuficiente, la deuda **no
 * queda registrada** (`seller_liabilities` sigue vacía).
 */
export async function resolverDisputa(
  _estado: EstadoAdmin,
  formData: FormData,
): Promise<EstadoAdmin> {
  let resultado: string;

  try {
    const admin = await requireCapabilitySessionUser(CAPABILITIES.DISPUTES_RESOLVE);
    await exigirLimitePorUsuario('admin-dispute', admin.id);

    const input = resolucionSchema.parse({
      disputeId: texto(formData, 'disputeId'),
      resolucion: texto(formData, 'resolucion'),
      montoPesos: texto(formData, 'montoPesos'),
      nota: texto(formData, 'nota'),
    });

    const salida = await resolverDisputaService(admin, input.disputeId, {
      resolution: input.resolucion,
      ...(input.montoPesos === undefined
        ? {}
        : { refundAmount: BigInt(Math.round(input.montoPesos * 100)) }),
      note: input.nota,
    });

    const reembolso =
      salida.refund === null
        ? 'Sin reembolso.'
        : salida.refund.ok
          ? `Reembolso: ${salida.refund.detalle}`
          : `⚠️ El reembolso NO se ejecutó: ${salida.refund.detalle}`;

    resultado = `Reclamo resuelto. ${reembolso}${salida.sancionAplicada ? ' Se aplicó la sanción.' : ''}`;
  } catch (error) {
    return errorDeAdmin(error, formData);
  }

  revalidatePath('/admin/disputas');

  return { ok: resultado };
}

/* ------------------------------------------------------------ sanciones -- */

const sancionSchema = z.object({
  sellerId: idRequerido('El id del vendedor no es válido'),
  tipo: z.enum(TIPOS_DE_SANCION, { error: 'Elegí un tipo de sanción' }),
  motivo: textoRequerido('La sanción necesita un motivo'),
  /** `YYYY-MM-DD` del `<input type="date">`. Vacío = sin vencimiento. */
  hasta: z.string().optional(),
});

/**
 * Aplica una sanción a un vendedor (ERD §16.2).
 *
 * ⚠️ LA EXPULSION ES TERMINAL (BR-004): no se puede levantar desde acá ni desde
 * ningún lado de la aplicación. La pantalla lo advierte antes de confirmar.
 *
 * ⚠️ LA FECHA SE INTERPRETA COMO FIN DEL DIA EN UTC. Un `<input type="date">`
 * manda `YYYY-MM-DD` sin hora; tomarla como medianoche haría que una suspensión
 * "hasta el 20" venza el 19 a la noche.
 */
export async function aplicarSancionAVendedor(
  _estado: EstadoAdmin,
  formData: FormData,
): Promise<EstadoAdmin> {
  let resultado: string;

  try {
    const admin = await requireCapabilitySessionUser(CAPABILITIES.TRUST_MODERATE);
    await exigirLimitePorUsuario('admin-moderate', admin.id);

    const input = sancionSchema.parse({
      sellerId: texto(formData, 'sellerId'),
      tipo: texto(formData, 'tipo'),
      motivo: texto(formData, 'motivo'),
      hasta: texto(formData, 'hasta'),
    });

    const endsAt = input.hasta === undefined ? null : new Date(`${input.hasta}T23:59:59.999Z`);
    if (endsAt !== null && Number.isNaN(endsAt.getTime())) {
      errorDeCampo('hasta', 'La fecha no es válida');
    }

    await applySanction(admin, input.sellerId, input.tipo, input.motivo, { endsAt });

    resultado = 'Sanción aplicada. Queda en el log de auditoría con tu usuario.';
  } catch (error) {
    return errorDeAdmin(error, formData);
  }

  revalidatePath('/admin/vendedores');

  return { ok: resultado };
}

const levantarSchema = z.object({
  sancionId: idRequerido('Falta la sanción que se quiere levantar'),
  motivo: textoRequerido('Levantar una sanción necesita un motivo'),
});

/** Levanta una sanción vigente. La expulsión NO se puede levantar (BR-004). */
export async function levantarSancionDeVendedor(
  _estado: EstadoAdmin,
  formData: FormData,
): Promise<EstadoAdmin> {
  try {
    const admin = await requireCapabilitySessionUser(CAPABILITIES.TRUST_MODERATE);
    await exigirLimitePorUsuario('admin-moderate', admin.id);

    const input = levantarSchema.parse({
      sancionId: texto(formData, 'sancionId'),
      motivo: texto(formData, 'motivo'),
    });

    await liftSanction(admin, input.sancionId, input.motivo);
  } catch (error) {
    return errorDeAdmin(error, formData);
  }

  revalidatePath('/admin/vendedores');

  return { ok: 'Sanción levantada.' };
}

/* ---------------------------------------------------- nivel de usuario -- */

const tiendaSchema = z.object({
  userId: idRequerido('El id de la cuenta no es válido'),
  motivo: textoRequerido('Otorgar TIENDA necesita un motivo', 1_000),
});

/**
 * Otorga el nivel TIENDA (DEC-020: "categoría especial otorgada por Offside").
 *
 * ⚠️ LA CAPACIDAD ES `system_config:manage` Y NO `trust:moderate`, aunque la
 * pantalla que la ofrece pida moderación. La exige así el Service —no existe
 * todavía una capacidad propia de niveles en `lib/permissions.ts`— y pedir una
 * distinta acá dejaría pasar el formulario para que el Service lo rechace
 * abajo. Hoy los dos mapas dan los mismos roles (ADMIN y SUPER_ADMIN).
 *
 * ⚠️ NO SE PUEDE DESHACER DESDE ACÁ: bajar un nivel otorgado es SQL, igual que
 * asignar un rol.
 */
export async function otorgarTienda(
  _estado: EstadoAdmin,
  formData: FormData,
): Promise<EstadoAdmin> {
  let resultado: string;

  try {
    const admin = await requireCapabilitySessionUser(CAPABILITIES.SYSTEM_CONFIG_MANAGE);
    await exigirLimitePorUsuario('admin-moderate', admin.id);

    const input = tiendaSchema.parse({
      userId: texto(formData, 'userId'),
      motivo: texto(formData, 'motivo'),
    });

    const salida = await grantTiendaLevel(admin, input.userId, input.motivo);

    resultado = salida.changed
      ? 'La cuenta pasó al nivel TIENDA.'
      : 'La cuenta ya estaba en TIENDA: no se cambió nada.';
  } catch (error) {
    return errorDeAdmin(error, formData);
  }

  revalidatePath('/admin/vendedores');

  return { ok: resultado };
}

/* ---------------------------------------------------------- promociones -- */

const promocionSchema = z.object({
  promotionId: idRequerido('Falta la promoción que se quiere terminar'),
  motivo: textoRequerido('Terminar una promoción necesita un motivo', 1_000),
});

/**
 * Corta una promoción vigente antes de tiempo.
 *
 * ⚠️ EL VENDEDOR NO PUEDE HACERLO: sólo administración. Y la fila queda como
 * `cancelled`, nunca se borra —cobrar una comisión agravada y después "olvidar"
 * que hubo promoción no puede pasar—.
 *
 * ⚠️ CAPACIDAD `system_config:manage`, por el mismo motivo que TIENDA: es la
 * que exige `endPromotionByAdmin`.
 */
export async function terminarPromocion(
  _estado: EstadoAdmin,
  formData: FormData,
): Promise<EstadoAdmin> {
  try {
    const admin = await requireCapabilitySessionUser(CAPABILITIES.SYSTEM_CONFIG_MANAGE);
    await exigirLimitePorUsuario('admin-moderate', admin.id);

    const input = promocionSchema.parse({
      promotionId: texto(formData, 'promotionId'),
      motivo: texto(formData, 'motivo'),
    });

    await endPromotionByAdmin(admin, input.promotionId, input.motivo);
  } catch (error) {
    return errorDeAdmin(error, formData);
  }

  revalidatePath('/admin/vendedores');

  return { ok: 'Promoción terminada. La publicación deja de estar promocionada ya mismo.' };
}

/* ------------------------------------------------------------- reportes -- */

const reporteSchema = z.object({
  reporteId: idRequerido('Falta la denuncia que se está cerrando'),
  decision: z.enum(['reviewed', 'dismissed'], { error: 'Elegí si se atiende o se descarta' }),
  nota: z.string().trim().max(1_000, 'La nota admite hasta 1000 caracteres').optional(),
});

/**
 * Cierra una denuncia sobre una publicación: `reviewed` (se atendió) o
 * `dismissed` (se descartó).
 *
 * ⚠️ ESTO NO BAJA LA PUBLICACION. `reviewReport` sólo cierra la denuncia y deja
 * la decisión en `audit_log`; moderar la publicación (`listings.moderation_status`)
 * es otra cosa y todavía no existe. La pantalla lo dice.
 *
 * ⚠️ LA NOTA VA AL LOG, NO A LA FILA: `listing_reports.note` es lo que escribió
 * quien denunció y no se pisa.
 */
export async function revisarReporte(
  _estado: EstadoAdmin,
  formData: FormData,
): Promise<EstadoAdmin> {
  let resultado: string;

  try {
    const admin = await requireCapabilitySessionUser(CAPABILITIES.TRUST_MODERATE);
    await exigirLimitePorUsuario('admin-moderate', admin.id);

    const input = reporteSchema.parse({
      reporteId: texto(formData, 'reporteId'),
      decision: texto(formData, 'decision'),
      nota: texto(formData, 'nota'),
    });

    await reviewReport(admin, input.reporteId, input.decision, input.nota ?? null);

    resultado = input.decision === 'reviewed' ? 'Denuncia atendida.' : 'Denuncia descartada.';
  } catch (error) {
    return errorDeAdmin(error, formData);
  }

  revalidatePath('/admin/reportes');

  return { ok: resultado };
}
