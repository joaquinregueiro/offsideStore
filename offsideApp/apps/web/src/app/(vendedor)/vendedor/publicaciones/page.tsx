import type { Metadata } from 'next';
import Link from 'next/link';

import { CampoOculto, Formulario } from '@/components/form';
import { IconoBuscar, IconoCamiseta } from '@/components/iconos';
import { FotoCompartida, Pantalla } from '@/components/movimiento';
import {
  Aviso,
  BotonEnlace,
  Confirmar,
  Distintivo,
  EstadoVacio,
  Etiqueta,
  NavDeSeccion,
  Pastilla,
  Seccion,
} from '@/components/ui';
import { condicion, estadoDePublicacion, fecha, precio, tonoDePublicacion } from '@/lib/formato';
import { requireSellerSessionUser } from '@/lib/session';
import { PanelDeCuenta, SolapasDeCuenta } from '../../../(cuenta)/panel';
import { arePromotionsEnabled } from '@/modules/listings/services/listing-settings.service';
import { coverUrls, listMyListings } from '@/modules/listings/services/listing.service';
import { listPromotions } from '@/modules/listings/services/promotion.service';
import { getConnectionStatus } from '@/modules/sellers/services/mercadopago-connection.service';

import { eliminar, pausar, reactivar } from '../../acciones';
import { Chapa } from '../../chapa';
import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Mis publicaciones' };
export const dynamic = 'force-dynamic';

/**
 * Los filtros por estado, en el orden en que importan.
 *
 * ⚠️ "ELIMINADAS" NO ES UNA PESTAÑA. El borrado es lógico —`order_items`
 * referencia la publicación— pero para el vendedor es terminal: ofrecer una
 * pestaña para verlas sugeriría que se pueden recuperar, y no se pueden.
 */
const FILTROS = [
  { clave: 'todas', texto: 'Todas' },
  { clave: 'active', texto: 'A la venta' },
  { clave: 'paused', texto: 'Pausadas' },
  { clave: 'draft', texto: 'Borradores' },
  { clave: 'sold_out', texto: 'Agotadas' },
] as const;

type ClaveDeFiltro = (typeof FILTROS)[number]['clave'];

function esFiltro(valor: string | undefined): valor is ClaveDeFiltro {
  return FILTROS.some((f) => f.clave === valor);
}

/** Arma la URL conservando el otro parámetro: filtrar no puede borrar la búsqueda. */
function urlDe(filtro: ClaveDeFiltro, busqueda: string): string {
  const params = new URLSearchParams();
  if (filtro !== 'todas') params.set('estado', filtro);
  if (busqueda !== '') params.set('q', busqueda);

  const query = params.toString();

  return query === '' ? '/vendedor/publicaciones' : `/vendedor/publicaciones?${query}`;
}

/**
 * Inventario del vendedor (SS-060).
 *
 * ⚠️ ESTA PANTALLA NO FILTRA POR SS-013, y es lo contrario de la vitrina a
 * propósito. Si un vendedor desconecta Mercado Pago, sus publicaciones
 * desaparecen del catálogo público pero **siguen siendo suyas y siguen acá**:
 * esconderselas a él también sería hacerle creer que las perdió.
 *
 * ⚠️ EL FILTRO Y LA BUSQUEDA VIAJAN EN LA URL POR GET. Un inventario filtrado se
 * comparte, se guarda en favoritos y vuelve con el botón atrás; y el buscador es
 * un `<form method="get">` que funciona sin una línea de JavaScript.
 *
 * ⚠️ SE BUSCA EN MEMORIA Y NO CON `search_vector`. El índice full-text es de la
 * vitrina pública (DEC-042) y sólo indexa lo que está a la venta: acá hay que
 * poder encontrar un borrador y una pausada, que son justamente las que no están
 * indexadas. Es el inventario propio de una persona, no el catálogo entero.
 */
export default async function MisPublicaciones({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSellerSessionUser('/vendedor/publicaciones');
  const params = await searchParams;

  const crudo = Array.isArray(params.estado) ? params.estado[0] : params.estado;
  const filtro: ClaveDeFiltro = esFiltro(crudo) ? crudo : 'todas';

  const busquedaCruda = Array.isArray(params.q) ? params.q[0] : params.q;
  const busqueda = (busquedaCruda ?? '').trim().slice(0, 120);

  const [publicaciones, conexion, promociones, promocionesActivas] = await Promise.all([
    listMyListings(user),
    getConnectionStatus(user),
    listPromotions(user),
    arePromotionsEnabled(),
  ]);

  /*
   * ⚠️ LA PROMOCION VIGENTE SALE DEL HISTORIAL, no de `listings.promoted_until`:
   * `PublicListing` no expone esa columna. La fila de `listing_promotions` es
   * además la fuente de verdad —`promoted_until` es una proyección para que la
   * vitrina filtre con un solo WHERE—, así que esto no es un rodeo.
   */
  const promocionadas = new Map(
    promociones.filter((p) => p.vigente).map((p) => [p.listingId, p] as const),
  );

  // Una eliminada es terminal: no se lista ni se cuenta.
  const vivas = publicaciones.filter((item) => item.status !== 'deleted');

  const normalizar = (texto: string): string =>
    texto
      .toLowerCase()
      .normalize('NFD')
      // Sin esto, buscar "lanus" no encuentra "Lanús": es el mismo criterio de
      // `unaccent` que usa la busqueda publica. El rango es el de marcas
      // combinantes, escrito con codepoints para que no dependa de como se
      // guarde este archivo.
      .replace(/[\u0300-\u036f]/g, '');

  const termino = normalizar(busqueda);

  const visibles = vivas.filter((item) => {
    if (filtro !== 'todas' && item.status !== filtro) return false;
    if (termino === '') return true;

    return normalizar(item.title).includes(termino);
  });

  const portadas = await coverUrls(visibles.map((item) => item.id));

  /**
   * Cuántas dejaron de verse por la desconexión.
   *
   * Sólo las `active`: una pausada o un borrador tampoco se muestran, pero eso
   * lo decidió el vendedor y meterlas en la cuenta convertiría el aviso en un
   * número que no explica nada.
   */
  const activas = vivas.filter((p) => p.status === 'active').length;

  return (
    <Pantalla>
      <PanelDeCuenta user={user} seccion="publicaciones">
        <main id="contenido">
          <Chapa
            rotulo="Inventario"
            titulo="Mis publicaciones"
            chica
            accion={
              conexion.canSell ? (
                <BotonEnlace href="/vendedor/publicaciones/nueva" flecha>
                  Publicar
                </BotonEnlace>
              ) : undefined
            }
          />

          <SolapasDeCuenta user={user} seccion="publicaciones" activa="publicaciones" />

          {!conexion.canSell && (
            <Aviso tono="error">
              {activas > 0 &&
                (activas === 1 ? (
                  <>
                    <strong>Tu publicación activa no se está mostrando.</strong> Mientras Mercado
                    Pago no esté conectado nadie puede verla ni comprarla, porque no podríamos
                    cobrarte la venta. <strong>Vuelve sola al reconectar</strong>: no hace falta que
                    la republiques ni que toques nada.{' '}
                  </>
                ) : (
                  <>
                    <strong>Tus {activas} publicaciones activas no se están mostrando.</strong>{' '}
                    Mientras Mercado Pago no esté conectado nadie puede verlas ni comprarlas, porque
                    no podríamos cobrarte la venta. <strong>Vuelven solas al reconectar</strong>: no
                    hace falta que las republiques ni que toques nada.{' '}
                  </>
                ))}
              Para publicar necesitás estar habilitado y tener Mercado Pago conectado.{' '}
              <Link href="/vendedor">Ver qué te falta</Link>.
            </Aviso>
          )}

          {vivas.length === 0 ? (
            <EstadoVacio titulo="Todavía no publicaste nada" icono={<IconoCamiseta tamanio={40} />}>
              <p>Cuando publiques una camiseta va a aparecer acá, con su stock y su estado.</p>
              {conexion.canSell && (
                <BotonEnlace href="/vendedor/publicaciones/nueva" flecha>
                  Publicar la primera
                </BotonEnlace>
              )}
            </EstadoVacio>
          ) : (
            <>
              {/*
              ⚠️ ES UN `<form method="get">` Y NO UN FILTRO EN VIVO. Sin
              JavaScript el navegador navega a la misma URL que se podría
              escribir a mano; con JavaScript se comporta igual. Un filtro en vivo
              exigiría estado de cliente para algo que una URL representa mejor.
            */}
              <form className={estilos.buscadorInventario} method="get" role="search">
                {filtro !== 'todas' && <input type="hidden" name="estado" value={filtro} />}
                <label htmlFor="q" className="solo-lectores">
                  Buscar en tus publicaciones
                </label>
                <span className={estilos.buscadorIcono} aria-hidden="true">
                  <IconoBuscar tamanio={18} />
                </span>
                <input
                  id="q"
                  name="q"
                  type="search"
                  className={estilos.buscadorCampo}
                  placeholder="Buscar por título"
                  defaultValue={busqueda}
                  maxLength={120}
                />
                <button type="submit" className={estilos.buscadorBoton}>
                  Buscar
                </button>
              </form>

              <div className={estilos.navMarco}>
                <NavDeSeccion
                  etiqueta="Publicaciones por estado"
                  activo={filtro}
                  items={FILTROS.map((f) => {
                    const cuantas =
                      f.clave === 'todas'
                        ? vivas.length
                        : vivas.filter((p) => p.status === f.clave).length;

                    return {
                      clave: f.clave,
                      texto: f.texto,
                      href: urlDe(f.clave, busqueda),
                      ...(cuantas > 0 ? { dato: cuantas } : {}),
                    };
                  })}
                />
              </div>

              {/*
              ⚠️ LA PASTILLA MUESTRA LO QUE ESTA FILTRANDO Y COMO SACARLO. Sin
              ella, alguien que buscó "boca" hace diez minutos ve un inventario
              incompleto y no tiene forma de saber por qué.
            */}
              {busqueda !== '' && (
                <div className={estilos.pastillas}>
                  <Pastilla href={urlDe(filtro, '')} descripcion="Quitar la búsqueda">
                    «{busqueda}»
                  </Pastilla>
                </div>
              )}

              {visibles.length === 0 ? (
                <EstadoVacio titulo="No encontramos nada con esos filtros">
                  <p>
                    Probá con otro texto o mirá{' '}
                    <Link href="/vendedor/publicaciones">todas tus publicaciones</Link>.
                  </p>
                </EstadoVacio>
              ) : (
                <Seccion
                  titulo="Inventario"
                  dato={
                    visibles.length === 1 ? '1 publicación' : `${visibles.length} publicaciones`
                  }
                >
                  <ul className={`${estilos.inventario} revela-grilla`}>
                    {visibles.map((publicacion) => {
                      const portada = portadas.get(publicacion.id);
                      const promocion = promocionadas.get(publicacion.id);

                      return (
                        <li
                          key={publicacion.id}
                          className={estilos.fila}
                          /*
                          ⚠️ EL ESTADO VIAJA COMO ATRIBUTO, NO COMO CLASE
                          CALCULADA. Así el CSS decide cómo se ve cada estado sin
                          que esta pantalla tenga que conocer la paleta.
                        */
                          data-estado={publicacion.status}
                        >
                          <FotoCompartida id={publicacion.id}>
                            <span className={estilos.filaMarco}>
                              {portada === undefined ? (
                                <span className={estilos.filaPatron} aria-hidden="true" />
                              ) : (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  className={estilos.filaFoto}
                                  src={portada}
                                  alt=""
                                  width={84}
                                  height={105}
                                  loading="lazy"
                                  decoding="async"
                                />
                              )}
                            </span>
                          </FotoCompartida>

                          <div className={estilos.filaCuerpo}>
                            <div className={estilos.filaTitulo}>
                              <Link
                                href={`/p/${publicacion.id}`}
                                className="subraya"
                                transitionTypes={['avanza']}
                              >
                                {publicacion.title}
                              </Link>
                              <Etiqueta tono={tonoDePublicacion(publicacion.status)}>
                                {estadoDePublicacion(publicacion.status)}
                              </Etiqueta>
                              {/*
                              ⚠️ SE LLAMA "PROMOCIONADA" Y NO "DESTACADA". La
                              eligió el vendedor y pagó por eso: decirlo con su
                              nombre es lo que mantiene honesta la grilla.
                            */}
                              {promocion !== undefined && <Distintivo />}
                            </div>

                            <p className={estilos.filaMeta}>
                              Talle {publicacion.sizeValue} · {condicion(publicacion.condition)} ·{' '}
                              {publicacion.stock === 1
                                ? '1 unidad'
                                : `${publicacion.stock} unidades`}
                            </p>

                            {publicacion.stock === 1 && (
                              <p className={estilos.filaMeta}>
                                <span
                                  className={[
                                    estilos.chipUltima,
                                    publicacion.status === 'active' ? 'pulso-atencion' : '',
                                  ]
                                    .filter(Boolean)
                                    .join(' ')}
                                >
                                  Última unidad
                                </span>
                              </p>
                            )}

                            <p className={estilos.filaPrecio}>
                              {precio(publicacion.priceAmount, publicacion.currency)}
                            </p>

                            {publicacion.status === 'draft' && (
                              <p className={estilos.filaAviso}>
                                Sin fotos: no está a la venta hasta que subas al menos una.
                              </p>
                            )}

                            {/*
                            ⚠️ SE DICE HASTA CUANDO DURA Y QUE NO SE PUEDE
                            CORTAR. Una promoción que se ve como un adorno pero
                            cobra el triple de comisión es una trampa.
                          */}
                            {promocion !== undefined && (
                              <p className={estilos.filaAviso}>
                                Promocionada hasta el {fecha(promocion.endsAt)}: mientras dure, tu
                                comisión se multiplica. No se puede cortar antes.
                              </p>
                            )}

                            {/*
                            SS-050. Cada acción es un formulario propio: son
                            mutaciones y van por POST, no por enlace —un GET que
                            cambia estado se dispara con el prefetch del navegador—.
                          */}
                            <div className={estilos.filaAcciones}>
                              <BotonEnlace
                                href={`/vendedor/publicaciones/${publicacion.id}/editar`}
                                variante="fantasma"
                                tamanio="chico"
                              >
                                Editar
                              </BotonEnlace>
                              <BotonEnlace
                                href={`/vendedor/publicaciones/${publicacion.id}/fotos`}
                                variante="fantasma"
                                tamanio="chico"
                              >
                                Fotos
                              </BotonEnlace>

                              {/*
                              ⚠️ PROMOCIONAR ES UN ENLACE, NO UN BOTON QUE
                              PROMOCIONA. Cuesta plata —la comisión se
                              multiplica— y no se puede cancelar antes de tiempo:
                              lleva a una pantalla que lo explica con SU tasa y SU
                              precio antes de que apriete nada.
                            */}
                              {promocionesActivas &&
                                publicacion.status === 'active' &&
                                promocion === undefined && (
                                  <BotonEnlace
                                    href={`/vendedor/publicaciones/${publicacion.id}/promocionar`}
                                    variante="secundario"
                                    tamanio="chico"
                                  >
                                    Promocionar
                                  </BotonEnlace>
                                )}

                              {(publicacion.status === 'active' ||
                                publicacion.status === 'sold_out') && (
                                <Formulario
                                  accion={pausar}
                                  enviar="Pausar"
                                  variante="fantasma"
                                  tamanio="chico"
                                  bloque={false}
                                >
                                  <CampoOculto nombre="listingId" valor={publicacion.id} />
                                </Formulario>
                              )}

                              {publicacion.status === 'paused' && (
                                <Formulario
                                  accion={reactivar}
                                  enviar="Volver a la venta"
                                  variante="secundario"
                                  tamanio="chico"
                                  bloque={false}
                                >
                                  <CampoOculto nombre="listingId" valor={publicacion.id} />
                                </Formulario>
                              )}

                              {/*
                              ⚠️ ELIMINAR VA EN DOS PASOS. Es irreversible y el
                              botón de al lado es "Pausar", que sí se deshace. El
                              aviso de consecuencia se lee ANTES de decidir.
                            */}
                              <Confirmar
                                etiqueta="Eliminar"
                                pregunta="Se saca de la venta para siempre. El historial de quien ya la compró no se toca, pero vos no podés recuperarla."
                              >
                                <Formulario
                                  accion={eliminar}
                                  enviar="Sí, eliminar"
                                  variante="peligro"
                                  tamanio="chico"
                                  bloque={false}
                                >
                                  <CampoOculto nombre="listingId" valor={publicacion.id} />
                                </Formulario>
                              </Confirmar>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Seccion>
              )}
            </>
          )}

          {/*
          ⚠️ LAS TRES REGLAS QUE MAS IMPORTAN DE ESTA PANTALLA ESTABAN EN GRIS DE
          13px AL PIE. Que eliminar sea definitivo y que cambiar el precio no
          toque las órdenes ya hechas (BR-023 / SS-041) son cosas que hay que
          leer, no que hay que encontrar.
        */}
          <div className={`${estilos.cierre} sup-2 patron-vivo diagonales-vivas`}>
            <p className={estilos.nota}>
              Pausar la saca de la vitrina y podés volver a activarla cuando quieras. Eliminar es
              definitivo. Cambiar el precio no afecta a las órdenes ya hechas.
            </p>
          </div>
        </main>
      </PanelDeCuenta>
    </Pantalla>
  );
}
