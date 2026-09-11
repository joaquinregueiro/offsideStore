import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AreaDeTexto, CampoOculto, Formulario, Seleccion } from '@/components/form';
import { Pantalla } from '@/components/movimiento';
import { Aviso, BotonEnlace, Migas } from '@/components/ui';
import { cantidad, motivoDeReclamo } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import {
  getDispatchDeadlineHours,
  getDisputeWindowDays,
} from '@/modules/config/services/setting-store.service';
/*
 * ⚠️ LA LISTA DE MOTIVOS NO SE ESCRIBE ACÁ: `DISPUTE_REASONS` son los
 * `enumValues` del enum `dispute_reason` del ERD, o sea LA lista y no una copia.
 * Escribir los ocho valores a mano en esta pantalla crearía una segunda
 * definición que el día que el ERD sume un motivo se queda vieja sin que nada
 * falle —el `<select>` simplemente no lo ofrecería—.
 *
 * ⚠️ SALE DEL SERVICE, NO DEL REPOSITORIO. Venía del repositorio porque era el
 * único lugar que la exportaba, y eso hacía que una pantalla conociera la capa
 * de datos de un módulo ajeno. `dispute.service.ts` ahora la re-exporta y la
 * pantalla vuelve a hablar sólo con el Service.
 */
import { DISPUTE_REASONS, getDisputeForOrder } from '@/modules/disputes/services/dispute.service';
import {
  claimEligibility,
  DESCRIPTION_MAX_LENGTH,
  EVIDENCE_MAX_ITEMS,
} from '@/modules/disputes/services/dispute-rules';
import { getMyOrderDetail } from '@/modules/orders/services/order.service';

import { abrirReclamo } from '../../../../acciones';
import { ChapaDeCuenta } from '../../../../chapa';
import { PanelDeCuenta, SolapasDeCuenta } from '../../../../panel';
import estilos from '../../../../cuenta.module.css';

export const metadata: Metadata = { title: 'Abrir un reclamo' };
export const dynamic = 'force-dynamic';

/**
 * TS-050 — el comprador abre un reclamo sobre una compra.
 *
 * ⚠️ LA ELEGIBILIDAD LA DECIDE `claimEligibility`, NO ESTA PANTALLA. Son tres
 * caminos distintos —despachada/entregada/completada dentro de la ventana, y
 * `PROCESSING` con el despacho vencido, que BR-032 habilita SÓLO para "no lo
 * recibí"— y cada uno tiene su mensaje. Acá se pregunta por `not_received`
 * porque es el motivo que entra en los tres: si ese no se puede, ninguno se
 * puede.
 *
 * ⚠️ UN SEGUNDO RECLAMO SOBRE LA MISMA ORDEN NO SE OFRECE. El Service lo
 * rechaza igual (`hasOpenDispute`), pero mostrar el formulario y rebotar
 * después de escribir cuatro párrafos es la peor forma de decirlo.
 */
export default async function Reclamar({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const user = await requireVerifiedSessionUser(`/cuenta/compras/${orderId}/reclamar`);

  const detalle = await getMyOrderDetail(user, orderId);
  if (detalle === null) notFound();

  const [reclamo, diasDeReclamo, horasDeDespacho] = await Promise.all([
    getDisputeForOrder(user, orderId),
    getDisputeWindowDays(),
    getDispatchDeadlineHours(),
  ]);

  const elegible = claimEligibility(
    {
      status: detalle.status,
      paidAt: detalle.paidAt === null ? null : new Date(detalle.paidAt),
      shippedAt: detalle.shippedAt === null ? null : new Date(detalle.shippedAt),
      deliveredAt: detalle.deliveredAt === null ? null : new Date(detalle.deliveredAt),
    },
    'not_received',
    { windowDays: diasDeReclamo, dispatchDeadlineHours: horasDeDespacho },
    new Date(),
  );

  return (
    <Pantalla>
      <PanelDeCuenta user={user} seccion="compras">
        <main id="contenido">
          <ChapaDeCuenta
            rotulo={`Orden ${detalle.orderNumber}`}
            titulo="Abrir un reclamo"
            detalle={
              <p className={estilos.chapaDetalle}>{detalle.items[0]?.title ?? 'Tu compra'}</p>
            }
          />

          <SolapasDeCuenta user={user} seccion="compras" activa="reclamos" />

          <Migas
            items={[
              { texto: 'Mis compras', href: '/cuenta/compras' },
              { texto: `Orden ${detalle.orderNumber}`, href: `/cuenta/compras/${orderId}` },
              { texto: 'Reclamo' },
            ]}
          />

          {reclamo !== null ? (
            <>
              <Aviso tono="neutro">Ya abriste un reclamo sobre esta compra.</Aviso>
              <div className={estilos.acciones}>
                <BotonEnlace href={`/cuenta/reclamos/${reclamo.id}`} flecha>
                  Ver el reclamo
                </BotonEnlace>
              </div>
            </>
          ) : !elegible.ok ? (
            <>
              <Aviso tono="neutro">
                {elegible.motivo === 'despacho_en_plazo'
                  ? 'El vendedor todavía está dentro del plazo para despachar. Si se vence, vas a poder reclamar que no lo recibiste.'
                  : elegible.motivo === 'ventana_vencida'
                    ? `El plazo para reclamar (${cantidad(diasDeReclamo, 'día', 'días')}) ya pasó.`
                    : 'Todavía no se puede reclamar sobre esta compra.'}
              </Aviso>
              <div className={estilos.acciones}>
                <BotonEnlace href={`/cuenta/compras/${orderId}`} variante="secundario">
                  Volver a la compra
                </BotonEnlace>
              </div>
            </>
          ) : (
            <section className={`${estilos.bloque} sup-ficha entraBloque`}>
              <h2 className={estilos.bloqueTitulo}>Contanos qué pasó</h2>

              <Formulario accion={abrirReclamo} enviar="Abrir el reclamo">
                <CampoOculto nombre="orderId" valor={orderId} />

                <Seleccion
                  nombre="reason"
                  etiqueta="Motivo"
                  vacio="Elegí un motivo"
                  opciones={DISPUTE_REASONS.map((motivo) => ({
                    valor: motivo,
                    etiqueta: motivoDeReclamo(motivo),
                  }))}
                />

                <AreaDeTexto
                  nombre="description"
                  etiqueta="Qué pasó"
                  ayuda="Contalo con el detalle que puedas: qué esperabas, qué recibiste y cuándo."
                  requerido
                  filas={6}
                  maximo={DESCRIPTION_MAX_LENGTH}
                />

                {/*
                ⚠️ LAS EVIDENCIAS SON TEXTO, UNA POR LÍNEA, y no archivos. Subir
                imágenes exige un puerto de almacenamiento con su propio control
                de tipo y de tamaño —la primera entrada binaria del sistema fue
                `image-processor.ts` y es una frontera de seguridad entera—, y
                `dispute_evidences` acepta `url` o `note`. Lo que se puede hacer
                hoy sin inventar nada es dejar escribir y pegar enlaces. Queda
                reportado como faltante, no simulado.
              */}
                <AreaDeTexto
                  nombre="evidencias"
                  etiqueta="Evidencias (opcional)"
                  ayuda={`Una por línea: un enlace a una foto, el número de seguimiento, lo que tengas. Hasta ${EVIDENCE_MAX_ITEMS}.`}
                  filas={4}
                />
              </Formulario>

              {/*
              ⚠️ SE DICE QUÉ PASA DESPUÉS, Y SE DICE LO QUE ES CIERTO. El reclamo
              le abre un plazo de respuesta al vendedor y, si no responde, escala
              solo a revisión de Offside. No se promete devolución del dinero:
              eso lo decide la resolución, y prometerlo acá sería exactamente el
              tipo de garantía que este sitio no da.
            */}
              <p className={estilos.nota}>
                Al abrirlo, el vendedor recibe el reclamo y tiene un plazo para responder. Si no
                responde, pasa a revisión de Offside. Vas a poder seguir todo desde{' '}
                <strong>Reclamos</strong>.
              </p>
            </section>
          )}
        </main>
      </PanelDeCuenta>
    </Pantalla>
  );
}
