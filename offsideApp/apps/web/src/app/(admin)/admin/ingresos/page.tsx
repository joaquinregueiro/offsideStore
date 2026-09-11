import type { Metadata } from 'next';

import { Pantalla } from '@/components/movimiento';
import {
  Aviso,
  BotonEnlace,
  CeldaNumero,
  Cifras,
  EncabezadoNumero,
  EstadoVacio,
  Tabla,
} from '@/components/ui';
import { porcentajeDeComision, precio } from '@/lib/formato';
import { CAPABILITIES } from '@/lib/permissions';
import { requireCapabilitySessionUser } from '@/lib/session';
import { getCommissionRateBasisPoints } from '@/modules/config/services/settings.service';

import { ingresosPorPeriodoYOrigen, type IngresoPorOrigen } from '../../datos';
import { Consola } from '../../consola';
import estilos from '../../admin.module.css';

export const metadata: Metadata = { title: 'Ingresos' };
export const dynamic = 'force-dynamic';

/**
 * Comisión cobrada, por período y por origen.
 *
 * ⚠️ SE LEEN LOS SNAPSHOTS DE `orders`, NUNCA SE RECALCULA NADA. Cada orden
 * congeló su comisión al crearse (DEC-030) junto con POR QUE fue esa:
 * `commission_source` dice si salió de la tasa global, del nivel del vendedor o
 * de una promoción. Multiplicar totales por la comisión de hoy daría un número
 * distinto y falso para toda orden vieja.
 *
 * ⚠️ ESTO NO ES UN ESTADO CONTABLE Y NO SE DISFRAZA DE UNO. Es lo que Offside
 * retuvo en pagos acreditados: no descuenta reembolsos, no descuenta disputas,
 * no provisiona nada y no incluye el costo de Mercado Pago —que se descuenta
 * del lado del vendedor (DEC-043) y Offside no registra en ninguna columna—.
 * Inventar cualquiera de esas restas sería inventar un cruce que nadie decidió.
 *
 * ⚠️ EL PERIODO ES EL DEL PAGO, no el de la creación de la orden: una orden
 * creada en agosto y pagada en septiembre es plata de septiembre.
 *
 * ⚠️ LA CONSULTA NO TIENE SERVICE y vive en `app/(admin)/datos.ts`. Ningún
 * módulo agrega los snapshots de `orders` por período. Reportado: pertenece a
 * un repositorio de `orders`.
 */

/** Los tres valores del CHECK de `orders.commission_source`, en palabras. */
const ORIGENES: Record<string, { texto: string; detalle: string }> = {
  default: {
    texto: 'General',
    detalle: 'La tasa global del Config Store. El vendedor no tenía nivel.',
  },
  seller_tier: {
    texto: 'Por nivel',
    detalle: 'La tasa propia del nivel del vendedor.',
  },
  promoted: {
    texto: 'Promocionada',
    detalle: 'La tasa base multiplicada por la promoción vigente al vender.',
  },
};

/** Suma con BigInt: los importes son centavos y no sobreviven a `Number`. */
function sumar(filas: IngresoPorOrigen[], campo: 'comision' | 'facturado'): bigint {
  return filas.reduce((total, fila) => total + BigInt(fila[campo]), 0n);
}

/** El mes, legible: `2026-09` → `septiembre de 2026`. */
function mes(periodo: string): string {
  const [anio, numero] = periodo.split('-');
  if (anio === undefined || numero === undefined) return periodo;

  // Día 15 para que ningún huso horario corra el mes al mes anterior.
  const formateado = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(
    new Date(Number(anio), Number(numero) - 1, 15),
  );

  return formateado;
}

export default async function Ingresos() {
  const admin = await requireCapabilitySessionUser(
    CAPABILITIES.SYSTEM_CONFIG_MANAGE,
    '/admin/ingresos',
  );

  const [filas, global] = await Promise.all([
    ingresosPorPeriodoYOrigen(),
    getCommissionRateBasisPoints(),
  ]);

  const moneda = filas[0]?.currency ?? 'ARS';
  const comisionTotal = sumar(filas, 'comision');
  const facturadoTotal = sumar(filas, 'facturado');
  const ordenesTotal = filas.reduce((total, fila) => total + fila.ordenes, 0);

  /* Los períodos en el orden en que vinieron de la base: del más nuevo al más viejo. */
  const periodos = [...new Set(filas.map((fila) => fila.periodo))];

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Consola rol={admin.adminRole} email={admin.email} activo="ingresos" titulo="Ingresos" />

        <div className={estilos.hoja}>
          <p className={estilos.bajada}>
            Es la comisión que Offside retuvo en órdenes con el pago acreditado, leída del snapshot
            de cada una. La tasa global de hoy es <strong>{porcentajeDeComision(global)}</strong>,
            pero cada orden conserva la suya.
          </p>

          <div className={estilos.avisoDeConsola}>
            <Aviso tono="error">
              <strong>No es un estado contable.</strong> No descuenta reembolsos ni disputas, no
              provisiona nada y no incluye el costo de Mercado Pago, que se descuenta del lado del
              vendedor y Offside no registra. Sirve para ver de dónde viene la comisión, no para
              cerrar un mes.
            </Aviso>
          </div>

          {filas.length === 0 ? (
            <EstadoVacio titulo="Todavía no hay ninguna orden pagada">
              Cuando se acredite el primer pago, la comisión aparece acá separada por origen.
            </EstadoVacio>
          ) : (
            <>
              {/*
                ⚠️ `quietas`: es una herramienta de operaciones y estos números
                son plata. Un importe que sube desde cero se lee como un importe
                que todavía se está calculando.
              */}
              <Cifras
                quietas
                cifras={[
                  {
                    valor: precio(comisionTotal.toString(), moneda),
                    etiqueta: 'Comisión acumulada',
                    detalle: 'Sin descontar reembolsos',
                  },
                  {
                    valor: precio(facturadoTotal.toString(), moneda),
                    etiqueta: 'Facturado a compradores',
                  },
                  { valor: String(ordenesTotal), etiqueta: 'Órdenes pagadas' },
                ]}
              />

              {periodos.map((periodo) => {
                const delPeriodo = filas.filter((fila) => fila.periodo === periodo);
                const comisionDelPeriodo = sumar(delPeriodo, 'comision');
                const facturadoDelPeriodo = sumar(delPeriodo, 'facturado');

                return (
                  <div key={periodo} className={estilos.historial}>
                    <Tabla titulo={`Comisión de ${mes(periodo)}`} tituloVisible>
                      <thead>
                        <tr>
                          <th scope="col">Origen</th>
                          <EncabezadoNumero>Órdenes</EncabezadoNumero>
                          <EncabezadoNumero>Facturado</EncabezadoNumero>
                          <EncabezadoNumero>Comisión</EncabezadoNumero>
                          <EncabezadoNumero>Tasa efectiva</EncabezadoNumero>
                        </tr>
                      </thead>
                      <tbody>
                        {delPeriodo.map((fila) => {
                          const origen = ORIGENES[fila.origen] ?? {
                            texto: fila.origen,
                            detalle: '',
                          };
                          const facturado = BigInt(fila.facturado);
                          /*
                           * ⚠️ LA TASA EFECTIVA SE DERIVA DE LOS DOS IMPORTES
                           * SUMADOS, no de ninguna configuración: es cuánto se
                           * retuvo de verdad sobre lo que se cobró. En
                           * "Promocionada" es el número que muestra el efecto
                           * del multiplicador sin tener que ir a buscarlo.
                           */
                          const tasa =
                            facturado === 0n
                              ? null
                              : Number((BigInt(fila.comision) * 10_000n) / facturado);

                          return (
                            <tr key={`${periodo}-${fila.origen}`}>
                              <td>
                                {origen.texto}
                                {origen.detalle !== '' && (
                                  <span className={estilos.metaFila}>{origen.detalle}</span>
                                )}
                              </td>
                              <CeldaNumero>{fila.ordenes}</CeldaNumero>
                              <CeldaNumero>{precio(fila.facturado, fila.currency)}</CeldaNumero>
                              <CeldaNumero>{precio(fila.comision, fila.currency)}</CeldaNumero>
                              <CeldaNumero>
                                {tasa === null ? '—' : porcentajeDeComision(tasa)}
                              </CeldaNumero>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <th scope="row">Total del mes</th>
                          <CeldaNumero>
                            {delPeriodo.reduce((total, fila) => total + fila.ordenes, 0)}
                          </CeldaNumero>
                          <CeldaNumero>
                            {precio(facturadoDelPeriodo.toString(), moneda)}
                          </CeldaNumero>
                          <CeldaNumero>{precio(comisionDelPeriodo.toString(), moneda)}</CeldaNumero>
                          <CeldaNumero>
                            {facturadoDelPeriodo === 0n
                              ? '—'
                              : porcentajeDeComision(
                                  Number((comisionDelPeriodo * 10_000n) / facturadoDelPeriodo),
                                )}
                          </CeldaNumero>
                        </tr>
                      </tfoot>
                    </Tabla>
                  </div>
                );
              })}
            </>
          )}

          <p className={estilos.nota}>
            <span>
              Se muestran los últimos doce meses con movimiento. Las órdenes canceladas no entran;
              las reembolsadas sí, porque un reembolso vive en <code>refunds</code> y no vuelve a
              escribir sobre la orden.
            </span>
          </p>

          <div className={estilos.pie}>
            <BotonEnlace href="/admin" variante="secundario">
              Volver
            </BotonEnlace>
          </div>
        </div>
      </main>
    </Pantalla>
  );
}
