import { describe, expect, it } from 'vitest';

import {
  ESTADOS_TERMINALES,
  allowedTransitions,
  canTransition,
  computePaymentDeadline,
  dispatchDeadlineFor,
  effectiveBasisPoints,
  hasProtectionWindowElapsed,
  isDispatchOverdue,
  protectionWindowEnd,
  toHistoryActorType,
  type OrderStatus,
  type TransitionActor,
} from './order-transitions';

/**
 * Maquina de estados de la orden (DEC-029) y ventanas (DEC-033, BR-032,
 * BR-033). Lo que se fija aca es QUIEN puede mover QUE: un actor de mas en la
 * tabla es un agujero de autorizacion que ninguna pantalla ve.
 */

const ESTADOS: readonly OrderStatus[] = [
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
];
const ACTORES: readonly TransitionActor[] = ['buyer', 'seller', 'admin', 'system'];

/** Las UNICAS transiciones permitidas. Cualquier otra combinacion es no. */
const PERMITIDAS: readonly [OrderStatus, OrderStatus, TransitionActor][] = [
  ['PENDING_PAYMENT', 'PAID', 'system'],
  ['PAID', 'PROCESSING', 'system'],
  ['PROCESSING', 'SHIPPED', 'seller'],
  ['SHIPPED', 'DELIVERED', 'buyer'],
  ['DELIVERED', 'COMPLETED', 'system'],
  ['PENDING_PAYMENT', 'CANCELLED', 'buyer'],
  ['PENDING_PAYMENT', 'CANCELLED', 'system'],
  ['PENDING_PAYMENT', 'CANCELLED', 'admin'],
  ['PROCESSING', 'CANCELLED', 'seller'],
  ['PROCESSING', 'CANCELLED', 'admin'],
];

describe('canTransition', () => {
  it('permite exactamente la tabla de DEC-029 por actor, y nada mas', () => {
    // Producto cartesiano completo: 7 x 7 x 4 = 196 combinaciones.
    for (const from of ESTADOS) {
      for (const to of ESTADOS) {
        for (const actor of ACTORES) {
          const esperado = PERMITIDAS.some(([f, t, a]) => f === from && t === to && a === actor);
          expect(canTransition(from, to, actor), `${from} → ${to} por ${actor}`).toBe(esperado);
        }
      }
    }
  });

  it('el vendedor NO puede marcar entregado ni el comprador despachar', () => {
    expect(canTransition('SHIPPED', 'DELIVERED', 'seller')).toBe(false);
    expect(canTransition('PROCESSING', 'SHIPPED', 'buyer')).toBe(false);
  });

  it('el comprador NO puede completar la orden: lo hace el sistema al vencer la proteccion', () => {
    expect(canTransition('DELIVERED', 'COMPLETED', 'buyer')).toBe(false);
    expect(canTransition('DELIVERED', 'COMPLETED', 'system')).toBe(true);
  });

  it('con el paquete en viaje no hay cancelacion: eso es una disputa (DEC-034)', () => {
    for (const from of ['SHIPPED', 'DELIVERED', 'COMPLETED'] as const) {
      for (const actor of ACTORES) {
        expect(canTransition(from, 'CANCELLED', actor)).toBe(false);
      }
    }
  });

  it('el vendedor solo cancela ANTES de despachar y despues de cobrar', () => {
    expect(canTransition('PROCESSING', 'CANCELLED', 'seller')).toBe(true);
    expect(canTransition('PENDING_PAYMENT', 'CANCELLED', 'seller')).toBe(false);
    expect(canTransition('PAID', 'CANCELLED', 'seller')).toBe(false);
  });

  it('desde un estado terminal no se sale', () => {
    for (const from of ESTADOS_TERMINALES) {
      for (const to of ESTADOS) {
        for (const actor of ACTORES) {
          expect(canTransition(from, to, actor)).toBe(false);
        }
      }
    }
  });
});

describe('allowedTransitions', () => {
  it('lista lo que cada actor puede hacer desde un estado, para las pantallas', () => {
    expect(allowedTransitions('PROCESSING', 'seller')).toEqual(['SHIPPED', 'CANCELLED']);
    expect(allowedTransitions('PENDING_PAYMENT', 'buyer')).toEqual(['CANCELLED']);
    expect(allowedTransitions('SHIPPED', 'buyer')).toEqual(['DELIVERED']);
    expect(allowedTransitions('SHIPPED', 'seller')).toEqual([]);
  });
});

describe('toHistoryActorType', () => {
  it('el comprador es un `user` a secas en el ERD', () => {
    expect(toHistoryActorType('buyer')).toBe('user');
    expect(toHistoryActorType('seller')).toBe('seller');
    expect(toHistoryActorType('admin')).toBe('admin');
    expect(toHistoryActorType('system')).toBe('system');
  });
});

/* -------------------------------------------------------------------------- */

const T0 = new Date('2026-09-11T12:00:00.000Z');
const minutos = (n: number) => new Date(T0.getTime() + n * 60_000);
const horas = (n: number) => minutos(n * 60);
const dias = (n: number) => horas(n * 24);

describe('ventana de pago (DEC-033)', () => {
  it('vence `payment_window_minutes` despues de crear la orden', () => {
    expect(computePaymentDeadline(T0, 2880)).toEqual(dias(2));
  });

  it('rechaza un plazo de cero o negativo, nombrando la clave', () => {
    expect(() => computePaymentDeadline(T0, 0)).toThrow(/payment_window_minutes/);
    expect(() => computePaymentDeadline(T0, -5)).toThrow(/payment_window_minutes/);
  });
});

describe('plazo de despacho (BR-032 / MF-030)', () => {
  it('corre desde que se aprobo el pago', () => {
    expect(dispatchDeadlineFor(T0, 72)).toEqual(dias(3));
  });

  it('sin pago no hay plazo', () => {
    expect(dispatchDeadlineFor(null, 72)).toBeNull();
  });

  it('esta vencido solo si sigue en PROCESSING y el plazo paso', () => {
    const orden = { status: 'PROCESSING' as const, paidAt: T0 };

    expect(isDispatchOverdue(orden, 72, horas(71))).toBe(false);
    expect(isDispatchOverdue(orden, 72, horas(72))).toBe(true);
    expect(isDispatchOverdue(orden, 72, horas(100))).toBe(true);
  });

  it('una orden despachada nunca esta "vencida", aunque haya salido tarde', () => {
    expect(isDispatchOverdue({ status: 'SHIPPED', paidAt: T0 }, 72, horas(500))).toBe(false);
    expect(isDispatchOverdue({ status: 'PAID', paidAt: T0 }, 72, horas(500))).toBe(false);
  });
});

describe('proteccion al comprador (BR-033 / BR-034 / MF-040)', () => {
  it('termina `buyer_protection_days` despues de la entrega', () => {
    expect(protectionWindowEnd(T0, 7)).toEqual(dias(7));
  });

  it('vencio cuando paso el plazo; nunca si no se entrego', () => {
    expect(hasProtectionWindowElapsed(T0, 7, dias(6))).toBe(false);
    expect(hasProtectionWindowElapsed(T0, 7, dias(7))).toBe(true);
    expect(hasProtectionWindowElapsed(null, 7, dias(100))).toBe(false);
  });
});

describe('comision efectiva (DEC-030)', () => {
  it('sin multiplicador, la base intacta', () => {
    expect(effectiveBasisPoints(600)).toBe(600);
    expect(effectiveBasisPoints(600, 1)).toBe(600);
  });

  it('con promocion multiplica y redondea al basis point', () => {
    expect(effectiveBasisPoints(600, 3)).toBe(1800);
    expect(effectiveBasisPoints(600, 1.5)).toBe(900);
    expect(effectiveBasisPoints(600, 1.333)).toBe(800);
  });

  it('rechaza bases o multiplicadores invalidos', () => {
    expect(() => effectiveBasisPoints(-1)).toThrow();
    expect(() => effectiveBasisPoints(6.5)).toThrow();
    expect(() => effectiveBasisPoints(600, 0)).toThrow();
  });
});
