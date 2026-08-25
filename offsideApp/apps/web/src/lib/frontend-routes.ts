import { getEnv } from '@offside/config';

/**
 * Rutas del frontend a las que el backend redirige.
 *
 * ⚠️ PROVISORIO Y AISLADO A PROPOSITO. El frontend todavia es un placeholder,
 * asi que estas rutas todavia no existen. Se centralizan aca para que el dia
 * que exista el frontend definitivo se cambien en un solo lugar, sin tocar
 * controllers ni servicios.
 *
 * No son configuracion de negocio ni entran al Config Store (CLAUDE.md §12):
 * son parte del mapa de navegacion de la propia aplicacion.
 */

/** Pantalla donde el vendedor gestiona su conexion con Mercado Pago. */
export const SELLER_MERCADOPAGO_PATH = '/vendedor/mercadopago';

/** Resultado con el que vuelve el callback de Mercado Pago (spec §13). */
export type MercadoPagoCallbackStatus = 'connected' | 'cancelled' | 'error';

/**
 * Construye la URL de retorno del callback de Mercado Pago.
 *
 * ⚠️ `reason` es SIEMPRE un motivo generico. El detalle tecnico queda en
 * `audit_log`: decirle al browser por que fallo exactamente permitiria
 * descubrir, por ejemplo, que cuentas de Mercado Pago ya estan registradas en
 * Offside (spec §14).
 */
export function mercadoPagoCallbackUrl(status: MercadoPagoCallbackStatus, reason?: string): string {
  const url = new URL(SELLER_MERCADOPAGO_PATH, getEnv().APP_URL);
  url.searchParams.set('status', status);
  if (reason !== undefined) url.searchParams.set('reason', reason);

  return url.toString();
}
