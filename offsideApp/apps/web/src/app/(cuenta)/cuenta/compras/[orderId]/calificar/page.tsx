import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AreaDeTexto, CampoOculto, Formulario } from '@/components/form';
import { Pantalla } from '@/components/movimiento';
import { Aviso, BotonEnlace, Estrellas, EstrellasEntrada, Migas } from '@/components/ui';
import { cantidad, fecha } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import {
  isFeatureEnabled,
  getReviewWindowDays,
} from '@/modules/config/services/setting-store.service';
import { getMyOrderDetail } from '@/modules/orders/services/order.service';
import { listMyReviews, COMMENT_MAX_LENGTH } from '@/modules/reviews/services/review.service';
import { isWithinReviewWindow } from '@/modules/reviews/services/review-rules';

import { calificar } from '../../../../acciones';
import { ChapaDeCuenta } from '../../../../chapa';
import { NavDeCuenta } from '../../../../nav';
import estilos from '../../../../cuenta.module.css';

export const metadata: Metadata = { title: 'Calificar la compra' };
export const dynamic = 'force-dynamic';

/**
 * BS-100 — calificar al vendedor de una compra completada.
 *
 * ⚠️ LA MISMA RUTA MUESTRA EL FORMULARIO O LA RESEÑA YA HECHA, y es deliberado:
 * es UNA por orden (UNIQUE(order_id), ERD §15), así que después de calificar
 * volver acá tiene que mostrar lo que se escribió —y la respuesta del vendedor
 * si la hubo—, no un formulario que va a fallar.
 *
 * ⚠️ UNA ORDEN AJENA DA 404, igual que en la ficha: `getMyOrderDetail` devuelve
 * `null` tanto para lo ajeno como para lo inexistente y acá los dos casos se
 * ven igual.
 *
 * ⚠️ NO SE DECIDE ACÁ SI PUEDE CALIFICAR. `createReview` aplica las cinco reglas
 * de `reviewEligibilityError` en orden; esta pantalla sólo evita ofrecer un
 * botón que va a rebotar. Si las dos se separan, gana el Service.
 */
export default async function Calificar({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const user = await requireVerifiedSessionUser(`/cuenta/compras/${orderId}/calificar`);

  const detalle = await getMyOrderDetail(user, orderId);
  if (detalle === null) notFound();

  const [mias, diasDeResena, habilitado] = await Promise.all([
    /*
     * ⚠️ SE USA `listMyReviews` Y NO `getReviewForOrder` porque trae ADEMÁS la
     * respuesta del vendedor, que es la mitad de lo que hay que mostrar cuando
     * la reseña ya existe. `getReviewForOrder` sólo dice si existe.
     */
    listMyReviews(user),
    getReviewWindowDays(),
    isFeatureEnabled('reviews'),
  ]);

  const resena = mias.find((item) => item.orderId === orderId);
  const dentroDePlazo = isWithinReviewWindow(
    detalle.completedAt === null ? null : new Date(detalle.completedAt),
    diasDeResena,
    new Date(),
  );
  const puedeCalificar = detalle.status === 'COMPLETED' && dentroDePlazo && habilitado;

  /*
   * ⚠️ EL NOMBRE SALE DE LA ORDEN Y NO DE LA RESEÑA, y ese es el arreglo: antes
   * sólo se conocía DESPUÉS de calificar —`listMyReviews` lo trae—, así que la
   * pantalla donde hay que decidir el puntaje decía "el vendedor" a secas.
   * Ahora `getMyOrderDetail` lo expone y se puede nombrar a quién se está
   * calificando ANTES de hacerlo, que es cuando importa.
   */
  const tienda = detalle.sellerDisplayName ?? resena?.sellerDisplayName ?? null;

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <ChapaDeCuenta
          rotulo={`Orden ${detalle.orderNumber}`}
          titulo={resena === undefined ? 'Calificar' : 'Tu calificación'}
          detalle={
            <p className={estilos.chapaDetalle}>
              {resena === undefined
                ? (detalle.items[0]?.title ?? 'Tu compra')
                : tienda === null
                  ? 'A la tienda que te vendió'
                  : `A ${tienda}`}
            </p>
          }
        />

        <NavDeCuenta activo="compras" />

        <Migas
          items={[
            { texto: 'Mis compras', href: '/cuenta/compras' },
            { texto: `Orden ${detalle.orderNumber}`, href: `/cuenta/compras/${orderId}` },
            { texto: 'Calificar' },
          ]}
        />

        {resena !== undefined ? (
          <>
            <section className={`${estilos.tarjetaTexto} sup-ficha entraBloque`}>
              <div className={estilos.tarjetaCabecera}>
                {/*
                  ⚠️ EL NÚMERO ES EL DATO Y LAS ESTRELLAS SON EL DIBUJO: las
                  estrellas van `aria-hidden` y lo que se lee es "5 de 5".
                */}
                <Estrellas promedio={resena.rating} cantidad={1} tamanio="grande" />
                <span className={estilos.tarjetaFecha}>
                  {fecha(resena.createdAt.toISOString())}
                </span>
              </div>

              {resena.comment !== null && <p className={estilos.texto}>{resena.comment}</p>}

              {resena.sellerReply === null ? (
                <p className={estilos.pendiente}>{tienda ?? 'El vendedor'} todavía no respondió.</p>
              ) : (
                <div className={estilos.respuesta}>
                  <p className={estilos.respuestaRotulo}>
                    Respuesta de {tienda ?? 'la tienda'}
                    {resena.sellerRepliedAt !== null &&
                      ` · ${fecha(resena.sellerRepliedAt.toISOString())}`}
                  </p>
                  <p className={estilos.texto}>{resena.sellerReply}</p>
                </div>
              )}
            </section>

            {/*
              ⚠️ NO HAY "EDITAR" NI "BORRAR", y no es un faltante: una reseña que
              se puede reescribir después de que el vendedor respondió deja la
              respuesta hablando de algo que ya no está. El Service tampoco lo
              permite.
            */}
            <p className={estilos.nota}>
              La calificación es una sola por compra y no se puede cambiar. Si pasó algo con el
              producto, lo que corresponde es abrir un reclamo.
            </p>

            <div className={estilos.acciones}>
              <BotonEnlace href={`/cuenta/compras/${orderId}`} variante="secundario">
                Volver a la compra
              </BotonEnlace>
            </div>
          </>
        ) : puedeCalificar ? (
          <section className={`${estilos.bloque} sup-ficha entraBloque`}>
            {/*
              ⚠️ EL TÍTULO NOMBRA A QUIÉN SE CALIFICA. "Cómo estuvo la compra" no
              dice a quién le llega el puntaje; una reseña es SOBRE una tienda y
              se publica en su perfil, así que el nombre tiene que estar a la
              vista antes de elegir las estrellas.
            */}
            <h2 className={estilos.bloqueTitulo}>
              {tienda === null ? 'Cómo estuvo la compra' : `Cómo te trató ${tienda}`}
            </h2>

            <Formulario accion={calificar} enviar="Publicar la calificación">
              <CampoOculto nombre="orderId" valor={orderId} />
              {/*
                ⚠️ SON RADIOS DE VERDAD DENTRO DE UN `<fieldset>`: se elige con el
                teclado, cada uno tiene su etiqueta para lectores de pantalla y
                funciona sin una línea de JavaScript.
              */}
              <EstrellasEntrada nombre="rating" etiqueta="Tu puntaje" />
              <AreaDeTexto
                nombre="comment"
                etiqueta="Comentario (opcional)"
                ayuda="Contá cómo fue: el estado de la prenda, el tiempo de entrega, el trato."
                filas={5}
                maximo={COMMENT_MAX_LENGTH}
              />
            </Formulario>

            {/*
              ⚠️ SE AVISA QUE ES PÚBLICA ANTES DE ESCRIBIR, no después. La reseña
              se ve en el perfil del vendedor: enterarse al publicarla es tarde.
            */}
            <p className={estilos.nota}>
              Lo que escribas se va a ver en el perfil de {tienda ?? 'la tienda'} junto a tu
              puntaje. Tenés {cantidad(diasDeResena, 'día', 'días')} desde que se completó la compra
              para calificar, y se califica una sola vez.
            </p>
          </section>
        ) : (
          <Aviso tono="neutro">
            {!habilitado
              ? 'Las calificaciones están desactivadas por ahora.'
              : detalle.status !== 'COMPLETED'
                ? 'Vas a poder calificar cuando la compra esté completada.'
                : `El plazo para calificar (${cantidad(diasDeResena, 'día', 'días')} desde que se completó la compra) ya pasó.`}
          </Aviso>
        )}
      </main>
    </Pantalla>
  );
}
