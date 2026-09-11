import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AreaDeTexto, CampoOculto, Formulario } from '@/components/form';
import { IconoEstrella } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import {
  Cifras,
  EstadoVacio,
  Estrellas,
  InsigniaDeReputacion,
  Paginacion,
  Seccion,
} from '@/components/ui';
import { cantidad, fechaYHora, horas } from '@/lib/formato';
import { requireSellerSessionUser } from '@/lib/session';
import { PanelDeCuenta, SolapasDeCuenta } from '../../../(cuenta)/panel';
import { getSellerReputation } from '@/modules/reputation/services/reputation.service';
import { REPLY_MAX_LENGTH, listSellerReviews } from '@/modules/reviews/services/review.service';
import { getMySellerProfile } from '@/modules/sellers/services/seller.service';

import { responderResenia } from '../../acciones';
import { Chapa } from '../../chapa';
import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Mi reputación' };
export const dynamic = 'force-dynamic';

/**
 * Reputación del vendedor (DEC-036 / TS-021).
 *
 * ⚠️ SE MUESTRAN LAS METRICAS CRUDAS Y EL SCORE SE PRESENTA COMO INDICADOR,
 * NUNCA COMO VEREDICTO. "12 ventas completadas · despachás en ~8 h · 0 reclamos"
 * es verificable; "sos un vendedor confiable" no lo es, y DEC-036 fija que la
 * fuente de verdad son los HECHOS, no un puntaje derivado. El score existe, se
 * muestra, y se dice con todas las letras qué es y qué no es.
 *
 * ⚠️ EL PROMEDIO DE DESPACHO NO ES UNA PROMESA AL COMPRADOR. Es lo que tardaste
 * hasta ahora, medido entre `paid_at` y el despacho; no es un plazo garantizado
 * ni reemplaza al plazo de BR-032.
 *
 * ⚠️ LA RESPUESTA A UNA RESEÑA NO CAMBIA LA NOTA, y se responde UNA SOLA VEZ.
 * La calificación es del comprador; la respuesta es contexto. Lo hace cumplir el
 * Service con un UPDATE condicionado, así que dos envíos simultáneos tampoco
 * pisan nada.
 */
export default async function MiReputacion({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSellerSessionUser('/vendedor/reputacion');
  const params = await searchParams;

  const perfil = await getMySellerProfile(user.id);
  if (perfil === null) redirect('/vendedor/empezar');

  const paginaCruda = Array.isArray(params.pagina) ? params.pagina[0] : params.pagina;
  const pagina = Math.max(1, Number.parseInt(paginaCruda ?? '1', 10) || 1);

  const [reputacion, resenias] = await Promise.all([
    getSellerReputation(perfil.id),
    listSellerReviews(perfil.id, pagina),
  ]);

  /*
   * ⚠️ LAS METRICAS DE LA INSIGNIA SON LAS MISMAS QUE VE UN COMPRADOR EN LA
   * FICHA. Mostrarle al vendedor un resumen distinto del que se publica sería la
   * forma más rápida de que deje de creer en los dos.
   */
  const metricas = [
    cantidad(reputacion.salesCount, 'venta completada', 'ventas completadas'),
    reputacion.avgDispatchHours === null
      ? 'sin despachos medidos'
      : `despachás en ~${horas(reputacion.avgDispatchHours)}`,
    cantidad(reputacion.claimsCount, 'reclamo'),
  ];

  return (
    <Pantalla>
      <PanelDeCuenta user={user} seccion="cuenta">
        <main id="contenido">
          <Chapa
            rotulo="Confianza"
            titulo="Mi reputación"
            chica
            detalle={
              <p className={estilos.chapaDetalle}>
                Calculada el {fechaYHora(reputacion.computedAt.toISOString())}
              </p>
            }
          />

          <SolapasDeCuenta user={user} seccion="cuenta" activa="nivel" />

          <div className={estilos.franjaReputacion}>
            <Estrellas
              promedio={reputacion.ratingAvg}
              cantidad={reputacion.ratingCount}
              tamanio="grande"
            />
            <InsigniaDeReputacion etiqueta={reputacion.label} metricas={metricas} />
          </div>

          <Seccion titulo="Los números">
            {/*
            ⚠️ SON HECHOS CONTADOS, NO UNA NOTA. Cada uno se puede verificar
            contra las órdenes: por eso son seis números crudos y no una barra de
            "85% de satisfacción", que no significaría nada concreto.
          */}
            <div className={`${estilos.tablero} sup-noche con-grano`}>
              <Cifras
                cifras={[
                  {
                    valor: String(reputacion.salesCount),
                    etiqueta: 'Ventas completadas',
                    detalle: 'sólo cuentan las cerradas',
                  },
                  {
                    valor:
                      reputacion.ratingAvg === null
                        ? '—'
                        : new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(
                            reputacion.ratingAvg,
                          ),
                    etiqueta: 'Calificación',
                    detalle:
                      reputacion.ratingCount === 0
                        ? 'todavía sin reseñas'
                        : cantidad(reputacion.ratingCount, 'reseña'),
                  },
                  {
                    valor:
                      reputacion.avgDispatchHours === null
                        ? '—'
                        : horas(reputacion.avgDispatchHours),
                    etiqueta: 'Promedio de despacho',
                    detalle:
                      reputacion.dispatchedCount === 0
                        ? 'sin despachos medidos'
                        : `sobre ${cantidad(reputacion.dispatchedCount, 'envío')}`,
                  },
                  {
                    valor:
                      reputacion.onTimeDispatchRate === null
                        ? '—'
                        : `${Math.round(reputacion.onTimeDispatchRate * 100)}%`,
                    etiqueta: 'Despachos en plazo',
                  },
                  {
                    valor: String(reputacion.cancellationsCount),
                    etiqueta: 'Cancelaciones tuyas',
                  },
                  {
                    valor: String(reputacion.claimsCount),
                    etiqueta: 'Reclamos recibidos',
                    detalle:
                      reputacion.refundsCount === 0
                        ? undefined
                        : `${cantidad(reputacion.refundsCount, 'reembolso')}`,
                  },
                ]}
              />
            </div>

            {/*
            ⚠️ EL SCORE SE MUESTRA COMO INDICADOR Y SE DICE QUE NO ES UN
            VEREDICTO (DEC-036). Es un derivado de los números de arriba con
            pesos que Offside configura y puede cambiar: presentarlo como una
            nota definitiva sería darle autoridad a un cálculo, no a los hechos.
          */}
            <p className={estilos.nota}>
              {reputacion.score === null
                ? 'Todavía no hay suficientes hechos para calcular un indicador. Los números de arriba son los que valen.'
                : `Tu indicador es ${new Intl.NumberFormat('es-AR', {
                    maximumFractionDigits: 1,
                  }).format(
                    reputacion.score,
                  )}. Es un resumen de los números de arriba, no un veredicto sobre vos: lo que vale son los hechos, y cada uno se puede verificar contra tus órdenes.`}
            </p>
          </Seccion>

          {/*
          ⚠️ EL DATO VA POR SPREAD Y NO CON UN TERNARIO A `undefined`. Con
          `exactOptionalPropertyTypes` una prop opcional NO acepta que le pasen
          `undefined` a propósito, y un `''` haría que el componente dibuje un
          párrafo vacío al lado del título.
        */}
          <Seccion
            titulo="Reseñas recibidas"
            {...(resenias.total === 0 ? {} : { dato: cantidad(resenias.total, 'reseña') })}
          >
            {resenias.items.length === 0 ? (
              <EstadoVacio
                titulo="Todavía no te calificaron"
                icono={<IconoEstrella tamanio={40} />}
              >
                <p>
                  Cuando una compra se completa, quien compró puede dejarte una reseña. Vas a poder
                  responderla una vez.
                </p>
              </EstadoVacio>
            ) : (
              <ul className={estilos.listaResenias}>
                {resenias.items.map((resenia) => (
                  <li key={resenia.id} className={estilos.resenia}>
                    <div className={estilos.reseniaCabecera}>
                      {/*
                      ⚠️ ACA NO VA `Estrellas`, Y NO ES UNA INCONSISTENCIA. Esa
                      primitiva escribe "de 5, N reseñas" al lado del promedio,
                      que es exacto arriba —donde hay un promedio— y falso acá:
                      diría "1 reseña" en cada una de las diez de la lista. Una
                      reseña individual tiene una nota, no un promedio.
                    */}
                      <p className={estilos.reseniaNota}>
                        <span className={estilos.reseniaNotaIcono} aria-hidden="true">
                          <IconoEstrella tamanio={16} />
                        </span>
                        {resenia.rating} de 5
                      </p>
                      <p className={estilos.celdaMeta}>
                        {resenia.raterDisplayName ?? 'Alguien'} ·{' '}
                        {fechaYHora(resenia.createdAt.toISOString())}
                      </p>
                    </div>

                    {resenia.comment !== null && (
                      <p className={estilos.reseniaTexto}>{resenia.comment}</p>
                    )}

                    {resenia.sellerReply === null ? (
                      /*
                      ⚠️ EL FORMULARIO SOLO APARECE SI TODAVIA NO RESPONDIO. No es
                      una comodidad: mostrarlo igual y que el Service rechace
                      convertiría "ya respondiste" en un error, cuando es
                      simplemente el estado normal de una reseña contestada.
                    */
                      <Formulario
                        accion={responderResenia}
                        enviar="Responder"
                        variante="secundario"
                        tamanio="chico"
                        bloque={false}
                      >
                        <CampoOculto nombre="reviewId" valor={resenia.id} />
                        <AreaDeTexto
                          nombre="respuesta"
                          etiqueta="Tu respuesta"
                          identificador={`respuesta-${resenia.id}`}
                          requerido
                          filas={3}
                          maximo={REPLY_MAX_LENGTH}
                          ayuda="Se publica junto a la reseña y se responde una sola vez: no se puede editar después."
                        />
                      </Formulario>
                    ) : (
                      <div className={estilos.reseniaRespuesta}>
                        <p className={estilos.reseniaRespuestaRotulo}>Tu respuesta</p>
                        <p className={estilos.reseniaTexto}>{resenia.sellerReply}</p>
                        {resenia.sellerRepliedAt !== null && (
                          <p className={estilos.celdaMeta}>
                            {fechaYHora(resenia.sellerRepliedAt.toISOString())}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <Paginacion
              actual={resenias.pagina}
              total={resenias.totalPaginas}
              hrefDe={(n) =>
                n === 1 ? '/vendedor/reputacion' : `/vendedor/reputacion?pagina=${n}`
              }
            />
          </Seccion>

          <div className={`${estilos.cierre} sup-2 patron-vivo diagonales-vivas`}>
            <p className={estilos.nota}>
              La calificación la deja quien te compró y no se puede borrar ni editar desde acá. Si
              una reseña rompe las reglas, Offside la revisa: responderla es tu herramienta, no la
              única.
            </p>
          </div>
        </main>
      </PanelDeCuenta>
    </Pantalla>
  );
}
