import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadRootEnv, resetRootEnvCache } from './load-env';

let dir: string;

beforeEach(() => {
  resetRootEnvCache();
  dir = mkdtempSync(join(tmpdir(), 'offside-env-'));
});

afterEach(() => {
  resetRootEnvCache();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.OFFSIDE_TEST_VAR;
});

describe('loadRootEnv', () => {
  it('encuentra el .env subiendo desde un subdirectorio', () => {
    // Reproduce el caso real: Next arranca en apps/web y el .env esta arriba.
    writeFileSync(join(dir, '.env'), 'OFFSIDE_TEST_VAR=desde-la-raiz\n');
    const nested = join(dir, 'apps', 'web');
    mkdirSync(nested, { recursive: true });

    const cargado = loadRootEnv(nested);

    expect(cargado).toBe(join(dir, '.env'));
    expect(process.env.OFFSIDE_TEST_VAR).toBe('desde-la-raiz');
  });

  it('no pisa una variable que ya venia del entorno', () => {
    process.env.OFFSIDE_TEST_VAR = 'de-la-plataforma';
    writeFileSync(join(dir, '.env'), 'OFFSIDE_TEST_VAR=del-archivo\n');

    loadRootEnv(dir);

    expect(process.env.OFFSIDE_TEST_VAR).toBe('de-la-plataforma');
  });

  it('devuelve undefined si no hay ningun .env', () => {
    const vacio = join(dir, 'sin-env');
    mkdirSync(vacio, { recursive: true });

    expect(loadRootEnv(vacio)).toBeUndefined();
  });

  it('es idempotente', () => {
    writeFileSync(join(dir, '.env'), 'OFFSIDE_TEST_VAR=uno\n');

    expect(loadRootEnv(dir)).toBe(join(dir, '.env'));
    expect(loadRootEnv(dir)).toBe(join(dir, '.env'));
  });
});
