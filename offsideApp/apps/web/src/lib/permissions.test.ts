import { describe, expect, it } from 'vitest';

import {
  ADMIN_ROLES,
  CAPABILITIES,
  actorRole,
  hasCapability,
  rolesFor,
  type AdminRole,
  type Capability,
} from './permissions';
import type { PublicUser } from '@/modules/auth/services/auth.service';

/**
 * DEC-023 — el mapa de permisos.
 *
 * Lo que se protege acá es que el mapa **falle cerrado**: cualquier duda tiene
 * que resolverse negando, nunca concediendo.
 */

function usuario(adminRole: AdminRole | null): PublicUser {
  return {
    id: 'no-importa',
    email: 'alguien@ejemplo.com',
    displayName: null,
    status: 'active',
    userLevel: 'NUEVO',
    riskLevel: 'NORMAL',
    adminRole,
    emailVerified: true,
  };
}

describe('el mapa de capacidades', () => {
  it('reembolsar es de SUPER_ADMIN, ADMIN y FINANCE', () => {
    expect(rolesFor(CAPABILITIES.PAYMENTS_REFUND)).toEqual(['SUPER_ADMIN', 'ADMIN', 'FINANCE']);
  });

  it('configurar el sistema es sólo de SUPER_ADMIN y ADMIN', () => {
    // La configuración cambia reglas para toda la plataforma, la comisión
    // incluida: no entra FINANCE.
    expect(rolesFor(CAPABILITIES.SYSTEM_CONFIG_MANAGE)).toEqual(['SUPER_ADMIN', 'ADMIN']);
  });

  it('resolver disputas es sólo de SUPER_ADMIN y ADMIN', () => {
    // Quién analiza un reclamo sigue 🟡 (TS-052): hasta que el owner lo
    // cierre, la capacidad queda en los dos roles generales. SUPPORT no entra
    // aunque el nombre lo sugiera; FINANCE tampoco: lo suyo es el dinero.
    expect(rolesFor(CAPABILITIES.DISPUTES_RESOLVE)).toEqual(['SUPER_ADMIN', 'ADMIN']);
  });

  it('sancionar vendedores es sólo de SUPER_ADMIN y ADMIN', () => {
    expect(rolesFor(CAPABILITIES.TRUST_MODERATE)).toEqual(['SUPER_ADMIN', 'ADMIN']);
  });

  it('⚠️ MODERATOR y SUPPORT siguen sin ninguna capacidad', () => {
    // DEC-023 los dejó declarados sin capacidades. Que ahora existan
    // `disputes:resolve` y `trust:moderate` no cambia eso: asignarles una
    // sería decidir política (TS-052) desde el código.
    for (const capacidad of Object.values(CAPABILITIES)) {
      expect(hasCapability('SUPPORT', capacidad)).toBe(false);
      expect(hasCapability('MODERATOR', capacidad)).toBe(false);
    }
  });

  it('FINANCE no resuelve disputas ni sanciona', () => {
    expect(hasCapability('FINANCE', CAPABILITIES.DISPUTES_RESOLVE)).toBe(false);
    expect(hasCapability('FINANCE', CAPABILITIES.TRUST_MODERATE)).toBe(false);
  });

  it('FINANCE puede reembolsar pero NO tocar la configuración', () => {
    expect(hasCapability('FINANCE', CAPABILITIES.PAYMENTS_REFUND)).toBe(true);
    expect(hasCapability('FINANCE', CAPABILITIES.SYSTEM_CONFIG_MANAGE)).toBe(false);
  });

  it('SUPER_ADMIN figura explícitamente en cada capacidad', () => {
    // No hay comodín ni herencia: un rol que "puede todo" por defecto
    // convertiría cualquier capacidad futura en un permiso concedido sin que
    // nadie lo haya decidido.
    for (const capacidad of Object.values(CAPABILITIES)) {
      expect(rolesFor(capacidad)).toContain('SUPER_ADMIN');
    }
  });
});

describe('falla cerrado', () => {
  it('un usuario común (rol null) no tiene ninguna capacidad', () => {
    for (const capacidad of Object.values(CAPABILITIES)) {
      expect(hasCapability(null, capacidad)).toBe(false);
    }
  });

  it('undefined tampoco concede', () => {
    expect(hasCapability(undefined, CAPABILITIES.PAYMENTS_REFUND)).toBe(false);
  });

  it('⚠️ un rol inválido no concede nada', () => {
    // El enum de PostgreSQL lo impide, pero el mapa no puede depender de eso:
    // un dato viejo o una migración futura no deben abrir permisos.
    const invalido = 'ROOT' as AdminRole;

    for (const capacidad of Object.values(CAPABILITIES)) {
      expect(hasCapability(invalido, capacidad)).toBe(false);
    }
  });

  it('una capacidad desconocida se rompe en vez de conceder', () => {
    // Es un BUG, no una decision de permisos: TypeScript ya lo impide, pero si
    // llegara igual tiene que fallar con un mensaje claro y sin conceder.
    const inexistente = 'usuarios:borrar' as Capability;

    for (const rol of ADMIN_ROLES) {
      expect(() => hasCapability(rol, inexistente)).toThrowError(/Capacidad desconocida/);
    }
  });
});

describe('actorRole — descriptivo, no autoriza', () => {
  it('administrador gana sobre vendedor', () => {
    expect(actorRole(usuario('ADMIN'), true)).toBe('admin');
  });

  it('vendedor gana sobre usuario común', () => {
    expect(actorRole(usuario(null), true)).toBe('seller');
  });

  it('sin rol ni perfil, es usuario común', () => {
    expect(actorRole(usuario(null), false)).toBe('user');
  });
});
