import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CampoOculto, Formulario } from '@/components/form';
import { IconoAutenticado, IconoCamion, IconoIntercambio } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import {
  Aviso,
  BotonEnlace,
  Confirmar,
  Cronologia,
  Etiqueta,
  FilaDeAcciones,
  Migas,
} from '@/components/ui';
import { estadoDeEnvio, estadoDeOrden, fecha, precio, tonoDeOrden } from '@/lib/formato';
import { getSessionUser, requireVerifiedSessionUser } from '@/lib/session';
import { coverUrls } from '@/modules/listings/services/listing.service';
import { getMyOrder, getMyOrderDetail } from '@/modules/orders/services/order.service';

import { cancelarOrden, confirmarRecepcion, pagar } from '../../acciones';
import { hitosDeLaOrden } from '../../cronologia';
import estilos from '../../resumen.module.css';
import { RutaDeCompra } from '../../ruta';

export const dynamic = 'force-dynamic';

/**
 * ⚠️ EL TITULO ES EL UNICO ANUNCIO QUE SOBREVIVE A UNA RECARGA. `role="status"`
 * no sirve aca: una live region solo anuncia MUTACIONES posteriores a su
 * insercion, y en este flujo todo son cargas completas de documento —la vuelta
 * desde Mercado Pago y cada `<meta refresh>`—. El `<title>` se relee en cada
 * carga, asi que quien usa lector de pantalla escucha que se esta confirmando.
 */
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ status?: string }>;
}): Promise<Metadata> {
  const [{ orderId }, { status }] = await Promise.all([params, searchParams]);

  /*
   * ⚠️ EL TITULO SALE DEL ESTADO DE LA ORDEN, NO DEL QUERY. Una orden ya pagada
   * a la que se vuelve con `?status=success` —el enlace que queda en el
   * historial del navegador— decia "Confirmando tu pago" mientras el cuerpo
   * decia "Pagada". Se detecto recorriendo la app real el 2026-09-10.
   */
  const user = await getSessionUser();
  const order = user === null ? null : await getMyOrder(user, orderId);
  const pendiente = order === null || order.status === 'PENDING_PAYMENT';

  if (order !== null && !pendiente)
    return { title: `Orden ${estadoDeOrden(order.status).toLowerCase()}` };
  return { title: status === 'success' ? 'Confirmando tu pago' : 'Pago' };
}

/**
 * ⚠️ CUANTAS VECES SE REINTENTA SOLO ANTES DE RENDIRSE. Cinco recargas de a 5
 * segundos son ~25 segundos de espera automatica: mas que suficiente para un
 * webhook que normalmente llega en menos de tres, y poco como para no dejar a
 * alguien en un bucle de recarga infinito si el webhook no llega nunca.
 *
 * NO es configuracion de negocio: es un parametro de interfaz.
 */
const REINTENTOS_DE_CONFIRMACION = 5;
const SEGUNDOS_ENTRE_REINTENTOS = 5;

/**
 * Fecha CON HORA, para el vencimiento de la ventana de pago.
 *
 * ⚠️ ES LOCAL Y NO VIVE EN `lib/formato.ts` PORQUE ESE ARCHIVO NO ES DE ESTE
 * GRUPO. `fecha()` imprime dia, mes y anio, y la ventana de pago casi siempre
 * vence el MISMO dia en que se creo la orden: "hasta el 10 sept 2026" no le dice
 * a nadie cuanto tiempo le queda. Si otra pantalla lo necesita, el lugar
 * correcto es `lib/formato.ts` — queda anotado.
 *
 * ⚠️ NO ES UN CONTADOR RELATIVO ("faltan 2 horas"). El HTML se arma en el
 * servidor y se queda quieto: un relativo envejece en la pantalla y termina
 * mintiendo. Una hora absoluta sigue siendo cierta mañana.
 */
function fechaHora(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * Pago y seguimiento de una orden. Esta pantalla cumple TRES papeles:
 *
 *  1. ANTES de pagar: resumen y boton que lleva a Mercado Pago.
 *  2. AL VOLVER de Mercado Pago: es la `back_url` que la preferencia declara
 *     (`/checkout/{orderId}?status=success|pending|failure`).
 *  3. DESPUES: el recorrido de la orden —cronologia, envio y "lo recibí"—
 *     hasta que se cierra.
 *
 * Son la misma pantalla a proposito: el estado de la orden ya distingue los
 * momentos, y tener dos paginas obligaria a mantener dos resumenes iguales. El
 * detalle completo —direccion, importes desglosados, reclamos— vive en
 * `/cuenta/compras/{orderId}`, y se enlaza desde aca.
 */
export default async function Checkout({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ status?: string; intento?: string }>;
}) {
  const [{ orderId }, { status, intento }] = await Promise.all([params, searchParams]);

  const user = await requireVerifiedSessionUser(`/checkout/${orderId}`);
  const order = await getMyOrderDetail(user, orderId);

  // Una orden ajena devuelve `null` igual que una inexistente: no se distinguen.
  if (order === null) notFound();

  const portadas = await coverUrls(order.items.map((item) => item.listingId));

  const pendiente = order.status === 'PENDING_PAYMENT';
  const vencida =
    order.paymentDeadline !== null && new Date(order.paymentDeadline).getTime() <= Date.now();

  /**
   * ⚠️ VOLVER DE MERCADO PAGO NO ES HABER PAGADO (BS-072 / DEC-028). MP
   * devuelve al comprador apenas termina, pero la fuente de verdad es el
   * WEBHOOK, que puede tardar segundos. Decir "pagado" porque la URL trae
   * `status=success` seria afirmar algo que todavia no sabemos.
   */
  const confirmando = status === 'success' && pendiente;
  const vuelta = Number.parseInt(intento ?? '1', 10) || 1;
  const sigueEsperando = confirmando && vuelta < REINTENTOS_DE_CONFIRMACION;

  /*
   * Mientras la espera automatica sigue, "actualizar" avanza el contador; cuando
   * ya se agoto, lo reinicia. Las dos son acciones manuales y las dos andan sin
   * una linea de JavaScript.
   */
  const proximoIntento = `/checkout/${order.id}?status=success&intento=${
    sigueEsperando ? vuelta + 1 : 1
  }`;

  /*
   * ⚠️ MIENTRAS LA PANTALLA SE RECARGA SOLA, NADA ENTRA ANIMADO. Cada `<meta
   * refresh>` es un primer pintado: sin esto, `.entra`, el riel de pasos y —lo
   * grave— `.cifra-entra` sobre el total se volverian a disparar cinco veces en
   * 25 segundos. Un importe que sube cinco veces mientras alguien espera la
   * confirmacion de su pago es exactamente el numero "que todavia no esta
   * decidido" que la regla existe para evitar.
   */
  const quieto = confirmando;

  /*
   * En que paso esta la persona AHORA. `4` = los tres cerrados.
   *
   * ⚠️ CONFIRMANDO ES EL PASO 3 "EN CURSO", NO EL 3 "HECHO". Es la distincion
   * que `<Pasos>` no sabia hacer y la razon por la que existe `RutaDeCompra`.
   */
  const paso = !pendiente ? 4 : confirmando ? 3 : 2;

  /*
   * ⚠️ UNA ORDEN CANCELADA NO ES UN DESENLACE FELIZ, Y HASTA ACA SE DIBUJABA
   * COMO SI LO FUERA. `!pendiente` mete en la MISMA rama a una orden pagada y a
   * una `CANCELLED`, asi que una cancelada salia con los tres pasos marcados ✓
   * —el rombo de "Pago" en verde, afirmando que el pago se completo— y con el
   * bloque de cierre de marca.
   */
  const cancelada = order.status === 'CANCELLED';

  /*
   * ⚠️ SE PREGUNTA POR `paidAt`, NO POR `status === 'PAID'`, Y ES UN ARREGLO DE
   * FONDO. Con la maquina de estados completa (DEC-029) `PAID` dura lo que dura
   * una transaccion: el webhook la deja en `PROCESSING` en el mismo commit. El
   * sello "Pagada" y el cierre feliz no se veian NUNCA en una compra normal.
   */
  const pagada = order.paidAt !== null;

  const tono = tonoDeOrden(order.status);
  const total = precio(order.totalAmount, order.currency);
  const hitos = hitosDeLaOrden(order.status, order.timeline, order.createdAt);
  const envio = order.shipment;

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        {/*
          ⚠️ RECARGA SOLA, SIN UNA LINEA DE JAVASCRIPT. El contador viaja EN LA
          URL (`?intento=`), asi que la recarga se detiene sola despues de unas
          vueltas en vez de quedar en un bucle infinito. Cuando el webhook
          confirma, la orden deja de estar pendiente y este `<meta>` no se
          renderiza mas.
        */}
        {sigueEsperando && (
          <meta
            httpEquiv="refresh"
            content={`${SEGUNDOS_ENTRE_REINTENTOS};url=${proximoIntento}`}
          />
        )}

        <Migas items={[{ texto: 'Mis compras', href: '/cuenta/compras' }, { texto: 'Pago' }]} />

        <div className={`${estilos.cabecera}${quieto ? '' : ' entra'}`}>
          <h1 className={estilos.titulo}>Orden {order.orderNumber}</h1>
          <span
            className={`${estilos.reglaTitulo}${quieto ? '' : ` ${estilos.reglaTituloAnimada}`}`}
            aria-hidden="true"
          />
          <p className={estilos.fechaOrden}>Creada el {fecha(order.createdAt)}</p>
        </div>

        {/*
          ⚠️ EN UNA ORDEN CANCELADA NO SE DIBUJA LA RUTA. `actual={4}` marca los
          tres pasos como listos, y el segundo es el pago: seria el sitio
          afirmando que se cobro algo que no se cobro. Un riel de progreso sobre
          un estado terminal y negativo tampoco tiene a donde avanzar.
        */}
        {!cancelada && <RutaDeCompra actual={paso} animar={!quieto} />}

        {/*
          ⚠️ LA ESPERA DEL WEBHOOK ERA UN PARRAFO GRIS QUIETO, y encima MUDO:
          `<Aviso tono="neutro">` no lleva `role`.

          ⚠️ LA BARRA MIDE LA ESPERA DE VERDAD: su duracion es la del `<meta
          refresh>`. Una barra que se mueve sin medir nada es justo el tipo de
          movimiento que esta pantalla no puede permitirse.
        */}
        {confirmando && (
          <section
            className={`${estilos.confirmando} sup-noche con-grano`}
            role="status"
            style={{ '--espera': `${SEGUNDOS_ENTRE_REINTENTOS}s` } as CSSProperties}
          >
            <span className={estilos.confirmandoSigno} aria-hidden="true">
              <span className={estilos.confirmandoHalo} />
              <IconoIntercambio tamanio={28} />
            </span>

            <div>
              <h2 className={estilos.confirmandoTitulo}>Estamos confirmando tu pago</h2>
              <p className={estilos.confirmandoTexto}>
                {sigueEsperando
                  ? 'Mercado Pago nos está avisando. Esta página se actualiza sola; no hace falta que hagas nada.'
                  : 'Está tardando más de lo habitual. Tu pago no se perdió: cuando Mercado Pago lo confirme, la orden avanza sola.'}
              </p>
            </div>

            {sigueEsperando && (
              <div className={estilos.confirmandoRiel} aria-hidden="true">
                <span className={estilos.confirmandoAvance} />
              </div>
            )}

            {/*
              ⚠️ LA SALIDA MANUAL SE RENDERIZA SIEMPRE, y antes desaparecia justo
              cuando hacia falta: al agotarse la espera automatica la pantalla
              decia "esta tardando mas de lo habitual" y no ofrecia NINGUNA
              accion —ni actualizar, ni volver—.
            */}
            <p className={estilos.confirmandoManual}>
              <a href={proximoIntento}>
                {sigueEsperando ? 'Actualizar ahora' : 'Volver a fijarme'}
              </a>
            </p>
          </section>
        )}

        {!sigueEsperando && confirmando && (
          <FilaDeAcciones centrada={false}>
            <BotonEnlace href="/cuenta/compras" variante="secundario">
              Ver mis compras
            </BotonEnlace>
          </FilaDeAcciones>
        )}

        {/*
          ⚠️ `pending` ES ALCANZABLE Y NO ESTABA CONTEMPLADO. La preferencia no
          excluye medios de pago en efectivo, asi que quien elige Rapipago o
          Pago Facil vuelve con `status=pending` — y hasta entonces no veia
          NINGUN mensaje: solo un boton de pagar que invitaba a pagar dos veces.
        */}
        {status === 'pending' && pendiente && (
          <Aviso>
            Mercado Pago todavía no acreditó el pago. Si elegiste pagar en efectivo, la orden se
            confirma sola cuando el pago se acredite.
          </Aviso>
        )}

        {status === 'failure' && pendiente && (
          /*
            ⚠️ Un pago rechazado NO cancela la orden (DEC-033 / UC-MF-2): sigue
            en PENDING_PAYMENT y se puede reintentar dentro de la ventana.

            ⚠️ Y NO SE ANIMA MAS ALLA DE APARECER: `Aviso` ya le pone
            `.entra-seco` a los errores —140ms sin desplazamiento— porque ya
            interrumpe con `role="alert"`.
          */
          <Aviso tono="error">
            El pago no se pudo completar. La orden sigue reservada: podés intentar de nuevo.
          </Aviso>
        )}

        {/*
          ⚠️ EL ESTADO TIÑE EL TICKET ENTERO —el asta y el paño—. `data-tono`
          recibe el tono YA resuelto por `tonoDeOrden()`: el CSS no tiene un
          segundo mapa de estados.
        */}
        <section
          className={`${estilos.ticket} sup-ficha con-grano${quieto ? '' : ' entra'}`}
          data-tono={tono}
        >
          <div className={`${estilos.ticketBanda} ${estilos.rombos}`} aria-hidden="true" />

          <header className={estilos.ticketCabecera}>
            <div>
              <p className={estilos.ticketRotulo}>Orden</p>
              <p className={estilos.ticketNumero}>{order.orderNumber}</p>
            </div>
            {/*
              ⚠️ `animada` ES UNA SOLA VUELTA Y SOLO CUANDO EL ESTADO YA CAMBIO.
              Marca que el estado es lo que hay que mirar cuando la pantalla
              vuelve del webhook; mientras se confirma no se aplica, porque el
              `<meta refresh>` la dispararia en cada recarga.
            */}
            <Etiqueta tono={tono} animada={!pendiente}>
              {estadoDeOrden(order.status)}
            </Etiqueta>
          </header>

          <div className={estilos.ticketCuerpo}>
            {order.items.map((item) => {
              const portada = portadas.get(item.listingId);

              return (
                <div key={item.id} className={estilos.itemOrden}>
                  <span className={`${estilos.itemMarco} zoom-marco`}>
                    {portada === undefined ? (
                      <span
                        className={`${estilos.itemPatron} ${estilos.rombos} ${estilos.rombosFinos}`}
                        aria-hidden="true"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className={`${estilos.itemFoto} zoom-foto`}
                        src={portada}
                        alt=""
                        width={72}
                        height={90}
                        decoding="async"
                      />
                    )}
                  </span>
                  <div className={estilos.itemDatos}>
                    {/*
                      ⚠️ ES EL TITULO CONGELADO EN LA ORDEN, no el de la
                      publicacion de hoy (DEC-030). Si el vendedor le cambio el
                      nombre despues, la compra sigue diciendo lo que se compro.
                    */}
                    <p className={estilos.itemTitulo}>{item.title}</p>
                    {item.quantity > 1 && (
                      <p className={estilos.itemCantidad}>{item.quantity} unidades</p>
                    )}
                  </div>
                  <span className={estilos.itemPrecio}>
                    {precio(item.unitPriceAmount, order.currency)}
                  </span>
                </div>
              );
            })}

            {/*
              ⚠️ ACA EL ENVIO YA NO ES UNA INCOGNITA: la orden lo CONGELO al
              crearse (DEC-030) con lo que el vendedor declaro. Cero no es
              "gratis" —puede estar incluido en el precio, ser a convenir o ser
              un retiro en persona—, asi que se dice "sin costo agregado" y no
              "gratis".
            */}
            <div className={estilos.lineaTicket}>
              <span className={estilos.conceptoTicket}>Envío</span>
              <span className={estilos.guia} aria-hidden="true" />
              <span
                className={`${estilos.valorTicket}${
                  order.shippingAmount === '0' ? ` ${estilos.pendiente}` : ''
                }`}
              >
                {order.shippingAmount === '0'
                  ? 'Sin costo agregado'
                  : precio(order.shippingAmount, order.currency)}
              </span>
            </div>

            {/*
              ⚠️ EL SELLO ES REDUNDANCIA PURA Y POR ESO PUEDE SER DECORATIVO: la
              `<Etiqueta>` de arriba y el bloque de cierre ya dicen el estado con
              palabras.
            */}
            {pagada && !cancelada && (
              <span className={`${estilos.sello} entra-telon-diagonal oblicuo`} aria-hidden="true">
                Pagada
              </span>
            )}
          </div>

          <div className={estilos.perforacion} aria-hidden="true" />

          <div className={`${estilos.total} sup-2`}>
            <span className={estilos.totalConcepto}>Total</span>
            <span className={`${estilos.totalValor}${quieto ? '' : ' cifra-entra'}`}>
              {quieto ? total : <span>{total}</span>}
            </span>
          </div>
        </section>

        {/*
          ⚠️ EL PLAZO ESTABA EN LOS DATOS Y NO SE MOSTRABA. El dato mas util que
          puede tener una orden sin pagar es hasta cuando se puede pagar.
        */}
        {pendiente && !vencida && !confirmando && order.paymentDeadline !== null && (
          <p className={estilos.plazo}>
            Podés pagarla hasta el {fechaHora(order.paymentDeadline)}. Después se libera la unidad.
          </p>
        )}

        {/*
          ⚠️ MIENTRAS SE CONFIRMA NO SE OFRECE PAGAR. Dejar el boton a la vista
          justo despues de volver de Mercado Pago es invitar a pagar dos veces
          la misma orden.

          ⚠️ EL BLOQUE DE MARCA ES EL ENFASIS. Sobre `.sup-cancha` el primario
          pasa solo a Amarillo Cambio con texto Tinta (13.97:1), y el corte
          diagonal de seccion es la bandera cruzando la pantalla: la unica vez en
          todo el tramo, puesta donde se cobra.
        */}
        {pendiente && !vencida && !confirmando && (
          <div className={`${estilos.accionPago} sup-cancha con-grano`}>
            <Formulario
              accion={pagar}
              enviar={status === 'failure' ? 'Intentar de nuevo' : 'Pagar con Mercado Pago'}
            >
              <CampoOculto nombre="orderId" valor={order.id} />
            </Formulario>
            <p className={estilos.notaPago}>
              <IconoAutenticado tamanio={16} />
              <span>Te llevamos a Mercado Pago. Offside no ve los datos de tu tarjeta.</span>
            </p>
          </div>
        )}

        {pendiente && vencida && (
          <>
            <Aviso tono="error">La ventana de pago de esta orden venció.</Aviso>
            <FilaDeAcciones centrada={false}>
              <BotonEnlace href="/" variante="secundario">
                Volver al catálogo
              </BotonEnlace>
            </FilaDeAcciones>
          </>
        )}

        {/*
          ⚠️ CANCELAR VA EN DOS PASOS Y SOLO SI LA MAQUINA DE ESTADOS LO PERMITE.
          `actions.canCancel` sale de `canTransition(estado, 'CANCELLED',
          'buyer')`: la pantalla no decide desde cuando se puede cancelar, lo
          pregunta. Una orden ya pagada no se cancela desde acá — eso es un
          reembolso, y lo emite el back-office.
        */}
        {order.actions.canCancel && !confirmando && (
          <div className={estilos.cancelar}>
            <Confirmar
              etiqueta="Cancelar la orden"
              pregunta="La orden se cancela y la unidad vuelve a estar disponible para otra persona. Si querés la camiseta después, tenés que empezar una compra nueva."
            >
              <Formulario
                accion={cancelarOrden}
                enviar="Sí, cancelar la orden"
                variante="peligro"
                tamanio="chico"
                bloque={false}
              >
                <CampoOculto nombre="orderId" valor={order.id} />
              </Formulario>
            </Confirmar>
          </div>
        )}

        {/*
          ⚠️ EL ENVIO SE MUESTRA CUANDO EXISTE, no cuando el estado lo sugiere:
          `shipments` guarda el despacho manual que cargo el vendedor (SH-010) y
          es la unica fuente de transportista y numero de seguimiento. Correo
          Argentino no esta integrado, asi que acá NO hay seguimiento automático
          y no se promete ninguno.
        */}
        {envio !== null && (
          <section className={`${estilos.envio} sup-ficha con-grano`}>
            <h2 className={estilos.envioTitulo}>
              <IconoCamion tamanio={20} />
              <span>Envío</span>
            </h2>

            <div className={estilos.envioDatos}>
              <p className={estilos.envioEstado}>
                <Etiqueta tono={envio.deliveredAt === null ? 'marca' : 'exito'}>
                  {estadoDeEnvio(envio.status)}
                </Etiqueta>
                {envio.carrierName !== null && <span>{envio.carrierName}</span>}
              </p>

              {envio.trackingNumber !== null && (
                <p className={estilos.envioSeguimiento}>
                  Seguimiento: <strong>{envio.trackingNumber}</strong>
                  {envio.trackingUrl !== null && (
                    <>
                      {' · '}
                      {/*
                        ⚠️ ES UN SITIO DE UN TERCERO: se abre en otra pestaña y
                        se avisa, en vez de sacar a alguien de su compra sin
                        decirle a donde va.
                      */}
                      <a href={envio.trackingUrl} target="_blank" rel="noreferrer noopener">
                        Seguirlo en el sitio del correo
                      </a>
                    </>
                  )}
                </p>
              )}

              {envio.dispatchedAt !== null && (
                <p className={estilos.envioFecha}>Despachado el {fecha(envio.dispatchedAt)}</p>
              )}
            </div>

            {/*
              ⚠️ LO CONFIRMA QUIEN RECIBE, Y ES UNA CONSECUENCIA DE NO TENER
              TRANSPORTISTA INTEGRADO: sin tracking, la unica persona que sabe
              que el paquete llego es quien lo tiene en la mano.
            */}
            {order.actions.canConfirmDelivery && (
              <div className={estilos.envioAccion}>
                <Formulario accion={confirmarRecepcion} enviar="Lo recibí" bloque={false}>
                  <CampoOculto nombre="orderId" valor={order.id} />
                </Formulario>
                <p className={estilos.envioNota}>
                  Confirmalo cuando tengas el paquete. Desde ahí corre el plazo de protección al
                  comprador.
                </p>
              </div>
            )}
          </section>
        )}

        {/*
          ⚠️ LA CRONOLOGIA VA DESPUES DEL DINERO Y ANTES DEL CIERRE. Es lo que
          contesta "¿y ahora qué?", que es la pregunta que trae a alguien de
          vuelta a esta pantalla cuando ya pagó.

          ⚠️ NO SE DIBUJA SOBRE UNA ORDEN SIN PAGAR Y SIN HISTORIA: un solo hito
          hecho y cinco apagados no es una cronologia, es una promesa. La ruta de
          pasos de arriba ya dice en qué punto está.
        */}
        {(pagada || cancelada) && (
          <section className={estilos.seguimiento}>
            <h2 className={estilos.subtitulo}>Seguimiento</h2>
            <Cronologia hitos={hitos} etiqueta="Recorrido de la orden" />
          </section>
        )}

        {/*
          ⚠️ EL FINAL FELIZ TIENE QUE VERSE COMO UN FINAL. Antes una orden pagada
          terminaba en dos botones sueltos sobre papel.

          ⚠️ NINGUNO ES `fantasma`: esa variante escribe `--color-cancha` a mano
          en `ui.module.css`, asi que sobre Verde Cancha es invisible.
        */}
        {!pendiente && (
          /*
            ⚠️ LA SUPERFICIE CAMBIA CON EL DESENLACE, NO CON EL GUSTO. Verde
            Cancha es la superficie de la marca celebrando; una cancelacion baja
            a `.sup-fosa` y el titular pasa a `--color-alerta`, que sobre oscuro
            SI es un color de texto (7.26:1) y sobre claro no lo seria.
          */
          <div
            className={
              cancelada
                ? `${estilos.cierre} ${estilos.cierreApagado} sup-fosa con-grano`
                : `${estilos.cierre} sup-cancha con-grano`
            }
          >
            <p className={estilos.cierreTitulo}>
              {cancelada ? 'Orden cancelada' : 'Listo, recibimos tu pago'}
            </p>
            {!cancelada && (
              <p className={estilos.cierreTexto}>
                El vendedor ya puede preparar el envío. Vas a poder seguir esta orden desde Mis
                compras.
              </p>
            )}
            {/*
              ⚠️ SE DICE EL HECHO Y NADA MAS. Una orden cancelada ya no se puede
              pagar —lo dice la maquina de estados—, pero POR QUE se cancelo y si
              hubo devolucion depende de disputas y refunds: se inventaria una
              politica desde la interfaz.
            */}
            {cancelada && (
              <p className={estilos.cierreTexto}>
                Esta orden ya no se puede pagar. Si querés la camiseta, empezá una compra nueva.
              </p>
            )}
            <FilaDeAcciones>
              <BotonEnlace href={`/cuenta/compras/${order.id}`}>Ver el detalle</BotonEnlace>
              <BotonEnlace href="/buscar" variante="secundario">
                Seguir mirando camisetas
              </BotonEnlace>
            </FilaDeAcciones>
          </div>
        )}

        {/*
          ⚠️ EL DETALLE COMPLETO NO SE DUPLICA ACA. La direccion de envio, el
          desglose de importes y los reclamos viven en una sola pantalla; esta es
          la del pago. El enlace se renderiza siempre —incluso con la orden sin
          pagar— porque es la unica salida hacia el historial.
        */}
        {pendiente && (
          <p className={estilos.nota}>
            <a href={`/cuenta/compras/${order.id}`}>Ver el detalle completo de la orden</a>
          </p>
        )}
      </main>
    </Pantalla>
  );
}
