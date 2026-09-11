import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Pantalla } from '@/components/movimiento';
import { Aviso, BotonEnlace, Etiqueta, FilaDeDatos, Migas } from '@/components/ui';
import {
  estadoDeDisputa,
  fecha,
  fechaYHora,
  motivoDeReclamo,
  precio,
  resolucionDeDisputa,
  tonoDeDisputa,
} from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import type { PublicUser } from '@/modules/auth/services/auth.service';
import { DisputeError } from '@/modules/disputes/disputes.errors';
import { getDispute, type DisputeDetail } from '@/modules/disputes/services/dispute.service';
import type { DisputeTimelineEntry } from '@/modules/disputes/services/dispute-rules';

import { ChapaDeCuenta } from '../../../chapa';
import { PanelDeCuenta, SolapasDeCuenta } from '../../../panel';
import estilos from '../../../cuenta.module.css';

export const metadata: Metadata = { title: 'Reclamo' };
export const dynamic = 'force-dynamic';

/** Quién escribió cada entrada, en la voz de quien reclama. */
const ACTORES: Record<DisputeTimelineEntry['actor'], string> = {
  buyer: 'Vos',
  seller: 'El vendedor',
  admin: 'Offside',
  system: 'Automático',
};

/**
 * Lee el reclamo tratando "ajeno" e "inexistente" como lo mismo.
 *
 * ⚠️ `getDispute` LANZA `DISPUTE_NOT_FOUND` EN LOS DOS CASOS a propósito, y acá
 * se traduce a un 404 de pantalla. Un 403 confirmaría que el reclamo existe y
 * permitiría enumerar los de otras personas probando ids.
 *
 * ⚠️ CUALQUIER OTRO ERROR SE RELANZA. Tragarse un fallo de base y mostrar un 404
 * diría "esto no existe" sobre algo que sí existe, y el límite de error del
 * grupo dejaría de verse.
 */
async function leerReclamo(
  id: string,
  volverA: string,
): Promise<{ user: PublicUser; reclamo: DisputeDetail }> {
  const user = await requireVerifiedSessionUser(volverA);

  try {
    // Se devuelve tambien el usuario: el armazon del panel lo necesita, y
    // volver a resolverlo seria leer la cookie y la sesion dos veces.
    return { user, reclamo: await getDispute(user, id) };
  } catch (error) {
    if (error instanceof DisputeError && error.reason === 'DISPUTE_NOT_FOUND') notFound();

    throw error;
  }
}

/**
 * FICHA DE UN RECLAMO — la conversación, las evidencias y cómo terminó.
 *
 * ⚠️ NO HAY BOTÓN PARA RESPONDER NI PARA RESOLVER. Responder es del vendedor
 * (`respondAsSeller`) y resolver es del back-office con la capacidad
 * `disputes:resolve`; esta pantalla es la vista de quien reclamó. `getDispute`
 * devuelve `viewer` justamente para que cada pantalla muestre lo suyo.
 *
 * ⚠️ EL `viewer` SE USA PARA SABER QUÉ MENSAJE ES PROPIO, no para autorizar: la
 * autorización ya la hizo el Service al resolver el rol.
 */
export default async function FichaDeReclamo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, reclamo } = await leerReclamo(id, `/cuenta/reclamos/${id}`);

  /*
   * Las evidencias que ya cuenta la conversación no se repiten abajo: la
   * descripción de apertura y la respuesta del vendedor viajan como `detalle`
   * de sus entradas. Lo que queda son los adjuntos de verdad.
   */
  const adjuntos = reclamo.evidencias.filter(
    (evidencia) => evidencia.type !== 'description' && evidencia.type !== 'response',
  );

  return (
    <Pantalla>
      <PanelDeCuenta user={user} seccion="compras">
        <main id="contenido">
          <ChapaDeCuenta
            rotulo={`Orden ${reclamo.orderNumber}`}
            titulo={motivoDeReclamo(reclamo.reason)}
            detalle={<p className={estilos.chapaDetalle}>Abierto el {fecha(reclamo.openedAt)}</p>}
            lateral={
              <Etiqueta tono={tonoDeDisputa(reclamo.status)}>
                {estadoDeDisputa(reclamo.status)}
              </Etiqueta>
            }
          />

          <SolapasDeCuenta user={user} seccion="compras" activa="reclamos" />

          <Migas
            items={[
              { texto: 'Mi cuenta', href: '/cuenta' },
              { texto: 'Mis reclamos', href: '/cuenta/reclamos' },
              { texto: motivoDeReclamo(reclamo.reason) },
            ]}
          />

          {reclamo.abierta && reclamo.sellerRespondedAt === null && (
            <Aviso tono="neutro">
              {reclamo.sellerResponseDueAt === null
                ? 'El vendedor todavía no respondió.'
                : `El vendedor tiene tiempo de responder hasta el ${fechaYHora(reclamo.sellerResponseDueAt)}. Si no responde, pasa a revisión de Offside.`}
            </Aviso>
          )}

          <div className={estilos.ficha}>
            <div className={estilos.columna}>
              <section className={`${estilos.bloque} sup-ficha entraBloque`}>
                <h2 className={estilos.bloqueTitulo}>Cómo viene</h2>

                {/*
                ⚠️ ES UNA `<ol>`: el orden ES la información. Un lector de
                pantalla anuncia "lista de 4 elementos, elemento 3" y con eso ya
                se sabe en qué punto del recorrido está el reclamo.
              */}
                <ol className={estilos.conversacion}>
                  {reclamo.timeline.map((entrada, indice) => (
                    <li
                      key={`${entrada.tipo}-${entrada.at}-${indice}`}
                      className={
                        entrada.actor === reclamo.viewer
                          ? `${estilos.mensaje} ${estilos.mensajePropio}`
                          : estilos.mensaje
                      }
                    >
                      <p className={estilos.mensajeRotulo}>
                        {ACTORES[entrada.actor]} · {fechaYHora(entrada.at)}
                      </p>
                      <p className={estilos.itemTitulo}>{entrada.titulo}</p>
                      {entrada.detalle !== null && (
                        <p className={estilos.texto}>
                          {/*
                          ⚠️ EL `detalle` DE UN REEMBOLSO SON CENTAVOS CRUDOS, no
                          una frase: `buildTimeline` guarda ahí el importe
                          devuelto. Imprimirlo tal cual mostraría "89900" en la
                          pantalla donde alguien quiere saber cuánta plata
                          recuperó.
                        */}
                          {entrada.tipo === 'reembolso'
                            ? precio(entrada.detalle, reclamo.currency)
                            : entrada.detalle}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </section>

              {adjuntos.length > 0 && (
                <section className={`${estilos.bloque} sup-ficha`}>
                  <h2 className={estilos.bloqueTitulo}>Evidencias</h2>
                  <ul className={estilos.evidencias}>
                    {adjuntos.map((evidencia) => (
                      <li key={evidencia.id}>
                        {evidencia.uploadedBy === 'buyer' ? 'Vos' : 'El vendedor'} ·{' '}
                        {evidencia.url === null ? (
                          (evidencia.note ?? 'Sin detalle')
                        ) : (
                          /*
                          ⚠️ `rel="noreferrer noopener"` NO ES OPCIONAL: el enlace
                          lo escribió la otra parte del reclamo, y sin esto la
                          página de destino recibe una referencia a esta ventana
                          y de dónde vino.
                        */
                          <a href={evidencia.url} target="_blank" rel="noreferrer noopener">
                            {evidencia.url}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <div className={estilos.columna}>
              <section className={`${estilos.bloque} sup-ficha entraBloque`}>
                <h2 className={estilos.bloqueTitulo}>La compra</h2>
                <FilaDeDatos concepto="Orden">{reclamo.orderNumber}</FilaDeDatos>
                <FilaDeDatos concepto="Total">
                  {precio(reclamo.orderTotalAmount, reclamo.currency)}
                </FilaDeDatos>
                <div className={estilos.acciones}>
                  <BotonEnlace
                    href={`/cuenta/compras/${reclamo.orderId}`}
                    variante="secundario"
                    tamanio="medio"
                    flecha
                  >
                    Ver la compra
                  </BotonEnlace>
                </div>
              </section>

              <section className={`${estilos.bloque} sup-ficha`}>
                <h2 className={estilos.bloqueTitulo}>Resultado</h2>
                {reclamo.resolution === null ? (
                  <p className={estilos.nota}>
                    Todavía no hay resolución. Cuando Offside revise el reclamo, la decisión y lo
                    que implique van a aparecer acá y en la conversación.
                  </p>
                ) : (
                  <>
                    <FilaDeDatos concepto="Decisión">
                      {resolucionDeDisputa(reclamo.resolution)}
                    </FilaDeDatos>
                    {reclamo.resolvedAt !== null && (
                      <FilaDeDatos concepto="Resuelto">{fecha(reclamo.resolvedAt)}</FilaDeDatos>
                    )}
                    <FilaDeDatos concepto="Reembolso">
                      {/*
                      ⚠️ TRES ESTADOS Y NO DOS. `null` es "todavía no se ejecutó",
                      `0` es "Mercado Pago lo rechazó" y mayor a cero es lo
                      devuelto. Mostrar los dos primeros igual escondería el caso
                      que más importa: el que hay que reclamar de nuevo.
                    */}
                      {reclamo.refundedAmount === null
                        ? 'Pendiente de confirmación'
                        : reclamo.refundedAmount === '0'
                          ? 'Mercado Pago lo rechazó'
                          : precio(reclamo.refundedAmount, reclamo.currency)}
                    </FilaDeDatos>
                  </>
                )}
              </section>
            </div>
          </div>
        </main>
      </PanelDeCuenta>
    </Pantalla>
  );
}
