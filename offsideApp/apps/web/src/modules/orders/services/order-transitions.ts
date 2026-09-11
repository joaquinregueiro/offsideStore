import type { OrderRow } from '../repositories/order.repository';

/**
 * Maquina de estados de la orden (DEC-029) y ventanas de tiempo (DEC-033,
 * BR-032, BR-033). **Funciones puras**: sin base, sin reloj propio. Todo lo
 * que depende de "ahora" lo recibe por parametro para que los tests fabriquen
 * el instante que quieran.
 *
 * ⚠️ ES LA UNICA TABLA DE TRANSICIONES. Los Services consultan aca antes de
 * escribir; el repository ademas condiciona el UPDATE al estado de origen, asi
 * que una carrera entre dos transiciones simultaneas la gana una sola y la
 * otra ve `undefined`. Las dos capas dicen lo mismo a proposito: si alguien
 * agrega una transicion en una y no en la otra, el test de la maquina lo ve.
 *
 * ⚠️ NO ES UN MOTOR CONFIGURABLE. DEC-029 dice que las reglas se diseñan para
 * poder configurarse "a futuro" y DEC-032 prohibe construir el motor ahora.
 * Lo que SI sale de configuracion son los PLAZOS (`app_settings`): la tabla de
 * transiciones es codigo.
 */

export type OrderStatus = OrderRow['status'];

/**
 * Quien ejecuta la transicion.
 *
 * `buyer` y `seller` son ROLES EN LA ORDEN, no roles del sistema: el mismo
 * usuario es comprador en una orden y vendedor en otra. Se mapean a
 * `actor_type` de `order_status_history` (`user` / `seller` / `admin` /
 * `system`) al escribir.
 */
export type TransitionActor = 'buyer' | 'seller' | 'admin' | 'system';

interface Transition {
  from: OrderStatus;
  to: OrderStatus;
  actors: readonly TransitionActor[];
}

/**
 * Las transiciones permitidas, y por quien.
 *
 *  - `PENDING_PAYMENT → PAID` y `PAID → PROCESSING` son del sistema (webhook
 *    de Mercado Pago). `PAID` dura lo que dura una transaccion: la orden entra
 *    en `PROCESSING` en el mismo commit, porque el plazo de despacho (MF-030)
 *    corre desde que el pago se aprobo, no desde que alguien mira la orden.
 *  - `PROCESSING → SHIPPED` la hace el VENDEDOR (SH-010: despacho manual, sin
 *    Correo Argentino).
 *  - `SHIPPED → DELIVERED` la confirma el COMPRADOR. ⚠️ ASUMIDO: la doc
 *    deriva `DELIVERED` del tracking de Correo Argentino (marketplace-flow §6),
 *    que no existe. Sin proveedor, la unica persona que sabe que el paquete
 *    llego es quien lo recibio.
 *  - `DELIVERED → COMPLETED` es del sistema: vence la ventana de proteccion sin
 *    reclamo (BR-033 / MF-040). No la dispara el comprador al confirmar.
 *  - `PENDING_PAYMENT → CANCELLED`: el comprador, el sistema (vencio la
 *    ventana de pago) o un admin (DEC-033, los tres casos que enumera).
 *  - `PROCESSING → CANCELLED`: el vendedor antes de despachar, o un admin.
 *    ⚠️ ASUMIDO: la politica de cancelacion sigue 🔴 (`orders-and-refunds.md`
 *    §12); esta transicion existe para que el vendedor que no puede cumplir
 *    lo diga en vez de dejar vencer el plazo, y deja constancia de que hay
 *    un refund pendiente que ejecuta `payments`.
 *
 * No hay transicion desde `SHIPPED`, `DELIVERED` ni `COMPLETED` a `CANCELLED`:
 * con el paquete en viaje lo que corresponde es una disputa (DEC-034), no una
 * cancelacion.
 */
const TRANSICIONES: readonly Transition[] = [
  { from: 'PENDING_PAYMENT', to: 'PAID', actors: ['system'] },
  { from: 'PAID', to: 'PROCESSING', actors: ['system'] },
  { from: 'PROCESSING', to: 'SHIPPED', actors: ['seller'] },
  { from: 'SHIPPED', to: 'DELIVERED', actors: ['buyer'] },
  { from: 'DELIVERED', to: 'COMPLETED', actors: ['system'] },
  { from: 'PENDING_PAYMENT', to: 'CANCELLED', actors: ['buyer', 'system', 'admin'] },
  { from: 'PROCESSING', to: 'CANCELLED', actors: ['seller', 'admin'] },
];

/** Estados desde los que ya no se sale. */
export const ESTADOS_TERMINALES: readonly OrderStatus[] = ['COMPLETED', 'CANCELLED'];

export function canTransition(from: OrderStatus, to: OrderStatus, actor: TransitionActor): boolean {
  return TRANSICIONES.some((t) => t.from === from && t.to === to && t.actors.includes(actor));
}

/** Transiciones que un actor puede hacer desde un estado. Para las pantallas. */
export function allowedTransitions(from: OrderStatus, actor: TransitionActor): OrderStatus[] {
  return TRANSICIONES.filter((t) => t.from === from && t.actors.includes(actor)).map((t) => t.to);
}

/**
 * De `TransitionActor` al `actor_type` del ERD (§11.3). El comprador es un
 * `user` a secas: el enum no distingue "comprador" porque toda persona lo es.
 */
export function toHistoryActorType(actor: TransitionActor): 'user' | 'seller' | 'admin' | 'system' {
  return actor === 'buyer' ? 'user' : actor;
}

/* -------------------------------------------------------------------------- */
/* Ventanas                                                                    */
/* -------------------------------------------------------------------------- */

const MS_POR_MINUTO = 60_000;
const MS_POR_HORA = 60 * MS_POR_MINUTO;
const MS_POR_DIA = 24 * MS_POR_HORA;

/** Vencimiento de la ventana de pago (DEC-033) a partir del alta de la orden. */
export function computePaymentDeadline(createdAt: Date, windowMinutes: number): Date {
  assertPlazoPositivo(windowMinutes, 'payment_window_minutes');
  return new Date(createdAt.getTime() + windowMinutes * MS_POR_MINUTO);
}

/**
 * Plazo de despacho (BR-032 / MF-030): corre desde que el pago se aprobo.
 *
 * Devuelve `null` si la orden nunca se pago: no hay plazo que correr. Se
 * calcula, no se persiste: el ERD no tiene columna para el vencimiento del
 * despacho y `paid_at` + la configuracion vigente lo reconstruyen. ⚠️ Eso
 * significa que cambiar `dispatch_deadline_hours` mueve el plazo de las
 * ordenes en curso; es un plazo operativo, no un snapshot economico (DEC-030
 * protege el dinero, no los relojes).
 */
export function dispatchDeadlineFor(paidAt: Date | null, deadlineHours: number): Date | null {
  assertPlazoPositivo(deadlineHours, 'dispatch_deadline_hours');
  if (paidAt === null) return null;
  return new Date(paidAt.getTime() + deadlineHours * MS_POR_HORA);
}

/**
 * El plazo de despacho esta vencido: la orden sigue esperando despacho
 * (`PROCESSING`) y el vencimiento ya paso. Una orden despachada nunca esta
 * "vencida" aunque haya salido tarde: eso lo cuenta la reputacion comparando
 * `shipped_at` con el plazo, no este predicado.
 */
export function isDispatchOverdue(
  order: Pick<OrderRow, 'status' | 'paidAt'>,
  deadlineHours: number,
  now: Date,
): boolean {
  if (order.status !== 'PROCESSING') return false;
  const deadline = dispatchDeadlineFor(order.paidAt, deadlineHours);
  return deadline !== null && deadline.getTime() <= now.getTime();
}

/** Fin de la ventana de proteccion al comprador (BR-033/BR-034) desde la entrega. */
export function protectionWindowEnd(deliveredAt: Date, protectionDays: number): Date {
  assertPlazoPositivo(protectionDays, 'buyer_protection_days');
  return new Date(deliveredAt.getTime() + protectionDays * MS_POR_DIA);
}

/**
 * La ventana de proteccion vencio: la orden se puede cerrar sola (MF-040).
 * `deliveredAt` null = nunca se entrego = no vencio nada.
 */
export function hasProtectionWindowElapsed(
  deliveredAt: Date | null,
  protectionDays: number,
  now: Date,
): boolean {
  if (deliveredAt === null) return false;
  return protectionWindowEnd(deliveredAt, protectionDays).getTime() <= now.getTime();
}

/**
 * Un plazo de cero o negativo no es "sin plazo": es una configuracion rota que
 * cancelaria toda orden al nacer o cerraria toda entrega en el acto. Se
 * rechaza en el borde, con el nombre de la clave para que el admin sepa cual.
 */
function assertPlazoPositivo(valor: number, clave: string): void {
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error(`app_settings.${clave} debe ser un numero positivo (recibido: ${valor})`);
  }
}

/* -------------------------------------------------------------------------- */
/* Comision efectiva                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Tasa efectiva en basis points: la tasa base (del tier o la global) por el
 * multiplicador de promocion, si lo hay.
 *
 * ⚠️ SE REDONDEA AL BASIS POINT MAS CERCANO, y es deliberado: el snapshot
 * `commission_rate_at_transaction` es `numeric(6,4)`, o sea que no puede
 * guardar una fraccion de basis point. Si el importe se calculara con mas
 * precision que la tasa congelada, el snapshot no explicaria el importe
 * (DEC-030). 600 bp x 3 = 1800 bp; 600 x 1.5 = 900; 600 x 1.333 = 800 (799.8).
 *
 * Sin multiplicador (o con 1) devuelve la base intacta.
 */
export function effectiveBasisPoints(basisPoints: number, promotionMultiplier?: number): number {
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new Error(`basisPoints debe ser un entero no negativo (recibido: ${basisPoints})`);
  }
  if (promotionMultiplier === undefined) return basisPoints;
  if (!Number.isFinite(promotionMultiplier) || promotionMultiplier <= 0) {
    throw new Error(`promotionMultiplier debe ser positivo (recibido: ${promotionMultiplier})`);
  }

  return Math.round(basisPoints * promotionMultiplier);
}
