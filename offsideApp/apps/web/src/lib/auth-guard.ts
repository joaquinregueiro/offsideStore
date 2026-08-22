import * as errors from '@/modules/auth/auth.errors';
import { resolveSession, type PublicUser } from '@/modules/auth/services/auth.service';

import { readSessionToken } from './session-cookie';

/**
 * Guard de autenticacion y autorizacion.
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

export type AdminRole = NonNullable<PublicUser['adminRole']>;

/**
 * Exige uno de los roles administrativos indicados.
 *
 * ⚠️ ALCANCE: autoriza SOLO por rol, que es lo unico cerrado (DEC-023 fija el
 * set `SUPER_ADMIN | ADMIN | MODERATOR | SUPPORT | FINANCE`). Los **permisos
 * granulares por rol siguen 🟡 PENDING**, asi que no hay ningun mapa de
 * permisos: inventarlo seria inventar una decision de negocio.
 *
 * Cada endpoint administrativo declara que roles acepta, hasta que DEC-023 se
 * cierre.
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
