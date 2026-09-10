import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { resolveSession, type PublicUser } from '@/modules/auth/services/auth.service';
import { getMySellerProfile } from '@/modules/sellers/services/seller.service';

import { capabilitiesFor, hasCapability, type Capability } from './permissions';
import { SESSION_COOKIE_NAME } from './session-cookie';

/**
 * Sesion desde SERVER COMPONENTS y SERVER ACTIONS.
 *
 * ⚠️ POR QUE NO SE REUSA `auth-guard.ts`. Ese modulo lee la sesion de un
 * `Request`, que es lo que reciben los Route Handlers. Un Server Component NO
 * tiene `Request`: accede a la cookie con `cookies()` de `next/headers`. Son dos
 * entradas distintas al MISMO mecanismo.
 *
 * Lo que NO se duplica es la regla: la resolucion de la sesion sigue siendo
 * `resolveSession` y la autorizacion sigue siendo el mapa de `permissions.ts`.
 * Aca solo cambia de donde sale el token.
 *
 * ⚠️ DIFERENCIA IMPORTANTE CON LOS GUARDS DE LA API: ante falta de permisos, una
 * pagina **redirige**; un endpoint **lanza** 401 o 403. Una persona frente a una
 * pantalla necesita ir a algun lado, no un codigo de estado.
 */

/** Usuario autenticado, o `null` si no hay sesion valida. */
export async function getSessionUser(): Promise<PublicUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (token === undefined || token === '') return null;

  return resolveSession(token);
}

/**
 * Exige sesion. Sin ella, redirige al login conservando a donde queria ir.
 *
 * ⚠️ `next` viaja en la URL y por eso se valida al volver: sin control, un
 * enlace `?next=https://otro-sitio` convertiria el login en un redirector
 * abierto para phishing. Ver `safeNextPath`.
 */
export async function requireSessionUser(volverA?: string): Promise<PublicUser> {
  const user = await getSessionUser();

  if (user === null) {
    const destino =
      volverA === undefined ? '/ingresar' : `/ingresar?next=${encodeURIComponent(volverA)}`;

    redirect(destino);
  }

  return user;
}

/**
 * Exige sesion **y** email verificado (BR-001).
 *
 * Es el guard por defecto de cualquier accion que sea "operar": comprar,
 * publicar, habilitarse como vendedor.
 */
export async function requireVerifiedSessionUser(volverA?: string): Promise<PublicUser> {
  const user = await requireSessionUser(volverA);
  if (!user.emailVerified) redirect('/verificar-email');

  return user;
}

/** Exige tener perfil de vendedor. Igual que `requireSeller`, pero para paginas. */
export async function requireSellerSessionUser(volverA?: string): Promise<PublicUser> {
  const user = await requireVerifiedSessionUser(volverA);
  if ((await getMySellerProfile(user.id)) === null) redirect('/vendedor/empezar');

  return user;
}

/**
 * Exige una capacidad administrativa (DEC-023).
 *
 * ⚠️ Un usuario SIN la capacidad recibe un 404, no un 403. Para alguien que no
 * es administrador, el back-office no deberia existir: un 403 le confirmaria
 * que la pantalla esta ahi. Sin sesion, en cambio, va al login como siempre.
 */
export async function requireCapabilitySessionUser(
  capability: Capability,
  volverA?: string,
): Promise<PublicUser> {
  const user = await requireSessionUser(volverA);
  if (!hasCapability(user.adminRole, capability)) notFound();

  return user;
}

/**
 * Exige tener AL MENOS UNA capacidad administrativa.
 *
 * Es el guard del indice del back-office, que no corresponde a una capacidad
 * concreta. Cada pantalla de adentro sigue exigiendo la suya: entrar al indice
 * no habilita nada.
 *
 * ⚠️ Sin ninguna capacidad devuelve 404, igual que
 * `requireCapabilitySessionUser` y por la misma razon: para quien no es
 * administrador, el back-office no deberia existir.
 */
export async function requireAnyCapabilitySessionUser(volverA?: string): Promise<PublicUser> {
  const user = await requireSessionUser(volverA);
  if (capabilitiesFor(user.adminRole).length === 0) notFound();

  return user;
}
