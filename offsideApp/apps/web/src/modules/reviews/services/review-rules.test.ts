import { describe, expect, it } from 'vitest';

import { AuthError } from '../../auth/auth.errors';
import {
  COMMENT_MAX_LENGTH,
  isWithinReviewWindow,
  normalizeComment,
  normalizeReply,
  REPLY_MAX_LENGTH,
  reviewDeadline,
  reviewEligibilityError,
  validateRating,
  type ReviewEligibilityInput,
} from './review-rules';

/**
 * Reglas de la calificación (BS-100 / BR-051 / ERD §15), sin base.
 */

const AHORA = new Date('2026-09-11T12:00:00.000Z');
const HACE_10_DIAS = new Date('2026-09-01T12:00:00.000Z');
const HACE_31_DIAS = new Date('2026-08-11T12:00:00.000Z');

function caso(overrides: Partial<ReviewEligibilityInput> = {}): ReviewEligibilityInput {
  return {
    order: {
      status: 'COMPLETED',
      buyerId: 'comprador',
      sellerUserId: 'vendedor',
      completedAt: HACE_10_DIAS,
    },
    raterId: 'comprador',
    windowDays: 30,
    now: AHORA,
    alreadyReviewed: false,
    ...overrides,
  };
}

function codigo(error: AuthError | null): string | null {
  return error === null ? null : error.code;
}

describe('validateRating', () => {
  it('acepta enteros de 1 a 5', () => {
    for (const r of [1, 2, 3, 4, 5]) expect(validateRating(r)).toBe(r);
  });

  it('rechaza fuera de rango, decimales y strings', () => {
    for (const r of [0, 6, 3.5, '4', null, undefined, Number.NaN]) {
      expect(() => validateRating(r)).toThrow(AuthError);
    }
  });
});

describe('normalizeComment', () => {
  it('vacío o solo espacios es "sin comentario"', () => {
    expect(normalizeComment(undefined)).toBeNull();
    expect(normalizeComment(null)).toBeNull();
    expect(normalizeComment('')).toBeNull();
    expect(normalizeComment('   ')).toBeNull();
  });

  it('recorta y respeta el techo', () => {
    expect(normalizeComment('  muy buena atención  ')).toBe('muy buena atención');
    expect(normalizeComment('a'.repeat(COMMENT_MAX_LENGTH))).toHaveLength(COMMENT_MAX_LENGTH);
    expect(() => normalizeComment('a'.repeat(COMMENT_MAX_LENGTH + 1))).toThrow(AuthError);
  });
});

describe('normalizeReply', () => {
  it('la respuesta es obligatoria', () => {
    expect(() => normalizeReply('')).toThrow(AuthError);
    expect(() => normalizeReply('   ')).toThrow(AuthError);
    expect(() => normalizeReply(undefined)).toThrow(AuthError);
  });

  it('recorta y respeta el techo', () => {
    expect(normalizeReply('  gracias  ')).toBe('gracias');
    expect(() => normalizeReply('b'.repeat(REPLY_MAX_LENGTH + 1))).toThrow(AuthError);
  });
});

describe('ventana de calificación', () => {
  it('el límite es exactamente completed_at + N días', () => {
    const limite = reviewDeadline(HACE_10_DIAS, 30);
    expect(limite.toISOString()).toBe('2026-10-01T12:00:00.000Z');
    expect(isWithinReviewWindow(HACE_10_DIAS, 30, limite)).toBe(true);
    expect(isWithinReviewWindow(HACE_10_DIAS, 30, new Date(limite.getTime() + 1))).toBe(false);
  });

  it('31 días después con ventana de 30, se cerró', () => {
    expect(isWithinReviewWindow(HACE_31_DIAS, 30, AHORA)).toBe(false);
  });

  it('⚠️ sin completed_at no se puede haber vencido: se deja calificar', () => {
    expect(isWithinReviewWindow(null, 30, AHORA)).toBe(true);
  });
});

describe('reviewEligibilityError', () => {
  it('con todo en orden, puede', () => {
    expect(reviewEligibilityError(caso())).toBeNull();
  });

  it('solo el comprador de la orden', () => {
    const error = reviewEligibilityError(caso({ raterId: 'otro' }));
    expect(codigo(error)).toBe('FORBIDDEN');
    expect(error?.message).toContain('quien compró');
  });

  it('⚠️ BR-051: nunca a la propia tienda, y antes que cualquier otra regla', () => {
    const autocompra = caso({
      order: { status: 'PAID', buyerId: 'yo', sellerUserId: 'yo', completedAt: null },
      raterId: 'yo',
    });
    const error = reviewEligibilityError(autocompra);
    expect(codigo(error)).toBe('FORBIDDEN');
    expect(error?.message).toContain('propia tienda');
  });

  it('solo orden COMPLETED, y el mensaje dice en qué estado está', () => {
    const error = reviewEligibilityError(caso({ order: { ...caso().order, status: 'DELIVERED' } }));
    expect(codigo(error)).toBe('VALIDATION_FAILED');
    expect(error?.message).toContain('DELIVERED');
  });

  it('vencida la ventana, no', () => {
    const error = reviewEligibilityError(
      caso({ order: { ...caso().order, completedAt: HACE_31_DIAS } }),
    );
    expect(codigo(error)).toBe('VALIDATION_FAILED');
    expect(error?.message).toContain('30 días');
  });

  it('una por orden', () => {
    const error = reviewEligibilityError(caso({ alreadyReviewed: true }));
    expect(codigo(error)).toBe('VALIDATION_FAILED');
    expect(error?.message).toContain('ya tiene');
  });
});
