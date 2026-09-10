import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

<<<<<<< HEAD
import {
  IconoAutenticado,
  IconoCamiseta,
  IconoEtiqueta,
  IconoIntercambio,
} from '@/components/iconos';
import { FotoCompartida, Pantalla } from '@/components/movimiento';
import { Aviso, BotonEnlace, Cifras, FilaDeDatos, Pasos, Seccion } from '@/components/ui';
import { estadoDePublicacion, estadoDeVendedor, fecha, tonoDeVendedor } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import {
  countMyListings,
  coverUrls,
  listMyListings,
} from '@/modules/listings/services/listing.service';
import { countMySales } from '@/modules/orders/services/order.service';
import { getConnectionStatus } from '@/modules/sellers/services/mercadopago-connection.service';
import { getStatus } from '@/modules/sellers/services/seller-approval.service';
import { getMySellerProfile } from '@/modules/sellers/services/seller.service';

import { Chapa } from '../chapa';
import { NavDelVendedor } from '../nav';
import estilos from '../vendedor.module.css';

export const metadata: Metadata = { title: 'Panel de vendedor' };
export const dynamic = 'force-dynamic';

/** Cuántas portadas entran en la tira sin convertirla en un catálogo. */
const TIRA = 6;
=======
import { Aviso, BotonEnlace, Etiqueta } from '@/components/ui';
import { estadoDeVendedor } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import { getStatus } from '@/modules/sellers/services/seller-approval.service';
import { getConnectionStatus } from '@/modules/sellers/services/mercadopago-connection.service';
import { getMySellerProfile } from '@/modules/sellers/services/seller.service';

import estilos from '../vendedor.module.css';

export const metadata: Metadata = { title: 'Panel de vendedor — Offside Store' };
export const dynamic = 'force-dynamic';

/**
 * Un paso del alta.
 *
 * ⚠️ EL ESTADO SE COMUNICA CON TEXTO Y CON UN SIMBOLO, no solo con color. Quien
 * no distingue verde de gris tiene que poder saber igual que le falta.
 */
function Paso({
  hecho,
  titulo,
  detalle,
  children,
}: {
  hecho: boolean;
  titulo: string;
  detalle: string;
  children?: ReactNode;
}) {
  return (
    <li className={estilos.paso}>
      <span
        className={`${estilos.marca} ${hecho ? estilos.marcaHecha : estilos.marcaPendiente}`}
        aria-hidden="true"
      >
        {hecho ? '✓' : '○'}
      </span>
      <div className={estilos.pasoCuerpo}>
        <p className={estilos.pasoTitulo}>
          {titulo} — {hecho ? 'listo' : 'pendiente'}
        </p>
        <p className={estilos.pasoDetalle}>{detalle}</p>
        {!hecho && children}
      </div>
    </li>
  );
}

function Acceso({
  href,
  titulo,
  detalle,
}: {
  href: string;
  titulo: string;
  detalle: string;
}): ReactNode {
  return (
    <Link href={href} className={estilos.acceso}>
      <span className={estilos.accesoTitulo}>{titulo}</span>
      <span className={estilos.accesoDetalle}>{detalle}</span>
    </Link>
  );
}
>>>>>>> origin/main

/**
 * Panel del vendedor.
 *
<<<<<<< HEAD
 * Es la pantalla que responde "¿por qué todavía no puedo vender?". La respuesta
 * son las tres señales de TS-001 (DEC-044): email verificado + identidad fiscal
 * declarada + Mercado Pago conectado. Con las tres, la aprobación es automática.
 *
 * ⚠️ SE USA `getStatus`, NO `evaluate`. `evaluate` aprueba y escribe una fila de
 * verificación; hacer eso cada vez que alguien refresca una pantalla llenaría
 * la tabla de ruido. La aprobación se dispara donde cambia una señal —al
 * declarar el CUIT y al conectar Mercado Pago—, que es donde importa.
 *
 * ⚠️ LA PANTALLA CAMBIA SEGUN EL DIA. El día 1 el checklist es lo único que
 * importa y ocupa el centro; el día 90 ya está resuelto y lo que importa son
 * los números.
 *
 * ⚠️ LA TIRA DE PORTADAS NO PIDE NINGUN DATO NUEVO: `listMyListings` y
 * `coverUrls` son las mismas funciones que ya usa `/vendedor/publicaciones`. Está
 * acá porque nueve pantallas de una tienda de ropa no tenían una sola camiseta, y
 * "¿cómo se ve lo mío?" es la pregunta con la que alguien entra al panel.
=======
 * Es la pantalla que responde "¿por que todavia no puedo vender?". La respuesta
 * son las tres señales de TS-001 (DEC-044): email verificado + identidad fiscal
 * declarada + Mercado Pago conectado. Con las tres, la aprobacion es automatica.
 *
 * ⚠️ SE USA `getStatus`, NO `evaluate`. `evaluate` aprueba y escribe una fila de
 * verificacion; hacer eso cada vez que alguien refresca una pantalla llenaria
 * la tabla de ruido. La aprobacion se dispara donde cambia una señal —al
 * declarar el CUIT y al conectar Mercado Pago—, que es donde importa.
>>>>>>> origin/main
 */
export default async function PanelDeVendedor() {
  const user = await requireVerifiedSessionUser('/vendedor');

  const perfil = await getMySellerProfile(user.id);
  if (perfil === null) redirect('/vendedor/empezar');

<<<<<<< HEAD
  const [estado, conexion, publicaciones, ventas, propias] = await Promise.all([
    getStatus(user),
    getConnectionStatus(user),
    countMyListings(user),
    countMySales(user),
    listMyListings(user),
  ]);
=======
  const [estado, conexion] = await Promise.all([getStatus(user), getConnectionStatus(user)]);
>>>>>>> origin/main

  const { signals } = estado;
  const puedeVender = conexion.canSell;

<<<<<<< HEAD
  /*
   * Una publicación eliminada es terminal y no se muestra: la tira responde
   * "cómo se ve mi tienda", y algo que ya no existe no se ve en ningún lado.
   */
  const vitrina = propias.filter((item) => item.status !== 'deleted').slice(0, TIRA);
  const portadas = await coverUrls(vitrina.map((item) => item.id));

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Chapa
          rotulo="Tu tienda"
          titulo={perfil.displayName}
          detalle={
            /*
              ⚠️ ES ANTIGÜEDAD, NO REPUTACION. "Vendés desde" es un hecho
              verificable y no contradice BR-003, que prohíbe presentar la
              conexión con Mercado Pago como un distintivo de confianza. La
              reputación no existe todavía y esto no la simula.
            */
            <p className={estilos.chapaDetalle}>
              Vendés en Offside desde {fecha(perfil.createdAt)}
            </p>
          }
          estado={{ texto: estadoDeVendedor(perfil.status), tono: tonoDeVendedor(perfil.status) }}
          accion={
            /*
              ⚠️ LA ACCION PRINCIPAL SUBE A LA CHAPA. Publicar era un botón que
              sólo existía en /vendedor/publicaciones: quien entraba al panel para
              publicar tenía que pasar por una pantalla intermedia. Sobre la chapa
              el primario es Amarillo Cambio con texto Tinta (13.97:1), porque
              `.sup-cancha` remapea los ocho tokens de botón.
            */
            puedeVender ? (
              <BotonEnlace href="/vendedor/publicaciones/nueva" flecha>
                Publicar
              </BotonEnlace>
            ) : undefined
          }
        />

        <NavDelVendedor activo="panel" publicaciones={publicaciones.total} ventas={ventas.total} />

        {puedeVender ? (
          <>
            {/*
              ⚠️ CON LA CUENTA HABILITADA, LOS NUMEROS VAN PRIMERO Y VAN SOBRE UN
              PLANO OSCURO. Cuatro recuadros blancos sobre papel hacían que los
              números —que son el contenido— pesaran lo mismo que un borde; el
              pliego de noche es lo que le da ritmo vertical al scroll. El
              checklist pasa a estar plegado: ya cumplió su función.
            */}
            <div className={`${estilos.tablero} sup-noche con-grano`}>
              <Cifras
                cifras={[
                  {
                    valor: String(publicaciones.activas),
                    etiqueta: 'A la venta',
                    detalle:
                      publicaciones.borradores > 0
                        ? `${publicaciones.borradores} en borrador`
                        : undefined,
                  },
                  {
                    valor: String(ventas.cobradas),
                    etiqueta: 'Ventas cobradas',
                    detalle:
                      ventas.esperandoPago > 0
                        ? `${ventas.esperandoPago} esperando pago`
                        : undefined,
                  },
                  { valor: String(publicaciones.pausadas), etiqueta: 'Pausadas' },
                  { valor: String(publicaciones.agotadas), etiqueta: 'Agotadas' },
                ]}
              />
            </div>

            {/*
              ⚠️ `desplegable` ANIMA LA ALTURA SIN UNA LINEA DE JAVASCRIPT (via
              `::details-content` + `interpolate-size`). Sin soporte del navegador
              abre de golpe: exactamente lo que hace hoy.
            */}
            <details className={`${estilos.habilitacion} desplegable`}>
              <summary className={estilos.habilitacionTitulo}>
                Tu cuenta está habilitada
                {estado.approvedAt !== null && ` desde el ${fecha(estado.approvedAt)}`}
              </summary>
              <div className={estilos.habilitacionPanel}>
                <FilaDeDatos concepto="Email verificado">Sí</FilaDeDatos>
                <FilaDeDatos concepto="Identidad fiscal">Declarada</FilaDeDatos>
                <FilaDeDatos concepto="Mercado Pago">Conectado</FilaDeDatos>
              </div>
            </details>
          </>
        ) : (
          <>
            <Aviso tono="error">
              Todavía no podés vender. Completá los pasos que quedan y la habilitación es
              automática: no hay nadie revisando del otro lado.
            </Aviso>

            <Seccion titulo="Habilitación">
              <div className={estilos.checklist}>
                <Pasos
                  etiqueta="Habilitación"
                  pasos={[
                    {
                      titulo: 'Email verificado',
                      detalle: 'Es el requisito para operar en Offside, no sólo para vender.',
                      hecho: signals.emailVerified,
                      accion: (
                        <BotonEnlace href="/verificar-email" variante="secundario" tamanio="chico">
                          Verificar email
                        </BotonEnlace>
                      ),
                    },
                    {
                      titulo: 'Identidad fiscal',
                      detalle: 'Tu CUIT, CUIL o CDI. Se valida el formato y el dígito verificador.',
                      hecho: signals.fiscalIdentityDeclared,
                      accion: (
                        <BotonEnlace href="/vendedor/fiscal" variante="secundario" tamanio="chico">
                          Cargar identificación
                        </BotonEnlace>
                      ),
                    },
                    {
                      titulo: 'Mercado Pago conectado',
                      detalle:
                        'Cobrás en tu propia cuenta. Offside sólo retiene su comisión del pago.',
                      hecho: signals.mercadoPagoConnected,
                      accion: (
                        <BotonEnlace
                          href="/vendedor/mercadopago"
                          variante="secundario"
                          tamanio="chico"
                        >
                          Conectar Mercado Pago
                        </BotonEnlace>
                      ),
                    },
                  ]}
                />
              </div>
            </Seccion>
          </>
        )}

        {vitrina.length > 0 && (
          <Seccion
            titulo="Cómo se ve tu tienda"
            /*
              ⚠️ EL DATO SE PASA POR SPREAD Y NO CON UN TERNARIO A `undefined`.
              Con `exactOptionalPropertyTypes` una prop opcional NO acepta que le
              pasen `undefined` a propósito, y un `''` haría que el componente
              dibuje un párrafo vacío.
            */
            {...(publicaciones.total > TIRA
              ? { dato: `Las ${TIRA} más recientes de ${publicaciones.total}` }
              : {})}
            accion={
              <BotonEnlace href="/vendedor/publicaciones" variante="fantasma" tamanio="chico">
                Ver todas
              </BotonEnlace>
            }
          >
            {/*
              ⚠️ `enfoca-hermanos` SOLO APAGA LAS FOTOS, NUNCA EL TEXTO. Bajarle
              la opacidad a la tarjeta entera arruinaría el contraste del estado
              que va escrito encima. Y vive detrás de `(hover: hover) and
              (pointer: fine)`: en un teléfono el `:hover` queda pegado después de
              un toque y la tira se quedaría con cinco fotos apagadas.
            */}
            <ul className={`${estilos.tira} revela-grilla enfoca-hermanos`}>
              {vitrina.map((item) => {
                const portada = portadas.get(item.id);

                return (
                  <li key={item.id}>
                    {/*
                      ⚠️ LA FOTO VIAJA A LA FICHA. Es la misma prenda: sin el
                      morph, una foto desaparece y otra aparece, y nada dice que
                      son la misma. El nombre lleva el id, que es único en la
                      página y el mismo que usa `/p/[id]`.
                    */}
                    <FotoCompartida id={item.id}>
                      <Link href={`/p/${item.id}`} className={estilos.tiraItem}>
                        {portada === undefined ? (
                          <span className={estilos.tiraPatron} data-foto />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            className={estilos.tiraFoto}
                            src={portada}
                            alt={item.title}
                            width={104}
                            height={130}
                            loading="lazy"
                            decoding="async"
                          />
                        )}
                        <span className={estilos.tiraEstado}>
                          {estadoDePublicacion(item.status)}
                        </span>
                      </Link>
                    </FotoCompartida>
                  </li>
                );
              })}
            </ul>
          </Seccion>
        )}

        <Seccion titulo="Tu tienda">
          <div className={estilos.accesos}>
            <Acceso
              href="/vendedor/publicaciones"
              icono={<IconoCamiseta tamanio={22} />}
              titulo="Publicaciones"
              detalle={
                publicaciones.total === 0
                  ? 'Todavía no publicaste nada.'
                  : `${publicaciones.activas} a la venta de ${publicaciones.total}.`
              }
            />
            <Acceso
              href="/vendedor/ventas"
              icono={<IconoIntercambio tamanio={22} />}
              titulo="Ventas"
              detalle={
                ventas.total === 0
                  ? 'Cuando te compren, aparece acá.'
                  : `${ventas.cobradas} cobradas de ${ventas.total}.`
              }
            />
            <Acceso
              href="/vendedor/mercadopago"
              icono={<IconoAutenticado tamanio={22} />}
              titulo="Mercado Pago"
              detalle={estadoDeConexion(conexion.status)}
            />
            {/*
              ⚠️ SIN ESTA TARJETA, `/vendedor/fiscal` QUEDA HUÉRFANA. El único
              enlace vivía dentro del paso pendiente del checklist, así que
              desaparecía en cuanto el vendedor cargaba su CUIT. Quien lo cargó
              mal sólo podía llegar escribiendo la URL a mano.
            */}
            <Acceso
              href="/vendedor/fiscal"
              icono={<IconoEtiqueta tamanio={22} />}
              titulo="Identidad fiscal"
              detalle={
                signals.fiscalIdentityDeclared
                  ? 'Declarada. Podés reemplazarla.'
                  : 'Falta declarar tu CUIT, CUIL o CDI.'
              }
            />
          </div>
        </Seccion>

        {/*
          ⚠️ Conectar Mercado Pago NO da confianza ni reputacion (BR-003 /
          SS-012). Es un requisito para poder cobrar, y decirlo evita que el
          vendedor lo lea como un sello de calidad. Estaba escondido adentro del
          desplegable de habilitación —o sea, invisible para quien no lo abre— y
          en gris de 13px.
        */}
        <div className={`${estilos.cierre} sup-2 patron-vivo diagonales-vivas`}>
          <p className={estilos.nota}>
            Estar habilitado significa que podés operar. No es un distintivo de confianza: la
            reputación se construye vendiendo.
          </p>
        </div>
      </main>
    </Pantalla>
  );
}

/** Estado de la conexión en una línea, para la tarjeta de acceso. */
function estadoDeConexion(status: string | null): string {
  if (status === 'connected') return 'Cuenta conectada.';
  if (status === 'expired') return 'La conexión venció: reconectá para seguir vendiendo.';
  if (status === 'revoked') return 'Revocaste el permiso desde Mercado Pago.';
  if (status === 'disconnected') return 'Desvinculada. Podés volver a conectarla.';

  return 'Sin conectar.';
}

/**
 * ⚠️ ES UN `Link`, NO UN `<a>` PELADO. Un ancla común tira abajo el documento y
 * lo vuelve a construir en cada clic; `Link` renderiza igual un `<a href>`, así
 * que sin JavaScript navega como siempre. `avanza` es la dirección: se entra a
 * algo, la pantalla nueva llega desde la derecha.
 */
function Acceso({
  href,
  icono,
  titulo,
  detalle,
}: {
  href: string;
  icono: ReactNode;
  titulo: string;
  detalle: string;
}) {
  return (
    <Link href={href} className={`${estilos.acceso} destello`} transitionTypes={['avanza']}>
      <span className={estilos.accesoIcono} aria-hidden="true">
        {icono}
      </span>
      <span className={estilos.accesoTitulo}>{titulo}</span>
      <span className={estilos.accesoDetalle}>{detalle}</span>
    </Link>
=======
  return (
    <main className={estilos.pagina}>
      <div className={estilos.encabezado}>
        <h1 className={estilos.titulo}>{perfil.displayName}</h1>
        <Etiqueta aviso={perfil.status !== 'approved'}>{estadoDeVendedor(perfil.status)}</Etiqueta>
      </div>

      {puedeVender ? (
        <Aviso>Tu cuenta está habilitada. Podés publicar y cobrar.</Aviso>
      ) : (
        <Aviso error>
          Todavía no podés vender. Completá los pasos que quedan y la habilitación es automática.
        </Aviso>
      )}

      <h2 className={estilos.subtitulo}>Habilitación</h2>

      <ul className={estilos.tarjeta}>
        <Paso
          hecho={signals.emailVerified}
          titulo="Email verificado"
          detalle="Es el requisito para operar en Offside, no sólo para vender."
        >
          <BotonEnlace href="/verificar-email" variante="secundario">
            Verificar email
          </BotonEnlace>
        </Paso>

        <Paso
          hecho={signals.fiscalIdentityDeclared}
          titulo="Identidad fiscal"
          detalle="Tu CUIT, CUIL o CDI. Se valida el formato y el dígito verificador."
        >
          <BotonEnlace href="/vendedor/fiscal" variante="secundario">
            Cargar identificación
          </BotonEnlace>
        </Paso>

        <Paso
          hecho={signals.mercadoPagoConnected}
          titulo="Mercado Pago conectado"
          detalle="Cobrás en tu propia cuenta. Offside sólo retiene su comisión del pago."
        >
          <BotonEnlace href="/vendedor/mercadopago" variante="secundario">
            Conectar Mercado Pago
          </BotonEnlace>
        </Paso>
      </ul>

      {/*
        ⚠️ Conectar Mercado Pago NO da confianza ni reputacion (BR-003 / SS-012).
        Es un requisito para poder cobrar, y decirlo evita que el vendedor lo
        lea como un sello de calidad.
      */}
      <p className={estilos.nota}>
        Estar habilitado significa que podés operar. No es un distintivo de confianza: la reputación
        se construye vendiendo.
      </p>

      <h2 className={estilos.subtitulo}>Tu tienda</h2>

      <div className={estilos.accesos}>
        <Acceso
          href="/vendedor/publicaciones"
          titulo="Publicaciones"
          detalle="Lo que tenés a la venta, con su stock."
        />
        <Acceso
          href="/vendedor/ventas"
          titulo="Ventas"
          detalle="Órdenes recibidas, comisión y neto."
        />
        <Acceso
          href="/vendedor/mercadopago"
          titulo="Mercado Pago"
          detalle={conexion.status === 'connected' ? 'Cuenta conectada.' : 'Sin conectar.'}
        />
      </div>
    </main>
>>>>>>> origin/main
  );
}
