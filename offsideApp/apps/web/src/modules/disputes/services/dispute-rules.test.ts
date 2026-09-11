import { describe, expect, it } from 'vitest';

import {
  buildTimeline,
  canResolve,
  canTransition,
  claimDeadlineFor,
  claimEligibility,
  isOpen,
  normalizeDescription,
  normalizeEvidences,
  planResolution,
  sellerResponseDueFor,
  viewerRole,
  type ClaimOrder,
} from './dispute-rules';
import type {
  DisputeActionRow,
  DisputeEvidenceRow,
  DisputeRow,
  DisputeStatus,
} from '../repositories/dispute.repository';

/**
 * Reglas de los reclamos (DEC-009, TS-050..061, BR-032/034).
 *
 * Lo que se fija acá: el flujo es LINEAL y sin atajos, la ventana se cuenta
 * desde la entrega o el despacho, el despacho vencido sólo habilita "no
 * recibido", y una resolución se traduce a efectos sin ambigüedad.
 */

const AHORA = new Date('2026-09-11T12:00:00.000Z');
const dias = (n: number): Date => new Date(AHORA.getTime() - n * 24 * 60 * 60 * 1000);
const horas = (n: number): Date => new Date(AHORA.getTime() - n * 60 * 60 * 1000);

const AJUSTES = { windowDays: 7, dispatchDeadlineHours: 72 };

function orden(overrides: Partial<ClaimOrder> = {}): ClaimOrder {
  return {
    status: 'DELIVERED',
    paidAt: dias(10),
    shippedAt: dias(8),
    deliveredAt: dias(3),
    ...overrides,
  };
}

describe('máquina de estados (DEC-009)', () => {
  it('sólo admite el flujo lineal', () => {
    expect(canTransition('OPEN', 'WAITING_SELLER')).toBe(true);
    expect(canTransition('WAITING_SELLER', 'UNDER_REVIEW')).toBe(true);
    expect(canTransition('UNDER_REVIEW', 'RESOLVED')).toBe(true);
  });

  it('⚠️ no hay atajos: ni resolver sin pasar por revisión, ni volver atrás', () => {
    expect(canTransition('WAITING_SELLER', 'RESOLVED')).toBe(false);
    expect(canTransition('OPEN', 'RESOLVED')).toBe(false);
    expect(canTransition('OPEN', 'UNDER_REVIEW')).toBe(false);
    expect(canTransition('RESOLVED', 'UNDER_REVIEW')).toBe(false);
    expect(canTransition('UNDER_REVIEW', 'WAITING_SELLER')).toBe(false);
  });

  it('RESOLVED es terminal', () => {
    const todos: DisputeStatus[] = ['OPEN', 'WAITING_SELLER', 'UNDER_REVIEW', 'RESOLVED'];
    for (const destino of todos) expect(canTransition('RESOLVED', destino)).toBe(false);
    expect(isOpen('RESOLVED')).toBe(false);
    expect(isOpen('WAITING_SELLER')).toBe(true);
  });
});

describe('ventana de reclamo', () => {
  it('se cuenta desde la entrega confirmada', () => {
    const o = orden({ deliveredAt: dias(3) });
    expect(claimDeadlineFor(o, 7)).toEqual(new Date(dias(3).getTime() + 7 * 24 * 60 * 60 * 1000));
    expect(claimEligibility(o, 'damaged', AJUSTES, AHORA)).toMatchObject({
      ok: true,
      base: 'delivered',
    });
  });

  it('sin confirmación de entrega, desde el despacho', () => {
    const o = orden({ status: 'SHIPPED', deliveredAt: null, shippedAt: dias(5) });
    expect(claimEligibility(o, 'not_received', AJUSTES, AHORA)).toMatchObject({
      ok: true,
      base: 'shipped',
    });
  });

  it('⚠️ vencida la ventana, no se puede reclamar', () => {
    expect(claimEligibility(orden({ deliveredAt: dias(8) }), 'damaged', AJUSTES, AHORA)).toEqual({
      ok: false,
      motivo: 'ventana_vencida',
    });
    // Justo en el límite todavía vale: la ventana es inclusiva.
    expect(claimEligibility(orden({ deliveredAt: dias(7) }), 'damaged', AJUSTES, AHORA).ok).toBe(
      true,
    );
  });

  it('una orden COMPLETED sigue reclamable dentro de la ventana', () => {
    // La orden se completa sola al vencer la protección (MF-040); la ventana
    // de reclamo es otra clave y puede ser más larga.
    expect(
      claimEligibility(
        orden({ status: 'COMPLETED', deliveredAt: dias(2) }),
        'other',
        AJUSTES,
        AHORA,
      ).ok,
    ).toBe(true);
  });

  it('PROCESSING con despacho vencido habilita SOLO "no recibido" (BR-032)', () => {
    const vencida = orden({
      status: 'PROCESSING',
      paidAt: horas(80),
      shippedAt: null,
      deliveredAt: null,
    });
    expect(claimEligibility(vencida, 'not_received', AJUSTES, AHORA)).toEqual({
      ok: true,
      base: 'dispatch_overdue',
      deadline: null,
    });
    expect(claimEligibility(vencida, 'damaged', AJUSTES, AHORA)).toEqual({
      ok: false,
      motivo: 'motivo_no_admitido',
    });
  });

  it('PROCESSING en plazo no admite reclamo', () => {
    const enPlazo = orden({
      status: 'PROCESSING',
      paidAt: horas(10),
      shippedAt: null,
      deliveredAt: null,
    });
    expect(claimEligibility(enPlazo, 'not_received', AJUSTES, AHORA)).toEqual({
      ok: false,
      motivo: 'despacho_en_plazo',
    });
  });

  it('antes de pagar, pagada sin procesar o cancelada: no', () => {
    for (const status of ['PENDING_PAYMENT', 'PAID', 'CANCELLED'] as const) {
      expect(claimEligibility(orden({ status }), 'other', AJUSTES, AHORA)).toEqual({
        ok: false,
        motivo: 'estado',
      });
    }
  });

  it('una orden despachada sin fecha es un dato roto, no una ventana infinita', () => {
    expect(
      claimEligibility(
        orden({ status: 'SHIPPED', shippedAt: null, deliveredAt: null }),
        'other',
        AJUSTES,
        AHORA,
      ),
    ).toEqual({
      ok: false,
      motivo: 'sin_fecha',
    });
  });

  it('el plazo del vendedor se suma a la apertura', () => {
    expect(sellerResponseDueFor(AHORA, 3)).toEqual(new Date('2026-09-14T12:00:00.000Z'));
  });

  it('un plazo de cero o negativo es configuración rota', () => {
    expect(() => claimDeadlineFor(orden(), 0)).toThrow();
    expect(() => sellerResponseDueFor(AHORA, -1)).toThrow();
  });
});

describe('plan de resolución (TS-054)', () => {
  const TOTAL = 10_000_000n;

  it('no_action y return_required no tienen efecto automático', () => {
    for (const r of ['no_action', 'return_required'] as const) {
      expect(planResolution(r, undefined, TOTAL)).toEqual({
        ok: true,
        plan: { acciones: [{ action: r, amount: null }], reembolso: null, sancion: null },
      });
      expect(planResolution(r, 100n, TOTAL).ok).toBe(false);
    }
  });

  it('full_refund devuelve todo, sin importe', () => {
    expect(planResolution('full_refund', undefined, TOTAL)).toEqual({
      ok: true,
      plan: {
        acciones: [{ action: 'full_refund', amount: TOTAL }],
        reembolso: { amountCents: null, total: true },
        sancion: null,
      },
    });
    expect(planResolution('full_refund', 5n, TOTAL).ok).toBe(false);
    // Mandar el total explícito se tolera: es lo mismo.
    expect(planResolution('full_refund', TOTAL, TOTAL).ok).toBe(true);
  });

  it('partial_refund exige un importe estrictamente entre 0 y el total', () => {
    expect(planResolution('partial_refund', 2_500_000n, TOTAL)).toEqual({
      ok: true,
      plan: {
        acciones: [{ action: 'partial_refund', amount: 2_500_000n }],
        reembolso: { amountCents: 2_500_000n, total: false },
        sancion: null,
      },
    });
    expect(planResolution('partial_refund', undefined, TOTAL).ok).toBe(false);
    expect(planResolution('partial_refund', 0n, TOTAL).ok).toBe(false);
    expect(planResolution('partial_refund', TOTAL, TOTAL).ok).toBe(false);
    expect(planResolution('partial_refund', TOTAL + 1n, TOTAL).ok).toBe(false);
  });

  it('penalización y suspensión sancionan, y pueden sumar un reembolso', () => {
    expect(planResolution('seller_penalty', undefined, TOTAL)).toEqual({
      ok: true,
      plan: {
        acciones: [{ action: 'seller_penalty', amount: null }],
        reembolso: null,
        sancion: 'penalty',
      },
    });
    expect(planResolution('seller_suspended', TOTAL, TOTAL)).toEqual({
      ok: true,
      plan: {
        acciones: [
          { action: 'seller_suspended', amount: null },
          { action: 'full_refund', amount: TOTAL },
        ],
        reembolso: { amountCents: null, total: true },
        sancion: 'suspension',
      },
    });
    expect(planResolution('seller_suspended', 1_000n, TOTAL)).toMatchObject({
      ok: true,
      plan: { reembolso: { amountCents: 1_000n, total: false }, sancion: 'suspension' },
    });
  });
});

describe('quién ve y quién resuelve', () => {
  const disputa = { buyerId: 'comprador', sellerId: 'tienda' };

  it('el comprador y el vendedor ven la suya; un tercero no', () => {
    expect(viewerRole({ id: 'comprador', adminRole: null }, disputa, null)).toBe('buyer');
    expect(viewerRole({ id: 'vendedor', adminRole: null }, disputa, 'tienda')).toBe('seller');
    expect(viewerRole({ id: 'otro', adminRole: null }, disputa, 'otra-tienda')).toBeNull();
  });

  it('un administrador con la capacidad ve cualquiera; sin ella, ninguna', () => {
    expect(viewerRole({ id: 'admin', adminRole: 'ADMIN' }, disputa, null)).toBe('admin');
    expect(viewerRole({ id: 'fin', adminRole: 'FINANCE' }, disputa, null)).toBeNull();
    expect(viewerRole({ id: 'sup', adminRole: 'SUPPORT' }, disputa, null)).toBeNull();
  });

  it('⚠️ un administrador que es parte NO resuelve su propio reclamo', () => {
    expect(canResolve({ id: 'admin', adminRole: 'ADMIN' }, disputa, 'vendedor')).toBe('ok');
    expect(canResolve({ id: 'comprador', adminRole: 'ADMIN' }, disputa, 'vendedor')).toBe(
      'es_parte',
    );
    expect(canResolve({ id: 'vendedor', adminRole: 'ADMIN' }, disputa, 'vendedor')).toBe(
      'es_parte',
    );
    expect(canResolve({ id: 'x', adminRole: 'FINANCE' }, disputa, 'vendedor')).toBe(
      'sin_capacidad',
    );
    expect(canResolve({ id: 'x', adminRole: null }, disputa, 'vendedor')).toBe('sin_capacidad');
  });
});

describe('evidencias: sólo texto o URL', () => {
  it('reconoce http(s) y trata todo lo demás como texto', () => {
    expect(
      normalizeEvidences(['https://ejemplo.com/foto.jpg', ' vino roto ', 'javascript:alert(1)']),
    ).toEqual({
      ok: true,
      evidences: [
        { type: 'url', url: 'https://ejemplo.com/foto.jpg', note: null },
        { type: 'text', url: null, note: 'vino roto' },
        { type: 'text', url: null, note: 'javascript:alert(1)' },
      ],
    });
  });

  it('descarta vacíos, rechaza no-strings y techos', () => {
    expect(normalizeEvidences(['', '   '])).toEqual({ ok: true, evidences: [] });
    expect(normalizeEvidences(undefined)).toEqual({ ok: true, evidences: [] });
    expect(normalizeEvidences([42]).ok).toBe(false);
    expect(normalizeEvidences(Array.from({ length: 11 }, () => 'x')).ok).toBe(false);
    expect(normalizeEvidences(['a'.repeat(2_001)]).ok).toBe(false);
  });

  it('la descripción tiene mínimo y máximo', () => {
    expect(normalizeDescription('corto').ok).toBe(false);
    expect(normalizeDescription('  llegó con la manga descosida  ')).toEqual({
      ok: true,
      text: 'llegó con la manga descosida',
    });
    expect(normalizeDescription('a'.repeat(4_001)).ok).toBe(false);
    expect(normalizeDescription(null).ok).toBe(false);
  });
});

describe('línea de tiempo', () => {
  const T0 = new Date('2026-09-01T10:00:00.000Z');
  const T1 = new Date('2026-09-02T10:00:00.000Z');
  const DUE = new Date('2026-09-04T10:00:00.000Z');
  const T3 = new Date('2026-09-05T10:00:00.000Z');

  function disputa(overrides: Partial<DisputeRow> = {}): DisputeRow {
    return {
      id: 'd1',
      orderId: 'o1',
      buyerId: 'b',
      sellerId: 's',
      reason: 'damaged',
      status: 'WAITING_SELLER',
      resolution: null,
      refundedAmount: null,
      currency: 'ARS',
      openedAt: T0,
      sellerResponseDueAt: DUE,
      sellerRespondedAt: null,
      resolvedAt: null,
      createdAt: T0,
      ...overrides,
    };
  }
  const evidencia = (type: string, note: string): DisputeEvidenceRow => ({
    id: `e-${type}`,
    disputeId: 'd1',
    uploadedBy: type === 'response' ? 'seller' : 'buyer',
    uploaderId: null,
    type,
    storageKey: null,
    url: null,
    note,
    createdAt: T0,
  });
  const accion = (action: DisputeActionRow['action'], note: string | null): DisputeActionRow => ({
    id: `a-${action}`,
    disputeId: 'd1',
    action,
    amount: null,
    currency: 'ARS',
    decidedBy: 'admin',
    note,
    createdAt: T3,
  });

  it('abierta y esperando al vendedor: sólo la apertura', () => {
    expect(buildTimeline(disputa(), [evidencia('description', 'llegó rota')], [])).toEqual([
      {
        tipo: 'apertura',
        at: T0.toISOString(),
        actor: 'buyer',
        titulo: 'Reclamo abierto',
        detalle: 'llegó rota',
      },
    ]);
  });

  it('con respuesta del vendedor', () => {
    const t = buildTimeline(
      disputa({ status: 'UNDER_REVIEW', sellerRespondedAt: T1 }),
      [evidencia('description', 'x'), evidencia('response', 'salió perfecta')],
      [],
    );
    expect(t.map((e) => e.tipo)).toEqual(['apertura', 'respuesta']);
    expect(t[1]?.detalle).toBe('salió perfecta');
  });

  it('⚠️ escalada por vencimiento: se deduce y se fecha en el plazo', () => {
    const t = buildTimeline(disputa({ status: 'UNDER_REVIEW' }), [], []);
    expect(t.map((e) => e.tipo)).toEqual(['apertura', 'escalada']);
    expect(t[1]?.at).toBe(DUE.toISOString());
  });

  it('resuelta con reembolso: pendiente, rechazado o realizado según refunded_amount', () => {
    const base = disputa({
      status: 'RESOLVED',
      sellerRespondedAt: T1,
      resolvedAt: T3,
      resolution: 'full_refund',
    });
    const acciones = [accion('full_refund', 'procede')];

    expect(buildTimeline(base, [], acciones).map((e) => e.tipo)).toEqual([
      'apertura',
      'respuesta',
      'resolucion',
      'reembolso',
    ]);
    expect(buildTimeline(base, [], acciones).at(-1)?.titulo).toBe(
      'Reembolso pendiente de confirmación',
    );
    expect(buildTimeline({ ...base, refundedAmount: 0n }, [], acciones).at(-1)?.titulo).toBe(
      'Mercado Pago rechazó el reembolso',
    );
    expect(buildTimeline({ ...base, refundedAmount: 5n }, [], acciones).at(-1)).toMatchObject({
      titulo: 'Reembolso realizado',
      detalle: '5',
    });
    expect(buildTimeline(base, [], acciones)[2]?.detalle).toBe('procede');
  });

  it('una penalización con reembolso combinado también muestra el reembolso', () => {
    const d = disputa({
      status: 'RESOLVED',
      sellerRespondedAt: T1,
      resolvedAt: T3,
      resolution: 'seller_penalty',
      refundedAmount: 7n,
    });
    const t = buildTimeline(
      d,
      [],
      [accion('seller_penalty', null), accion('partial_refund', null)],
    );
    expect(t.map((e) => e.tipo)).toEqual(['apertura', 'respuesta', 'resolucion', 'reembolso']);
  });

  it('sin reembolso no inventa una entrada de reembolso', () => {
    const d = disputa({
      status: 'RESOLVED',
      sellerRespondedAt: T1,
      resolvedAt: T3,
      resolution: 'no_action',
    });
    expect(buildTimeline(d, [], [accion('no_action', null)]).map((e) => e.tipo)).toEqual([
      'apertura',
      'respuesta',
      'resolucion',
    ]);
  });
});
