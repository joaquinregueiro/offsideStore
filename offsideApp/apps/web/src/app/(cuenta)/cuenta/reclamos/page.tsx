import type { Metadata } from 'next';
import Link from 'next/link';

import { IconoBandera } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import { BotonEnlace, Etiqueta, EstadoVacio, Seccion } from '@/components/ui';
import {
  cantidad,
  estadoDeDisputa,
  fecha,
  motivoDeReclamo,
  precio,
  resolucionDeDisputa,
  tonoDeDisputa,
} from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import { listMyDisputes } from '@/modules/disputes/services/dispute.service';

import { ChapaDeCuenta } from '../../chapa';
import { NavDeCuenta } from '../../nav';
import estilos from '../../cuenta.module.css';

export const metadata: Metadata = { title: 'Mis reclamos' };
export const dynamic = 'force-dynamic';

/**
 * MIS RECLAMOS (TS-050).
 *
 * ⚠️ NO HAY BOTÓN DE "ABRIR RECLAMO" ACÁ, y no es un olvido: un reclamo es
 * SIEMPRE sobre una compra concreta, y elegirla desde una lista de reclamos es
 * al revés. Se abre desde la ficha de la compra, que es donde está el contexto
 * —y donde `claimEligibility` ya sabe si se puede—.
 *
 * ⚠️ LOS ABIERTOS VAN ARRIBA. `listMyDisputes` devuelve por fecha; acá se
 * reordena para presentación porque lo que todavía está en curso es lo que
 * puede requerir hacer algo. El orden dentro de cada grupo se conserva.
 */
export default async function MisReclamos() {
  const user = await requireVerifiedSessionUser('/cuenta/reclamos');
  const reclamos = await listMyDisputes(user);

  const abiertos = reclamos.filter((reclamo) => reclamo.abierta);
  const cerrados = reclamos.filter((reclamo) => !reclamo.abierta);
  const ordenados = [...abiertos, ...cerrados];

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <ChapaDeCuenta
          rotulo="Mi cuenta"
          titulo="Mis reclamos"
          detalle={
            <p className={estilos.chapaDetalle}>
              {reclamos.length === 0
                ? 'No abriste ningún reclamo'
                : abiertos.length === 0
                  ? 'Ninguno abierto'
                  : `${cantidad(abiertos.length, 'abierto')}`}
            </p>
          }
        />

        <NavDeCuenta activo="reclamos" reclamos={abiertos.length} />

        {ordenados.length === 0 ? (
          <EstadoVacio titulo="No tenés reclamos" icono={<IconoBandera tamanio={40} />}>
            {/*
              ⚠️ EL ESTADO VACÍO DICE DÓNDE SE ABRE UNO, no promete protección.
              Offside no retiene los fondos (DEC-019): un reclamo abre una
              revisión, no una devolución automática, y decirlo de otra forma
              sería la garantía que este sitio no puede dar.
            */}
            <p>Si algo sale mal con una compra, el reclamo se abre desde la ficha de esa compra.</p>
            <BotonEnlace href="/cuenta/compras" variante="secundario">
              Ver mis compras
            </BotonEnlace>
          </EstadoVacio>
        ) : (
          <Seccion titulo="Reclamos" dato={cantidad(reclamos.length, 'reclamo')}>
            <ul className={`${estilos.lista} ${estilos.revela}`}>
              {ordenados.map((reclamo) => (
                <li key={reclamo.id}>
                  <Link
                    href={`/cuenta/reclamos/${reclamo.id}`}
                    className={`${estilos.reclamo} sup-ficha eleva destello presiona`}
                    transitionTypes={['avanza']}
                  >
                    <div className={estilos.reclamoCabecera}>
                      <p className={estilos.reclamoTitulo}>{motivoDeReclamo(reclamo.reason)}</p>
                      <Etiqueta tono={tonoDeDisputa(reclamo.status)}>
                        {estadoDeDisputa(reclamo.status)}
                      </Etiqueta>
                    </div>

                    <p className={estilos.compraMeta}>
                      Orden {reclamo.orderNumber} · abierto el {fecha(reclamo.openedAt)} ·{' '}
                      {precio(reclamo.orderTotalAmount, reclamo.currency)}
                    </p>

                    {reclamo.resolution !== null && (
                      <p className={estilos.compraMeta}>
                        Resultado: {resolucionDeDisputa(reclamo.resolution)}
                        {/*
                          ⚠️ `refundedAmount` DISTINGUE TRES COSAS Y NO DOS:
                          `null` es "todavía no se ejecutó", `0` es "Mercado Pago
                          lo rechazó" y mayor a cero es "se devolvió". Mostrar
                          `null` y `0` igual escondería el caso que más importa.
                        */}
                        {reclamo.refundedAmount !== null &&
                          reclamo.refundedAmount !== '0' &&
                          ` · te devolvieron ${precio(reclamo.refundedAmount, reclamo.currency)}`}
                      </p>
                    )}

                    {reclamo.abierta && reclamo.sellerResponseDueAt !== null && (
                      <p className={estilos.compraMeta}>
                        El vendedor tiene tiempo de responder hasta el{' '}
                        {fecha(reclamo.sellerResponseDueAt)}.
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </Seccion>
        )}
      </main>
    </Pantalla>
  );
}
