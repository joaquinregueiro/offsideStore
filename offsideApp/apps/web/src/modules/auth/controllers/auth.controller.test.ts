import { resetEnvCache } from '@offside/config';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Limite por CUENTA del reset de password por la API.
 *
 * Auditoria de seguridad 2026-11-06: la Server Action lo aplicaba y el
 * endpoint no, asi que rotando IPs se podia inundar de emails la casilla de un
 * tercero. Lo que se fija aca es el orden: si la cuenta agoto su cupo, no se
 * genera ningun token ni se encola ningun email.
 */

const rateLimit = vi.hoisted(() => ({
  consumeIpLimit: vi.fn(),
  consumeAccountLimit: vi.fn(),
  checkAccountLimit: vi.fn(),
  registerFailedAttempt: vi.fn(),
}));

const authService = vi.hoisted(() => ({ requestPasswordReset: vi.fn() }));

vi.mock('@/lib/rate-limit', () => rateLimit);
vi.mock('../services/auth.service', () => authService);
vi.mock('@/lib/auth-guard', () => ({ requireUser: vi.fn() }));

const { forgotPassword } = await import('./auth.controller');

beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgresql://unit:unit@localhost:5432/unit';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.AUTH_SESSION_SECRET ??= 'pepper-solo-para-tests';
  resetEnvCache();
});

afterEach(() => {
  vi.resetAllMocks();
});

function pedido(): Request {
  return new Request('http://localhost/api/auth/password/forgot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
    body: JSON.stringify({ email: 'victima@example.test' }),
  });
}

describe('POST /api/auth/password/forgot', () => {
  it('⚠️ con el cupo de la CUENTA agotado responde 429 y no manda nada', async () => {
    rateLimit.consumeIpLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    rateLimit.consumeAccountLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 600 });

    const respuesta = await forgotPassword(pedido());

    expect(respuesta.status).toBe(429);
    expect(respuesta.headers.get('Retry-After')).toBe('600');
    expect(authService.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('consume el MISMO scope que la Server Action, para compartir contador', async () => {
    rateLimit.consumeIpLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    rateLimit.consumeAccountLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    authService.requestPasswordReset.mockResolvedValue(null);

    const respuesta = await forgotPassword(pedido());

    expect(respuesta.status).toBe(200);
    expect(rateLimit.consumeAccountLimit).toHaveBeenCalledWith(
      'password-forgot',
      'victima@example.test',
    );
    expect(authService.requestPasswordReset).toHaveBeenCalledOnce();
  });
});
