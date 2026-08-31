import * as errors from '@/modules/auth/auth.errors';
import { resolveSession, type PublicUser } from '@/modules/auth/services/auth.service';

import { getMySellerProfile } from '@/modules/sellers/services/seller.service';

import { hasCapability, type AdminRole, type Capability } from './permissions';
import { readSessionToken } from './session-cookie';

/**
 * Guard de autenticacion y autorizacion.
 *
 * Cuatro niveles, de menor a mayor exigencia:
 *
 *   requireUser          hay sesion valida
 *   requireVerifiedUser  + email verificado (BR-001) — el default para operar
 *   requireSeller        + tiene perfil de vendedor
 *   requireCapability    + su rol habilita una capacidad administrativa
 *
 *
 * Se usa desde los Route Handlers, que son los que orquestan. No hay middleware
 * global de Next a proposito: cada ruta declara explicitamente si exige sesion,
 * y asi no hay rutas protegidas "por accidente" ni desprotegidas por un patron
 * mal escrito.
 */

/** Devuelve el usuario autenticado, o `null` si no hay sesion valida. */
export async function getCurrentUser(request: Request): Promise<PublicUser | null> {
  const token = readSessionToken(request);
  if (!token) return null;

  return resolveSession(token);
}

/** Exige sesion valida. Lanza `NOT_AUTHENTICATED` (401) si no la hay. */
export async function requireUser(request: Request): Promise<PublicUser> {
  const user = await getCurrentUser(request);
  if (!user) throw errors.notAuthenticated();
  return user;
}

/**
 * Exige sesion valida **y** email verificado (BR-001).
 *
 * Es el guard por defecto para cualquier accion que sea "operar": comprar,
 * publicar, habilitarse como vendedor.
 */
export async function requireVerifiedUser(request: Request): Promise<PublicUser> {
  const user = await requireUser(request);
  if (!user.emailVerified) throw errors.emailNotVerified();
  return user;
}

/**
 * Exige que el usuario tenga un perfil de vendedor.
 *
 * ⚠️ VERIFICA QUE EXISTA EL PERFIL, NO QUE ESTE APROBADO. Es el guard del
 * BORDE: separa "esto es de vendedores" de "esto es de cualquiera". Si una
 * accion ademas exige estar aprobado o tener Mercado Pago conectado, eso lo
 * decide el Service, que es quien conoce la regla (TS-010, `canSell`).
 *
 * Duplicar esa regla aca la pondria en dos lugares que se desincronizan.
 */
export async function requireSeller(request: Request): Promise<PublicUser> {
  const user = await requireVerifiedUser(request);

  if ((await getMySellerProfile(user.id)) === null) throw errors.forbidden();

  return user;
}

/**
 * Exige uno de los roles administrativos indicados.
 *
 * PRIMITIVA DE BAJO NIVEL. Preferir `requireCapability`, que declara QUE se
 * quiere hacer en vez de QUIEN puede hacerlo: la lista de roles pertenece a la
 * politica (`lib/permissions.ts`), no al endpoint.
 *
 * Se conserva para el caso —hoy inexistente— de una restriccion por rol que no
 * corresponda a ninguna capacidad del mapa.
 */
export async function requireAdminRole(
  request: Request,
  allowed: readonly AdminRole[],
): Promise<PublicUser> {
  const user = await requireUser(request);

  if (user.adminRole === null || !allowed.includes(user.adminRole)) {
    throw errors.forbidden();
  }

  return user;
}

/**
 * Exige una CAPACIDAD administrativa (DEC-023).
 *
 * Es el guard que deben usar los endpoints del back-office: el endpoint declara
 * que necesita `payments:refund`, y el mapa de `lib/permissions.ts` decide que
 * roles la tienen.
 *
 * ⚠️ 401 vs 403, y la diferencia importa: sin sesion se responde
 * NOT_AUTHENTICATED (401, "no se quien sos"); con sesion pero sin permiso,
 * FORBIDDEN (403, "se quien sos y no podes"). Devolver 401 en el segundo caso
 * invitaria a reintentar con otra credencial; devolver 403 en el primero
 * confirmaria la existencia del recurso a un anonimo.
 */
export async function requireCapability(
  request: Request,
  capability: Capability,
): Promise<PublicUser> {
  const user = await requireUser(request);

  if (!hasCapability(user.adminRole, capability)) throw errors.forbidden();

  return user;
}
