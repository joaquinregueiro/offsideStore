'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { CAPABILITIES } from '@/lib/permissions';
import { requireCapabilitySessionUser } from '@/lib/session';
import { AuthError } from '@/modules/auth/auth.errors';
import { setCommissionRateBasisPoints } from '@/modules/config/services/settings.service';
import { refundPayment } from '@/modules/payments/services/refund.service';

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
 */

export interface EstadoAdmin {
  error?: string;
  ok?: string;
}

function texto(formData: FormData, nombre: string): string | undefined {
  const valor = formData.get(nombre);

  return typeof valor === 'string' && valor !== '' ? valor : undefined;
}

function mensajeDeError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? 'Revisá los datos ingresados.';
  }

  if (error instanceof AuthError) return error.message;

  console.error('[admin] error inesperado en una accion:', error);

  return 'Tuvimos un problema. Probá de nuevo en un momento.';
}

/* --------------------------------------------------------------- comision -- */

/**
 * ⚠️ SE INGRESA EN PORCENTAJE Y SE GUARDA EN BASIS POINTS. La fuente de verdad
 * es el entero en bp (600 = 6%): un porcentaje en punto flotante no sobrevive
 * el viaje —`0.06` no es representable en binario—. El formulario acepta hasta
 * dos decimales y se multiplica por 100 con redondeo.
 */
const comisionSchema = z.object({
  porcentaje: z.coerce
    .number()
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

    const { porcentaje } = comisionSchema.parse({ porcentaje: texto(formData, 'porcentaje') });
    const basisPoints = Math.round(porcentaje * 100);

    await setCommissionRateBasisPoints(basisPoints, admin.id);
  } catch (error) {
    return { error: mensajeDeError(error) };
  }

  // La pantalla lee el valor vigente; sin esto seguiria mostrando el anterior.
  revalidatePath('/admin/comision');

  return { ok: 'Comisión actualizada. Rige para las órdenes nuevas.' };
}

/* ---------------------------------------------------------------- refunds -- */

const reembolsoSchema = z.object({
  paymentId: z.string().uuid(),
  /** Vacío = reembolso total. Con importe = parcial, en pesos. */
  montoPesos: z.coerce.number().positive('El importe tiene que ser mayor a cero').optional(),
  motivo: z.string().trim().max(500).optional(),
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
    return { error: mensajeDeError(error) };
  }

  revalidatePath('/admin/pagos');

  return { ok: resultado };
}
