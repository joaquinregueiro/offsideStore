import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
  AreaDeTexto,
  Campo,
  CampoImporte,
  CampoOculto,
  Formulario,
  GrupoDeCampos,
  Seleccion,
  SubtituloDeGrupo,
} from '@/components/form';
import { Pantalla } from '@/components/movimiento';
import { Aviso, BotonEnlace, Seccion } from '@/components/ui';
import { estadoDePublicacion, precio, tonoDePublicacion } from '@/lib/formato';
import { requireSellerSessionUser } from '@/lib/session';
import { PanelDeCuenta } from '../../../../../(cuenta)/panel';
import { listCatalogs, listMyListings } from '@/modules/listings/services/listing.service';

import { editar } from '../../../../acciones';
import { Chapa } from '../../../../chapa';
import estilos from '../../../../vendedor.module.css';

export const metadata: Metadata = { title: 'Editar publicación' };
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
 *
 * ⚠️ LOS MISMOS GRUPOS QUE `publicar`, EN EL MISMO ORDEN, Y NO ES SIMETRIA POR
 * SIMETRIA. Quien publicó una camiseta hace una semana ya aprendió dónde está
 * cada cosa, y volver a encontrarlos en otro orden —o en una lista plana— obliga
 * a releer el formulario entero para corregir un typo.
 *
 * ⚠️ SON TRES Y NO CUATRO: acá no existe el grupo "Fotos" —se administran en su
 * propia pantalla— ni el selector de categoría, que no se puede cambiar. El
 * `counter()` de `.formPublicar` los numera solo, así que la diferencia no
 * miente en ninguna de las dos pantallas.
 */
export default async function EditarPublicacion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireSellerSessionUser(`/vendedor/publicaciones/${id}/editar`);

  // Misma autorización que el resto: se busca entre las propias del vendedor.
  const [propias, catalogos] = await Promise.all([listMyListings(user), listCatalogs()]);
  const publicacion = propias.find((item) => item.id === id);
  if (publicacion === undefined) notFound();

  if (publicacion.status === 'deleted') {
    return (
      <Pantalla>
        <PanelDeCuenta user={user} seccion="publicaciones">
          <main id="contenido">
            <Chapa
              rotulo="Inventario"
              titulo="Editar"
              chica
              detalle={<p className={estilos.chapaDetalle}>{publicacion.title}</p>}
              estado={{ texto: 'Eliminada', tono: 'alerta' }}
            />

            {/*
            ⚠️ ELIMINAR ES TERMINAL Y LOGICO (`status = 'deleted'`): la
            publicación sigue existiendo porque `order_items` la referencia, pero
            no se puede volver atrás. La pantalla lo dice y ofrece la salida en
            vez de dejar un formulario que va a rechazar.
          */}
            <Aviso tono="error">Esta publicación fue eliminada y ya no se puede editar.</Aviso>

            <div className={estilos.acciones}>
              <BotonEnlace href="/vendedor/publicaciones" variante="secundario">
                Volver a mis publicaciones
              </BotonEnlace>
            </div>
          </main>
        </PanelDeCuenta>
      </Pantalla>
    );
  }

  return (
    <Pantalla>
      <PanelDeCuenta user={user} seccion="publicaciones">
        <main id="contenido">
          <Chapa
            rotulo="Inventario"
            titulo="Editar"
            chica
            /*
            ⚠️ EL TITULO DE LA PUBLICACION VA EN EL DETALLE, NO EN EL `<h1>`. El
            titular dice qué se está haciendo; con quince camisetas parecidas, el
            nombre de la que se está tocando es lo que evita editar la
            equivocada.
          */
            detalle={<p className={estilos.chapaDetalle}>{publicacion.title}</p>}
            estado={{
              texto: estadoDePublicacion(publicacion.status),
              tono: tonoDePublicacion(publicacion.status),
            }}
            accion={
              <BotonEnlace
                href={`/vendedor/publicaciones/${publicacion.id}/fotos`}
                variante="secundario"
              >
                Fotos
              </BotonEnlace>
            }
          />

          {/*
          ⚠️ BR-023 / SS-041, ARRIBA Y NO AL PIE. Es la duda que tiene cualquiera
          que cambia un precio, y la respuesta es tranquilizadora: la orden
          congeló su importe al crearse (DEC-030) y nunca vuelve a leer el precio
          de la publicación. Leerla DESPUES de haber guardado no sirve de nada.
        */}
          <Aviso>
            Cambiar el precio <strong>no afecta a las órdenes ya hechas</strong>: cada una guardó su
            importe cuando se creó. Hoy está en{' '}
            <strong>{precio(publicacion.priceAmount, publicacion.currency)}</strong>.
          </Aviso>

          {/* El mismo marco numerado que `publicar`: mismos grupos, misma cuenta. */}
          <div className={estilos.formPublicar}>
            <Formulario accion={editar} enviar="Guardar cambios">
              <CampoOculto nombre="listingId" valor={publicacion.id} />

              <GrupoDeCampos titulo="Qué estás vendiendo">
                <Campo nombre="title" etiqueta="Título" defaultValue={publicacion.title} />

                <AreaDeTexto
                  nombre="description"
                  etiqueta="Descripción"
                  defaultValue={publicacion.description ?? ''}
                  ayuda="Estado real, detalles, marcas de uso. Ser preciso evita reclamos."
                />
              </GrupoDeCampos>

              <GrupoDeCampos titulo="Precio y stock">
                {/* Misma primitiva de plata y mismo orden que `publicar`: es el
                  punto entero de que los dos formularios se lean igual. */}
                <CampoImporte
                  nombre="precioPesos"
                  etiqueta="Precio en pesos"
                  defaultValue={(Number(publicacion.priceAmount) / 100).toString()}
                  min={1}
                  step={1}
                  ayuda="Queda registrado en el historial de precios."
                />

                <div className={estilos.par}>
                  {/*
                  ⚠️ `min={0}` Y NO `min={1}`, al revés que en publicar: acá el
                  cero es un valor legítimo y con significado —deja la
                  publicación agotada— y es la única forma de sacarla de la venta
                  sin pausarla.
                */}
                  <Campo
                    nombre="stock"
                    etiqueta="Unidades"
                    tipo="number"
                    defaultValue={publicacion.stock.toString()}
                    min={0}
                    step={1}
                    inputMode="numeric"
                    ayuda="En cero, la publicación queda como agotada."
                  />
                  <Campo nombre="sizeValue" etiqueta="Talle" defaultValue={publicacion.sizeValue} />
                </div>

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

                {/*
                ⚠️ ESTOS CINCO CAMPOS FALTABAN, Y SU AUSENCIA CAUSABA UNA PERDIDA
                DE DATOS SILENCIOSA. El formulario no los renderizaba, la acción
                los leía como ausentes y mandaba `null`: **corregir un typo en el
                título borraba el club, la marca y la temporada**. La publicación
                desaparecía de todas las facetas de la búsqueda y perdía el peso
                de los alias —"CARP" dejaba de encontrarla (PS-024)— sin que nada
                lo avisara.

                La acción ya tiene el parche que impide escribir sobre lo que no
                vino (`catalogoAEscribir` pregunta por `formData.has()`); esto es
                la otra mitad: poder EDITARLAS. Y como ahora sí vienen en el
                formulario, elegir "Sin especificar" limpia el campo de verdad.
              */}
                <SubtituloDeGrupo>Para que te encuentren</SubtituloDeGrupo>

                <p className={estilos.pasoDetalle}>
                  Todos opcionales. Alimentan los filtros de la búsqueda: una camiseta con club y
                  marca cargados aparece cuando alguien filtra por ellos.
                </p>

                <div className={estilos.par}>
                  <Seleccion
                    nombre="clubId"
                    etiqueta="Club"
                    vacio="Sin especificar"
                    defaultValue={publicacion.clubId ?? ''}
                    opciones={catalogos.clubes.map((c) => ({ valor: c.id, etiqueta: c.name }))}
                  />
                  <Seleccion
                    nombre="nationalTeamId"
                    etiqueta="Selección"
                    vacio="Sin especificar"
                    defaultValue={publicacion.nationalTeamId ?? ''}
                    opciones={catalogos.selecciones.map((c) => ({ valor: c.id, etiqueta: c.name }))}
                  />
                </div>

                <div className={estilos.par}>
                  <Seleccion
                    nombre="brandId"
                    etiqueta="Marca"
                    vacio="Sin especificar"
                    defaultValue={publicacion.brandId ?? ''}
                    opciones={catalogos.marcas.map((c) => ({ valor: c.id, etiqueta: c.name }))}
                  />
                  <Seleccion
                    nombre="seasonId"
                    etiqueta="Temporada"
                    vacio="Sin especificar"
                    defaultValue={publicacion.seasonId ?? ''}
                    opciones={catalogos.temporadas.map((c) => ({ valor: c.id, etiqueta: c.name }))}
                  />
                </div>

                <Seleccion
                  nombre="competitionId"
                  etiqueta="Competencia"
                  vacio="Sin especificar"
                  defaultValue={publicacion.competitionId ?? ''}
                  opciones={catalogos.competiciones.map((c) => ({ valor: c.id, etiqueta: c.name }))}
                />
              </GrupoDeCampos>

              <GrupoDeCampos
                titulo="Detalles de la prenda"
                detalle="Si es una camiseta, el tipo y las mangas son obligatorios."
              >
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
              </GrupoDeCampos>
            </Formulario>
          </div>

          <Seccion titulo="Lo demás de esta publicación">
            <div className={estilos.acciones}>
              <BotonEnlace
                href={`/vendedor/publicaciones/${publicacion.id}/fotos`}
                variante="secundario"
              >
                Administrar fotos
              </BotonEnlace>
              {/*
              ⚠️ EL ENLACE A LA FICHA PUBLICA SOLO SI ESTA ACTIVA. `/p/[id]`
              devuelve 404 para lo que no es comprable —pausada, borrador,
              agotada, o vendedor con Mercado Pago desconectado (SS-013)—, así
              que ofrecerlo siempre sería mandar al vendedor a una pantalla de
              error desde su propia publicación.
            */}
              {publicacion.status === 'active' && (
                <BotonEnlace href={`/p/${publicacion.id}`} variante="fantasma">
                  Ver cómo se publica
                </BotonEnlace>
              )}
              <BotonEnlace href="/vendedor/publicaciones" variante="fantasma">
                Volver al inventario
              </BotonEnlace>
            </div>
          </Seccion>

          <div className={`${estilos.cierre} sup-2 patron-vivo diagonales-vivas`}>
            <p className={estilos.nota}>
              Cada cambio de precio y de condición queda registrado (BR-015). La categoría no se
              puede cambiar: volvería obligatorios atributos que esta publicación no tiene, así que
              si te equivocaste hay que publicar de nuevo.
            </p>
          </div>
        </main>
      </PanelDeCuenta>
    </Pantalla>
  );
}
