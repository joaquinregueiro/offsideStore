/**
 * Puerto hacia la fuente fiscal oficial (ARCA).
 *
 * El dominio depende de ESTA interfaz, nunca del proveedor concreto — es la
 * regla de `architecture.md` §3.1: las integraciones externas viven detras de
 * una interfaz agnostica y no se filtran al dominio.
 *
 * ⚠️ NO HAY INTEGRACION TODAVIA. Este archivo define el contrato; el adapter
 * real se implementa cuando se resuelva la investigacion de ARCA (servicio,
 * certificados, ambientes, cadencia de refresco). Ver
 * `docs-implementation/seller-tax-identity.md`.
 */

import type { TaxIdType } from '../../services/fiscal-identity.service';

export interface FiscalLookupQuery {
  taxIdType: TaxIdType;
  /** Ya normalizado: solo digitos. */
  taxId: string;
}

/**
 * Respuesta normalizada de la fuente fiscal.
 *
 * `condition` es `string` y no un conjunto cerrado A PROPOSITO: los valores
 * concretos los define la fuente oficial y todavia no se conocen. Enumerarlos
 * ahora seria inventarlos.
 */
export interface FiscalLookupResult {
  found: boolean;
  condition: string | null;
  /** Identificacion de la fuente que respondio (ej. 'ARCA'). */
  source: string;
  checkedAt: Date;
  /** Respuesta cruda, para auditoria. Se conserva sin interpretar. */
  raw: unknown;
}

/** Error de la fuente fiscal. Que no se confunda con un error de validacion. */
export class FiscalSourceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FiscalSourceUnavailableError';
  }
}

export interface FiscalSourcePort {
  /** Identificador del proveedor, para trazabilidad. */
  readonly name: string;
  /** `false` mientras no haya integracion real disponible. */
  readonly isAvailable: boolean;
  lookup(query: FiscalLookupQuery): Promise<FiscalLookupResult>;
}
