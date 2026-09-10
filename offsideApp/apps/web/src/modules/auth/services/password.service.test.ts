import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from './password.service';

/** Tests unitarios: no tocan la base. */
describe('password.service', () => {
  it('produce un hash argon2id, no la contrasena en claro', async () => {
    const hash = await hashPassword('una-contrasena-larga');

    expect(hash).not.toContain('una-contrasena-larga');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('el hash es distinto en cada llamada (salt aleatoria)', async () => {
    const [a, b] = await Promise.all([
      hashPassword('misma-password'),
      hashPassword('misma-password'),
    ]);

    expect(a).not.toBe(b);
  });

  it('verifica correctamente la contrasena correcta', async () => {
    const hash = await hashPassword('correcta-y-larga');

    await expect(verifyPassword(hash, 'correcta-y-larga')).resolves.toBe(true);
  });

  it('rechaza una contrasena incorrecta', async () => {
    const hash = await hashPassword('correcta-y-larga');

    await expect(verifyPassword(hash, 'incorrecta-y-larga')).resolves.toBe(false);
  });

  it('devuelve false ante un hash corrupto, sin lanzar', async () => {
    // Un registro corrupto no debe tumbar el login de todos.
    await expect(verifyPassword('no-es-un-hash', 'lo-que-sea')).resolves.toBe(false);
  });
});
