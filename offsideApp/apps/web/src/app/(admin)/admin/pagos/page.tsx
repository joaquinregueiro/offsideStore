import type { Metadata } from 'next';

import { AreaDeTexto, Campo, CampoOculto, Formulario } from '@/components/form';
import { Aviso, Boton, BotonEnlace, EstadoVacio, Etiqueta } from '@/components/ui';
import { estadoDeOrden, fecha, precio } from '@/lib/formato';
import { CAPABILITIES } from '@/lib/permissions';
import { requireCapabilitySessionUser } from '@/lib/session';
import { findOrderPaymentsForAdmin } from '@/modules/payments/services/refund.service';

import { reembolsar } from '../../acciones';
import estilos from '../../admin.module.css';

export const metadata: Metadata = { title: 'Pagos y reembolsos — Offside Store' };
export const dynamic = 'force-dynamic';

/**
 * Consola de pagos y reembolsos.
 *
 * ⚠️ SE BUSCA POR NÚMERO DE ORDEN, NO SE LISTA TODO. Un listado de todos los
 * pagos de la plataforma sería una pantalla que nadie usa para operar y una
 * fuga esperando: el caso real es "el comprador de la orden OFF-XXXX reclama".
 * La búsqueda va por GET —queda en la URL y se puede compartir con el equipo—
 * y el número de orden no es un dato sensible por sí solo.
 *
 * ⚠️ LA POLÍTICA DE REEMBOLSOS SIGUE 🟡. `orders-and-refunds.md` §5.5 no define
 * plazos ni causales. Esta pantalla ejecuta la MECÁNICA; quién decide que
 * corresponde devolver es una persona, no el sistema.
 */
export default async function Pagos({
  searchParams,
}: {
  searchParams: Promise<{ orden?: string }>;
}) {
  const [{ orden }] = await Promise.all([
    searchParams,
    requireCapabilitySessionUser(CAPABILITIES.PAYMENTS_REFUND, '/admin/pagos'),
  ]);

  const buscado = orden?.trim().toUpperCase();
  const resultado =
    buscado === undefined || buscado === '' ? null : await findOrderPaymentsForAdmin(buscado);

  return (
    <main className={estilos.pagina}>
      <span className={estilos.contexto}>Back-office</span>
      <h1 className={estilos.titulo}>Pagos y reembolsos</h1>

      {/*
        ⚠️ ADVERTENCIA DELIBERADA Y NO DECORATIVA. Los refunds tienen código y
        tests, pero NUNCA se ejecutaron contra la API real de Mercado Pago.
        Además está el hueco abierto por DEC-019: si el vendedor no tiene saldo,
        hoy se devuelve un error y NO queda registrada la deuda
        (`seller_liabilities` sigue vacía). Quien opere acá tiene que saberlo.
      */}
      <Aviso error>
        Los reembolsos nunca se ejecutaron contra Mercado Pago real. Si el vendedor no tiene saldo,
        la deuda <strong>no queda registrada</strong>. Verificá el resultado en Mercado Pago después
        de cada operación.
      </Aviso>

      <form method="get" className={estilos.buscador}>
        <div className={estilos.buscadorCampo}>
          <label htmlFor="orden" className={estilos.etiqueta}>
            Número de orden
          </label>
          <input
            id="orden"
            name="orden"
            className={estilos.control}
            defaultValue={buscado ?? ''}
            placeholder="OFF-XXXXXXXXXX"
          />
        </div>
        <Boton type="submit">Buscar</Boton>
      </form>

      {buscado !== undefined && buscado !== '' && resultado === null && (
        <EstadoVacio titulo="No encontramos esa orden">
          Revisá el número. Se escribe completo, con el prefijo <code>OFF-</code>.
        </EstadoVacio>
      )}

      {resultado !== null && (
        <>
          <div className={estilos.tarjeta}>
            <div className={estilos.linea}>
              <span>
                <strong>{resultado.order.orderNumber}</strong>
              </span>
              <Etiqueta aviso={resultado.order.status === 'CANCELLED'}>
                {estadoDeOrden(resultado.order.status)}
              </Etiqueta>
            </div>
            <div className={estilos.linea}>
              <span className={estilos.concepto}>Total</span>
              <span className={estilos.dato}>
                {precio(resultado.order.totalAmount, resultado.order.currency)}
              </span>
            </div>
            <div className={estilos.linea}>
              <span className={estilos.concepto}>Comisión de Offside</span>
              <span className={estilos.dato}>
                {precio(resultado.order.commissionAmount, resultado.order.currency)}
              </span>
            </div>
            <div className={estilos.linea}>
              <span className={estilos.concepto}>Creada</span>
              <span className={estilos.dato}>{fecha(resultado.order.createdAt)}</span>
            </div>
          </div>

          <h2 className={estilos.subtitulo}>Pagos</h2>

          {resultado.payments.length === 0 ? (
            <EstadoVacio titulo="La orden no tiene pagos">
              Nunca se inició un checkout para esta orden.
            </EstadoVacio>
          ) : (
            resultado.payments.map((pago) => (
              <article key={pago.id} className={estilos.tarjeta}>
                <div className={estilos.linea}>
                  <span className={estilos.concepto}>Estado</span>
                  {/*
                    ⚠️ Se muestra el estado de Offside Y el crudo de Mercado Pago
                    (DEC-035). Ante una discrepancia, quien opera necesita ver
                    los dos: el mapeado es nuestro, el crudo es la verdad del
                    proveedor.
                  */}
                  <span className={estilos.dato}>
                    {pago.status}
                    {pago.mpStatus !== null && ` · MP: ${pago.mpStatus}`}
                  </span>
                </div>
                <div className={estilos.linea}>
                  <span className={estilos.concepto}>Importe</span>
                  <span className={estilos.dato}>{precio(pago.amount, pago.currency)}</span>
                </div>
                <div className={estilos.linea}>
                  <span className={estilos.concepto}>Ya reembolsado</span>
                  <span className={estilos.dato}>{precio(pago.refundedAmount, pago.currency)}</span>
                </div>
                <div className={estilos.linea}>
                  <span className={estilos.concepto}>Disponible para devolver</span>
                  <span className={estilos.dato}>
                    <strong>{precio(pago.refundableAmount, pago.currency)}</strong>
                  </span>
                </div>

                {pago.refunds.length > 0 && (
                  <div className={estilos.linea}>
                    <span className={estilos.concepto}>Reembolsos</span>
                    <span className={estilos.dato}>
                      {pago.refunds
                        .map((r) => `${r.type} ${precio(r.amount, r.currency)} · ${r.status}`)
                        .join(' | ')}
                    </span>
                  </div>
                )}

                {pago.refundableAmount === '0' ? (
                  <p className={estilos.nota}>Este pago no admite más reembolsos.</p>
                ) : (
                  <Formulario accion={reembolsar} enviar="Emitir reembolso">
                    <CampoOculto nombre="paymentId" valor={pago.id} />
                    <Campo
                      nombre="montoPesos"
                      etiqueta="Importe en pesos"
                      tipo="number"
                      requerido={false}
                      ayuda="Vacío devuelve el total disponible. Con importe, es parcial."
                    />
                    <AreaDeTexto
                      nombre="motivo"
                      etiqueta="Motivo"
                      filas={2}
                      ayuda="Queda en el log de auditoría junto con tu usuario."
                    />
                  </Formulario>
                )}
              </article>
            ))
          )}
        </>
      )}

      <p className={estilos.nota}>
        <BotonEnlace href="/admin" variante="secundario">
          Volver
        </BotonEnlace>
      </p>
    </main>
  );
}
