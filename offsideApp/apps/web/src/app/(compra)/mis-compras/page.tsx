import type { Metadata } from 'next';
import Link from 'next/link';

import { IconoCamiseta } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import { BotonEnlace, Etiqueta, EstadoVacio, Seccion } from '@/components/ui';
import { estadoDeOrden, fecha, precio, tonoDeOrden } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import { coverUrls } from '@/modules/listings/services/listing.service';
import { listMyOrders } from '@/modules/orders/services/order.service';

import estilos from '../resumen.module.css';

export const metadata: Metadata = { title: 'Mis compras' };
export const dynamic = 'force-dynamic';

/** Historial de compras (BS-080). */
export default async function MisCompras() {
  const user = await requireVerifiedSessionUser('/mis-compras');
  const ordenes = await listMyOrders(user);

  /*
   * Las portadas de TODAS las ordenes en una sola consulta. La composicion la
   * hace la pantalla: `orders` no importa el repositorio de `listings`.
   */
  const portadas = await coverUrls(ordenes.flatMap((orden) => orden.items.map((i) => i.listingId)));

  return (
    <Pantalla>
      {/*
        ⚠️ ESTA PANTALLA ES MAS ANCHA QUE LAS OTRAS DOS DEL GRUPO, y no es una
        inconsistencia: la compra pide columna angosta porque no hay nada que
        comparar al costado; el historial ES un catalogo de lo que compraste.
      */}
      <main id="contenido" className={`${estilos.pagina} ${estilos.paginaAncha}`}>
        <div className={`${estilos.cabecera} entra`}>
          <h1 className={estilos.titulo}>Mis compras</h1>
          <span
            className={`${estilos.reglaTitulo} ${estilos.reglaTituloAnimada}`}
            aria-hidden="true"
          />
        </div>

        {ordenes.length === 0 ? (
          <EstadoVacio titulo="Todavía no compraste nada" icono={<IconoCamiseta tamanio={40} />}>
            {/*
              ⚠️ NO DICE "Y SU SEGUIMIENTO". No hay modulo `shipments` ni
              tracking: prometerlo en el estado vacio es exactamente el tipo de
              promesa sin nada detras que `/como-funciona` existe para no hacer.
            */}
            <p>Cuando compres una camiseta, la vas a ver acá con su estado.</p>
            <BotonEnlace href="/">Ver el catálogo</BotonEnlace>
          </EstadoVacio>
        ) : (
          <Seccion
            titulo="Historial"
            dato={ordenes.length === 1 ? '1 orden' : `${ordenes.length} órdenes`}
          >
            {/*
              ⚠️ `.enfoca-hermanos` SOLO TOCA LA FOTO, nunca el texto: bajarle la
              opacidad a la ficha entera arruinaria el contraste del titulo y del
              total de todo lo que no esta bajo el mouse. Una foto no tiene
              requisito de contraste; un importe si. Y vive detras de
              `@media (hover: hover)`: en un telefono el `:hover` queda pegado
              despues de un toque y la lista se quedaria con once fotos apagadas.
            */}
            <ul className={`${estilos.compras} revela-grilla-materia enfoca-hermanos`}>
              {ordenes.map((orden) => {
                /*
                  ⚠️ ANTES ESTO ERA UNA LISTA DE CODIGOS `OFF-XXXXXXXXXX`. Nadie
                  recuerda una compra por su numero de orden: la recuerda por la
                  camiseta. El titulo sale del snapshot congelado en la orden
                  (DEC-030), asi que sigue diciendo lo que se compro aunque el
                  vendedor haya cambiado la publicacion despues.
                */
                const principal = orden.items[0];
                const portada =
                  principal === undefined ? undefined : portadas.get(principal.listingId);
                const otros = orden.items.length - 1;

                return (
                  <li key={orden.id}>
                    {/*
                      ⚠️ `data-tono` LLEVA EL TONO YA RESUELTO, no el estado. El
                      CSS mapea cuatro tonos a cuatro colores y nunca vuelve a
                      decidir que estado es cual: esa decision vive en un solo
                      lugar (`lib/formato.ts`).
                    */}
                    {/*
                      ⚠️ `.presiona` NO ES REDUNDANTE CON `.eleva`. En un
                      telefono no existe el `:hover`, asi que la ficha entera
                      —que es un enlace de 120px de alto— no daba NINGUNA señal
                      de haber sido tocada hasta que llegaba la pantalla
                      siguiente. `.eleva:active` solo devuelve la elevacion a
                      cero, que sin hover previo no se ve.
                    */}
                    <Link
                      href={`/checkout/${orden.id}`}
                      className={`${estilos.compra} sup-ficha eleva destello presiona`}
                      data-tono={tonoDeOrden(orden.status)}
                      transitionTypes={['avanza']}
                    >
                      <span className={`${estilos.compraMarco} zoom-marco`}>
                        {portada === undefined ? (
                          <span
                            className={`${estilos.compraPatron} ${estilos.rombos} ${estilos.rombosFinos}`}
                            data-foto
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
                          <Etiqueta tono={tonoDeOrden(orden.status)}>
                            {estadoDeOrden(orden.status)}
                          </Etiqueta>
                          {/*
                            ⚠️ EL TOTAL NO TIENE ANIMACION PROPIA, ni siquiera de
                            entrada. La ficha entera entra con
                            `.revela-grilla-materia` y el numero viaja adentro:
                            un historial donde doce importes se mueven por
                            separado se lee como doce numeros calculandose.
                          */}
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
    </Pantalla>
  );
}
