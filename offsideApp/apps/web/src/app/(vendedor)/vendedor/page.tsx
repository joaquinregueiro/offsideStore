import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import {
  IconoAutenticado,
  IconoCamiseta,
  IconoEstrella,
  IconoEtiqueta,
  IconoIntercambio,
  IconoMedalla,
  IconoPausa,
  IconoPregunta,
  IconoRayo,
  IconoTienda,
} from '@/components/iconos';
import { FotoCompartida, Pantalla } from '@/components/movimiento';
import {
  Aviso,
  BotonEnlace,
  Cifras,
  Estrellas,
  FilaDeDatos,
  Pasos,
  Seccion,
} from '@/components/ui';
import {
  estadoDePublicacion,
  estadoDeVendedor,
  fecha,
  precio,
  tonoDeVendedor,
} from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import { PanelDeCuenta, SolapasDeCuenta } from '../../(cuenta)/panel';
import { getDispatchDeadlineHours } from '@/modules/config/services/setting-store.service';
import { countOpenForSeller } from '@/modules/disputes/services/dispute.service';
import {
  countMyListings,
  coverUrls,
  listMyListings,
} from '@/modules/listings/services/listing.service';
import { isDispatchOverdue } from '@/modules/orders/services/order-transitions';
import { countMySales, listMySales } from '@/modules/orders/services/order.service';
import { countPendingForSeller } from '@/modules/questions/services/question.service';
import { getSellerReputationForUser } from '@/modules/reputation/services/reputation.service';
import { getConnectionStatus } from '@/modules/sellers/services/mercadopago-connection.service';
import { getStatus } from '@/modules/sellers/services/seller-approval.service';
import { getMySellerProfile } from '@/modules/sellers/services/seller.service';
import { getVacation } from '@/modules/sellers/services/vacation.service';

import { Chapa } from '../chapa';
import estilos from '../vendedor.module.css';

export const metadata: Metadata = { title: 'Panel de vendedor' };
export const dynamic = 'force-dynamic';

/** Cuántas portadas entran en la tira sin convertirla en un catálogo. */
const TIRA = 6;

/** Órdenes que todavía están en curso: hay plata cobrada y algo que hacer. */
const EN_CURSO = ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'];

/**
 * Panel del vendedor.
 *
 * Es la pantalla que responde "¿por qué todavía no puedo vender?" el día 1 y
 * "¿qué tengo que hacer hoy?" el día 90. Las tres señales de TS-001 (DEC-044)
 * —email verificado + identidad fiscal declarada + Mercado Pago conectado—
 * aprueban la cuenta solas; después el centro pasa a ser el trabajo pendiente.
 *
 * ⚠️ SE USA `getStatus`, NO `evaluate`. `evaluate` aprueba y escribe una fila de
 * verificación; hacer eso cada vez que alguien refresca una pantalla llenaría
 * la tabla de ruido. La aprobación se dispara donde cambia una señal —al
 * declarar el CUIT y al conectar Mercado Pago—, que es donde importa.
 *
 * ⚠️ LAS CIFRAS SON TAREAS, NO VANIDAD. "Ventas del mes" es lo único que mira
 * hacia atrás; las otras cinco son cosas que esperan una acción: despachar,
 * responder, resolver. Un panel que sólo dice cuánto vendiste no sirve para
 * abrirlo todas las mañanas.
 */
export default async function PanelDeVendedor() {
  const user = await requireVerifiedSessionUser('/vendedor');

  const perfil = await getMySellerProfile(user.id);
  if (perfil === null) redirect('/vendedor/empezar');

  const [
    estado,
    conexion,
    publicaciones,
    ventas,
    propias,
    ordenes,
    preguntas,
    reclamos,
    reputacion,
    vacaciones,
    horasDeDespacho,
  ] = await Promise.all([
    getStatus(user),
    getConnectionStatus(user),
    countMyListings(user),
    countMySales(user),
    listMyListings(user),
    listMySales(user),
    countPendingForSeller(user),
    countOpenForSeller(user),
    getSellerReputationForUser(user.id),
    getVacation(user),
    getDispatchDeadlineHours(),
  ]);

  const { signals } = estado;
  const puedeVender = conexion.canSell;

  const ahora = new Date();

  /*
   * ⚠️ "DEL MES" ES DESDE EL 1 DEL MES EN CURSO Y SE CUENTA POR `paidAt`, no por
   * `createdAt`: una orden creada el 30 y pagada el 2 es plata de este mes. Se
   * suma con `BigInt` —los importes viajan como string de centavos justamente
   * para no perder precisión— y `precio()` recién convierte al final, para
   * dibujar.
   *
   * ⚠️ ES EL SNAPSHOT DE CADA ORDEN (DEC-030), no un recálculo con la comisión
   * de hoy: si mañana cambia la tasa, este número no se mueve.
   */
  const desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  const delMes = ordenes.filter(
    (orden) =>
      orden.status !== 'CANCELLED' && orden.paidAt !== null && new Date(orden.paidAt) >= desde,
  );
  const netoDelMes = delMes.reduce((suma, orden) => suma + BigInt(orden.sellerAmount), 0n);
  const moneda = ordenes[0]?.currency ?? 'ARS';

  const enCurso = ordenes.filter((orden) => EN_CURSO.includes(orden.status)).length;
  const aDespachar = ordenes.filter(
    (orden) => orden.status === 'PAID' || orden.status === 'PROCESSING',
  );

  /*
   * ⚠️ EL PLAZO SE RESUELVE UNA VEZ Y SE APLICA A TODAS. `getDispatchDeadline`
   * lee la configuración en cada llamada; usarla por orden serían N lecturas de
   * `app_settings` para pintar un número. `isDispatchOverdue` es la misma regla
   * (BR-032), pura, con las horas ya resueltas.
   */
  const vencidas = aDespachar.filter((orden) =>
    isDispatchOverdue(
      { status: orden.status, paidAt: orden.paidAt === null ? null : new Date(orden.paidAt) },
      horasDeDespacho,
      ahora,
    ),
  ).length;

  /*
   * Una publicación eliminada es terminal y no se muestra: la tira responde
   * "cómo se ve mi tienda", y algo que ya no existe no se ve en ningún lado.
   */
  const vitrina = propias.filter((item) => item.status !== 'deleted').slice(0, TIRA);
  const portadas = await coverUrls(vitrina.map((item) => item.id));

  return (
    <Pantalla>
      <PanelDeCuenta user={user} seccion="cuenta">
        <main id="contenido">
          <Chapa
            rotulo="Tu tienda"
            titulo={perfil.displayName}
            detalle={
              /*
              ⚠️ ES ANTIGÜEDAD, NO REPUTACION. "Vendés desde" es un hecho
              verificable y no contradice BR-003, que prohíbe presentar la
              conexión con Mercado Pago como un distintivo de confianza.
            */
              <p className={estilos.chapaDetalle}>
                Vendés en Offside desde {fecha(perfil.createdAt)}
              </p>
            }
            estado={{ texto: estadoDeVendedor(perfil.status), tono: tonoDeVendedor(perfil.status) }}
            accion={
              puedeVender ? (
                <BotonEnlace href="/vendedor/publicaciones/nueva" flecha>
                  Publicar
                </BotonEnlace>
              ) : undefined
            }
          />

          <SolapasDeCuenta user={user} seccion="cuenta" activa="vender" />

          {/*
          ⚠️ EL MODO VACACIONES SE AVISA ARRIBA DE TODO. Es la única condición
          que apaga la tienda entera sin que nada esté roto: sin este aviso, el
          vendedor ve cero visitas y cero ventas y no tiene forma de saber por
          qué. Se dice que vuelven solas para que no toque nada.
        */}
          {vacaciones.onVacation && (
            <Aviso tono="neutro">
              <strong>Estás en modo vacaciones.</strong> Tus publicaciones no se muestran
              {vacaciones.vacationUntil === null
                ? ''
                : ` hasta el ${fecha(vacaciones.vacationUntil)}`}
              . <strong>Vuelven solas</strong>: no hace falta republicar nada.{' '}
              <Link href="/vendedor/vacaciones">Cambiar</Link>
            </Aviso>
          )}

          {/*
          ⚠️ MERCADO PAGO DESCONECTADO NO ES UN DETALLE DE CONFIGURACION: apaga
          la vitrina (SS-013). El vendedor tiene que enterarse acá y no cuando
          deje de vender sin explicación.
        */}
          {!puedeVender && perfil.status === 'approved' && (
            <Aviso tono="error">
              <strong>Tus publicaciones no se están mostrando.</strong> Mientras Mercado Pago no
              esté conectado nadie puede verlas ni comprarlas, porque no podríamos cobrarte la
              venta. <strong>Vuelven solas al reconectar.</strong>{' '}
              <Link href="/vendedor/mercadopago">Reconectar</Link>
            </Aviso>
          )}

          {vencidas > 0 && (
            <Aviso tono="error">
              {vencidas === 1
                ? 'Hay 1 venta con el plazo de despacho vencido.'
                : `Hay ${vencidas} ventas con el plazo de despacho vencido.`}{' '}
              Despachar fuera de plazo cuenta en tu reputación.{' '}
              <Link href="/vendedor/ventas?estado=a-despachar">Ver cuáles</Link>
            </Aviso>
          )}

          {puedeVender ? (
            <>
              {/*
              ⚠️ LOS NUMEROS VAN SOBRE UN PLANO OSCURO. Cuatro recuadros blancos
              sobre papel hacían que los números —que son el contenido— pesaran lo
              mismo que un borde; el pliego de noche es lo que le da ritmo
              vertical al scroll.

              ⚠️ EL IMPORTE ENTRA UNA VEZ Y QUEDA QUIETO. Nada de contar hacia
              arriba: es plata real, y un número que sube mientras alguien lo lee
              se interpreta como un número que todavía se está calculando.
            */}
              <div className={`${estilos.tablero} sup-noche con-grano`}>
                <Cifras
                  cifras={[
                    {
                      valor: precio(netoDelMes.toString(), moneda),
                      etiqueta: 'Ventas de este mes',
                      detalle: 'antes del costo de Mercado Pago',
                    },
                    {
                      valor: String(enCurso),
                      etiqueta: 'En curso',
                      detalle: enCurso === 0 ? undefined : 'cobradas y sin cerrar',
                    },
                    {
                      valor: String(aDespachar.length),
                      etiqueta: 'A despachar',
                      detalle:
                        vencidas > 0
                          ? vencidas === 1
                            ? '1 con el plazo vencido'
                            : `${vencidas} con el plazo vencido`
                          : undefined,
                    },
                    {
                      valor: String(preguntas),
                      etiqueta: 'Preguntas sin responder',
                    },
                    {
                      valor: String(reclamos),
                      etiqueta: 'Reclamos abiertos',
                    },
                    {
                      valor:
                        reputacion?.ratingAvg == null
                          ? '—'
                          : new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(
                              reputacion.ratingAvg,
                            ),
                      etiqueta: 'Calificación',
                      detalle:
                        reputacion === null || reputacion.ratingCount === 0
                          ? 'todavía sin reseñas'
                          : `${reputacion.ratingCount === 1 ? '1 reseña' : `${reputacion.ratingCount} reseñas`}`,
                    },
                  ]}
                />
              </div>

              {/*
              ⚠️ LAS ESTRELLAS VAN APARTE Y NO ADENTRO DEL TABLERO. El número de
              la cifra es el dato; las estrellas son el dibujo, y adentro del
              pliego oscuro competirían con seis números que ya piden atención.
            */}
              {reputacion !== null && (
                <div className={estilos.franjaReputacion}>
                  <Estrellas
                    promedio={reputacion.ratingAvg}
                    cantidad={reputacion.ratingCount}
                    tamanio="grande"
                  />
                  <BotonEnlace href="/vendedor/reputacion" variante="fantasma" tamanio="chico">
                    Ver tu reputación
                  </BotonEnlace>
                </div>
              )}

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
                          <BotonEnlace
                            href="/verificar-email"
                            variante="secundario"
                            tamanio="chico"
                          >
                            Verificar email
                          </BotonEnlace>
                        ),
                      },
                      {
                        titulo: 'Identidad fiscal',
                        detalle:
                          'Tu CUIT, CUIL o CDI. Se valida el formato y el dígito verificador.',
                        hecho: signals.fiscalIdentityDeclared,
                        accion: (
                          <BotonEnlace
                            href="/vendedor/fiscal"
                            variante="secundario"
                            tamanio="chico"
                          >
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
                      son la misma.
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
                href="/vendedor/preguntas"
                icono={<IconoPregunta tamanio={22} />}
                titulo="Preguntas"
                detalle={
                  preguntas === 0
                    ? 'No tenés preguntas sin responder.'
                    : `${preguntas === 1 ? '1 pregunta espera' : `${preguntas} preguntas esperan`} respuesta.`
                }
              />
              <Acceso
                href="/vendedor/reputacion"
                icono={<IconoEstrella tamanio={22} />}
                titulo="Reputación"
                detalle={
                  reputacion === null || reputacion.ratingCount === 0
                    ? 'Todavía no te calificaron.'
                    : `${reputacion.ratingCount === 1 ? '1 reseña' : `${reputacion.ratingCount} reseñas`} recibidas.`
                }
              />
              <Acceso
                href="/vendedor/nivel"
                icono={<IconoMedalla tamanio={22} />}
                titulo="Nivel"
                detalle="Tu comisión depende de tus ventas completadas."
              />
              <Acceso
                href="/vendedor/promociones"
                icono={<IconoRayo tamanio={22} />}
                titulo="Promociones"
                detalle="Figurar primero, con la comisión agravada."
              />
              <Acceso
                href="/vendedor/metricas"
                icono={<IconoEtiqueta tamanio={22} />}
                titulo="Métricas"
                detalle="Ventas por mes, ticket promedio y qué se vende."
              />
              <Acceso
                href="/vendedor/tienda"
                icono={<IconoTienda tamanio={22} />}
                titulo="Tienda"
                detalle="Tu nombre visible y cómo te presentás."
              />
              <Acceso
                href="/vendedor/vacaciones"
                icono={<IconoPausa tamanio={22} />}
                titulo="Vacaciones"
                detalle={
                  vacaciones.onVacation
                    ? 'Activado: no estás vendiendo.'
                    : 'Apagá la tienda un rato.'
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
              desaparecía en cuanto el vendedor cargaba su CUIT.
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
          vendedor lo lea como un sello de calidad.
        */}
          <div className={`${estilos.cierre} sup-2 patron-vivo diagonales-vivas`}>
            <p className={estilos.nota}>
              Estar habilitado significa que podés operar. No es un distintivo de confianza: la
              reputación se construye vendiendo.
            </p>
          </div>
        </main>
      </PanelDeCuenta>
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
  );
}
