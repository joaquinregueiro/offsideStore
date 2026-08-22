import {
  FiscalSourceUnavailableError,
  type FiscalLookupQuery,
  type FiscalLookupResult,
  type FiscalSourcePort,
} from './fiscal-source.port';

/**
 * Adapter por defecto: **no hay fuente fiscal integrada**.
 *
 * ⚠️ NO ES UN MOCK NI UN SIMULADOR. No inventa condiciones fiscales ni finge
 * consultar a ARCA. Declara honestamente que la integracion no existe, y falla
 * si alguien intenta usarla.
 *
 * La alternativa —devolver una condicion fiscal ficticia— seria peor que no
 * tener nada: haria creer que un vendedor esta verificado cuando no lo esta, y
 * ese dato terminaria alimentando liquidaciones reales.
 *
 * Cuando exista la integracion con ARCA, se agrega un `ArcaFiscalSourceAdapter`
 * al lado de este y se cambia cual se inyecta. Nada del dominio cambia.
 */
export class UnavailableFiscalSourceAdapter implements FiscalSourcePort {
  readonly name = 'none';
  readonly isAvailable = false;

  lookup(_query: FiscalLookupQuery): Promise<FiscalLookupResult> {
    return Promise.reject(
      new FiscalSourceUnavailableError(
        'No hay ninguna fuente fiscal integrada. La verificacion contra ARCA todavia no fue implementada.',
      ),
    );
  }
}

/**
 * Fuente fiscal en uso.
 *
 * Punto unico de inyeccion: cuando ARCA este integrado, se reemplaza aca.
 */
export function getFiscalSource(): FiscalSourcePort {
  return new UnavailableFiscalSourceAdapter();
}
