import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AreaDeTexto, Campo, CampoOculto, Formulario, Seleccion } from '@/components/form';
import { Pantalla } from '@/components/movimiento';
import {
  Aviso,
  BotonEnlace,
  Cifras,
  Confirmar,
  Definiciones,
  EstadoVacio,
  Etiqueta,
  InsigniaDeNivel,
  InsigniaDeReputacion,
  Tabla,
} from '@/components/ui';
import {
  cantidad,
  estadoDeVendedor,
  fecha,
  fechaYHora,
  multiplicador,
  nivelDeUsuario,
  porcentajeDeComision,
  tipoDeSancion,
  tonoDeVendedor,
} from '@/lib/formato';
import { CAPABILITIES } from '@/lib/permissions';
import { requireCapabilitySessionUser } from '@/lib/session';
import { getSellerReputation } from '@/modules/reputation/services/reputation.service';
import { resolveCommissionBasisPoints } from '@/modules/sellers/services/seller-tier.service';
import { listSanctions } from '@/modules/trust/services/sanction.service';

import {
  aplicarSancionAVendedor,
  levantarSancionDeVendedor,
  otorgarTienda,
  terminarPromocion,
} from '../../../acciones';
import { Consola } from '../../../consola';
import { promocionesDeVendedor, verVendedor } from '../../../datos';
import { TIPOS_DE_SANCION, esUuid } from '../../../vocabulario';
import estilos from '../../../admin.module.css';

export const metadata: Metadata = { title: 'Vendedor' };
export const dynamic = 'force-dynamic';

/**
 * Ficha de moderación de un vendedor (`trust:moderate`).
 *
 * ⚠️ TRES COSAS QUE SE HACEN ACA TIENEN EFECTOS DISTINTOS Y NO SE MEZCLAN:
 * sancionar cambia el estado del perfil y puede impedirle vender; otorgar
 * TIENDA cambia el nivel de la CUENTA (no del vendedor); terminar una promoción
 * toca una publicación. Cada una pide su confirmación y su motivo.
 *
 * ⚠️ LA EXPULSION ES TERMINAL (BR-004). No se levanta desde acá ni desde ningún
 * lado de la aplicación: deshacerla es SQL, igual que asignar un rol. Se avisa
 * antes de confirmar.
 *
 * ⚠️ DOS DE LAS ACCIONES EXIGEN `system_config:manage` Y NO `trust:moderate`,
 * porque es lo que exigen sus Services (`grantTiendaLevel` y
 * `endPromotionByAdmin`). Hoy los dos mapas dan los mismos roles; el día que se
 * separen, esta pantalla va a mostrar dos formularios que el servidor rechaza.
 * Reportado.
 */

const ESTADOS_DE_SANCION: Record<string, { texto: string; tono: 'neutro' | 'alerta' | 'exito' }> = {
  active: { texto: 'Vigente', tono: 'alerta' },
  lifted: { texto: 'Levantada', tono: 'exito' },
  expired: { texto: 'Vencida', tono: 'neutro' },
};

/** Qué hace cada tipo de sanción, dicho antes de elegirlo. */
const QUE_HACE_LA_SANCION: Record<string, string> = {
  warning: 'Advertencia. Queda registrada y no le impide operar.',
  limitation: 'Limitación. Queda registrada; qué limita todavía no tiene semántica definida (🟡).',
  suspension: 'Suspensión: deja de poder vender. Se puede levantar.',
  expulsion: 'Expulsión: es DEFINITIVA. No se levanta desde la aplicación.',
  penalty: 'Penalización. Queda registrada y no cambia el estado del perfil.',
};

export default async function Vendedor({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, admin] = await Promise.all([
    params,
    requireCapabilitySessionUser(CAPABILITIES.TRUST_MODERATE, '/admin/vendedores'),
  ]);

  /*
   * ⚠️ EL ID SE VALIDA ANTES DE CONSULTAR. `seller_profiles.id` es `uuid`: con
   * un texto que no lo es, PostgreSQL lanza antes de mirar ninguna fila y la
   * persona recibe "Tuvimos un problema" en vez de un 404. Verificado contra el
   * servidor con `/admin/vendedores/no-es-uuid`.
   */
  if (!esUuid(id)) notFound();

  const vendedor = await verVendedor(id);
  // Un id que no existe es un 404: no hay nada que moderar.
  if (vendedor === undefined) notFound();

  const [reputacion, comision, sanciones, promociones] = await Promise.all([
    getSellerReputation(vendedor.sellerId),
    resolveCommissionBasisPoints(vendedor.sellerId),
    listSanctions(vendedor.sellerId),
    promocionesDeVendedor(vendedor.sellerId),
  ]);

  const vigentes = sanciones.filter((sancion) => sancion.status === 'active');
  const puntualidad =
    reputacion.onTimeDispatchRate === null
      ? 'sin despachos medidos'
      : `${Math.round(reputacion.onTimeDispatchRate * 100)} % a tiempo`;

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Consola
          rol={admin.adminRole}
          email={admin.email}
          activo="vendedores"
          titulo={vendedor.displayName}
        />

        <div className={estilos.hoja}>
          {vigentes.length > 0 && (
            <div className={estilos.avisoDeConsola}>
              <Aviso tono="error">
                Este vendedor tiene {cantidad(vigentes.length, 'sanción', 'sanciones')} vigente
                {vigentes.length === 1 ? '' : 's'}.
              </Aviso>
            </div>
          )}

          <article className={`${estilos.tarjeta} ${estilos.fichaNeutra}`}>
            <div className={estilos.tarjetaCabecera}>
              <h2 className={estilos.tituloDeFicha}>{vendedor.displayName}</h2>
              <span className={estilos.estadoGrupo}>
                <span className={estilos.rotuloEstado}>Estado del perfil</span>
                <Etiqueta tono={tonoDeVendedor(vendedor.status)}>
                  {estadoDeVendedor(vendedor.status)}
                </Etiqueta>
              </span>
            </div>

            <div className={estilos.insignias}>
              <InsigniaDeNivel
                nombre={vendedor.tierName ?? 'Sin nivel'}
                tasa={porcentajeDeComision(comision.basisPoints)}
              />
              <InsigniaDeReputacion
                etiqueta={reputacion.label}
                metricas={[
                  cantidad(reputacion.salesCount, 'venta'),
                  cantidad(reputacion.claimsCount, 'reclamo'),
                  puntualidad,
                ]}
              />
            </div>

            <Definiciones
              items={[
                {
                  termino: 'Email',
                  valor: <code className={estilos.crudo}>{vendedor.email}</code>,
                },
                {
                  termino: 'Id de vendedor',
                  valor: <code className={estilos.crudo}>{vendedor.sellerId}</code>,
                },
                {
                  termino: 'Id de cuenta',
                  valor: <code className={estilos.crudo}>{vendedor.userId}</code>,
                },
                { termino: 'Nivel de cuenta', valor: nivelDeUsuario(vendedor.userLevel) },
                { termino: 'Riesgo', valor: vendedor.riskLevel },
                { termino: 'Alta', valor: fecha(vendedor.createdAt.toISOString()) },
                {
                  termino: 'Aprobado',
                  valor:
                    vendedor.approvedAt === null
                      ? 'Todavía no'
                      : fecha(vendedor.approvedAt.toISOString()),
                },
                {
                  termino: 'Vacaciones',
                  valor:
                    vendedor.vacationUntil === null
                      ? 'No'
                      : `Hasta ${fecha(vendedor.vacationUntil.toISOString())}`,
                },
              ]}
            />
          </article>

          <h2 className={estilos.subtitulo}>Reputación</h2>

          {/*
            ⚠️ `quietas` PORQUE ES UNA HERRAMIENTA DE OPERACIONES. Cada
            milisegundo de animación acá es un milisegundo esperando para leer
            un dato, y quien abre esta pantalla la abre veinte veces por día.

            ⚠️ SON METRICAS CRUDAS, NO UN VEREDICTO (DEC-036). El score derivado
            se muestra al lado y siempre como indicador: lo verificable son las
            ventas, las cancelaciones y los reclamos.
          */}
          <Cifras
            quietas
            cifras={[
              { valor: String(reputacion.salesCount), etiqueta: 'Ventas completadas' },
              { valor: String(reputacion.cancellationsCount), etiqueta: 'Canceladas por él' },
              { valor: String(reputacion.claimsCount), etiqueta: 'Reclamos' },
              { valor: String(reputacion.refundsCount), etiqueta: 'Reembolsos' },
              {
                valor: String(reputacion.counterfeitFlags),
                etiqueta: 'Denuncias por falsificación',
              },
              {
                valor:
                  reputacion.avgDispatchHours === null
                    ? '—'
                    : `${Math.round(reputacion.avgDispatchHours)} h`,
                etiqueta: 'Despacho promedio',
              },
              {
                valor: reputacion.score === null ? '—' : String(reputacion.score),
                etiqueta: 'Score derivado',
                detalle: 'Indicador, no autoridad',
              },
              {
                valor:
                  reputacion.ratingAvg === null ? 'Sin reseñas' : `${reputacion.ratingAvg} / 5`,
                etiqueta: 'Calificación',
                detalle: cantidad(reputacion.ratingCount, 'reseña'),
              },
            ]}
          />

          <h2 className={estilos.subtitulo}>Sanciones</h2>

          {sanciones.length === 0 ? (
            <EstadoVacio titulo="Nunca se le aplicó una sanción">
              Las sanciones que se apliquen desde acá quedan en el log de auditoría y en el
              historial de la cuenta.
            </EstadoVacio>
          ) : (
            <div className={estilos.historial}>
              <Tabla titulo="Sanciones del vendedor" tituloVisible>
                <thead>
                  <tr>
                    <th scope="col">Tipo</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Motivo</th>
                    <th scope="col">Desde</th>
                    <th scope="col">Hasta</th>
                    <th scope="col">Levantar</th>
                  </tr>
                </thead>
                <tbody>
                  {sanciones.map((sancion) => {
                    const estado = ESTADOS_DE_SANCION[sancion.status] ?? {
                      texto: sancion.status,
                      tono: 'neutro' as const,
                    };

                    return (
                      <tr key={sancion.id}>
                        <td>{tipoDeSancion(sancion.type)}</td>
                        <td>
                          <Etiqueta tono={estado.tono}>{estado.texto}</Etiqueta>
                        </td>
                        <td>{sancion.reason ?? '—'}</td>
                        <td>
                          {sancion.startsAt === null ? '—' : fechaYHora(sancion.startsAt)}
                          {sancion.disputeId !== null && (
                            <span className={estilos.metaFila}>Nace de un reclamo</span>
                          )}
                        </td>
                        <td>
                          {sancion.endsAt === null ? 'Sin vencimiento' : fecha(sancion.endsAt)}
                        </td>
                        <td>
                          {/*
                            ⚠️ SOLO LAS VIGENTES SE PUEDEN LEVANTAR, Y LA
                            EXPULSION NUNCA. Ofrecer el control para las demás
                            sería prometer una acción que el Service rechaza.
                          */}
                          {sancion.status !== 'active' ? (
                            '—'
                          ) : sancion.type === 'expulsion' ? (
                            <span className={estilos.metaFila}>Definitiva</span>
                          ) : (
                            <Confirmar
                              etiqueta="Levantar"
                              pregunta="Si era una suspensión y no queda otra sanción bloqueante vigente, el vendedor vuelve a poder vender. Queda en el log de auditoría."
                            >
                              <Formulario
                                accion={levantarSancionDeVendedor}
                                enviar="Confirmar"
                                tamanio="chico"
                                bloque={false}
                              >
                                <CampoOculto nombre="sancionId" valor={sancion.id} />
                                <AreaDeTexto
                                  nombre="motivo"
                                  identificador={`motivo-levantar-${sancion.id}`}
                                  etiqueta="Motivo"
                                  filas={2}
                                  requerido
                                  maximo={2000}
                                  ayuda="Obligatorio. Queda en el log de auditoría con tu usuario."
                                />
                              </Formulario>
                            </Confirmar>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Tabla>
            </div>
          )}

          <section className={`${estilos.tarjeta} ${estilos.fichaAlerta}`}>
            <div className={estilos.tarjetaCabecera}>
              <h2 className={estilos.tituloDeFicha}>Aplicar una sanción</h2>
            </div>

            <div className={`${estilos.zonaPeligro} sup-calida`}>
              <Confirmar
                etiqueta="Sancionar a este vendedor"
                pregunta="Una suspensión le impide vender desde el momento en que se guarda. Una expulsión es DEFINITIVA y no se puede deshacer desde la aplicación."
              >
                <Formulario
                  accion={aplicarSancionAVendedor}
                  enviar="Confirmar sanción"
                  variante="peligro"
                >
                  <CampoOculto nombre="sellerId" valor={vendedor.sellerId} />
                  <Seleccion
                    nombre="tipo"
                    etiqueta="Tipo de sanción"
                    opciones={TIPOS_DE_SANCION.map((valor) => ({
                      valor,
                      etiqueta: tipoDeSancion(valor),
                    }))}
                  />
                  <AreaDeTexto
                    nombre="motivo"
                    etiqueta="Motivo"
                    filas={3}
                    requerido
                    maximo={2000}
                    ayuda="Obligatorio. Es lo único que explica después por qué se sancionó."
                  />
                  <Campo
                    nombre="hasta"
                    etiqueta="Vence el"
                    tipo="date"
                    requerido={false}
                    ayuda="Vacío = sin vencimiento. Se toma el final de ese día."
                  />
                </Formulario>
              </Confirmar>
            </div>

            <dl className={estilos.leyenda}>
              {TIPOS_DE_SANCION.map((tipo) => (
                <div key={tipo} className={estilos.leyendaItem}>
                  <dt>{tipoDeSancion(tipo)}</dt>
                  <dd>{QUE_HACE_LA_SANCION[tipo] ?? ''}</dd>
                </div>
              ))}
            </dl>
          </section>

          <h2 className={estilos.subtitulo}>Promociones vigentes</h2>

          {promociones.length === 0 ? (
            <p className={estilos.nota}>
              <span>No tiene ninguna publicación promocionada en este momento.</span>
            </p>
          ) : (
            <div className={estilos.historial}>
              <Tabla titulo="Promociones vigentes" tituloVisible>
                <thead>
                  <tr>
                    <th scope="col">Publicación</th>
                    <th scope="col">Multiplicador</th>
                    <th scope="col">Termina</th>
                    <th scope="col">Cortar</th>
                  </tr>
                </thead>
                <tbody>
                  {promociones.map((promocion) => (
                    <tr key={promocion.id}>
                      <td>{promocion.listingTitle}</td>
                      <td>{multiplicador(Number(promocion.multiplicador))}</td>
                      <td>{fechaYHora(promocion.endsAt.toISOString())}</td>
                      <td>
                        <Confirmar
                          etiqueta="Terminar"
                          pregunta="La publicación deja de estar promocionada ya mismo: sale del primer lugar de la vitrina y su próxima venta vuelve a la comisión normal. La fila queda como cancelada, nunca se borra."
                        >
                          <Formulario
                            accion={terminarPromocion}
                            enviar="Confirmar"
                            variante="peligro"
                            tamanio="chico"
                            bloque={false}
                          >
                            <CampoOculto nombre="promotionId" valor={promocion.id} />
                            <AreaDeTexto
                              nombre="motivo"
                              identificador={`motivo-promo-${promocion.id}`}
                              etiqueta="Motivo"
                              filas={2}
                              requerido
                              maximo={1000}
                              ayuda="Obligatorio. Queda en el log de auditoría."
                            />
                          </Formulario>
                        </Confirmar>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Tabla>
            </div>
          )}

          <h2 className={estilos.subtitulo}>Nivel de la cuenta</h2>

          <section className={estilos.tarjeta}>
            <p className={estilos.bajada}>
              Hoy es <strong>{nivelDeUsuario(vendedor.userLevel)}</strong>. TIENDA es la única
              categoría que <strong>otorga Offside</strong> (DEC-020): las demás las gana la cuenta
              sola con sus operaciones.
            </p>

            {vendedor.userLevel === 'TIENDA' ? (
              <p className={estilos.nota}>
                <span>Ya tiene el nivel TIENDA. Bajarlo es SQL, igual que asignar un rol.</span>
              </p>
            ) : (
              <Confirmar
                etiqueta="Otorgar el nivel TIENDA"
                pregunta="Es una decisión de Offside sobre la cuenta y no se puede deshacer desde la aplicación. Queda en el historial de nivel y en el log de auditoría."
              >
                <Formulario accion={otorgarTienda} enviar="Confirmar" tamanio="medio">
                  <CampoOculto nombre="userId" valor={vendedor.userId} />
                  <AreaDeTexto
                    nombre="motivo"
                    identificador="motivo-tienda"
                    etiqueta="Motivo"
                    filas={2}
                    requerido
                    maximo={1000}
                    ayuda="Obligatorio. Queda guardado con el cambio de nivel."
                  />
                </Formulario>
              </Confirmar>
            )}
          </section>

          <div className={estilos.pie}>
            <BotonEnlace href={`/admin/niveles?vendedor=${vendedor.sellerId}`}>
              Cambiar su nivel de vendedor
            </BotonEnlace>
            <BotonEnlace href="/admin/vendedores" variante="secundario">
              Volver
            </BotonEnlace>
          </div>
        </div>
      </main>
    </Pantalla>
  );
}
