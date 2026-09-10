<<<<<<< HEAD
import type { CSSProperties } from 'react';
=======
>>>>>>> origin/main
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CampoOculto, Formulario } from '@/components/form';
<<<<<<< HEAD
import { IconoAutenticado, IconoIntercambio } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import { Aviso, BotonEnlace, Etiqueta, FilaDeAcciones, Migas } from '@/components/ui';
import { estadoDeOrden, fecha, precio, tonoDeOrden } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import { coverUrls } from '@/modules/listings/services/listing.service';
=======
import { Aviso, BotonEnlace, Etiqueta } from '@/components/ui';
import { estadoDeOrden, precio } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
>>>>>>> origin/main
import { getMyOrder } from '@/modules/orders/services/order.service';

import { pagar } from '../../acciones';
import estilos from '../../resumen.module.css';
<<<<<<< HEAD
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
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}): Promise<Metadata> {
  const { status } = await searchParams;

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
=======

export const metadata: Metadata = { title: 'Pago — Offside Store' };
export const dynamic = 'force-dynamic';

/**
>>>>>>> origin/main
 * Pago de una orden. Esta pantalla cumple DOS papeles:
 *
 *  1. ANTES de pagar: resumen y boton que lleva a Mercado Pago.
 *  2. AL VOLVER de Mercado Pago: es la `back_url` que la preferencia declara
 *     (`/checkout/{orderId}?status=success|pending|failure`).
 *
 * Son la misma pantalla a proposito: el estado de la orden ya distingue los dos
 * momentos, y tener dos paginas obligaria a mantener dos resumenes iguales.
 */
export default async function Checkout({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
<<<<<<< HEAD
  searchParams: Promise<{ status?: string; intento?: string }>;
}) {
  const [{ orderId }, { status, intento }] = await Promise.all([params, searchParams]);
=======
  searchParams: Promise<{ status?: string }>;
}) {
  const [{ orderId }, { status }] = await Promise.all([params, searchParams]);
>>>>>>> origin/main

  const user = await requireVerifiedSessionUser(`/checkout/${orderId}`);
  const order = await getMyOrder(user, orderId);

  // Una orden ajena devuelve `null` igual que una inexistente: no se distinguen.
  if (order === null) notFound();

<<<<<<< HEAD
  const portadas = await coverUrls(order.items.map((item) => item.listingId));

=======
>>>>>>> origin/main
  const pendiente = order.status === 'PENDING_PAYMENT';
  const vencida =
    order.paymentDeadline !== null && new Date(order.paymentDeadline).getTime() <= Date.now();

<<<<<<< HEAD
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
   * COMO SI LO FUERA. `!pendiente` mete en la MISMA rama a `PAID` y a
   * `CANCELLED`, asi que una orden cancelada salia con los tres pasos marcados
   * ✓ —el rombo de "Pago" en verde, afirmando que el pago se completo— y con el
   * bloque de cierre de marca: "Cancelada" en Amarillo Cambio a tamaño display
   * sobre Verde Cancha, o sea la tipografia de la celebracion.
   *
   * ⚠️ NO ES UNA RAMA MUERTA. `CANCELLED` esta en el enum y `lib/formato.ts` ya
   * le asigna texto y tono `alerta`; el ciclo de vida de la orden todavia se
   * corta en `PAID`, pero el dia que exista el vencimiento automatico esta
   * pantalla es la que lo muestra.
   */
  const cancelada = order.status === 'CANCELLED';
  const tono = tonoDeOrden(order.status);
  const total = precio(order.totalAmount, order.currency);

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

        <Migas items={[{ texto: 'Mis compras', href: '/mis-compras' }, { texto: 'Pago' }]} />

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

          ⚠️ EL ANUNCIO REAL LO HACEN EL `<title>` Y ESTE `<h2>`, no el
          `role="status"`: una live region solo anuncia mutaciones posteriores a
          su insercion, y aca cada actualizacion es un documento nuevo. El `role`
          queda como red para el dia que esto se actualice sin recargar.

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
                  : 'Está tardando más de lo habitual. Tu pago no se perdió: cuando Mercado Pago lo confirme, la orden pasa a Pagada.'}
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
              accion —ni actualizar, ni volver—, porque el bloque de acciones de
              abajo solo aparece cuando la orden ya no esta pendiente.
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
            <BotonEnlace href="/mis-compras" variante="secundario">
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
          segundo mapa de estados, que es exactamente lo que `lib/formato.ts`
          documenta que ya paso siete veces.
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

            <div className={estilos.lineaTicket}>
              <span className={estilos.conceptoTicket}>Envío</span>
              <span className={estilos.guia} aria-hidden="true" />
              <span className={`${estilos.valorTicket} ${estilos.pendiente}`}>No incluido</span>
            </div>

            {/*
              ⚠️ EL SELLO ES REDUNDANCIA PURA Y POR ESO PUEDE SER DECORATIVO: la
              `<Etiqueta>` de arriba y el bloque de cierre ya dicen "Pagada" con
              palabras. Es el unico desenlace feliz del producto entero y hasta
              hoy lo unico que cambiaba era un chip de 12px.
            */}
            {order.status === 'PAID' && (
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
          ⚠️ EL PLAZO ESTABA EN LOS DATOS Y NO SE MOSTRABA. `getMyOrder` devuelve
          `paymentDeadline` y la pantalla lo usaba solo para calcular `vencida`:
          el dato mas util que puede tener una orden sin pagar es hasta cuando se
          puede pagar.
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
          ⚠️ EL FINAL FELIZ TIENE QUE VERSE COMO UN FINAL. Antes una orden pagada
          terminaba en dos botones sueltos sobre papel.

          ⚠️ NINGUNO ES `fantasma`: esa variante escribe `--color-cancha` a mano
          en `ui.module.css`, asi que sobre Verde Cancha es invisible. Sobre esta
          superficie el primario es Amarillo Cambio y el secundario es contorno
          papel (5.16:1).
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
              {order.status === 'PAID' ? 'Listo, recibimos tu pago' : estadoDeOrden(order.status)}
            </p>
            {order.status === 'PAID' && (
              <p className={estilos.cierreTexto}>
                El vendedor ya puede preparar el envío. Vas a poder seguir esta orden desde Mis
                compras.
              </p>
            )}
            {/*
              ⚠️ SE DICE EL HECHO Y NADA MAS. Una orden cancelada ya no se puede
              pagar —lo dice la maquina de estados—, pero POR QUE se cancelo y si
              hubo devolucion depende de disputas y refunds, que no existen: se
              inventaria una politica desde la interfaz.
            */}
            {cancelada && (
              <p className={estilos.cierreTexto}>
                Esta orden ya no se puede pagar. Si querés la camiseta, empezá una compra nueva.
              </p>
            )}
            <FilaDeAcciones>
              <BotonEnlace href="/mis-compras">Ver mis compras</BotonEnlace>
              <BotonEnlace href="/buscar" variante="secundario">
                Seguir mirando camisetas
              </BotonEnlace>
            </FilaDeAcciones>
          </div>
        )}
      </main>
    </Pantalla>
=======
  return (
    <main className={estilos.pagina}>
      <h1 className={estilos.titulo}>Orden {order.orderNumber}</h1>

      {/*
        ⚠️ EL RETORNO DE MERCADO PAGO NO CONFIRMA NADA (BS-072 / DEC-028). MP
        devuelve al comprador apenas termina, pero la fuente de verdad es el
        WEBHOOK, que puede tardar segundos. Decir "pagado" porque la URL trae
        `status=success` seria afirmar algo que todavia no sabemos.
      */}
      {status === 'success' && pendiente && (
        <div style={{ marginBottom: 24 }}>
          <Aviso>
            Estamos confirmando tu pago con Mercado Pago. Puede tardar unos segundos; actualizá esta
            página en un momento.
          </Aviso>
        </div>
      )}

      {status === 'failure' && pendiente && (
        <div style={{ marginBottom: 24 }}>
          {/*
            ⚠️ Un pago rechazado NO cancela la orden (DEC-033 / UC-MF-2): sigue
            en PENDING_PAYMENT y se puede reintentar dentro de la ventana.
          */}
          <Aviso error>El pago no se pudo completar. Podés intentar de nuevo.</Aviso>
        </div>
      )}

      <div className={estilos.resumen}>
        {order.items.map((item) => (
          <div key={item.id} className={estilos.linea}>
            <span>
              {item.title}
              {item.quantity > 1 && ` × ${item.quantity}`}
            </span>
            <span>{precio(item.unitPriceAmount, order.currency)}</span>
          </div>
        ))}

        <div className={`${estilos.linea} ${estilos.lineaTotal}`}>
          <span className={estilos.concepto}>Total</span>
          <span className={estilos.total}>{precio(order.totalAmount, order.currency)}</span>
        </div>

        <div className={estilos.linea}>
          <span className={estilos.concepto}>Estado</span>
          <Etiqueta aviso={order.status === 'CANCELLED'}>{estadoDeOrden(order.status)}</Etiqueta>
        </div>
      </div>

      {pendiente && !vencida && (
        <Formulario accion={pagar} enviar="Pagar con Mercado Pago">
          <CampoOculto nombre="orderId" valor={order.id} />
        </Formulario>
      )}

      {pendiente && vencida && (
        <>
          <Aviso error>La ventana de pago de esta orden venció.</Aviso>
          <p className={estilos.nota}>
            <BotonEnlace href="/" variante="secundario">
              Volver al catálogo
            </BotonEnlace>
          </p>
        </>
      )}

      {!pendiente && (
        <>
          {order.status === 'PAID' && (
            <Aviso>Recibimos tu pago. El vendedor ya puede preparar el envío.</Aviso>
          )}
          <p className={estilos.nota}>
            <BotonEnlace href="/mis-compras" variante="secundario">
              Ver mis compras
            </BotonEnlace>
          </p>
        </>
      )}
    </main>
>>>>>>> origin/main
  );
}
