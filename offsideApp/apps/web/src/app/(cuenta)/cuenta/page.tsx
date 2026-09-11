import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import {
  IconoCamiseta,
  IconoCampana,
  IconoBandera,
  IconoFavorito,
  IconoPregunta,
  IconoUbicacion,
} from '@/components/iconos';
import { Blobs, Pantalla } from '@/components/movimiento';
import { Cifras, InsigniaDeNivel, Seccion } from '@/components/ui';
import { cantidad, nivelDeUsuario } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import { listMyDisputes } from '@/modules/disputes/services/dispute.service';
import { listFavorites } from '@/modules/favorites/services/favorite.service';
import { countUnread } from '@/modules/notifications/services/inapp-notification.service';
import { listMyOrders } from '@/modules/orders/services/order.service';

import { ChapaDeCuenta } from '../chapa';
import { PanelDeCuenta, SolapasDeCuenta } from '../panel';
import estilos from '../cuenta.module.css';

export const metadata: Metadata = { title: 'Mi cuenta' };
export const dynamic = 'force-dynamic';

/**
 * Estados que NO cuentan como "compra en curso".
 *
 * ⚠️ SE DECLARA LO QUE TERMINÓ Y NO LO QUE SIGUE ABIERTO. Al revés, el día que
 * DEC-029 sume un estado intermedio la cifra dejaría de contarlo en silencio y
 * nadie se enteraría; así, un estado nuevo entra solo.
 */
const TERMINADAS = ['COMPLETED', 'CANCELLED'];

/**
 * RESUMEN DE LA CUENTA — la pantalla que responde "¿qué tengo en curso?".
 *
 * ⚠️ LOS CUATRO NÚMEROS SON ACCIONABLES, no un tablero decorativo: compras en
 * curso, favoritos, avisos sin leer y reclamos abiertos son las cuatro cosas
 * que pueden requerir que alguien haga algo. Un dashboard con "total de compras
 * históricas" se mira una vez y no sirve para nada.
 *
 * ⚠️ LAS CUATRO CONSULTAS VAN EN PARALELO. Son de módulos distintos y ninguna
 * depende de otra; encadenarlas sumaría cuatro viajes a la base para pintar una
 * fila de números.
 */
export default async function ResumenDeCuenta() {
  const user = await requireVerifiedSessionUser('/cuenta');

  const [ordenes, favoritos, sinLeer, reclamos] = await Promise.all([
    listMyOrders(user),
    listFavorites(user),
    countUnread(user),
    listMyDisputes(user),
  ]);

  const enCurso = ordenes.filter((orden) => !TERMINADAS.includes(orden.status));
  const abiertos = reclamos.filter((reclamo) => reclamo.abierta);

  return (
    <Pantalla>
      <PanelDeCuenta user={user} seccion="cuenta">
        <main id="contenido">
          <ChapaDeCuenta
            rotulo="Mi cuenta"
            titulo={user.displayName ?? 'Hola'}
            detalle={
              <p className={`${estilos.chapaDetalle} ${estilos.chapaEmail}`}>{user.email}</p>
            }
            lateral={
              /*
              ⚠️ EL NIVEL ES UN ESTATUS, NO UNA GARANTÍA (DEC-020), y por eso la
              insignia va SOLA, sin ningún texto que sugiera protección,
              prioridad ni respaldo. Lo que significa se explica abajo, en
              palabras, una vez.
            */
              <InsigniaDeNivel nombre={nivelDeUsuario(user.userLevel)} destacada />
            }
          />

          <SolapasDeCuenta user={user} seccion="cuenta" activa="resumen" />

          {/*
          ⚠️ LOS NÚMEROS SOBRE UN PLANO OSCURO Y NO EN CUATRO CAJAS BLANCAS: el
          número es el contenido, y sobre papel pesa lo mismo que su borde.
        */}
          <div className={`${estilos.tablero} sup-noche con-grano escena-luz`}>
            <Blobs />
            <Cifras
              cifras={[
                {
                  valor: String(enCurso.length),
                  etiqueta: 'Compras en curso',
                  detalle: enCurso.length === 0 ? 'Nada pendiente' : undefined,
                },
                { valor: String(favoritos.total), etiqueta: 'Favoritos' },
                {
                  valor: String(sinLeer),
                  etiqueta: 'Avisos sin leer',
                  detalle: sinLeer === 0 ? 'Estás al día' : undefined,
                },
                {
                  valor: String(abiertos.length),
                  etiqueta: 'Reclamos abiertos',
                  detalle: abiertos.length === 0 ? 'Ninguno' : undefined,
                },
              ]}
            />
          </div>

          <Seccion titulo="Tu nivel">
            {/*
            ⚠️ ESTE PÁRRAFO ES EL QUE IMPIDE QUE LA INSIGNIA MIENTA. DEC-020 dice
            que el nivel es un ESTATUS derivado de la actividad, no una garantía:
            no da prioridad, no protege una compra y no es un seguro. Decirlo
            acá, donde la insignia se ve, es lo único que evita que alguien la
            lea como lo segundo.
          */}
            <p className={estilos.nota}>
              Sos <strong>{nivelDeUsuario(user.userLevel)}</strong>. El nivel sube solo con las
              operaciones que completás en Offside y es un estatus dentro de la comunidad: no es una
              garantía, no te da prioridad y no reemplaza a ninguna protección.
            </p>
          </Seccion>

          <Seccion titulo="Accesos rápidos">
            {/*
            ⚠️ `.revela` ES REVELADO POR SCROLL Y ESTÁ BIEN ACÁ: esta grilla vive
            abajo del pliegue en un teléfono. Lo de arriba —chapa y tablero—
            entra con reloj, que es lo correcto para algo que ya está a la vista
            cuando la página pinta.
          */}
            <ul className={`${estilos.atajos} ${estilos.revela}`}>
              <Atajo
                href="/cuenta/compras"
                icono={<IconoCamiseta tamanio={22} />}
                titulo="Mis compras"
                dato={
                  enCurso.length === 0
                    ? cantidad(ordenes.length, 'compra')
                    : `${cantidad(enCurso.length, 'compra')} en curso`
                }
              />
              <Atajo
                href="/cuenta/favoritos"
                icono={<IconoFavorito tamanio={22} />}
                titulo="Favoritos"
                dato={cantidad(favoritos.total, 'publicación', 'publicaciones')}
              />
              <Atajo
                href="/cuenta/notificaciones"
                icono={<IconoCampana tamanio={22} />}
                titulo="Avisos"
                dato={
                  sinLeer === 0 ? 'Sin novedades' : `${cantidad(sinLeer, 'sin leer', 'sin leer')}`
                }
              />
              <Atajo
                href="/cuenta/reclamos"
                icono={<IconoBandera tamanio={22} />}
                titulo="Reclamos"
                dato={
                  abiertos.length === 0
                    ? 'Ninguno abierto'
                    : `${cantidad(abiertos.length, 'abierto')}`
                }
              />
              <Atajo
                href="/cuenta/preguntas"
                icono={<IconoPregunta tamanio={22} />}
                titulo="Mis preguntas"
                dato="Lo que preguntaste y lo que te respondieron"
              />
              <Atajo
                href="/cuenta/direcciones"
                icono={<IconoUbicacion tamanio={22} />}
                titulo="Direcciones"
                dato="Dónde querés recibir tus compras"
              />
            </ul>
          </Seccion>
        </main>
      </PanelDeCuenta>
    </Pantalla>
  );
}

/**
 * Una tarjeta de acceso rápido.
 *
 * ⚠️ ES UN ENLACE ENTERO, NO UNA TARJETA CON UN ENLACE ADENTRO. Un área de 88px
 * de alto que sólo responde en su título es una trampa en un teléfono.
 *
 * ⚠️ `.presiona` NO ES REDUNDANTE CON `.eleva`: en un teléfono no existe el
 * `:hover`, así que sin él la tarjeta no da ninguna señal de haber sido tocada
 * hasta que llega la pantalla siguiente.
 */
function Atajo({
  href,
  icono,
  titulo,
  dato,
}: {
  href: string;
  icono: ReactNode;
  titulo: string;
  dato: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className={`${estilos.atajo} sup-ficha eleva destello presiona`}
        transitionTypes={['avanza']}
      >
        <span className={`${estilos.atajoIcono} icono-vivo`} aria-hidden="true">
          {icono}
        </span>
        <span className={estilos.atajoCuerpo}>
          <span className={estilos.atajoTitulo}>{titulo}</span>
          <span className={estilos.atajoDato}>{dato}</span>
        </span>
      </Link>
    </li>
  );
}
