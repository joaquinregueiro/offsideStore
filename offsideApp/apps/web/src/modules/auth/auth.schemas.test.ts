import { beforeAll, describe, expect, it } from 'vitest';

/** Los schemas leen `AUTH_PASSWORD_MIN_LENGTH` del entorno al construirse. */
beforeAll(async () => {
  const { loadRootEnv } = await import('@offside/config');
  loadRootEnv(import.meta.dirname);
});

describe('registerSchema', () => {
  const valido = {
    email: 'Alguien@Offside.test',
    password: 'una-password-larga',
    acceptedTerms: true as const,
  };

  it('acepta un alta valida', async () => {
    const { registerSchema } = await import('./auth.schemas');

    expect(registerSchema.parse(valido).email).toBe('Alguien@Offside.test');
  });

  it('rechaza un email invalido', async () => {
    const { registerSchema } = await import('./auth.schemas');

    expect(() => registerSchema.parse({ ...valido, email: 'no-es-email' })).toThrow();
  });

  it('rechaza una password demasiado corta', async () => {
    const { registerSchema } = await import('./auth.schemas');

    expect(() => registerSchema.parse({ ...valido, password: 'corta' })).toThrow();
  });

  it('rechaza el alta sin aceptar terminos (BS-002)', async () => {
    const { registerSchema } = await import('./auth.schemas');

    expect(() => registerSchema.parse({ ...valido, acceptedTerms: false })).toThrow();
    expect(() =>
      registerSchema.parse({ email: valido.email, password: valido.password }),
    ).toThrow();
  });

  it('rechaza una password absurdamente larga (DoS por hashing)', async () => {
    const { registerSchema } = await import('./auth.schemas');

    expect(() => registerSchema.parse({ ...valido, password: 'x'.repeat(5000) })).toThrow();
  });
});

describe('loginSchema', () => {
  it('no aplica la politica de longitud al iniciar sesion', async () => {
    const { loginSchema } = await import('./auth.schemas');

    // Una password vieja pudo crearse con otra politica: rechazarla aca solo
    // filtraria usuarios legitimos.
    expect(() => loginSchema.parse({ email: 'a@b.test', password: 'x' })).not.toThrow();
  });

  it('exige password no vacia', async () => {
    const { loginSchema } = await import('./auth.schemas');

    expect(() => loginSchema.parse({ email: 'a@b.test', password: '' })).toThrow();
  });
});

describe('createSellerProfileSchema', () => {
  it('exige aceptar los terminos de vendedor (SS-002)', async () => {
    const { createSellerProfileSchema } = await import('./auth.schemas');

    expect(() =>
      createSellerProfileSchema.parse({ displayName: 'Mi Tienda', acceptedSellerTerms: false }),
    ).toThrow();
  });

  it('no acepta sellerTierId: los tiers estan sin definir (DEC-037)', async () => {
    const { createSellerProfileSchema } = await import('./auth.schemas');
    const parsed = createSellerProfileSchema.parse({
      displayName: 'Mi Tienda',
      acceptedSellerTerms: true,
      sellerTierId: 'algo',
    });

    expect(parsed).not.toHaveProperty('sellerTierId');
  });
});
