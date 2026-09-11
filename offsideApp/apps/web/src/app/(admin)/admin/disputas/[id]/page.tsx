import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AreaDeTexto, Campo, CampoOculto, Formulario, Seleccion } from '@/components/form';
import { Pantalla } from '@/components/movimiento';
import {
  Aviso,
  BotonEnlace,
  Confirmar,
  Cronologia,
  Definiciones,
  Etiqueta,
  type Hito,
} from '@/components/ui';
import {
  estadoDeDisputa,
  fechaYHora,
  motivoDeReclamo,
  precio,
  resolucionDeDisputa,
  tonoDeDisputa,
} from '@/lib/formato';
import { CAPABILITIES } from '@/lib/permissions';
import { requireCapabilitySessionUser } from '@/lib/session';
import { DisputeError } from '@/modules/disputes/disputes.errors';
import { DISPUTE_RESOLUTIONS } from '@/modules/disputes/repositories/dispute.repository';
import {
  getDispute,
  resolutionLabel,
  type DisputeDetail,
} from '@/modules/disputes/services/dispute.service';

import { resolverDisputa } from '../../../acciones';
import { esUuid } from '../../../vocabulario';
import { Consola } from '../../../consola';
import estilos from '../../../admin.module.css';

export const metadata: Metadata = { title: 'Reclamo' };
export const dynamic = 'force-dynamic';

/**
 * Detalle de un reclamo y su resolución (TS-054).
 *
 * ⚠️ RESOLVER PUEDE MOVER DINERO Y PUEDE SANCIONAR A UNA PERSONA, las dos cosas
 * sin pasar por `payments:refund` ni por `trust:moderate`. Lo habilita
 * OR-001/OR-002 —el refund SE ORIGINA en la resolución y su importe LO FIJA la
 * resolución—, y por eso la nota es obligatoria: la resolución es la causa
 * trazable, no un atajo.
 *
 * ⚠️ QUIEN ES PARTE DEL RECLAMO NO PUEDE RESOLVERLO, aunque sea administrador.
 * Lo decide `canResolve` en el Service, no esta pantalla.
 *
 * ⚠️ `DISPUTE_RESOLUTIONS` SE IMPORTA DEL REPOSITORIO, y es la única vez que
 * este grupo cruza esa capa. Es el enum del ERD y no lo re-exporta ningún
 * Service: escribir la lista a mano acá sería una segunda definición de las
 * resoluciones válidas. Queda reportado: pertenece a `dispute-rules.ts`, al
 * lado de `resolutionLabel`.
 */

/**
 * Qué hace cada resolución, dicho antes de elegirla.
 *
 * ⚠️ UN `<select>` NO PUEDE EXPLICAR SUS OPCIONES, y estas seis tienen
 * consecuencias muy distintas —una devuelve plata, dos sancionan a una persona,
 * una no hace nada—. La leyenda va al lado del control y no en un `title`, que
 * no existe en un teléfono.
 *
 * ⚠️ `return_required` NO DEVUELVE NADA Y NO CIERRA NADA. OR-006 deja el orden
 * de operaciones de una devolución ⚙️ con valor 🟡, así que el sistema sólo
 * deja constancia: confirmar que el vendedor recibió la devolución es un paso
 * MANUAL, fuera de Offside, y después hay que volver acá a resolver de nuevo si
 * corresponde un reembolso.
 */
const QUE_HACE: Record<string, string> = {
  no_action: 'Se desestima el reclamo. No se devuelve dinero y no se sanciona a nadie.',
  partial_refund: 'Devuelve el importe que escribas. Pide un monto menor al total.',
  full_refund: 'Devuelve toda la orden. No lleva importe.',
  return_required:
    'Sólo deja constancia: hay que confirmar que el vendedor recibió la devolución, a mano y fuera de Offside. No devuelve dinero.',
  seller_penalty:
    'Penaliza al vendedor. Si además escribís un importe, devuelve ese dinero en la misma operación.',
  seller_suspended:
    'Suspende al vendedor: deja de poder vender. Si además escribís un importe, devuelve ese dinero.',
};

/** Los estados del reclamo como línea de tiempo de la `Cronologia`. */
const HITOS: { clave: string; titulo: string; estados: readonly string[] }[] = [
  { clave: 'OPEN', titulo: 'Reclamo abierto', estados: ['OPEN'] },
  { clave: 'WAITING_SELLER', titulo: 'Esperando al vendedor', estados: ['WAITING_SELLER'] },
  { clave: 'UNDER_REVIEW', titulo: 'En revisión de Offside', estados: ['UNDER_REVIEW'] },
  { clave: 'RESOLVED', titulo: 'Resuelto', estados: ['RESOLVED'] },
];

const ACTORES: Record<string, string> = {
  buyer: 'quien compró',
  seller: 'el vendedor',
  admin: 'Offside',
  system: 'el sistema',
};

export default async function Reclamo({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, admin] = await Promise.all([
    params,
    requireCapabilitySessionUser(CAPABILITIES.DISPUTES_RESOLVE, '/admin/disputas'),
  ]);

  /*
   * ⚠️ UN RECLAMO QUE NO EXISTE ES UN 404, NO UN "tuvimos un problema". El
   * Service lanza `DISPUTE_NOT_FOUND` tanto si no existe como si esta persona
   * no puede verlo —no se distinguen, para no poder enumerar reclamos ajenos—,
   * y sin esto el id de la URL mal tipeado caería en el `error.tsx` del grupo.
   * Cualquier otro error se relanza.
   */
  // Mismo motivo que en la ficha del vendedor: `disputes.id` es `uuid`, y un
  // texto que no lo es hace lanzar a PostgreSQL en vez de devolver cero filas.
  if (!esUuid(id)) notFound();

  let reclamo: DisputeDetail;
  try {
    reclamo = await getDispute(admin, id);
  } catch (error) {
    if (error instanceof DisputeError && error.reason === 'DISPUTE_NOT_FOUND') notFound();
    throw error;
  }

  const indiceActual = HITOS.findIndex((hito) => hito.estados.includes(reclamo.status));

  const hitos: Hito[] = HITOS.map((hito, indice) => ({
    clave: hito.clave,
    titulo: hito.titulo,
    estado: indice < indiceActual ? 'hecho' : indice === indiceActual ? 'actual' : 'futuro',
  }));

  const total = BigInt(reclamo.orderTotalAmount);
  const devuelto = reclamo.refundedAmount === null ? null : BigInt(reclamo.refundedAmount);
  const rechazado = devuelto === 0n;

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Consola
          rol={admin.adminRole}
          email={admin.email}
          activo="disputas"
          titulo={`Reclamo de ${reclamo.orderNumber}`}
        />

        <div className={estilos.hoja}>
          {/*
            ⚠️ EL RESULTADO DEL REEMBOLSO SE DICE ARRIBA DE TODO CUANDO FALLO.
            `refunded_amount = 0` significa que Mercado Pago lo RECHAZO: la
            resolución quedó escrita y la plata no volvió. Esconderlo en la
            cronología dejaría el reclamo "resuelto" para quien lo mire de
            costado.
          */}
          {rechazado && (
            <div className={estilos.avisoDeConsola}>
              <Aviso tono="error">
                Mercado Pago <strong>rechazó</strong> el reembolso de este reclamo: la resolución
                quedó registrada y el dinero no volvió. Si el motivo fue saldo insuficiente del
                vendedor, la deuda <strong>no queda registrada</strong> en ningún lado. Verificá en
                Mercado Pago antes de prometerle nada a quien compró.
              </Aviso>
            </div>
          )}

          <article className={`${estilos.tarjeta} ${estilos.fichaNeutra}`}>
            <div className={estilos.tarjetaCabecera}>
              <span className={estilos.numeroDeOrden}>{reclamo.orderNumber}</span>
              <span className={estilos.estadoGrupo}>
                <span className={estilos.rotuloEstado}>Estado del reclamo</span>
                <Etiqueta tono={tonoDeDisputa(reclamo.status)}>
                  {estadoDeDisputa(reclamo.status)}
                </Etiqueta>
              </span>
            </div>

            <Definiciones
              items={[
                { termino: 'Motivo', valor: motivoDeReclamo(reclamo.reason) },
                { termino: 'Abierto el', valor: fechaYHora(reclamo.openedAt) },
                {
                  termino: 'Total de la orden',
                  valor: precio(reclamo.orderTotalAmount, reclamo.currency),
                },
                {
                  termino: 'Plazo del vendedor',
                  valor:
                    reclamo.sellerResponseDueAt === null
                      ? '—'
                      : fechaYHora(reclamo.sellerResponseDueAt),
                },
                {
                  termino: 'Respondió el',
                  valor:
                    reclamo.sellerRespondedAt === null
                      ? 'Todavía no respondió'
                      : fechaYHora(reclamo.sellerRespondedAt),
                },
                {
                  termino: 'Resolución',
                  valor:
                    reclamo.resolution === null
                      ? 'Sin resolver'
                      : resolucionDeDisputa(reclamo.resolution),
                },
                {
                  termino: 'Reembolsado',
                  valor:
                    devuelto === null
                      ? '—'
                      : rechazado
                        ? 'Rechazado por Mercado Pago'
                        : precio(devuelto.toString(), reclamo.currency),
                },
              ]}
            />
          </article>

          <h2 className={estilos.subtitulo}>Recorrido</h2>
          <Cronologia hitos={hitos} etiqueta="Estado del reclamo" />

          <h2 className={estilos.subtitulo}>Qué pasó</h2>
          <ol className={estilos.bitacora}>
            {reclamo.timeline.map((entrada) => (
              <li key={`${entrada.tipo}-${entrada.at}`} className={estilos.bitacoraItem}>
                <p className={estilos.bitacoraTitulo}>{entrada.titulo}</p>
                <p className={estilos.metaFila}>
                  {fechaYHora(entrada.at)} · {ACTORES[entrada.actor] ?? entrada.actor}
                </p>
                {entrada.detalle !== null && (
                  <p className={estilos.bitacoraDetalle}>{entrada.detalle}</p>
                )}
              </li>
            ))}
          </ol>

          <h2 className={estilos.subtitulo}>Evidencias</h2>
          {reclamo.evidencias.length === 0 ? (
            <p className={estilos.nota}>
              <span>No se cargó ninguna evidencia.</span>
            </p>
          ) : (
            <ul className={estilos.evidencias}>
              {reclamo.evidencias.map((evidencia) => (
                <li key={evidencia.id} className={estilos.evidencia}>
                  <p className={estilos.metaFila}>
                    {ACTORES[evidencia.uploadedBy] ?? evidencia.uploadedBy} ·{' '}
                    {fechaYHora(evidencia.createdAt)}
                  </p>
                  {/*
                    ⚠️ UNA URL SE MUESTRA COMO TEXTO, NO COMO ENLACE. La escribió
                    una de las partes del reclamo: convertirla en un `<a>` que un
                    administrador va a apretar mientras decide sobre plata ajena
                    es exactamente el clic que no conviene ofrecer. El Service ya
                    separa `url` de `text` y descarta cualquier cosa que no sea
                    `http(s)`; acá se copia y se abre a mano si hace falta.
                  */}
                  {evidencia.url !== null && <code className={estilos.crudo}>{evidencia.url}</code>}
                  {evidencia.note !== null && (
                    <p className={estilos.bitacoraDetalle}>{evidencia.note}</p>
                  )}
                </li>
              ))}
            </ul>
          )}

          <h2 className={estilos.subtitulo}>Resolver</h2>

          {reclamo.status === 'RESOLVED' ? (
            <div className={estilos.avisoDeConsola}>
              <Aviso tono="exito">
                Este reclamo ya está resuelto como{' '}
                <strong>
                  {reclamo.resolution === null ? '—' : resolucionDeDisputa(reclamo.resolution)}
                </strong>
                . Una resolución no se revierte desde acá.
              </Aviso>
            </div>
          ) : reclamo.status !== 'UNDER_REVIEW' ? (
            <div className={estilos.avisoDeConsola}>
              <Aviso>
                Un reclamo se resuelve sólo cuando está <strong>en revisión</strong>. Ahora está en
                &quot;{estadoDeDisputa(reclamo.status)}&quot;: le toca responder al vendedor, y si
                no responde, el barrido lo escala al vencer el plazo.
              </Aviso>
            </div>
          ) : (
            <section className={`${estilos.tarjeta} ${estilos.fichaAlerta}`}>
              <div className={`${estilos.zonaPeligro} sup-calida`}>
                <Confirmar
                  etiqueta="Resolver el reclamo"
                  pregunta={`Según la resolución que elijas, esto puede devolverle hasta ${precio(total.toString(), reclamo.currency)} a quien compró y puede suspender al vendedor. Se ejecuta contra Mercado Pago y no se deshace desde acá.`}
                >
                  <Formulario
                    accion={resolverDisputa}
                    enviar="Confirmar resolución"
                    variante="peligro"
                  >
                    <CampoOculto nombre="disputeId" valor={reclamo.id} />

                    <Seleccion
                      nombre="resolucion"
                      etiqueta="Resolución"
                      opciones={DISPUTE_RESOLUTIONS.map((valor) => ({
                        valor,
                        etiqueta: resolutionLabel(valor),
                      }))}
                    />

                    <Campo
                      nombre="montoPesos"
                      etiqueta="Importe a devolver, en pesos"
                      tipo="number"
                      requerido={false}
                      min={0}
                      max={Number(total) / 100}
                      step={0.01}
                      inputMode="decimal"
                      ayuda="Sólo para reembolso parcial, o junto a una sanción. El reembolso total no lleva importe."
                    />

                    <AreaDeTexto
                      nombre="nota"
                      etiqueta="Nota de la resolución"
                      filas={3}
                      requerido
                      maximo={2000}
                      ayuda="Es obligatoria y queda guardada con la resolución. Es lo único que explica después por qué se decidió esto."
                    />
                  </Formulario>
                </Confirmar>
              </div>

              <dl className={estilos.leyenda}>
                {DISPUTE_RESOLUTIONS.map((valor) => (
                  <div key={valor} className={estilos.leyendaItem}>
                    <dt>{resolutionLabel(valor)}</dt>
                    <dd>{QUE_HACE[valor] ?? ''}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <div className={estilos.pie}>
            <BotonEnlace href="/admin/disputas" variante="secundario">
              Volver a la bandeja
            </BotonEnlace>
          </div>
        </div>
      </main>
    </Pantalla>
  );
}
