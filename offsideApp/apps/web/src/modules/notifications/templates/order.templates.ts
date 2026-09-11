// Ruta RELATIVA y no el alias `@/`: este modulo lo carga tambien el seed, que
// corre con tsx desde la raiz del monorepo y ahi el alias de `apps/web` no
// existe. El resto de `modules/` que usa `@/` son Controllers, que solo corren
// dentro de Next.
import { fecha, precio } from '../../../lib/formato';

import type { EmailMessage } from '../infrastructure/email/email-sender.port';
import { dias, envolver, textoPlano, urlAbsoluta } from './base';

/**
 * Plantillas de los emails de compra, venta, despacho, entrega, reclamo,
 * calificacion y nivel de vendedor. Son los siete eventos que
 * `notifications-and-engagement.md` §2.1 lista ademas del registro.
 *
 * ⚠️ TEXTO, TONO Y DISENO SIGUEN 🟡 en la documentacion. Lo de aca es sobrio a
 * proposito y NO PROMETE NADA QUE EL SISTEMA NO HAGA: no hay envios por Correo
 * Argentino (el despacho lo marca el vendedor a mano), no hay plazos de entrega
 * y no hay mensajeria in-app. Cuando exista la definicion de marca se
 * reemplaza SOLO este archivo.
 *
 * ⚠️ NINGUN EMAIL LLEVA UN TOKEN NI UN ENLACE FIRMADO: todos apuntan a
 * pantallas que exigen sesion. Es deliberado: un email se reenvia, se filtra y
 * queda en casillas ajenas por anos; lo que lleva adentro no puede abrir nada
 * por si solo.
 *
 * ⚠️ NO SE CRUZAN DATOS ENTRE LAS PARTES. El email al vendedor no lleva el
 * email ni la direccion del comprador (la ve en su panel, con sesion), y el
 * del comprador no lleva el email del vendedor. Hay tests que lo fijan.
 *
 * Las funciones reciben DATOS PLANOS Y SERIALIZABLES —viajan en el payload del
 * job de BullMQ como JSON—, nunca filas de Drizzle ni `Date`.
 */

/**
 * Rutas del frontend a las que apuntan los enlaces. Hoy existen las tres.
 * No hay pantalla de detalle de una orden ni de un reclamo: cuando existan
 * se cambia aca y en ningun otro lado.
 */
export const RUTA_MIS_COMPRAS = '/mis-compras';
export const RUTA_VENTAS = '/vendedor/ventas';
export const RUTA_PANEL_VENDEDOR = '/vendedor';

/* ------------------------------------------------------------ tipos de entrada */

/** Lo que una plantilla necesita saber de una orden. Snapshot, no fila. */
export interface OrdenEmail {
  id: string;
  /** `orders.order_number`, el que la persona reconoce. */
  numero: string;
  /** `orders.total_amount` en centavos, como string (regla de dinero del ERD). */
  total: string;
  moneda: string;
  articulos: { titulo: string; cantidad: number }[];
  /**
   * `orders.seller_amount` en centavos, como string. Solo lo llevan los emails
   * al vendedor; null si el snapshot no lo tiene todavia.
   */
  importeVendedor?: string | null | undefined;
}

/**
 * Seguimiento cargado por el vendedor (`shipments.provider = 'manual'`).
 *
 * ⚠️ SIN URL A PROPOSITO. El seguimiento lo escribe el vendedor, y un enlace
 * escrito por una parte y mandado a la otra desde nuestro remitente es un
 * vector de phishing. Se manda el numero y el nombre del transportista, que
 * son texto; el comprador lo consulta donde corresponda.
 */
export interface SeguimientoEmail {
  numero: string;
  transportista: string | null;
}

export interface DisputaEmail {
  id: string;
  ordenId: string;
  ordenNumero: string;
  /** `dispute_reason` del ERD. Se traduce aca. */
  motivo: string;
  /** ISO 8601. Plazo del vendedor (`seller_response_due_at`); null si no hay. */
  respuestaHasta: string | null;
  /** `dispute_resolution` del ERD; null mientras no este resuelta. */
  resolucion: string | null;
  /** Centavos como string; null si la resolucion no reembolsa. */
  importeReembolsado: string | null;
  moneda: string;
}

export interface ResenaEmail {
  ordenNumero: string;
  /** 1 a 5 (`reviews.rating`). */
  puntaje: number;
  comentario: string | null;
}

export interface NivelVendedorEmail {
  /** `seller_tiers.code`. */
  codigo: string;
  /** `seller_tiers.name`, el que se le muestra a la persona. */
  nombre: string;
  /**
   * Comision del tier en BASIS POINTS (500 = 5 %). El caller la convierte desde
   * `seller_tiers.commission_rate`, que guarda fraccion. Null si el tier no la
   * define: el email no inventa un numero.
   */
  comisionBasisPoints: number | null;
}

export type ParteDeLaOrden = 'comprador' | 'vendedor';

/* ------------------------------------------------------------------ helpers */

function saludo(nombre: string | null): string {
  return nombre !== null && nombre.trim() !== '' ? `Hola, ${nombre.trim()}.` : 'Hola.';
}

function listaDeArticulos(orden: OrdenEmail): string {
  return orden.articulos
    .map((a) => (a.cantidad === 1 ? a.titulo : `${a.titulo} (x${a.cantidad})`))
    .join('; ');
}

function datosDeOrden(orden: OrdenEmail): { etiqueta: string; valor: string }[] {
  return [
    { etiqueta: 'Orden', valor: orden.numero },
    { etiqueta: 'Artículo', valor: listaDeArticulos(orden) },
    { etiqueta: 'Total', valor: precio(orden.total, orden.moneda) },
  ];
}

/** 500 -> "5 %", 550 -> "5,5 %". */
function porcentaje(basisPoints: number): string {
  const numero = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(
    basisPoints / 100,
  );

  return `${numero} %`;
}

/**
 * Motivos de reclamo (`dispute_reason`), en palabras. Presentacion: los
 * valores del enum estan bien asi en la base. Un valor desconocido se muestra
 * tal cual antes que romper el email.
 */
const MOTIVOS_DE_RECLAMO: Record<string, string> = {
  not_received: 'Producto no recibido',
  different_from_listing: 'Producto distinto al publicado',
  counterfeit: 'Producto falsificado',
  condition_mismatch: 'La condición no coincide con la publicada',
  size_mismatch: 'El talle no coincide con el publicado',
  damaged: 'Producto dañado',
  wrong_description: 'Descripción incorrecta',
  other: 'Otro motivo',
};

export function motivoDeReclamo(valor: string): string {
  return MOTIVOS_DE_RECLAMO[valor] ?? valor;
}

/** Resoluciones (`dispute_resolution`, trust-and-safety.md §5.5), en palabras. */
const RESOLUCIONES: Record<string, string> = {
  no_action: 'Reclamo desestimado, sin reembolso',
  partial_refund: 'Reembolso parcial al comprador',
  full_refund: 'Reembolso total al comprador',
  return_required: 'El comprador debe devolver el producto',
  seller_penalty: 'Penalización al vendedor',
  seller_suspended: 'Suspensión del vendedor',
};

export function resolucionDeReclamo(valor: string): string {
  return RESOLUCIONES[valor] ?? valor;
}

function armar(
  to: string,
  subject: string,
  contenido: {
    titulo: string;
    parrafos: string[];
    datos?: { etiqueta: string; valor: string }[];
    boton: { texto: string; ruta: string };
  },
): EmailMessage {
  const boton = { texto: contenido.boton.texto, href: urlAbsoluta(contenido.boton.ruta) };
  const datos = contenido.datos !== undefined ? { datos: contenido.datos } : {};

  return {
    to,
    subject,
    text: textoPlano({ parrafos: contenido.parrafos, ...datos, boton }),
    html: envolver({ titulo: contenido.titulo, parrafos: contenido.parrafos, ...datos, boton }),
  };
}

/* --------------------------------------------------------------- plantillas */

/** Al vendedor, cuando el pago de una orden queda aprobado (MF-030). */
export function nuevaVenta(to: string, nombre: string | null, orden: OrdenEmail): EmailMessage {
  const datos = datosDeOrden(orden);
  if (orden.importeVendedor !== undefined && orden.importeVendedor !== null) {
    datos.push({
      etiqueta: 'Te corresponde',
      valor: precio(orden.importeVendedor, orden.moneda),
    });
  }

  return armar(to, `Vendiste: orden ${orden.numero} — Offside Store`, {
    titulo: 'Tenés una venta',
    parrafos: [
      saludo(nombre),
      `Se acreditó el pago de la orden ${orden.numero}. Ya podés prepararla: la dirección de envío está en tu panel de ventas.`,
      'Cuando la despaches, marcala como enviada y cargá el transportista y el número de seguimiento: el comprador los va a ver en su compra.',
    ],
    datos,
    boton: { texto: 'Ver la venta', ruta: RUTA_VENTAS },
  });
}

/** Al comprador, cuando su pago queda aprobado. */
export function compraConfirmada(
  to: string,
  nombre: string | null,
  orden: OrdenEmail,
): EmailMessage {
  return armar(to, `Compra confirmada: orden ${orden.numero} — Offside Store`, {
    titulo: 'Tu compra está confirmada',
    parrafos: [
      saludo(nombre),
      `Recibimos el pago de la orden ${orden.numero}. El vendedor ya fue avisado para que la prepare.`,
      'Te vamos a escribir cuando la despache. Podés seguir el estado desde tus compras.',
    ],
    datos: datosDeOrden(orden),
    boton: { texto: 'Ver mis compras', ruta: RUTA_MIS_COMPRAS },
  });
}

/** Al comprador, cuando el vendedor marca la orden como enviada. */
export function pedidoDespachado(
  to: string,
  nombre: string | null,
  orden: OrdenEmail,
  seguimiento: SeguimientoEmail,
): EmailMessage {
  const datos = datosDeOrden(orden);
  datos.push({ etiqueta: 'Seguimiento', valor: seguimiento.numero });
  if (seguimiento.transportista !== null && seguimiento.transportista.trim() !== '') {
    datos.push({ etiqueta: 'Transportista', valor: seguimiento.transportista.trim() });
  }

  return armar(to, `Tu compra está en camino: orden ${orden.numero} — Offside Store`, {
    titulo: 'Tu compra fue despachada',
    parrafos: [
      saludo(nombre),
      `El vendedor despachó la orden ${orden.numero} y cargó el número de seguimiento.`,
      'Cuando la recibas, confirmalo desde tus compras. Si algo no está bien, ahí mismo podés abrir un reclamo.',
    ],
    datos,
    boton: { texto: 'Ver mis compras', ruta: RUTA_MIS_COMPRAS },
  });
}

/**
 * Al comprador, para recordarle que confirme la recepcion antes de que venza
 * la ventana de proteccion (BR-033 / MF-040).
 *
 * ⚙️ El PLAZO viene calculado por quien llama (`buyer_protection_days` en el
 * Config Store). Aca solo se dice cuanto falta.
 */
export function confirmaRecepcion(
  to: string,
  nombre: string | null,
  orden: OrdenEmail,
  diasRestantes: number,
): EmailMessage {
  const restantes = Math.max(0, Math.floor(diasRestantes));
  const plazo =
    restantes === 0
      ? 'La ventana para confirmar o reclamar vence hoy.'
      : `Tenés ${dias(restantes)} para confirmarla o abrir un reclamo.`;

  return armar(to, `¿Recibiste tu compra? Orden ${orden.numero} — Offside Store`, {
    titulo: '¿Recibiste tu compra?',
    parrafos: [
      saludo(nombre),
      `La orden ${orden.numero} figura como despachada. Si ya la tenés, confirmá la recepción desde tus compras.`,
      `${plazo} Si no hacés nada en ese tiempo, la compra se da por completada.`,
    ],
    datos: datosDeOrden(orden),
    boton: { texto: 'Confirmar recepción', ruta: RUTA_MIS_COMPRAS },
  });
}

/** Al vendedor, cuando la orden pasa a `COMPLETED`. */
export function ventaCompletada(
  to: string,
  nombre: string | null,
  orden: OrdenEmail,
): EmailMessage {
  const datos = datosDeOrden(orden);
  if (orden.importeVendedor !== undefined && orden.importeVendedor !== null) {
    datos.push({
      etiqueta: 'Te corresponde',
      valor: precio(orden.importeVendedor, orden.moneda),
    });
  }

  return armar(to, `Venta completada: orden ${orden.numero} — Offside Store`, {
    titulo: 'Venta completada',
    parrafos: [
      saludo(nombre),
      `La orden ${orden.numero} quedó completada. Esta venta ya cuenta para tu historial y tu nivel de vendedor.`,
      'El comprador puede dejarte una calificación; si lo hace, te avisamos.',
    ],
    datos,
    boton: { texto: 'Ver mis ventas', ruta: RUTA_VENTAS },
  });
}

/**
 * A cualquiera de las dos partes, cuando la orden pasa a `CANCELLED`.
 *
 * ⚠️ `pagoAcreditado` lo decide quien llama mirando el pago, no la orden: si
 * fue cancelada desde `PENDING_PAYMENT` no hay nada que devolver y decir
 * "reembolso" confundiria. Cuando si lo hubo, se dice que se gestiona por
 * Mercado Pago —que es el mecanismo documentado en `orders-and-refunds.md`—
 * y NADA sobre plazos, que dependen del proveedor y no estan confirmados.
 */
export function ordenCancelada(
  to: string,
  nombre: string | null,
  orden: OrdenEmail,
  parte: ParteDeLaOrden,
  pagoAcreditado: boolean,
): EmailMessage {
  const parrafos = [saludo(nombre), `La orden ${orden.numero} fue cancelada.`];

  if (parte === 'comprador') {
    parrafos.push(
      pagoAcreditado
        ? 'Como el pago ya se había acreditado, el reembolso se gestiona a través de Mercado Pago.'
        : 'No se te cobró nada por esta orden.',
    );
  } else {
    parrafos.push(
      pagoAcreditado
        ? 'El importe se devuelve al comprador a través de Mercado Pago. No hace falta que despaches nada.'
        : 'No hace falta que despaches nada: el pago nunca se acreditó.',
    );
  }

  return armar(to, `Orden cancelada: ${orden.numero} — Offside Store`, {
    titulo: 'Orden cancelada',
    parrafos,
    datos: datosDeOrden(orden),
    boton:
      parte === 'comprador'
        ? { texto: 'Ver mis compras', ruta: RUTA_MIS_COMPRAS }
        : { texto: 'Ver mis ventas', ruta: RUTA_VENTAS },
  });
}

/** Al vendedor, cuando el comprador abre un reclamo (TS-050). */
export function reclamoAbierto(
  to: string,
  nombre: string | null,
  disputa: DisputaEmail,
): EmailMessage {
  const datos = [
    { etiqueta: 'Orden', valor: disputa.ordenNumero },
    { etiqueta: 'Motivo', valor: motivoDeReclamo(disputa.motivo) },
  ];
  const parrafos = [
    saludo(nombre),
    `El comprador abrió un reclamo sobre la orden ${disputa.ordenNumero}.`,
  ];

  if (disputa.respuestaHasta !== null) {
    datos.push({ etiqueta: 'Respondé antes del', valor: fecha(disputa.respuestaHasta) });
    // ⚠️ SOLO el plazo. Que pasa si el vendedor no responde es TS-052 y sigue
    // 🟡: el email no lo afirma.
    parrafos.push(
      `Tenés tiempo hasta el ${fecha(disputa.respuestaHasta)} para responder y cargar evidencia desde tus ventas.`,
    );
  } else {
    parrafos.push('Podés responder y cargar evidencia desde tus ventas.');
  }

  return armar(to, `Reclamo sobre la orden ${disputa.ordenNumero} — Offside Store`, {
    titulo: 'Recibiste un reclamo',
    parrafos,
    datos,
    boton: { texto: 'Ver el reclamo', ruta: RUTA_VENTAS },
  });
}

/** A cada parte, cuando el reclamo queda `RESOLVED`. */
export function reclamoResuelto(
  to: string,
  nombre: string | null,
  disputa: DisputaEmail,
  parte: ParteDeLaOrden,
): EmailMessage {
  const datos = [
    { etiqueta: 'Orden', valor: disputa.ordenNumero },
    { etiqueta: 'Motivo', valor: motivoDeReclamo(disputa.motivo) },
    {
      etiqueta: 'Resolución',
      valor: disputa.resolucion !== null ? resolucionDeReclamo(disputa.resolucion) : 'Sin detalle',
    },
  ];
  if (disputa.importeReembolsado !== null) {
    datos.push({
      etiqueta: 'Reembolso',
      valor: precio(disputa.importeReembolsado, disputa.moneda),
    });
  }

  const parrafos = [
    saludo(nombre),
    `El reclamo sobre la orden ${disputa.ordenNumero} quedó resuelto.`,
  ];
  if (disputa.importeReembolsado !== null) {
    // ⚠️ Sin "al mismo medio de pago" ni plazos: como devuelve Mercado Pago es
    // comportamiento del proveedor (🔵) y no se afirma desde aca.
    parrafos.push(
      parte === 'comprador'
        ? 'El reembolso se gestiona a través de Mercado Pago.'
        : 'El reembolso al comprador se gestiona a través de Mercado Pago.',
    );
  }

  return armar(to, `Reclamo resuelto: orden ${disputa.ordenNumero} — Offside Store`, {
    titulo: 'Reclamo resuelto',
    parrafos,
    datos,
    boton:
      parte === 'comprador'
        ? { texto: 'Ver mis compras', ruta: RUTA_MIS_COMPRAS }
        : { texto: 'Ver mis ventas', ruta: RUTA_VENTAS },
  });
}

/** Al vendedor, cuando el comprador deja una calificacion (MF-041). */
export function calificacionRecibida(
  to: string,
  nombre: string | null,
  resena: ResenaEmail,
): EmailMessage {
  const datos = [
    { etiqueta: 'Orden', valor: resena.ordenNumero },
    { etiqueta: 'Puntaje', valor: `${resena.puntaje} de 5` },
  ];
  if (resena.comentario !== null && resena.comentario.trim() !== '') {
    datos.push({ etiqueta: 'Comentario', valor: resena.comentario.trim() });
  }

  return armar(to, `Recibiste una calificación: orden ${resena.ordenNumero} — Offside Store`, {
    titulo: 'Recibiste una calificación',
    parrafos: [
      saludo(nombre),
      `El comprador de la orden ${resena.ordenNumero} te dejó una calificación. Podés responderla desde tus ventas.`,
    ],
    datos,
    boton: { texto: 'Ver la calificación', ruta: RUTA_VENTAS },
  });
}

/** Al vendedor, cuando cambia su tier (`seller_profiles.seller_tier_id`). */
export function nivelDeVendedorActualizado(
  to: string,
  nombre: string | null,
  nivel: NivelVendedorEmail,
): EmailMessage {
  const datos = [{ etiqueta: 'Nivel', valor: nivel.nombre }];
  const parrafos = [saludo(nombre), `Tu nivel de vendedor ahora es "${nivel.nombre}".`];

  if (nivel.comisionBasisPoints !== null) {
    datos.push({ etiqueta: 'Comisión', valor: porcentaje(nivel.comisionBasisPoints) });
    parrafos.push(
      `A partir de ahora la comisión de Offside sobre tus ventas es del ${porcentaje(nivel.comisionBasisPoints)}. Las órdenes anteriores mantienen la comisión con la que se crearon.`,
    );
  }

  return armar(to, `Tu nivel de vendedor cambió: ${nivel.nombre} — Offside Store`, {
    titulo: 'Tu nivel de vendedor cambió',
    parrafos,
    datos,
    boton: { texto: 'Ver mi panel', ruta: RUTA_PANEL_VENDEDOR },
  });
}
