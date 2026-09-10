import { describe, expect, it } from 'vitest';

import { parseEnv, requireEnv } from './env';

const baseEnv = {
  DATABASE_URL: 'postgresql://offside:offside@localhost:5432/offside_dev',
  REDIS_URL: 'redis://localhost:6379',
};

describe('parseEnv', () => {
  it('acepta un entorno minimo valido y aplica defaults', () => {
    const env = parseEnv(baseEnv);

    expect(env.APP_ENV).toBe('development');
    expect(env.APP_URL).toBe('http://localhost:3000');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('falla si falta una variable obligatoria', () => {
    expect(() => parseEnv({ REDIS_URL: baseEnv.REDIS_URL })).toThrowError(/DATABASE_URL/);
  });

  it('falla si DATABASE_URL no es PostgreSQL', () => {
    expect(() => parseEnv({ ...baseEnv, DATABASE_URL: 'mysql://x' })).toThrowError(/PostgreSQL/);
  });

  it('rechaza un APP_ENV desconocido', () => {
    expect(() => parseEnv({ ...baseEnv, APP_ENV: 'staging' })).toThrowError(/APP_ENV/);
  });
});

describe('requireEnv', () => {
  it('devuelve el valor cuando esta definido', () => {
    const env = parseEnv({ ...baseEnv, MERCADOPAGO_ACCESS_TOKEN: 'test-token' });

    expect(requireEnv(env, 'MERCADOPAGO_ACCESS_TOKEN')).toBe('test-token');
  });

  it('falla con un mensaje accionable cuando no esta definido', () => {
    const env = parseEnv(baseEnv);

    expect(() => requireEnv(env, 'MERCADOPAGO_ACCESS_TOKEN')).toThrowError(
      /MERCADOPAGO_ACCESS_TOKEN/,
    );
  });
});
