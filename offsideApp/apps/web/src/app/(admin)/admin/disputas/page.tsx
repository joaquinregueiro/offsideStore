import type { Metadata } from 'next';
import Link from 'next/link';

import { Pantalla } from '@/components/movimiento';
import { BotonEnlace, EstadoVacio, Etiqueta, Tabla } from '@/components/ui';
import {
  estadoDeDisputa,
  fechaRelativa,
  fechaYHora,
  motivoDeReclamo,
  precio,
  tonoDeDisputa,
} from '@/lib/formato';
import { CAPABILITIES } from '@/lib/permissions';
import { requireCapabilitySessionUser } from '@/lib/session';
import { listOpenForAdmin } from '@/modules/disputes/services/dispute.service';
import { DISPUTE_STATUSES } from '@/modules/disputes/repositories/dispute.repository';

import { Consola } from '../../consola';
import estilos from '../../admin.module.css';

export const metadata: Metadata = { title: 'Disputas' };
export const dynamic = 'force-dynamic';

/**
 * Bandeja de reclamos (DEC-009 / TS-052).
 *
 * ⚠️ LAS MAS VIEJAS PRIMERO, y lo decide el repositorio: un reclamo que espera
 * hace una semana importa más que el que acaba de abrirse. No se ordena acá.
 *
 * ⚠️ EL FILTRO VIAJA EN LA URL POR GET. Una bandeja filtrada se comparte con el
 * equipo, vuelve con el botón atrás y funciona sin JavaScript. Las pestañas son
 * enlaces, no estado de React.
 *
 * ⚠️ UN ADMINISTRADOR NO PUEDE RESOLVER MIENTRAS EL RECLAMO ESPERA AL VENDEDOR.
 * La máquina de estados es lineal (`OPEN → WAITING_SELLER → UNDER_REVIEW →
 * RESOLVED`) y saltear el turno del vendedor sería decidir TS-052 desde el
 * código. Por eso la bandeja separa "en revisión" —lo que SÍ se puede
 * resolver— del resto.
 */

/**
 * Los filtros de la bandeja.
 *
 * ⚠️ `revision` VA PRIMERO PORQUE ES LA COLA DE TRABAJO REAL. "Abiertas" son
 * todas las que no se cerraron, pero sobre dos de esos tres estados no se puede
 * hacer nada todavía.
 */
const FILTROS = [
  { clave: 'revision', texto: 'En revisión', estados: ['UNDER_REVIEW'] as const },
  {
    clave: 'abiertas',
    texto: 'Abiertas',
    estados: ['OPEN', 'WAITING_SELLER', 'UNDER_REVIEW'] as const,
  },
  { clave: 'nuevas', texto: 'Recién abiertas', estados: ['OPEN'] as const },
  { clave: 'vendedor', texto: 'Esperando al vendedor', estados: ['WAITING_SELLER'] as const },
  { clave: 'resueltas', texto: 'Resueltas', estados: ['RESOLVED'] as const },
  { clave: 'todas', texto: 'Todas', estados: DISPUTE_STATUSES },
] as const;

export default async function Disputas({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const [{ estado }, admin] = await Promise.all([
    searchParams,
    requireCapabilitySessionUser(CAPABILITIES.DISPUTES_RESOLVE, '/admin/disputas'),
  ]);

  const filtro = FILTROS.find((f) => f.clave === estado) ?? FILTROS[0];
  const reclamos = await listOpenForAdmin(admin, { statuses: filtro.estados, limit: 100 });

  const ahora = new Date();

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Consola rol={admin.adminRole} email={admin.email} activo="disputas" titulo="Disputas" />

        <div className={estilos.hoja}>
          <p className={estilos.bajada}>
            Un reclamo se resuelve recién <strong>en revisión</strong>: antes le toca responder al
            vendedor, y si no responde, el barrido lo escala solo al vencer el plazo.
          </p>

          {/*
            ⚠️ SON ENLACES, NO BOTONES. Cada filtro es una URL distinta: se
            comparte, se guarda en favoritos y anda sin JavaScript.
          */}
          <nav className={estilos.filtros} aria-label="Filtrar reclamos">
            {FILTROS.map((f) => (
              <Link
                key={f.clave}
                href={`/admin/disputas?estado=${f.clave}`}
                className={f.clave === filtro.clave ? estilos.filtroActivo : estilos.filtro}
                aria-current={f.clave === filtro.clave ? 'page' : undefined}
              >
                {f.texto}
              </Link>
            ))}
          </nav>

          {reclamos.length === 0 ? (
            <EstadoVacio titulo="No hay reclamos con ese filtro">
              Probá con otro estado, o mirá todas.
            </EstadoVacio>
          ) : (
            <div className={estilos.historial}>
              <Tabla titulo={`Reclamos: ${filtro.texto}`} tituloVisible>
                <thead>
                  <tr>
                    <th scope="col">Orden</th>
                    <th scope="col">Motivo</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Abierto</th>
                    <th scope="col">Plazo del vendedor</th>
                    <th scope="col">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {reclamos.map((reclamo) => (
                    <tr key={reclamo.id}>
                      <td>
                        {/*
                          ⚠️ EL ENLACE VA EN EL NUMERO DE ORDEN, que es el dato
                          por el que una persona busca el reclamo cuando el
                          comprador escribe. El id de la disputa es un uuid y no
                          se muestra.
                        */}
                        <Link href={`/admin/disputas/${reclamo.id}`}>{reclamo.orderNumber}</Link>
                      </td>
                      <td>{motivoDeReclamo(reclamo.reason)}</td>
                      <td>
                        <Etiqueta tono={tonoDeDisputa(reclamo.status)}>
                          {estadoDeDisputa(reclamo.status)}
                        </Etiqueta>
                      </td>
                      <td>
                        {fechaYHora(reclamo.openedAt)}
                        <span className={estilos.metaFila}>
                          {fechaRelativa(reclamo.openedAt, ahora)}
                        </span>
                      </td>
                      <td>
                        {reclamo.sellerResponseDueAt === null
                          ? '—'
                          : fechaRelativa(reclamo.sellerResponseDueAt, ahora)}
                      </td>
                      <td>{precio(reclamo.orderTotalAmount, reclamo.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </Tabla>
            </div>
          )}

          <p className={estilos.nota}>
            <span>
              La bandeja trae hasta 100 reclamos. Todavía no pagina: si alguna vez hay más, se corta
              en los 100 más viejos, que son los que hay que atender primero.
            </span>
          </p>

          <div className={estilos.pie}>
            <BotonEnlace href="/admin" variante="secundario">
              Volver
            </BotonEnlace>
          </div>
        </div>
      </main>
    </Pantalla>
  );
}
