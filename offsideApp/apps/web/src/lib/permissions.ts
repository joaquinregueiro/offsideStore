import type { PublicUser } from '@/modules/auth/services/auth.service';

/**
 * DEC-023 — quien puede hacer que en el back-office.
 *
 * =============================================================================
 * ESTE ARCHIVO ES LA UNICA FUENTE DE LA POLITICA DE PERMISOS.
 * =============================================================================
 *
 * Antes cada endpoint declaraba su propia lista de roles en la llamada al
 * guard. Funcionaba, pero dejaba la politica dispersa: para saber quien podia
 * reembolsar habia que leer el controller de payments. Ahora el endpoint
 * declara **la capacidad** y el mapa vive aca.
 *
 * ⚠️ ALCANCE DEL MAPA — decidido por el owner el 2026-08-27.
 *
 * Se mapean SOLO las capacidades que existen hoy o son inminentes. `AR-006`
 * (`architecture.md`) lista nueve capacidades del back-office —usuarios y
 * suspensiones, vendedores y aprobaciones, moderacion, ordenes, pagos, refunds,
 * disputas, bloqueos, audit logs— pero la mayoria pertenece a modulos que
 * todavia no existen. Fijarles permisos ahora seria decidir politica sobre
 * funcionalidad no disenada.
 *
 * `MODERATOR`, `SUPPORT` y FINANCE-fuera-de-pagos quedan **declarados sin
 * capacidades**: el rol se puede asignar, pero hoy no habilita nada. Es
 * deliberado y no es un olvido.
 *
 * ⚠️ 2026-09-11: existen `disputes:resolve` y `trust:moderate`, y las tienen
 * SOLO los dos roles generales. Que SUPPORT resuelva reclamos o que MODERATOR
 * sancione suena natural por el nombre, pero "quien analiza" una disputa es
 * TS-052 🟡 y la moderacion de vendedores no tiene politica escrita: darles la
 * capacidad seria decidir eso desde el codigo. Cuando el owner lo cierre, es
 * un cambio de una linea en el mapa y otra en el test.
 */

export type AdminRole = NonNullable<PublicUser['adminRole']>;

/** Los cinco roles de DEC-023, en un solo lugar. */
export const ADMIN_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'MODERATOR',
  'SUPPORT',
  'FINANCE',
] as const satisfies readonly AdminRole[];

/**
 * Capacidades administrativas con permisos definidos.
 *
 * El nombre es `recurso:accion`. Se agregan a medida que existe la
 * funcionalidad, nunca antes.
 */
export const CAPABILITIES = {
  /** Emitir un reembolso sobre un pago (ERD §12.4). */
  PAYMENTS_REFUND: 'payments:refund',
  /** Leer y modificar el Config Store (`app_settings`, DEC-013/DEC-038). */
  SYSTEM_CONFIG_MANAGE: 'system_config:manage',
  /**
   * Revisar y resolver disputas (ERD §14, `trust-and-safety.md` §5), y leer
   * cualquier disputa desde el back-office.
   */
  DISPUTES_RESOLVE: 'disputes:resolve',
  /** Aplicar y levantar sanciones a vendedores (ERD §16.2). */
  TRUST_MODERATE: 'trust:moderate',
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

/**
 * El mapa. Un rol que no figura en una capacidad NO la tiene.
 *
 * ⚠️ NO HAY HERENCIA entre roles ni comodines. `SUPER_ADMIN` aparece
 * explicitamente en cada linea: un rol que "puede todo" por defecto convierte
 * cualquier capacidad futura en un permiso concedido sin que nadie lo decida.
 */
const MAPA: Readonly<Record<Capability, readonly AdminRole[]>> = {
  // FINANCE entra porque un reembolso es una operacion de dinero. Se mantiene
  // el conjunto que el endpoint ya usaba antes de centralizar el mapa.
  'payments:refund': ['SUPER_ADMIN', 'ADMIN', 'FINANCE'],
  // La configuracion cambia reglas de negocio para toda la plataforma —entre
  // ellas la comision—, asi que queda en los dos roles generales.
  'system_config:manage': ['SUPER_ADMIN', 'ADMIN'],
  // ⚠️ Resolver con reembolso mueve dinero sin pasar por `payments:refund`;
  // se acepta porque OR-001/OR-002 dicen que el refund SE ORIGINA en la
  // resolucion y su importe LO FIJA la resolucion —la resolucion es la causa
  // trazable, no un atajo—. SUPPORT no entra aunque el nombre lo sugiera:
  // quien analiza sigue 🟡 en TS-052. FINANCE tampoco: su capacidad es el
  // dinero, no el juicio sobre el reclamo.
  'disputes:resolve': ['SUPER_ADMIN', 'ADMIN'],
  // Sancionar a un vendedor es moderar (AR-006: "usuarios y suspensiones"),
  // pero no hay politica escrita de moderacion: queda en los dos roles
  // generales. Una sancion que nace de una disputa la aplica el flujo de
  // resolucion con `disputes:resolve`, sin necesitar esta capacidad.
  'trust:moderate': ['SUPER_ADMIN', 'ADMIN'],
};

/** Roles que tienen una capacidad. */
export function rolesFor(capability: Capability): readonly AdminRole[] {
  return MAPA[capability];
}

/**
 * Si un rol habilita una capacidad.
 *
 * ⚠️ FALLA CERRADO. Un rol `null` (usuario comun) o un valor que no este en el
 * mapa devuelve `false`. Nunca concede por defecto.
 */
export function hasCapability(role: AdminRole | null | undefined, capability: Capability): boolean {
  const permitidos = MAPA[capability] as readonly AdminRole[] | undefined;

  // Una capacidad fuera del mapa es un BUG, no una decision de permisos.
  // TypeScript ya lo impide, pero si llegara igual —un cast, un valor
  // construido en runtime— se rompe con un mensaje claro en vez de dejar que
  // `undefined.includes` tire un TypeError opaco. Nunca concede.
  if (permitidos === undefined) {
    throw new Error(`Capacidad desconocida: "${capability}". No esta en el mapa de DEC-023.`);
  }

  if (role === null || role === undefined) return false;

  return permitidos.includes(role);
}

/**
 * Capacidades que habilita un rol.
 *
 * Existe para el back-office: el indice necesita saber QUE mostrarle a cada
 * administrador, y decidir si tiene que existir para el. Se deriva del MISMO
 * mapa, asi que no puede desincronizarse de `hasCapability`.
 *
 * ⚠️ Sigue sin autorizar. Autorizar es `hasCapability` contra una capacidad
 * concreta; esto solo enumera.
 */
export function capabilitiesFor(role: AdminRole | null | undefined): Capability[] {
  if (role === null || role === undefined) return [];

  return (Object.keys(MAPA) as Capability[]).filter((capacidad) => MAPA[capacidad].includes(role));
}

/**
 * Rol efectivo de un actor, para mostrarlo o registrarlo.
 *
 * ⚠️ ES DESCRIPTIVO, NO AUTORIZA. Autorizar se hace con `hasCapability` o con
 * los guards: reducir a un solo rol perderia el detalle —un ADMIN tambien puede
 * ser vendedor— y decidir permisos sobre esa reduccion seria un bug esperando.
 *
 * Precedencia: administrador gana sobre vendedor, y vendedor sobre usuario.
 */
export type ActorRole = 'user' | 'seller' | 'admin';

export function actorRole(user: PublicUser, isSeller: boolean): ActorRole {
  if (user.adminRole !== null) return 'admin';
  if (isSeller) return 'seller';

  return 'user';
}
