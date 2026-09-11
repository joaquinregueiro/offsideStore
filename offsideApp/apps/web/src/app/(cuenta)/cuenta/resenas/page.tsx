import type { Metadata } from 'next';
import Link from 'next/link';

import { IconoEstrella } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import { BotonEnlace, Estrellas, EstadoVacio, Seccion } from '@/components/ui';
import { cantidad, fecha } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import { listMyReviews } from '@/modules/reviews/services/review.service';

import { ChapaDeCuenta } from '../../chapa';
import { PanelDeCuenta, SolapasDeCuenta } from '../../panel';
import estilos from '../../cuenta.module.css';

export const metadata: Metadata = { title: 'Mis reseñas' };
export const dynamic = 'force-dynamic';

/**
 * LAS RESEÑAS QUE ESCRIBÍ (BS-100).
 *
 * ⚠️ LA RUTA VA SIN EÑE (`/cuenta/resenas`) A PROPÓSITO. Un `ñ` en una URL viaja
 * percent-encoded (`rese%C3%B1as`) y así aparece al copiarla, al compartirla y
 * en cualquier log. El texto visible sí lleva la eñe, que es lo que se lee.
 *
 * ⚠️ NO HAY "EDITAR" NI "BORRAR", y no es un faltante: una reseña que se puede
 * reescribir después de que el vendedor respondió deja la respuesta hablando de
 * algo que ya no está. El Service tampoco lo permite.
 *
 * ⚠️ LAS FECHAS LLEGAN COMO `Date`, no como ISO. `listMyReviews` devuelve la
 * fila del repositorio tal cual, que es el único Service de esta pantalla que lo
 * hace: por eso hay `.toISOString()` antes de `fecha()`, que espera ISO.
 */
export default async function MisResenas() {
  const user = await requireVerifiedSessionUser('/cuenta/resenas');
  const resenas = await listMyReviews(user);

  return (
    <Pantalla>
      <PanelDeCuenta user={user} seccion="compras">
        <main id="contenido">
          <ChapaDeCuenta
            rotulo="Mi cuenta"
            titulo="Mis reseñas"
            detalle={
              <p className={estilos.chapaDetalle}>
                {resenas.length === 0
                  ? 'Todavía no calificaste ninguna compra'
                  : cantidad(resenas.length, 'reseña')}
              </p>
            }
          />

          <SolapasDeCuenta user={user} seccion="compras" activa="resenas" />

          {resenas.length === 0 ? (
            <EstadoVacio titulo="Todavía no calificaste" icono={<IconoEstrella tamanio={40} />}>
              {/*
              ⚠️ SE DICE CUÁNDO SE PUEDE CALIFICAR, no sólo que todavía no se
              hizo. Calificar exige una orden COMPLETED: sin esa línea, alguien
              con una compra en curso busca un botón que no existe.
            */}
              <p>
                Cuando una compra se complete vas a poder calificar al vendedor desde la ficha de
                esa compra.
              </p>
              <BotonEnlace href="/cuenta/compras" variante="secundario">
                Ver mis compras
              </BotonEnlace>
            </EstadoVacio>
          ) : (
            <Seccion titulo="Lo que escribiste" dato={cantidad(resenas.length, 'reseña')}>
              <ul className={`${estilos.lista} ${estilos.revela}`}>
                {resenas.map((resena) => (
                  <li key={resena.id} className={`${estilos.tarjetaTexto} sup-ficha eleva`}>
                    <div className={estilos.tarjetaCabecera}>
                      <span className={estilos.tarjetaEnlace}>{resena.sellerDisplayName}</span>
                      <span className={estilos.tarjetaFecha}>
                        {fecha(resena.createdAt.toISOString())}
                      </span>
                    </div>

                    {/*
                    ⚠️ `cantidad={1}` NO ES UN CONTEO DE RESEÑAS: `Estrellas` lo
                    usa para decidir si hay algo que dibujar y para el texto
                    accesible "4 de 5". Acá es una reseña, la de esta persona.
                  */}
                    <Estrellas promedio={resena.rating} cantidad={1} />

                    {resena.comment !== null && <p className={estilos.texto}>{resena.comment}</p>}

                    {resena.sellerReply === null ? (
                      <p className={estilos.pendiente}>El vendedor todavía no respondió.</p>
                    ) : (
                      <div className={estilos.respuesta}>
                        <p className={estilos.respuestaRotulo}>
                          Respuesta de {resena.sellerDisplayName}
                          {resena.sellerRepliedAt !== null &&
                            ` · ${fecha(resena.sellerRepliedAt.toISOString())}`}
                        </p>
                        <p className={estilos.texto}>{resena.sellerReply}</p>
                      </div>
                    )}

                    <p className={estilos.pendiente}>
                      <Link href={`/cuenta/compras/${resena.orderId}`} className="subraya">
                        Orden {resena.orderNumber}
                      </Link>
                    </p>
                  </li>
                ))}
              </ul>
            </Seccion>
          )}
        </main>
      </PanelDeCuenta>
    </Pantalla>
  );
}
