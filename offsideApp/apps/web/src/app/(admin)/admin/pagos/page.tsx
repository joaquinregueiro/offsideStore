import type { Metadata } from 'next';

import { AreaDeTexto, Campo, CampoOculto, Formulario } from '@/components/form';
<<<<<<< HEAD
import { Pantalla } from '@/components/movimiento';
import {
  Aviso,
  Boton,
  BotonEnlace,
  CeldaNumero,
  Confirmar,
  EncabezadoNumero,
  EstadoVacio,
  Etiqueta,
  FilaDeDatos,
  Tabla,
  type TonoEtiqueta,
} from '@/components/ui';
import { estadoDeOrden, estadoDePago, fecha, precio, tonoDeOrden, tonoDePago } from '@/lib/formato';
=======
import { Aviso, Boton, BotonEnlace, EstadoVacio, Etiqueta } from '@/components/ui';
import { estadoDeOrden, fecha, precio } from '@/lib/formato';
>>>>>>> origin/main
import { CAPABILITIES } from '@/lib/permissions';
import { requireCapabilitySessionUser } from '@/lib/session';
import { findOrderPaymentsForAdmin } from '@/modules/payments/services/refund.service';

import { reembolsar } from '../../acciones';
<<<<<<< HEAD
import { Consola } from '../../consola';
import estilos from '../../admin.module.css';

export const metadata: Metadata = { title: 'Pagos y reembolsos' };
export const dynamic = 'force-dynamic';

/**
 * ⚠️ ESTOS TRES MAPAS SON LOCALES A PROPOSITO, Y ES DEUDA DECLARADA.
 * `lib/formato.ts` tiene ocho formateadores —`estadoDePago`, `tonoDePago`,
 * `estadoDeOrden`, `tonoDeOrden`, `tonoDePublicacion`, `tonoDeVendedor`,
 * `rolLegible`, `fecha`— y NINGUNO para `refund_type` / `refund_status`. Se
 * escriben acá porque el defecto que arreglan es de esta pantalla —los
 * reembolsos salían en inglés y en mayúsculas crudas dentro de un string
 * aplanado—, pero pertenecen a `lib/formato.ts` con los otros ocho.
 */
const TIPOS_DE_REEMBOLSO: Record<string, string> = {
  FULL: 'Total',
  PARTIAL: 'Parcial',
};

const ESTADOS_DE_REEMBOLSO: Record<string, string> = {
  REQUESTED: 'Solicitado',
  UNDER_REVIEW: 'En revisión',
  APPROVED: 'Aprobado',
  PROCESSING: 'Procesando',
  COMPLETED: 'Completado',
  REJECTED: 'Rechazado',
};

/**
 * ⚠️ `REJECTED` VA EN ALERTA Y ES EL UNICO QUE IMPORTA DISTINGUIR DE UN VISTAZO:
 * es el caso en que la plata NO volvió y, si el motivo fue saldo insuficiente,
 * hoy tampoco queda registrada la deuda (`seller_liabilities` sigue vacía).
 * `COMPLETED` es el único éxito real: `APPROVED` todavía no movió nada.
 */
const TONOS_DE_REEMBOLSO: Record<string, TonoEtiqueta> = {
  REQUESTED: 'neutro',
  UNDER_REVIEW: 'neutro',
  APPROVED: 'marca',
  PROCESSING: 'marca',
  COMPLETED: 'exito',
  REJECTED: 'alerta',
};

/**
 * ⚠️ LA FRANJA DE LA FICHA ES FORMA, NO INFORMACION. El estado está escrito con
 * todas las letras y rotulado en la cabecera de cada ficha; la franja sólo hace
 * que el pago que importa se encuentre sin leer cuando una orden tiene tres
 * intentos —rechazado, reintentado, aprobado—.
 */
const FRANJA_POR_TONO: Record<TonoEtiqueta, string> = {
  exito: estilos.fichaExito ?? '',
  marca: estilos.fichaMarca ?? '',
  alerta: estilos.fichaAlerta ?? '',
  neutro: estilos.fichaNeutra ?? '',
};

/**
=======
import estilos from '../../admin.module.css';

export const metadata: Metadata = { title: 'Pagos y reembolsos — Offside Store' };
export const dynamic = 'force-dynamic';

/**
>>>>>>> origin/main
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
<<<<<<< HEAD
 *
 * ⚠️ NO LLEVA REVELADO POR SCROLL NI ESCALONADO, Y ES UNA DECISION. Es una
 * herramienta de operaciones: cada milisegundo de animación acá es un
 * milisegundo esperando para leer un dato. Lo único que se mueve es el filete
 * del título y la barra de reparto, las dos una sola vez y con `transform`.
=======
>>>>>>> origin/main
 */
export default async function Pagos({
  searchParams,
}: {
  searchParams: Promise<{ orden?: string }>;
}) {
<<<<<<< HEAD
  const [{ orden }, admin] = await Promise.all([
=======
  const [{ orden }] = await Promise.all([
>>>>>>> origin/main
    searchParams,
    requireCapabilitySessionUser(CAPABILITIES.PAYMENTS_REFUND, '/admin/pagos'),
  ]);

  const buscado = orden?.trim().toUpperCase();
  const resultado =
    buscado === undefined || buscado === '' ? null : await findOrderPaymentsForAdmin(buscado);

<<<<<<< HEAD
  /*
   * ⚠️ EL BUSCADOR TIENE DOS TAMAÑOS Y ES UNA CLASE, NO UNA RAMA DE JSX.
   * `/admin/pagos` sin `?orden=` es la pantalla que se ve el 100% de las veces
   * y no tenía ni un metro cuadrado de diseño. Sin resultado, el campo es el
   * héroe de la consola; con resultado se pliega a una barra fina para no
   * robarle lugar a los datos.
   */
  const hayResultado = resultado !== null;

  const buscador = (
    <form
      method="get"
      className={hayResultado ? estilos.buscador : `${estilos.buscador} ${estilos.buscadorHeroe}`}
    >
      <div className={estilos.buscadorCampo}>
        <label htmlFor="orden" className={estilos.etiquetaCampo}>
          Número de orden
        </label>
        <input
          id="orden"
          name="orden"
          className={estilos.control}
          defaultValue={buscado ?? ''}
          placeholder="OFF-XXXXXXXXXX"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {/*
        ⚠️ `Boton` ES EL UNICO COMPONENTE DE `ui.tsx` QUE PUEDE VIVIR ADENTRO DE
        LA BANDA OSCURA: lee los ocho tokens `--boton-*` que `.sup-noche` cablea
        (Amarillo Cambio sobre tinta, 13.97:1). Los demás escriben
        `--color-tinta` o `--color-tiempo-extra` literales.
      */}
      <Boton type="submit" className="presiona">
        Buscar
      </Boton>

      {!hayResultado && (
        <p className={estilos.ayudaBuscador}>
          Se escribe completo, con el prefijo <code>OFF-</code>. Por ejemplo{' '}
          <code>OFF-3A9F21C0D4</code>.
        </p>
      )}
    </form>
  );

  const ordenHallada = resultado?.order;
  /* Una orden sin importe no existe, pero dividir por cero sí. */
  const total = ordenHallada === undefined ? 0 : Number(ordenHallada.totalAmount);
  const base = total > 0 ? total : 1;
  const pctOffside =
    ordenHallada === undefined
      ? 0
      : Math.round((Number(ordenHallada.commissionAmount) / base) * 100);
  const pctVendedor =
    ordenHallada === undefined ? 0 : Math.round((Number(ordenHallada.sellerAmount) / base) * 100);

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Consola
          rol={admin.adminRole}
          email={admin.email}
          activo="pagos"
          titulo="Pagos y reembolsos"
        >
          {buscador}
        </Consola>

        <div className={estilos.hoja}>
          {/*
            ⚠️ ADVERTENCIA DELIBERADA Y NO DECORATIVA. Los refunds tienen código y
            tests, pero NUNCA se ejecutaron contra la API real de Mercado Pago.
            Además está el hueco abierto por DEC-019: si el vendedor no tiene saldo,
            hoy se devuelve un error y NO queda registrada la deuda
            (`seller_liabilities` sigue vacía). Quien opere acá tiene que saberlo.

            ⚠️ VA EN LA HOJA, NO EN LA BANDA: `.aviso` es una superficie clara con
            texto tinta.
          */}
          {/*
            ⚠️ EL ENVOLTORIO ES EL AIRE. `.aviso` declara `margin: 0` y
            `.tarjeta` sólo lleva `margin-bottom`: sin esto, la advertencia
            quedaba pegada —cero píxeles— a la ficha de la orden o al estado
            vacío, y dos bloques con borde a cero se leen como una sola caja
            rota. Justo en el texto que avisa que esto mueve plata real.
          */}
          <div className={estilos.avisoDeConsola}>
            <Aviso tono="error">
              Los reembolsos nunca se ejecutaron contra Mercado Pago real. Si el vendedor no tiene
              saldo, la deuda <strong>no queda registrada</strong>. Verificá el resultado en Mercado
              Pago después de cada operación.
            </Aviso>
          </div>

          {buscado !== undefined && buscado !== '' && resultado === null && (
            <EstadoVacio titulo="No encontramos esa orden">
              Revisá el número. Se escribe completo, con el prefijo <code>OFF-</code>.
            </EstadoVacio>
          )}

          {resultado !== null && ordenHallada !== undefined && (
            <>
              <div
                className={`${estilos.tarjeta} ${FRANJA_POR_TONO[tonoDeOrden(ordenHallada.status)]}`}
              >
                <div className={estilos.tarjetaCabecera}>
                  <span className={estilos.numeroDeOrden}>{ordenHallada.orderNumber}</span>
                  {/*
                    ⚠️ EL CHIP VA ROTULADO. Un `<Etiqueta>` suelto al lado del
                    número de orden es una palabra sin dueño: la fila de al lado
                    dice "Estado crudo de Mercado Pago" y ésta no decía de quién
                    era el suyo. Para un lector de pantalla era una palabra
                    suelta en el encabezado de la ficha.
                  */}
                  <span className={estilos.estadoGrupo}>
                    <span className={estilos.rotuloEstado}>Estado de la orden</span>
                    <Etiqueta tono={tonoDeOrden(ordenHallada.status)}>
                      {estadoDeOrden(ordenHallada.status)}
                    </Etiqueta>
                  </span>
                </div>

                {/*
                  ⚠️ SE MUESTRA EL REPARTO COMPLETO, Y LOS DOS DATOS QUE FALTABAN YA
                  ESTABAN EN EL SERVICE. `PublicOrder` expone `productAmount` y
                  `sellerAmount` desde siempre; la pantalla mostraba sólo total y
                  comisión. Cuánto le quedó al vendedor es exactamente lo que hay
                  que mirar antes de decidir un reembolso —es de ahí de donde sale
                  la plata (DEC-043)— y estaba a cero consultas de distancia.
                */}
                <div className={estilos.datos}>
                  <FilaDeDatos concepto="Producto">
                    {precio(ordenHallada.productAmount, ordenHallada.currency)}
                  </FilaDeDatos>
                  <FilaDeDatos concepto="Total de la orden">
                    {precio(ordenHallada.totalAmount, ordenHallada.currency)}
                  </FilaDeDatos>
                  <FilaDeDatos concepto="Comisión de Offside">
                    {precio(ordenHallada.commissionAmount, ordenHallada.currency)}
                  </FilaDeDatos>
                  <FilaDeDatos concepto="Para el vendedor">
                    {precio(ordenHallada.sellerAmount, ordenHallada.currency)}
                  </FilaDeDatos>
                  <FilaDeDatos concepto="Creada">{fecha(ordenHallada.createdAt)}</FilaDeDatos>
                </div>

                {/*
                  ⚠️ DE DONDE SALE LA PLATA, DIBUJADO. Es FORMA pura y por eso el
                  riel lleva `aria-hidden`: los tres importes están escritos
                  arriba, en `.datos`. Contesta de un vistazo la pregunta que se
                  hace antes de cada reembolso.
                */}
                <div className={estilos.reparto}>
                  <div className={estilos.repartoRiel} aria-hidden="true">
                    <span className={estilos.repartoOffside} style={{ width: `${pctOffside}%` }} />
                    <span
                      className={estilos.repartoVendedor}
                      style={{ width: `${pctVendedor}%` }}
                    />
                  </div>
                  <ul className={estilos.repartoLeyenda}>
                    <li>
                      <span
                        className={`${estilos.repartoMuestra} ${estilos.muestraOffside}`}
                        aria-hidden="true"
                      />
                      Offside
                    </li>
                    <li>
                      <span
                        className={`${estilos.repartoMuestra} ${estilos.muestraVendedor}`}
                        aria-hidden="true"
                      />
                      Vendedor
                    </li>
                    <li>
                      {/*
                        ⚠️ EL RESTO NO SE INVENTA. Total menos comisión menos parte
                        del vendedor es el costo de Mercado Pago, que se descuenta
                        del lado del vendedor (DEC-043) y que Offside no registra en
                        ninguna columna. Se nombra como lo que es: el hueco.
                      */}
                      El resto lo retiene Mercado Pago
                    </li>
                  </ul>
                </div>
              </div>

              <h2 className={estilos.subtitulo}>Pagos</h2>

              {resultado.payments.length === 0 ? (
                <EstadoVacio titulo="La orden no tiene pagos">
                  Nunca se inició un checkout para esta orden.
                </EstadoVacio>
              ) : (
                resultado.payments.map((pago, indice) => (
                  <article
                    key={pago.id}
                    className={`${estilos.tarjeta} ${FRANJA_POR_TONO[tonoDePago(pago.status)]}`}
                  >
                    {/*
                      ⚠️ LOS PAGOS SE NUMERAN. Una orden puede tener varios intentos
                      —rechazado, reintentado, aprobado— y hasta ahora eran fichas
                      idénticas sin nada que las ordenara. El número también hace
                      único el `<caption>` de la tabla de reembolsos, que si no
                      diría lo mismo dos veces para un lector de pantalla.
                    */}
                    <div className={estilos.tarjetaCabecera}>
                      <p className={estilos.pasoDeFicha}>
                        Pago {indice + 1} de {resultado.payments.length}
                      </p>
                      <span className={estilos.estadoGrupo}>
                        <span className={estilos.rotuloEstado}>Estado en Offside</span>
                        <Etiqueta tono={tonoDePago(pago.status)}>
                          {estadoDePago(pago.status)}
                        </Etiqueta>
                      </span>
                    </div>

                    {/*
                      ⚠️ Se muestra el estado de Offside Y el crudo de Mercado Pago
                      (DEC-035). Ante una discrepancia, quien opera necesita ver los
                      dos: el mapeado es nuestro, el crudo es la verdad del
                      proveedor. El mapeado va como `<Etiqueta>` —el mismo lenguaje
                      que TODOS los estados de esta consola— y el crudo va
                      monoespaciado y encuadrado, porque es texto de máquina.
                    */}
                    <div className={estilos.datos}>
                      {pago.mpStatus !== null && (
                        <FilaDeDatos concepto="Estado crudo de Mercado Pago">
                          <code className={estilos.crudo}>{pago.mpStatus}</code>
                        </FilaDeDatos>
                      )}

                      {/*
                        ⚠️ EL ID DE MERCADO PAGO ES EL DATO MAS IMPORTANTE DE ESTA
                        PANTALLA. Arriba, el aviso pide "verificá el resultado en
                        Mercado Pago después de cada operación" — y el buscador de
                        Mercado Pago funciona con ESTE número. `user-select: all` en
                        `.crudo` lo selecciona entero de un clic: sin eso hay que
                        arrastrar sobre 12 dígitos y perder uno es silencioso.
                      */}
                      {pago.mpPaymentId !== null && (
                        <FilaDeDatos concepto="ID en Mercado Pago">
                          <code className={estilos.crudo}>{pago.mpPaymentId}</code>
                        </FilaDeDatos>
                      )}

                      <FilaDeDatos concepto="Registrado el">{fecha(pago.createdAt)}</FilaDeDatos>
                      <FilaDeDatos concepto="Importe">
                        {precio(pago.amount, pago.currency)}
                      </FilaDeDatos>
                      <FilaDeDatos concepto="Ya reembolsado">
                        {precio(pago.refundedAmount, pago.currency)}
                      </FilaDeDatos>
                    </div>

                    {/*
                      ⚠️ "DISPONIBLE" QUEDA FUERA DE LA GRILLA Y VA `destacada`. Es
                      el único número sobre el que se actúa: en dos columnas con los
                      otros cinco quedaba como un dato más entre datos.
                    */}
                    <FilaDeDatos concepto="Disponible para devolver" destacada>
                      {precio(pago.refundableAmount, pago.currency)}
                    </FilaDeDatos>

                    {/*
                      ⚠️ LOS REEMBOLSOS ERAN UN STRING APLANADO CON `.join(' | ')`:
                      tipo y estado en inglés y en mayúsculas crudas, importes sin
                      alinear, y **`mpRefundId` no aparecía nunca** — el único dato
                      con el que se busca un reembolso en el panel de Mercado Pago,
                      que es justo lo que el aviso rojo de arriba manda a hacer. Es
                      el mismo agujero que ya se cerró para `mpPaymentId`, un
                      escalón más abajo.

                      ⚠️ FALTAN "CUANDO" Y "MOTIVO", Y NO ES UN OLVIDO. La fila
                      `refunds` tiene `created_at` y `reason`, pero `PublicRefund`
                      (`refund.service.ts`) los descarta en la proyección, y
                      `modules/` está fuera de esta superficie. El formulario de
                      abajo EXIGE el motivo y lo guarda: mostrarlo necesita dos
                      campos más en el Service. Queda reportado.
                    */}
                    {pago.refunds.length > 0 && (
                      <div className={estilos.historial}>
                        <Tabla titulo={`Reembolsos del pago ${indice + 1}`} tituloVisible>
                          <thead>
                            <tr>
                              <th scope="col">Tipo</th>
                              <EncabezadoNumero>Importe</EncabezadoNumero>
                              <th scope="col">Estado</th>
                              <th scope="col">ID en Mercado Pago</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pago.refunds.map((r) => (
                              <tr key={r.id}>
                                <td>{TIPOS_DE_REEMBOLSO[r.type] ?? r.type}</td>
                                <CeldaNumero>{precio(r.amount, r.currency)}</CeldaNumero>
                                <td>
                                  <Etiqueta tono={TONOS_DE_REEMBOLSO[r.status] ?? 'neutro'}>
                                    {ESTADOS_DE_REEMBOLSO[r.status] ?? r.status}
                                  </Etiqueta>
                                </td>
                                <td>
                                  {r.mpRefundId === null ? (
                                    '—'
                                  ) : (
                                    <code className={estilos.crudo}>{r.mpRefundId}</code>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </Tabla>
                      </div>
                    )}

                    {/*
                      ⚠️ LA ACCION QUE MUEVE PLATA SE SEPARA DEL RESTO DE LA FICHA.
                      Antes el disparador quedaba pegado al último dato, con el
                      mismo aire que separa dos importes. La señal es una CINTA DE
                      PELIGRO de 10px —naranja sobre tinta, 7.26:1—, no un filete de
                      1px (2.05:1 sobre claro) ni un relleno rayado al 16% (1.14:1
                      contra su base): los dos eran invisibles. Estática: nada se
                      mueve al lado de un botón que transfiere plata.

                      ⚠️ `sup-calida` NO ES OPCIONAL. Sobre `#f7f4cf`,
                      `--color-neutro-tenue` da 4.39:1 y `--color-alerta` 4.36:1, los
                      dos DEBAJO de AA; la clase los cablea a `--color-neutro-texto`
                      (5.51) y `--color-alerta-hondo` (5.05).
                    */}
                    <div className={`${estilos.zonaPeligro} sup-calida`}>
                      {pago.refundableAmount === '0' ? (
                        <p className={estilos.nota}>
                          <span>Este pago no admite más reembolsos.</span>
                        </p>
                      ) : (
                        /*
                          ⚠️ EL REEMBOLSO VA EN DOS PASOS. Mueve plata real y es
                          irreversible; que pasara con un clic en una consola donde
                          se entra a MIRAR el estado de un pago era demasiado fácil.
                          No usa `window.confirm`: sin JavaScript no existe.
                        */
                        <Confirmar
                          etiqueta="Emitir reembolso"
                          pregunta={`Vas a devolver hasta ${precio(pago.refundableAmount, pago.currency)} a la persona que compró. La operación se ejecuta contra Mercado Pago y no se puede deshacer desde acá.`}
                        >
                          <Formulario
                            accion={reembolsar}
                            enviar="Confirmar reembolso"
                            variante="peligro"
                          >
                            <CampoOculto nombre="paymentId" valor={pago.id} />
                            {/*
                              ⚠️ `identificador` HACE UNICO EL `id` DEL CONTROL. Hay
                              un formulario por pago dentro del mismo `.map()`: sin
                              esto, dos pagos producen dos `id="montoPesos"` y las
                              dos etiquetas enfocan el campo del primero.

                              ⚠️ `max` SALE DE `refundableAmount`, QUE ESTA
                              RENDERIZADO TRES LINEAS MAS ARRIBA. El error operativo
                              más probable de la pantalla —tipear más de lo
                              disponible— se descubría después de mandar el
                              formulario. No es una decisión de producto: el Service
                              ya rechaza ese caso con el mismo criterio
                              (`refundAmountInvalid`), esto sólo lo dice antes.
                            */}
                            <Campo
                              nombre="montoPesos"
                              identificador={`monto-${pago.id}`}
                              etiqueta="Importe en pesos"
                              tipo="number"
                              requerido={false}
                              min={0}
                              max={Number(pago.refundableAmount) / 100}
                              step={0.01}
                              inputMode="decimal"
                              ayuda="Vacío devuelve el total disponible. Con importe, es parcial."
                            />
                            {/*
                              ⚠️ EL MOTIVO SE EXIGE EN EL FORMULARIO. La pantalla
                              promete trazabilidad y el campo era opcional: un
                              reembolso sin causa no se puede reconstruir después.
                              ⚠️ El SERVIDOR todavía lo acepta vacío: exigirlo ahí es
                              un cambio de contrato de la acción y queda reportado.
                            */}
                            <AreaDeTexto
                              nombre="motivo"
                              identificador={`motivo-${pago.id}`}
                              etiqueta="Motivo"
                              filas={2}
                              requerido
                              ayuda="Queda en el log de auditoría junto con tu usuario."
                            />
                          </Formulario>
                        </Confirmar>
                      )}
                    </div>
                  </article>
                ))
              )}
            </>
          )}

          <div className={estilos.pie}>
            <BotonEnlace href="/admin" variante="secundario">
              Volver
            </BotonEnlace>
          </div>
        </div>
      </main>
    </Pantalla>
=======
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
>>>>>>> origin/main
  );
}
