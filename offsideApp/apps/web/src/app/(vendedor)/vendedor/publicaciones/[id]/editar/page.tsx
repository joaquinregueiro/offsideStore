import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AreaDeTexto, Campo, CampoOculto, Formulario, Seleccion } from '@/components/form';
import { Aviso, BotonEnlace } from '@/components/ui';
import { precio } from '@/lib/formato';
import { requireSellerSessionUser } from '@/lib/session';
import { listMyListings } from '@/modules/listings/services/listing.service';

import { editar } from '../../../../acciones';
import estilos from '../../../../vendedor.module.css';

export const metadata: Metadata = { title: 'Editar publicación — Offside Store' };
export const dynamic = 'force-dynamic';

/**
 * Edición de una publicación (SS-040).
 *
 * ⚠️ NO SE PUEDE CAMBIAR LA CATEGORÍA. Cambiarla puede volver obligatorios
 * atributos que la publicación no tiene (ERD §9.1). Si hace falta, se publica
 * de nuevo. Se dice en la pantalla en vez de mostrar un campo que rechaza.
 *
 * ⚠️ LAS FOTOS SE ADMINISTRAN APARTE. Subir archivos y editar texto tienen
 * ritmos distintos —una falla de red al subir no debería perder los cambios de
 * precio—, así que viven en dos pantallas.
 */
export default async function EditarPublicacion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireSellerSessionUser(`/vendedor/publicaciones/${id}/editar`);

  // Misma autorización que el resto: se busca entre las propias del vendedor.
  const publicacion = (await listMyListings(user)).find((item) => item.id === id);
  if (publicacion === undefined) notFound();

  if (publicacion.status === 'deleted') {
    return (
      <main className={estilos.pagina}>
        <h1 className={estilos.titulo}>Editar</h1>
        <Aviso error>Esta publicación fue eliminada y ya no se puede editar.</Aviso>
        <div className={estilos.acciones}>
          <BotonEnlace href="/vendedor/publicaciones" variante="secundario">
            Volver
          </BotonEnlace>
        </div>
      </main>
    );
  }

  return (
    <main className={estilos.pagina}>
      <h1 className={estilos.titulo}>Editar</h1>
      <p className={estilos.bajada}>{publicacion.title}</p>

      <Formulario accion={editar} enviar="Guardar cambios">
        <CampoOculto nombre="listingId" valor={publicacion.id} />

        <Campo nombre="title" etiqueta="Título" defaultValue={publicacion.title} />

        <AreaDeTexto
          nombre="description"
          etiqueta="Descripción"
          defaultValue={publicacion.description ?? ''}
          ayuda="Estado real, detalles, marcas de uso. Ser preciso evita reclamos."
        />

        <div className={estilos.par}>
          <Campo
            nombre="precioPesos"
            etiqueta="Precio en pesos"
            tipo="number"
            defaultValue={(Number(publicacion.priceAmount) / 100).toString()}
            ayuda="Queda registrado en el historial de precios."
          />
          <Campo
            nombre="stock"
            etiqueta="Unidades"
            tipo="number"
            defaultValue={publicacion.stock.toString()}
            ayuda="En cero, la publicación queda como agotada."
          />
        </div>

        <div className={estilos.par}>
          <Campo nombre="sizeValue" etiqueta="Talle" defaultValue={publicacion.sizeValue} />
          <Seleccion
            nombre="condition"
            etiqueta="Estado"
            defaultValue={publicacion.condition}
            opciones={[
              { valor: 'NUEVO', etiqueta: 'Nuevo' },
              { valor: 'COMO_NUEVO', etiqueta: 'Como nuevo' },
              { valor: 'EXCELENTE', etiqueta: 'Excelente' },
              { valor: 'MUY_BUENO', etiqueta: 'Muy bueno' },
              { valor: 'BUENO', etiqueta: 'Bueno' },
              { valor: 'ACEPTABLE', etiqueta: 'Aceptable' },
            ]}
          />
        </div>

        <div className={estilos.par}>
          <Seleccion
            nombre="kitType"
            etiqueta="Tipo de camiseta"
            vacio="No corresponde"
            ayuda="Obligatorio si es una camiseta."
            defaultValue={publicacion.kitType ?? ''}
            opciones={[
              { valor: 'home', etiqueta: 'Titular' },
              { valor: 'away', etiqueta: 'Suplente' },
              { valor: 'third', etiqueta: 'Tercera' },
              { valor: 'goalkeeper', etiqueta: 'Arquero' },
              { valor: 'special', etiqueta: 'Especial' },
            ]}
          />
          <Seleccion
            nombre="sleeve"
            etiqueta="Mangas"
            vacio="No corresponde"
            ayuda="Obligatorio si es una camiseta."
            defaultValue={publicacion.sleeve ?? ''}
            opciones={[
              { valor: 'short', etiqueta: 'Cortas' },
              { valor: 'long', etiqueta: 'Largas' },
            ]}
          />
        </div>
      </Formulario>

      {/*
        ⚠️ BR-023 / SS-041. Es la duda que tiene cualquiera que cambia un precio,
        y la respuesta es tranquilizadora: la orden congeló su importe al
        crearse y nunca vuelve a leer el precio de la publicación.
      */}
      <Aviso>
        Cambiar el precio <strong>no afecta a las órdenes ya hechas</strong>: cada una guardó su
        importe cuando se creó.
      </Aviso>

      <p className={estilos.nota}>
        El precio actual es {precio(publicacion.priceAmount, publicacion.currency)}. Cada cambio
        queda registrado en el historial. La categoría no se puede cambiar: si te equivocaste,
        publicá de nuevo.
      </p>

      <div className={estilos.acciones}>
        <BotonEnlace href={`/vendedor/publicaciones/${publicacion.id}/fotos`} variante="secundario">
          Administrar fotos
        </BotonEnlace>
        <BotonEnlace href="/vendedor/publicaciones" variante="secundario">
          Volver
        </BotonEnlace>
      </div>
    </main>
  );
}
