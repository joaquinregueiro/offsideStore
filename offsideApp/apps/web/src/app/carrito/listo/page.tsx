import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { IconoCarrito, IconoTilde } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import { Aviso, BotonEnlace, Etiqueta, EstadoVacio, Migas } from '@/components/ui';
import { cantidad as cantidadLegible, estadoDeOrden, precio, tonoDeOrden } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import { getMyOrder } from '@/modules/orders/services/order.service';

import estilos from '../carrito.module.css';

export const metadata: Metadata = { title: 'Órdenes creadas' };
export const dynamic = 'force-dynamic';

/** Tope de ids que se leen de la URL. El carrito real nunca llega ni cerca. */
const MAX_ORDENES = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Las ordenes que salieron del carrito (DEC-026: una por vendedor).
 *
 * ⚠️ EXISTE PORQUE UN CHECKOUT DE CARRITO NO TERMINA EN UN PAGO, TERMINA EN
 * VARIOS. Redirigir al checkout de la primera orden esconderia las otras: la
 * persona pagaria una, volveria a la vitrina y se enteraria de las demas cuando
 * venciera la ventana de pago.
 *
 * ⚠️ LOS IDS VIENEN DE LA URL Y NO SE LES CREE NADA. Cada uno se lee con
 * `getMyOrder`, que filtra por `user.id`: una orden ajena devuelve `null` igual
 * que una inexistente, asi que pegar el id de otra persona no muestra nada. Sin
 * eso, esta pantalla seria un visor de ordenes ajenas con solo cambiar la URL.
 */
export default async function OrdenesCreadas({
  searchParams,
}: {
  searchParams: Promise<{ ordenes?: string; quedaron?: string }>;
}) {
  const { ordenes: crudas, quedaron } = await searchParams;

  const user = await requireVerifiedSessionUser('/carrito');

  const ids = (crudas ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => UUID.test(id))
    .slice(0, MAX_ORDENES);

  // Sin ids validos no hay nada que mostrar: la pantalla no tiene sentido suelta.
  if (ids.length === 0) redirect('/carrito');

  const encontradas = await Promise.all(ids.map((id) => getMyOrder(user, id)));
  const ordenes = encontradas.filter((orden) => orden !== null);

  const pendientes = Number.parseInt(quedaron ?? '0', 10) || 0;

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Migas items={[{ texto: 'Tu carrito', href: '/carrito' }, { texto: 'Órdenes creadas' }]} />

        <div className={`${estilos.cabecera} entra`}>
          <h1 className={estilos.titulo}>
            {ordenes.length === 1 ? 'Creamos tu orden' : 'Creamos tus órdenes'}
          </h1>
          <span
            className={`${estilos.reglaTitulo} ${estilos.reglaTituloAnimada}`}
            aria-hidden="true"
          />
          {/*
            ⚠️ SE DICE QUE TODAVIA NO SE PAGO NADA, Y ES LO MAS IMPORTANTE DE LA
            PANTALLA. "Creamos tu orden" con un tilde verde se lee como "listo,
            comprado": las ordenes nacen en pendiente de pago y vencen solas si
            nadie las paga (DEC-033).
          */}
          <p className={estilos.resumenCabecera}>
            Todavía no pagaste nada. Cada orden se paga por separado en Mercado Pago.
          </p>
        </div>

        {ordenes.length === 0 ? (
          <EstadoVacio titulo="No encontramos esas órdenes" icono={<IconoCarrito tamanio={40} />}>
            <p>Puede que el enlace esté incompleto. Buscalas en tus compras.</p>
            <BotonEnlace href="/cuenta/compras">Ver mis compras</BotonEnlace>
          </EstadoVacio>
        ) : (
          <>
            {pendientes > 0 && (
              /*
                ⚠️ LO QUE QUEDO EN EL CARRITO SE AVISA ACA. `checkoutCart` corta
                en la primera linea que otra persona se llevo en el medio: sin
                este aviso, la camiseta que no se pudo comprar desaparece de la
                vista y reaparece en el carrito sin explicacion.
              */
              <Aviso tono="error">
                {cantidadLegible(pendientes, 'publicación', 'publicaciones')} quedó en el carrito
                porque dejó de estar disponible mientras comprabas.{' '}
                <a href="/carrito">Ver el carrito</a>.
              </Aviso>
            )}

            <ul className={estilos.ordenes}>
              {ordenes.map((orden) => (
                <li key={orden.id} className={`${estilos.orden} sup-ficha con-grano`}>
                  <div className={estilos.ordenDatos}>
                    <p className={estilos.ordenNumero}>
                      <IconoTilde tamanio={16} />
                      <span>Orden {orden.orderNumber}</span>
                    </p>
                    <Etiqueta tono={tonoDeOrden(orden.status)}>
                      {estadoDeOrden(orden.status)}
                    </Etiqueta>
                  </div>

                  <p className={estilos.ordenTotal}>{precio(orden.totalAmount, orden.currency)}</p>

                  {/*
                    ⚠️ EL BOTON DICE LO QUE LA ORDEN PERMITE. Las ordenes recien
                    creadas nacen todas en `PENDING_PAYMENT`, pero esta URL es
                    compartible y sobrevive: entrar mañana con el mismo enlace,
                    con una orden ya pagada o cancelada, ofrecia "Pagar" sobre
                    algo que el checkout despues no deja pagar.
                  */}
                  <BotonEnlace
                    href={`/checkout/${orden.id}`}
                    tamanio="chico"
                    flecha
                    variante={orden.status === 'PENDING_PAYMENT' ? 'primario' : 'secundario'}
                  >
                    {orden.status === 'PENDING_PAYMENT' ? 'Pagar' : 'Ver la orden'}
                  </BotonEnlace>
                </li>
              ))}
            </ul>

            <p className={estilos.nota}>
              <IconoCarrito tamanio={16} />
              <span>
                Podés pagarlas de a una, cuando quieras, desde{' '}
                <a href="/cuenta/compras">Mis compras</a>. Cada orden tiene su propio plazo de pago.
              </span>
            </p>
          </>
        )}
      </main>
    </Pantalla>
  );
}
