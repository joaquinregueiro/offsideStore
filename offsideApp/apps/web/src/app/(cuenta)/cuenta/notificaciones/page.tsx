import type { Metadata } from 'next';
import Link from 'next/link';

import { CampoOculto, Formulario } from '@/components/form';
import { IconoCampana } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import { BotonEnlace, EstadoVacio, Paginacion, Seccion } from '@/components/ui';
import { cantidad, fechaRelativa, rutaInternaSegura } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import { listNotifications } from '@/modules/notifications/services/inapp-notification.service';

import { marcarLeida, marcarTodasLeidas } from '../../acciones';
import { ChapaDeCuenta } from '../../chapa';
import { NavDeCuenta } from '../../nav';
import estilos from '../../cuenta.module.css';

export const metadata: Metadata = { title: 'Mis avisos' };
export const dynamic = 'force-dynamic';

/** Página válida: entero ≥ 1. Cualquier otra cosa es la primera. */
function paginaDeLaUrl(valor: string | string[] | undefined): number {
  if (typeof valor !== 'string') return 1;

  const numero = Number.parseInt(valor, 10);

  return Number.isInteger(numero) && numero >= 1 ? numero : 1;
}

/**
 * A dónde lleva un aviso, si lleva a algún lado.
 *
 * ⚠️ EL `payload` ES `jsonb` LIBRE Y LO ESCRIBIÓ OTRO MÓDULO, así que acá se lo
 * trata como dato desconocido: se comprueba la forma antes de usar cualquier
 * campo. Una notificación con un payload raro tiene que renderizar igual, sin
 * enlace, y no romper la bandeja entera.
 *
 * ⚠️ EL DESTINO PASA POR `rutaInternaSegura`. Hoy las rutas se arman acá con ids
 * validados, pero el día que un módulo guarde una URL en el payload, un
 * `https://sitio-falso` en un aviso que Offside muestra como propio sería
 * phishing con nuestro dominio de por medio.
 */
function destinoDe(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;

  const datos = payload as Record<string, unknown>;

  if (typeof datos.orderId === 'string') {
    return rutaInternaSegura(`/cuenta/compras/${datos.orderId}`, '');
  }
  if (typeof datos.disputeId === 'string') {
    return rutaInternaSegura(`/cuenta/reclamos/${datos.disputeId}`, '');
  }
  if (typeof datos.listingId === 'string') {
    return rutaInternaSegura(`/p/${datos.listingId}`, '');
  }

  return null;
}

/**
 * LA BANDEJA DE AVISOS (la campanita de la barra superior).
 *
 * ⚠️ "MARCAR LEÍDA" ES UN `<form>` POR POST, NO UN ENLACE. Muta, y un GET que
 * muta lo dispara solo cualquier prefetch del navegador: la bandeja se marcaría
 * entera con sólo pasar el mouse por encima.
 *
 * ⚠️ ENTRAR A LA BANDEJA NO MARCA NADA COMO LEÍDO. Es la tentación obvia y está
 * mal: alguien que abre la campanita para mirar de reojo perdería la marca de lo
 * que todavía no atendió. Se marca de a uno o todas juntas, siempre a pedido.
 *
 * ⚠️ EL FILTRO "SIN LEER" VIAJA EN LA URL, como todo filtro del sitio: se
 * comparte, vuelve con el botón atrás y anda sin JavaScript.
 */
export default async function MisAvisos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireVerifiedSessionUser('/cuenta/notificaciones');
  const params = await searchParams;

  const soloNoLeidas = params.filtro === 'sin-leer';
  const pagina = await listNotifications(user, {
    soloNoLeidas,
    pagina: paginaDeLaUrl(params.pagina),
  });

  const totalPaginas = Math.max(1, Math.ceil(pagina.total / pagina.porPagina));
  const sinLeerEnLaPagina = pagina.notificaciones.filter((aviso) => !aviso.leida).length;
  const ahora = new Date();

  const hrefDe = (numero: number): string =>
    soloNoLeidas
      ? `/cuenta/notificaciones?filtro=sin-leer&pagina=${numero}`
      : `/cuenta/notificaciones?pagina=${numero}`;

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <ChapaDeCuenta
          rotulo="Mi cuenta"
          titulo="Avisos"
          detalle={
            <p className={estilos.chapaDetalle}>
              {pagina.total === 0
                ? 'No tenés avisos'
                : soloNoLeidas
                  ? cantidad(pagina.total, 'sin leer', 'sin leer')
                  : cantidad(pagina.total, 'aviso')}
            </p>
          }
        />

        <NavDeCuenta activo="notificaciones" />

        <nav className={estilos.filtros} aria-label="Filtrar avisos">
          <Link
            href="/cuenta/notificaciones"
            className={soloNoLeidas ? estilos.filtro : `${estilos.filtro} ${estilos.filtroActivo}`}
            aria-current={soloNoLeidas ? undefined : 'page'}
          >
            Todos
          </Link>
          <Link
            href="/cuenta/notificaciones?filtro=sin-leer"
            className={soloNoLeidas ? `${estilos.filtro} ${estilos.filtroActivo}` : estilos.filtro}
            aria-current={soloNoLeidas ? 'page' : undefined}
          >
            Sin leer
          </Link>
        </nav>

        {pagina.notificaciones.length === 0 ? (
          <EstadoVacio
            titulo={soloNoLeidas ? 'Estás al día' : 'Todavía no hay avisos'}
            icono={<IconoCampana tamanio={40} />}
          >
            <p>
              Acá te avisamos cuando pasa algo con una compra, con un reclamo o con algo que
              guardaste.
            </p>
            {soloNoLeidas && (
              <BotonEnlace href="/cuenta/notificaciones" variante="secundario">
                Ver todos
              </BotonEnlace>
            )}
          </EstadoVacio>
        ) : (
          <Seccion
            titulo={soloNoLeidas ? 'Sin leer' : 'Todos'}
            dato={cantidad(pagina.total, 'aviso')}
            accion={
              sinLeerEnLaPagina > 0 ? (
                <Formulario
                  accion={marcarTodasLeidas}
                  enviar="Marcar todas como leídas"
                  variante="secundario"
                  tamanio="chico"
                  bloque={false}
                />
              ) : undefined
            }
          >
            <ul className={`${estilos.lista} ${estilos.revela}`}>
              {pagina.notificaciones.map((aviso) => {
                const destino = destinoDe(aviso.payload);

                return (
                  <li
                    key={aviso.id}
                    className={
                      aviso.leida
                        ? `${estilos.notificacion} sup-ficha`
                        : `${estilos.notificacion} ${estilos.noLeida} sup-ficha`
                    }
                  >
                    {/*
                      ⚠️ EL PUNTO ES DECORATIVO Y EL ESTADO SE DICE CON TEXTO. Un
                      color distinto no lo distingue nadie con un lector de
                      pantalla, y un punto verde tampoco se ve en un teléfono al
                      sol.
                    */}
                    <span className={estilos.notificacionMarca} aria-hidden="true" />

                    <div>
                      <p className={estilos.notificacionTitulo}>
                        {aviso.title}
                        {!aviso.leida && <span className="solo-lectores"> (sin leer)</span>}
                      </p>

                      {aviso.body !== null && (
                        <p className={estilos.notificacionTexto}>{aviso.body}</p>
                      )}

                      <div className={estilos.notificacionPie}>
                        <span className={estilos.notificacionFecha}>
                          {fechaRelativa(aviso.createdAt, ahora)}
                        </span>

                        {destino !== null && destino !== '' && (
                          <Link href={destino} transitionTypes={['avanza']}>
                            Ver
                          </Link>
                        )}

                        {!aviso.leida && (
                          <Formulario
                            accion={marcarLeida}
                            enviar="Marcar leída"
                            variante="fantasma"
                            tamanio="chico"
                            bloque={false}
                          >
                            <CampoOculto nombre="notificationId" valor={aviso.id} />
                          </Formulario>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            <Paginacion actual={pagina.pagina} total={totalPaginas} hrefDe={hrefDe} />
          </Seccion>
        )}
      </main>
    </Pantalla>
  );
}
