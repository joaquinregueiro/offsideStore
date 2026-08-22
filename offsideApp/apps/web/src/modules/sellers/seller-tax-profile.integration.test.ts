import { getDatabase, schema } from '@offside/database';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type * as AuthService from '../auth/services/auth.service';
import type * as SellerService from './services/seller.service';
import type * as TaxService from './services/seller-tax-profile.service';

/**
 * Integracion contra PostgreSQL REAL. Requiere `docker compose up -d`.
 *   npm test -- --project=integration
 *
 * Limpia todo lo que crea: sufijo `@taxitest.offside`.
 */

const SUFIJO = '@taxitest.offside';
const email = (n: string) => `${n}${SUFIJO}`;
const PASSWORD = 'password-de-prueba-larga';
const CUIT_VALIDO = '20-12345678-6';
const CUIT_NORMALIZADO = '20123456786';

let authService: typeof AuthService;
let sellerService: typeof SellerService;
let taxService: typeof TaxService;

beforeAll(async () => {
  const { loadRootEnv } = await import('@offside/config');
  loadRootEnv(import.meta.dirname);

  authService = await import('../auth/services/auth.service');
  sellerService = await import('./services/seller.service');
  taxService = await import('./services/seller-tax-profile.service');

  await limpiar();
});

afterAll(async () => {
  await limpiar();
  const { closeDatabase } = await import('@offside/database');
  await closeDatabase();
});

async function limpiar(): Promise<void> {
  const db = getDatabase();
  const usuarios = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(like(schema.users.email, `%${SUFIJO}`));
  if (usuarios.length === 0) return;
  const ids = usuarios.map((u) => u.id);

  const perfiles = await db
    .select({ id: schema.sellerProfiles.id })
    .from(schema.sellerProfiles)
    .where(inArray(schema.sellerProfiles.userId, ids));
  if (perfiles.length > 0) {
    await db.delete(schema.sellerTaxProfiles).where(
      inArray(
        schema.sellerTaxProfiles.sellerId,
        perfiles.map((p) => p.id),
      ),
    );
  }

  await db.delete(schema.sellerProfiles).where(inArray(schema.sellerProfiles.userId, ids));
  await db.delete(schema.userHistoryEvents).where(inArray(schema.userHistoryEvents.userId, ids));
  await db.delete(schema.sessions).where(inArray(schema.sessions.userId, ids));
  await db
    .delete(schema.emailVerificationTokens)
    .where(inArray(schema.emailVerificationTokens.userId, ids));
  await db.delete(schema.users).where(inArray(schema.users.id, ids));
}

/** Usuario verificado CON perfil de vendedor. */
async function vendedor(nombre: string) {
  const { emailVerificationToken } = await authService.register({
    email: email(nombre),
    password: PASSWORD,
    acceptedTerms: true,
  });
  const user = await authService.verifyEmail(emailVerificationToken);
  await sellerService.createSellerProfile(user, {
    displayName: `Tienda ${nombre}`,
    acceptedSellerTerms: true,
  });
  return user;
}

describe('carga de identidad fiscal', () => {
  it('normaliza el identificador antes de persistirlo', async () => {
    const user = await vendedor('normaliza');

    const perfil = await taxService.submitTaxIdentity(user, {
      taxIdType: 'CUIT',
      taxId: CUIT_VALIDO,
    });

    expect(perfil.taxId).toBe(CUIT_NORMALIZADO);
    expect(perfil.taxIdType).toBe('CUIT');
  });

  it('nace PENDING: sintaxis valida NO es verificacion fiscal', async () => {
    const user = await vendedor('pendiente');

    const perfil = await taxService.submitTaxIdentity(user, {
      taxIdType: 'CUIT',
      taxId: CUIT_VALIDO,
    });

    expect(perfil.verificationStatus).toBe('PENDING');
    expect(perfil.taxCondition).toBeNull();
    expect(perfil.source).toBeNull();
    expect(perfil.checkedAt).toBeNull();
  });

  it('acepta CUIL y CDI, no solo CUIT', async () => {
    const cuil = await vendedor('cuil');
    await expect(
      taxService.submitTaxIdentity(cuil, { taxIdType: 'CUIL', taxId: '27123456780' }),
    ).resolves.toMatchObject({ taxIdType: 'CUIL' });

    const cdi = await vendedor('cdi');
    await expect(
      taxService.submitTaxIdentity(cdi, { taxIdType: 'CDI', taxId: '30123456781' }),
    ).resolves.toMatchObject({ taxIdType: 'CDI' });
  });

  it('rechaza un digito verificador incorrecto', async () => {
    const user = await vendedor('dv-malo');

    await expect(
      taxService.submitTaxIdentity(user, { taxIdType: 'CUIT', taxId: '20-12345678-3' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('un identificador invalido NO deja nada persistido', async () => {
    const user = await vendedor('sin-persistir');

    await expect(
      taxService.submitTaxIdentity(user, { taxIdType: 'CUIT', taxId: '123' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await expect(taxService.getMyTaxProfile(user)).resolves.toBeNull();
  });

  it('el mensaje de error NUNCA incluye el identificador ingresado', async () => {
    const user = await vendedor('sin-filtrar');

    await expect(
      taxService.submitTaxIdentity(user, { taxIdType: 'CUIT', taxId: '20-12345678-3' }),
    ).rejects.toSatisfy((e: Error) => !e.message.includes('12345678'));
  });

  it('exige perfil de vendedor previo', async () => {
    const { emailVerificationToken } = await authService.register({
      email: email('sin-perfil'),
      password: PASSWORD,
      acceptedTerms: true,
    });
    const user = await authService.verifyEmail(emailVerificationToken);

    await expect(
      taxService.submitTaxIdentity(user, { taxIdType: 'CUIT', taxId: CUIT_VALIDO }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('exige email verificado (BR-001)', async () => {
    const { user } = await authService.register({
      email: email('sin-verificar'),
      password: PASSWORD,
      acceptedTerms: true,
    });

    await expect(
      taxService.submitTaxIdentity(user, { taxIdType: 'CUIT', taxId: CUIT_VALIDO }),
    ).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
  });
});

describe('historial fiscal', () => {
  it('reemplazar el identificador conserva el anterior como historico', async () => {
    const user = await vendedor('historial');
    const primero = await taxService.submitTaxIdentity(user, {
      taxIdType: 'CUIT',
      taxId: CUIT_VALIDO,
    });
    const segundo = await taxService.submitTaxIdentity(user, {
      taxIdType: 'CUIL',
      taxId: '27123456780',
    });

    expect(segundo.id).not.toBe(primero.id);

    const vigente = await taxService.getMyTaxProfile(user);
    expect(vigente?.id).toBe(segundo.id);
    expect(vigente?.taxIdType).toBe('CUIL');

    // El anterior sigue en la base, cerrado.
    const seller = await getDatabase()
      .select()
      .from(schema.sellerProfiles)
      .where(eq(schema.sellerProfiles.userId, user.id));
    const filas = await getDatabase()
      .select()
      .from(schema.sellerTaxProfiles)
      .where(eq(schema.sellerTaxProfiles.sellerId, seller[0]!.id));

    expect(filas).toHaveLength(2);
    const cerrado = filas.find((f) => f.id === primero.id);
    expect(cerrado?.validTo).not.toBeNull();
  });

  it('el indice unico parcial garantiza una sola fila vigente', async () => {
    const user = await vendedor('unica-vigente');
    await taxService.submitTaxIdentity(user, { taxIdType: 'CUIT', taxId: CUIT_VALIDO });
    await taxService.submitTaxIdentity(user, { taxIdType: 'CUIL', taxId: '27123456780' });

    const seller = await getDatabase()
      .select()
      .from(schema.sellerProfiles)
      .where(eq(schema.sellerProfiles.userId, user.id));
    const vigentes = await getDatabase()
      .select()
      .from(schema.sellerTaxProfiles)
      .where(eq(schema.sellerTaxProfiles.sellerId, seller[0]!.id));

    expect(vigentes.filter((f) => f.validTo === null)).toHaveLength(1);
  });
});

describe('autorizacion', () => {
  it('cada vendedor solo ve y modifica SU perfil fiscal', async () => {
    const a = await vendedor('duenio-a');
    const b = await vendedor('duenio-b');

    await taxService.submitTaxIdentity(a, { taxIdType: 'CUIT', taxId: CUIT_VALIDO });
    await taxService.submitTaxIdentity(b, { taxIdType: 'CUIL', taxId: '27123456780' });

    // El perfil se resuelve SIEMPRE desde el usuario autenticado: no hay
    // parametro de id que un atacante pueda manipular.
    expect((await taxService.getMyTaxProfile(a))?.taxId).toBe(CUIT_NORMALIZADO);
    expect((await taxService.getMyTaxProfile(b))?.taxId).toBe('27123456780');
  });
});

describe('separacion de responsabilidades', () => {
  it('cargar datos fiscales NO aprueba al vendedor', async () => {
    const user = await vendedor('no-aprueba');
    await taxService.submitTaxIdentity(user, { taxIdType: 'CUIT', taxId: CUIT_VALIDO });

    const perfil = await sellerService.getMySellerProfile(user.id);
    expect(perfil?.status).toBe('pending'); // sigue pendiente
    expect(perfil?.approvedAt).toBeNull();
  });

  it('la verificacion fiscal falla porque NO hay fuente integrada', async () => {
    const user = await vendedor('sin-fuente');
    await taxService.submitTaxIdentity(user, { taxIdType: 'CUIT', taxId: CUIT_VALIDO });

    // No se inventa una condicion fiscal: se declara que no hay integracion.
    await expect(taxService.verifyTaxIdentity(user)).rejects.toMatchObject({
      code: 'FISCAL_SOURCE_UNAVAILABLE',
    });
  });

  it('la carga fiscal no crea ninguna regla de comision', async () => {
    const user = await vendedor('sin-comision');
    const perfil = await taxService.submitTaxIdentity(user, {
      taxIdType: 'CUIT',
      taxId: CUIT_VALIDO,
    });

    // El perfil fiscal no expone nada de comisiones: son conceptos desacoplados.
    expect(perfil).not.toHaveProperty('commissionRate');
    expect(perfil).not.toHaveProperty('feeRate');

    // Y el tier del vendedor sigue sin asignar (DEC-037 sin valores).
    const seller = await sellerService.getMySellerProfile(user.id);
    expect(seller?.sellerTierId).toBeNull();
  });
});
