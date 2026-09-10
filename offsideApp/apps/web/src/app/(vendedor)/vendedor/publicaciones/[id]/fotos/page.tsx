import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CampoArchivos, CampoOculto, Formulario } from '@/components/form';
import { IconoCamiseta } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import { Aviso, BotonEnlace, EstadoVacio, Seccion } from '@/components/ui';
import { requireSellerSessionUser } from '@/lib/session';
import { getImageSettings } from '@/modules/config/services/image-settings.service';
import { listMyListings } from '@/modules/listings/services/listing.service';
import { listImages } from '@/modules/listings/services/listing-image.service';

import { agregarFotos, borrarFoto } from '../../../../acciones';
import { Chapa } from '../../../../chapa';
import estilos from '../../../../vendedor.module.css';

export const metadata: Metadata = { title: 'Fotos' };
export const dynamic = 'force-dynamic';

/**
 * Anchos reales de las variantes que genera `image-processor.ts`.
 *
 * ⚠️ ESTAN ESCRITOS ACA A PROPOSITO Y NO IMPORTADOS: el procesador vive en la
 * infraestructura del modulo de listings y esta pantalla no la toca. Si mañana
 * cambian, lo peor que pasa es que el navegador elija una variante un escalon
 * mas grande de lo necesario — nunca una imagen rota.
 */
const ANCHOS: Record<string, number> = { thumb: 400, medium: 800, large: 1600 };

/**
 * `srcset` de una foto, a partir de las variantes que existan.
 *
 * ⚠️ SE GENERAN TRES TAMANIOS Y SE SERVIA SIEMPRE UNO SOLO. En una galería que
 * carga hasta ocho fotos de golpe, eso es la diferencia entre bajar 8 imágenes
 * de 400px y bajar 8 de 1600 —o, al revés, mostrar la de 400 estirada en una
 * pantalla de alta densidad—.
 *
 * ⚠️ DEVUELVE UN OBJETO PARA HACER SPREAD, no un string: con
 * `exactOptionalPropertyTypes` pasarle `srcSet={undefined}` a un `<img>` no
 * compila, y una foto vieja sin variantes tiene que quedarse sin el atributo.
 */
function srcSet(variantes: Record<string, string>): { srcSet?: string } {
  /*
   * ⚠️ SE ORDENA POR ANCHO, NO ALFABETICAMENTE. Un `.sort()` sobre las cadenas
   * ya armadas ordena por URL, que no tiene nada que ver con el tamaño: el
   * `srcset` salia en un orden arbitrario. Al navegador no le importa —elige por
   * el descriptor `w`—, pero a quien lo lea en el inspector si, y un orden que
   * parece significar algo y no significa nada es peor que ninguno.
   */
  const partes = Object.entries(variantes)
    .flatMap(([nombre, url]) => {
      const ancho = ANCHOS[nombre];
      return ancho === undefined ? [] : [{ url, ancho }];
    })
    .sort((a, b) => a.ancho - b.ancho)
    .map(({ url, ancho }) => `${url} ${ancho}w`);

  return partes.length > 0 ? { srcSet: partes.join(', ') } : {};
}

/**
 * Fotos de una publicación (PS-010 / PS-011).
 *
 * ⚠️ LA AUTORIZACIÓN NO SE HACE ACÁ. Se listan las publicaciones del vendedor
 * autenticado y se busca la pedida entre ellas: si no está, es 404. Comparar
 * contra un `sellerId` traído del request sería el error clásico. Las Server
 * Actions vuelven a verificar por su cuenta contra el mismo Service.
 *
 * ⚠️ ES LA PANTALLA MAS VISUAL DEL PANEL —una galería de camisetas— y era la
 * única que no mostraba una sola con jerarquía: `<img>` pelados sobre papel.
 * Cada foto vive ahora en un marco hundido, la portada se marca SOBRE la imagen
 * y no debajo, y la grilla se revela con el scroll.
 */
export default async function FotosDeLaPublicacion({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireSellerSessionUser(`/vendedor/publicaciones/${id}/fotos`);

  const mias = await listMyListings(user);
  const publicacion = mias.find((item) => item.id === id);
  if (publicacion === undefined) notFound();

  const [imagenes, settings] = await Promise.all([listImages(id), getImageSettings()]);

  const quedan = settings.maxImages - imagenes.length;
  const maxMb = Math.floor(settings.maxBytes / (1024 * 1024));

  /*
   * ⚠️ SE DICE SI ESTA EN BORRADOR, PORQUE ES LA CONSECUENCIA DE NO TENER FOTOS.
   * SS-032: la publicación nace en `draft` y se activa sola cuando tiene una
   * imagen. Sin decirlo, "subí una foto" es un consejo; diciéndolo, es la razón
   * por la que todavía no vende.
   */
  const enBorrador = publicacion.status === 'draft';

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Chapa
          rotulo="Inventario"
          titulo="Fotos"
          chica
          detalle={<p className={estilos.chapaDetalle}>{publicacion.title}</p>}
          estado={{
            texto:
              imagenes.length === 0
                ? 'Sin fotos'
                : imagenes.length === 1
                  ? '1 foto'
                  : `${imagenes.length} fotos`,
            tono: imagenes.length === 0 ? 'alerta' : 'marca',
          }}
          accion={
            <BotonEnlace
              href={`/vendedor/publicaciones/${publicacion.id}/editar`}
              variante="secundario"
            >
              Editar datos
            </BotonEnlace>
          }
        />

        {imagenes.length === 0 ? (
          <>
            {/*
              ⚠️ PS-010 CON RIEL DE ALERTA Y CON LA CONSECUENCIA ESCRITA. Antes
              decía "prácticamente nadie la va a comprar", que es una estimación;
              lo que corresponde decir es el hecho: sin una foto la publicación
              queda en borrador y no sale a la vitrina.
            */}
            <Aviso tono="error">
              {enBorrador ? (
                <>
                  Esta publicación está <strong>en borrador</strong> y no se muestra en la vitrina.
                  Sale a la venta sola en cuanto subas la primera foto.
                </>
              ) : (
                <>Esta publicación no tiene fotos. Sin al menos una no puede volver a la venta.</>
              )}
            </Aviso>

            <EstadoVacio
              titulo="Todavía no subiste ninguna foto"
              icono={<IconoCamiseta tamanio={40} />}
            >
              <p>
                La primera que subas queda de portada: es la que se ve en la vitrina y en la
                búsqueda. Si es usada o retro, sumá una de la etiqueta.
              </p>
            </EstadoVacio>
          </>
        ) : (
          <Seccion
            titulo="Fotos de la publicación"
            dato={
              quedan === 0
                ? `${imagenes.length} de ${settings.maxImages} · completo`
                : `${imagenes.length} de ${settings.maxImages}`
            }
          >
            {/*
              ⚠️ `revela-grilla` ESCALONA LA ENTRADA CON EL SCROLL Y ES CSS PURO
              (`animation-timeline: view()`). Sin soporte, o con
              `prefers-reduced-motion`, las fotos ya están: la clase global se
              apaga entera, no deja nada en `opacity: 0`.
            */}
            <ul className={`${estilos.galeria} revela-grilla`}>
              {imagenes.map((imagen, indice) => (
                <li key={imagen.id}>
                  <figure className={estilos.miniatura}>
                    {/*
                      ⚠️ LA PORTADA SE MARCA SOBRE LA FOTO Y NO DEBAJO. Es el
                      único dato de esta pantalla que cambia lo que ve un
                      comprador, y en el pie competía con el botón de borrar.
                    */}
                    {indice === 0 && <span className={estilos.portada}>Portada</span>}

                    {/*
                      ⚠️ EL RECORTE VIVE EN EL MARCO, NO EN LA `<figure>`: el pie
                      lleva el botón de borrar, y un ancestro con overflow oculto
                      le recorta el anillo de foco.

                      ⚠️ `zoom-marco` / `zoom-foto` SON LAS GLOBALES, no un
                      `scale` escrito a mano. Es el mismo acercamiento que usan
                      la vitrina y el inventario.
                    */}
                    <span className={`${estilos.miniaturaMarco} zoom-marco`}>
                      {/*
                        ⚠️ `<img>` y no `next/image`: las fotos se sirven ya
                        redimensionadas desde el CDN del bucket, en tres
                        variantes que genera el procesador. Pasarlas otra vez por
                        el optimizador de Next las procesaría dos veces y haría
                        que el servidor intervenga en cada imagen de cada visita,
                        que es justamente lo que un CDN viene a evitar.
                      */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        className="zoom-foto"
                        src={imagen.variants.thumb ?? imagen.url}
                        {...srcSet(imagen.variants)}
                        sizes="(max-width: 420px) 92vw, 220px"
                        alt={imagen.alt ?? `Foto ${indice + 1} de ${publicacion.title}`}
                        loading="lazy"
                        decoding="async"
                      />
                    </span>

                    <figcaption>
                      {/*
                        ⚠️ EL NUMERO DE ORDEN ES INFORMACION, NO ADORNO: la
                        portada es la primera POR POSICION y no se puede
                        reordenar todavía, así que saber en qué lugar está cada
                        foto es lo que permite decidir cuál borrar.
                      */}
                      <span className={estilos.miniaturaOrden}>
                        {String(indice + 1).padStart(2, '0')}
                      </span>

                      <Formulario
                        accion={borrarFoto}
                        enviar="Borrar"
                        variante="peligro"
                        tamanio="chico"
                        bloque={false}
                      >
                        <CampoOculto nombre="listingId" valor={publicacion.id} />
                        <CampoOculto nombre="imageId" valor={imagen.id} />
                      </Formulario>
                    </figcaption>
                  </figure>
                </li>
              ))}
            </ul>
          </Seccion>
        )}

        {quedan > 0 ? (
          <Formulario
            accion={agregarFotos}
            enviar={imagenes.length === 0 ? 'Subir fotos' : 'Subir'}
          >
            <CampoOculto nombre="listingId" valor={publicacion.id} />
            <CampoArchivos
              nombre="fotos"
              etiqueta="Agregar fotos"
              ayuda={`Te quedan ${quedan} de ${settings.maxImages}. Máximo ${maxMb} MB cada una. JPEG, PNG o WebP.`}
            />
          </Formulario>
        ) : (
          <Aviso>
            Llegaste al máximo de {settings.maxImages} fotos. Borrá alguna para subir otra.
          </Aviso>
        )}

        <div className={estilos.acciones}>
          <BotonEnlace href="/vendedor/publicaciones" variante="secundario">
            Volver a mis publicaciones
          </BotonEnlace>
        </div>

        {/*
          ⚠️ TODAVIA NO SE PUEDE REORDENAR. La portada es la primera por posición,
          y borrar deja huecos que no se renumeran. Cambiar el orden necesita una
          interfaz de arrastrar —o botones de subir/bajar— y no entra en esta
          fase. Se dice, no se esconde.

          ⚠️ Y SE DICE QUE BORRAR LA ULTIMA DE UNA ACTIVA SE RECHAZA: bajarla en
          silencio sería dejar de vender sin enterarse.
        */}
        <div className={`${estilos.cierre} sup-2 patron-vivo diagonales-vivas`}>
          <p className={estilos.nota}>
            La portada es la primera foto y por ahora no se puede reordenar: si querés otra portada,
            borrá las que sobran y subilas en el orden que quieras. Si la publicación está a la
            venta, borrar su única foto se rechaza — antes hay que pausarla.
          </p>
        </div>
      </main>
    </Pantalla>
  );
}
