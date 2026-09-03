import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CampoArchivos, CampoOculto, Formulario } from '@/components/form';
import { Aviso, BotonEnlace } from '@/components/ui';
import { requireSellerSessionUser } from '@/lib/session';
import { getImageSettings } from '@/modules/config/services/image-settings.service';
import { listMyListings } from '@/modules/listings/services/listing.service';
import { listImages } from '@/modules/listings/services/listing-image.service';

import { agregarFotos, borrarFoto } from '../../../../acciones';
import estilos from '../../../../vendedor.module.css';

export const metadata: Metadata = { title: 'Fotos — Offside Store' };
export const dynamic = 'force-dynamic';

/**
 * Fotos de una publicación (PS-010 / PS-011).
 *
 * ⚠️ LA AUTORIZACIÓN NO SE HACE ACÁ. Se listan las publicaciones del vendedor
 * autenticado y se busca la pedida entre ellas: si no está, es 404. Comparar
 * contra un `sellerId` traído del request sería el error clásico. Las Server
 * Actions vuelven a verificar por su cuenta contra el mismo Service.
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

  return (
    <main className={estilos.pagina}>
      <h1 className={estilos.titulo}>Fotos</h1>
      <p className={estilos.bajada}>{publicacion.title}</p>

      {imagenes.length === 0 ? (
        <Aviso error>
          Esta publicación no tiene fotos. Sin al menos una, prácticamente nadie la va a comprar.
        </Aviso>
      ) : (
        <div className={estilos.galeria}>
          {imagenes.map((imagen, indice) => (
            <figure key={imagen.id} className={estilos.miniatura}>
              {/*
                ⚠️ `<img>` y no `next/image`: las fotos se sirven ya
                redimensionadas desde el CDN del bucket, en tres variantes que
                genera el procesador. Pasarlas otra vez por el optimizador de
                Next las procesaría dos veces y haría que el servidor
                intervenga en cada imagen de cada visita, que es justamente lo
                que un CDN viene a evitar.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagen.variants.thumb ?? imagen.url}
                alt={imagen.alt ?? `Foto ${indice + 1} de ${publicacion.title}`}
                loading="lazy"
              />
              <figcaption>
                {indice === 0 && <span className={estilos.portada}>Portada</span>}
                <Formulario accion={borrarFoto} enviar="Borrar">
                  <CampoOculto nombre="listingId" valor={publicacion.id} />
                  <CampoOculto nombre="imageId" valor={imagen.id} />
                </Formulario>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {quedan > 0 ? (
        <Formulario accion={agregarFotos} enviar="Subir">
          <CampoOculto nombre="listingId" valor={publicacion.id} />
          <CampoArchivos
            nombre="fotos"
            etiqueta="Agregar fotos"
            ayuda={`Te quedan ${quedan} de ${settings.maxImages}. Máximo ${Math.floor(settings.maxBytes / (1024 * 1024))} MB cada una.`}
          />
        </Formulario>
      ) : (
        <Aviso>
          Llegaste al máximo de {settings.maxImages} fotos. Borrá alguna para subir otra.
        </Aviso>
      )}

      {/*
        ⚠️ TODAVIA NO SE PUEDE REORDENAR. La portada es la primera por posición,
        y borrar deja huecos que no se renumeran. Cambiar el orden necesita una
        interfaz de arrastrar —o botones de subir/bajar— y no entra en esta
        fase. Se dice, no se esconde.
      */}
      <p className={estilos.nota}>
        La portada es la primera foto. Por ahora no se puede reordenar: si querés otra portada,
        borrá las que sobran y subilas en el orden que quieras.
      </p>

      <div className={estilos.acciones}>
        <BotonEnlace href="/vendedor/publicaciones" variante="secundario">
          Volver a mis publicaciones
        </BotonEnlace>
      </div>
    </main>
  );
}
