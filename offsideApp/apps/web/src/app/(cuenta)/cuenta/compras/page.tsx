import type { Metadata } from 'next';
import Link from 'next/link';

import { IconoCamiseta } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import { BotonEnlace, Etiqueta, EstadoVacio, Seccion } from '@/components/ui';
import { cantidad, estadoDeOrden, fecha, precio, tonoDeOrden } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import { coverUrls } from '@/modules/listings/services/listing.service';
import { listMyOrders, type OrderStatus } from '@/modules/orders/services/order.service';

import { ChapaDeCuenta } from '../../chapa';
import { PanelDeCuenta, SolapasDeCuenta } from '../../panel';
import estilos from '../../cuenta.module.css';

export const metadata: Metadata = { title: 'Mis compras' };
export const dynamic = 'force-dynamic';

/**
 * Los filtros del riel.
 *
 * ⚠️ ESTÁ TIPADO COMO `OrderStatus` A PROPÓSITO: si DEC-029 cambia un estado,
 * esto NO compila. Una lista de strings sueltos se quedaría vieja en silencio y
 * el filtro devolvería cero resultados sin que nada avisara.
 *
 * ⚠️ `PAID` NO TIENE PESTAÑA, y no es un olvido: `PAID` es un instante —el pago
 * aprobado deja la orden en `PROCESSING`—, así que una pestaña "Pagada"
 * aparecería siempre vacía. El estado sí se muestra en la tarjeta si alguna
 * orden llega a quedar ahí por un faltante de stock.
 */
const FILTROS: readonly { estado: OrderStatus; texto: string }[] = [
  { estado: 'PENDING_PAYMENT', texto: 'Esperando pago' },
  { estado: 'PROCESSING', texto: 'En preparación' },
  { estado: 'SHIPPED', texto: 'Enviadas' },
  { estado: 'DELIVERED', texto: 'Entregadas' },
  { estado: 'COMPLETED', texto: 'Completadas' },
  { estado: 'CANCELLED', texto: 'Canceladas' },
];

/**
 * Valida el `?estado=` de la URL contra la lista de arriba.
 *
 * ⚠️ UN VALOR INVENTADO SE TRATA COMO "TODAS", no como un error. La URL la puede
 * escribir cualquiera y un 400 por un parámetro de filtro sería castigar a
 * alguien por un enlace viejo; además evita que el parámetro se convierta en un
 * oráculo de qué valores existen en el enum.
 */
function estadoDeLaUrl(valor: string | string[] | undefined): OrderStatus | undefined {
  if (typeof valor !== 'string') return undefined;

  return FILTROS.find((filtro) => filtro.estado === valor)?.estado;
}

/**
 * MIS COMPRAS (BS-080), con filtro por estado en la URL.
 *
 * ⚠️ EL FILTRO VIAJA POR GET Y SON ENLACES. Una lista filtrada se comparte, se
 * guarda en favoritos, vuelve con el botón atrás y anda sin JavaScript. Nada de
 * estado de React para lo que una URL puede representar.
 *
 * ⚠️ EL CONTEO DE LA PESTAÑA ES EL TOTAL, NO EL FILTRADO. Un numerito que cambia
 * según el filtro deja de ser "cuántas compras tengo" y pasa a ser "cuántas
 * estoy viendo", que ya lo dice la pantalla.
 */
export default async function MisCompras({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireVerifiedSessionUser('/cuenta/compras');
  const params = await searchParams;
  const estado = estadoDeLaUrl(params.estado);

  /*
   * ⚠️ SIN FILTRO SE HACE UNA SOLA CONSULTA. La lista completa ya es la
   * respuesta, y el total de la pestaña sale de ella: pedir las dos siempre
   * sería un `SELECT` de más en el caso más frecuente.
   */
  const todas = await listMyOrders(user);
  const ordenes = estado === undefined ? todas : await listMyOrders(user, { estado });

  /*
   * Las portadas de TODAS las órdenes en una sola consulta. La composición la
   * hace la pantalla: `orders` no importa el repositorio de `listings`.
   */
  const portadas = await coverUrls(ordenes.flatMap((orden) => orden.items.map((i) => i.listingId)));

  return (
    <Pantalla>
      <PanelDeCuenta user={user} seccion="compras">
        <main id="contenido">
          <ChapaDeCuenta
            rotulo="Mi cuenta"
            titulo="Mis compras"
            detalle={
              <p className={estilos.chapaDetalle}>
                {todas.length === 0
                  ? 'Todavía no compraste nada'
                  : `${cantidad(todas.length, 'compra')} en total`}
              </p>
            }
          />

          <SolapasDeCuenta user={user} seccion="compras" activa="historial" />

          {todas.length > 0 && (
            <nav className={estilos.filtros} aria-label="Filtrar por estado">
              <Link
                href="/cuenta/compras"
                className={
                  estado === undefined
                    ? `${estilos.filtro} ${estilos.filtroActivo}`
                    : estilos.filtro
                }
                aria-current={estado === undefined ? 'page' : undefined}
              >
                Todas
              </Link>
              {FILTROS.map((filtro) => {
                const activo = estado === filtro.estado;

                return (
                  <Link
                    key={filtro.estado}
                    href={`/cuenta/compras?estado=${filtro.estado}`}
                    className={
                      activo ? `${estilos.filtro} ${estilos.filtroActivo}` : estilos.filtro
                    }
                    aria-current={activo ? 'page' : undefined}
                  >
                    {filtro.texto}
                  </Link>
                );
              })}
            </nav>
          )}

          {ordenes.length === 0 ? (
            <EstadoVacio
              titulo={estado === undefined ? 'Todavía no compraste nada' : 'Ninguna compra acá'}
              icono={<IconoCamiseta tamanio={40} />}
            >
              {/*
              ⚠️ NO DICE "Y SU SEGUIMIENTO". No hay integración con ningún
              transportista: el seguimiento es lo que el vendedor declara a mano.
              Prometerlo en un estado vacío es el tipo de promesa sin nada detrás
              que `/como-funciona` existe para no hacer.
            */}
              {estado === undefined ? (
                <>
                  <p>Cuando compres una camiseta, la vas a ver acá con su estado.</p>
                  <BotonEnlace href="/">Ver el catálogo</BotonEnlace>
                </>
              ) : (
                <>
                  <p>No tenés compras en ese estado.</p>
                  <BotonEnlace href="/cuenta/compras" variante="secundario">
                    Ver todas
                  </BotonEnlace>
                </>
              )}
            </EstadoVacio>
          ) : (
            <Seccion
              titulo="Historial"
              dato={
                estado === undefined
                  ? cantidad(ordenes.length, 'orden', 'órdenes')
                  : `${cantidad(ordenes.length, 'orden', 'órdenes')} · ${estadoDeOrden(estado)}`
              }
            >
              <ul className={`${estilos.lista} ${estilos.revela}`}>
                {ordenes.map((orden) => {
                  /*
                  ⚠️ EL TÍTULO SALE DEL SNAPSHOT CONGELADO EN LA ORDEN (DEC-030),
                  no de la publicación actual: sigue diciendo lo que se compró
                  aunque el vendedor la haya renombrado o eliminado después.
                  Nadie recuerda una compra por su número de orden.
                */
                  const principal = orden.items[0];
                  const portada =
                    principal === undefined ? undefined : portadas.get(principal.listingId);
                  const otros = orden.items.length - 1;

                  return (
                    <li key={orden.id}>
                      <Link
                        href={`/cuenta/compras/${orden.id}`}
                        className={`${estilos.compra} sup-ficha eleva destello presiona`}
                        data-tono={tonoDeOrden(orden.status)}
                        transitionTypes={['avanza']}
                      >
                        <span className={`${estilos.compraMarco} zoom-marco`}>
                          {portada === undefined ? (
                            <span
                              className={`${estilos.compraPatron} ${estilos.rombos}`}
                              aria-hidden="true"
                            />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className={`${estilos.compraFoto} zoom-foto`}
                              src={portada}
                              alt=""
                              width={96}
                              height={120}
                              loading="lazy"
                              decoding="async"
                            />
                          )}
                        </span>

                        <div className={estilos.compraCuerpo}>
                          <p className={estilos.compraTitulo}>
                            {principal?.title ?? `Orden ${orden.orderNumber}`}
                            {otros > 0 && (
                              <span className={estilos.compraOtros}>
                                {otros === 1 ? ' y 1 artículo más' : ` y ${otros} artículos más`}
                              </span>
                            )}
                          </p>
                          <p className={estilos.compraMeta}>
                            {fecha(orden.createdAt)} · Orden {orden.orderNumber}
                          </p>
                          <div className={estilos.compraPie}>
                            {/*
                            ⚠️ LA ETIQUETA NO LATE Y NO ENTRA ANIMADA. El estado de
                            una orden que se mueve se lee como un estado que
                            todavía no está decidido.
                          */}
                            <Etiqueta tono={tonoDeOrden(orden.status)}>
                              {estadoDeOrden(orden.status)}
                            </Etiqueta>
                            <span className={estilos.compraTotal}>
                              {precio(orden.totalAmount, orden.currency)}
                            </span>
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Seccion>
          )}
        </main>
      </PanelDeCuenta>
    </Pantalla>
  );
}
