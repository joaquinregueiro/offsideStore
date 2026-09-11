import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Pantalla } from '@/components/movimiento';
import {
  Aviso,
  Cifras,
  InsigniaDeNivel,
  Pasos,
  Seccion,
  Tabla,
  CeldaNumero,
  EncabezadoNumero,
} from '@/components/ui';
import { cantidad, porcentajeDeComision } from '@/lib/formato';
import { requireSellerSessionUser } from '@/lib/session';
import { PanelDeCuenta, SolapasDeCuenta } from '../../../(cuenta)/panel';
import { getTierProgress, listTiers } from '@/modules/sellers/services/seller-tier.service';
import { getMySellerProfile } from '@/modules/sellers/services/seller.service';

import { Chapa } from '../../chapa';
import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Mi nivel de vendedor' };
export const dynamic = 'force-dynamic';

/**
 * Nivel del vendedor (seller tier).
 *
 * ⚠️ NINGUNA CIFRA DE ESTA PANTALLA ESTA ESCRITA EN EL JSX. Los nombres, los
 * umbrales y las tasas salen de `seller_tiers` y de `app_settings` a través de
 * `getTierProgress` y `listTiers`: es plata del vendedor y tiene que decir lo
 * mismo que después cobra la orden. Escribir "6%" acá sería garantizar que el
 * día que Admin cambie la comisión, esta pantalla mienta.
 *
 * ⚠️ "VENTAS COMPLETADAS" NO ES "VENTAS". Sólo cuentan las órdenes `COMPLETED`
 * (BR-051), y según la configuración puede haber una ventana de tiempo y
 * excluirse las reembolsadas. Se dice, porque si no el vendedor cuenta sus
 * ventas a mano y le da otro número.
 *
 * ⚠️ SUBIR DE NIVEL NO CAMBIA LO YA VENDIDO. Cada orden congeló su comisión al
 * crearse (DEC-030).
 */
export default async function MiNivel() {
  const user = await requireSellerSessionUser('/vendedor/nivel');

  const perfil = await getMySellerProfile(user.id);
  if (perfil === null) redirect('/vendedor/empezar');

  const [progreso, niveles] = await Promise.all([getTierProgress(perfil.id), listTiers()]);

  return (
    <Pantalla>
      <PanelDeCuenta user={user} seccion="cuenta">
        <main id="contenido">
          <Chapa
            rotulo="Mi cuenta"
            titulo="Mi nivel"
            chica
            detalle={
              <p className={estilos.chapaDetalle}>
                Cuánto te cobra Offside por vender, y qué te falta para el próximo escalón.
              </p>
            }
          />

          <SolapasDeCuenta user={user} seccion="cuenta" activa="nivel" />

          <div className={estilos.franjaNivel}>
            <InsigniaDeNivel
              nombre={progreso.currentTier?.name ?? 'Sin nivel asignado'}
              tasa={progreso.currentRateLabel}
              destacada
            />
          </div>

          {progreso.currentTier === null && (
            <Aviso tono="neutro">
              Todavía no tenés un nivel asignado, así que pagás la comisión general de Offside. Se
              asigna solo cuando tus ventas completadas alcanzan el primer escalón.
            </Aviso>
          )}

          {!progreso.autoAssign && (
            <Aviso tono="neutro">
              La asignación automática de niveles está apagada en este momento: alcanzar un umbral
              no cambia tu nivel solo.
            </Aviso>
          )}

          <div className={`${estilos.tablero} sup-noche con-grano`}>
            <Cifras
              cifras={[
                {
                  valor: progreso.currentRateLabel,
                  etiqueta: 'Tu comisión',
                  detalle:
                    progreso.currentTier === null
                      ? 'la general de Offside'
                      : progreso.currentTier.usesGlobalRate
                        ? 'tu nivel usa la tasa general'
                        : `nivel ${progreso.currentTier.name}`,
                },
                {
                  valor: String(progreso.completedSales),
                  etiqueta: 'Ventas completadas',
                  detalle:
                    progreso.windowDays === null
                      ? 'desde siempre'
                      : `en los últimos ${progreso.windowDays} días`,
                },
                {
                  valor:
                    progreso.nextTier === null ? '—' : String(progreso.nextTier.remainingSales),
                  etiqueta: 'Te faltan',
                  detalle:
                    progreso.nextTier === null
                      ? 'ya estás en el nivel más alto'
                      : `para ${progreso.nextTier.name}`,
                },
              ]}
            />
          </div>

          {progreso.nextTier !== null && (
            <Seccion titulo="Qué te falta">
              {/*
              ⚠️ EL PROXIMO NIVEL ES EL SIGUIENTE POR UMBRAL RESPECTO DEL ACTUAL,
              no respecto de las ventas. Con 12 ventas y todavía en el primer
              escalón, el próximo es el segundo —aunque falten 0—, no el tercero:
              mostrar otra cosa prometería un salto que la evaluación no da.
            */}
              <div className={estilos.checklist}>
                <Pasos
                  etiqueta="Próximo nivel"
                  pasos={[
                    {
                      titulo: `Llegar a ${cantidad(progreso.nextTier.minCompletedSales, 'venta completada', 'ventas completadas')}`,
                      detalle:
                        progreso.nextTier.remainingSales === 0
                          ? 'Ya alcanzaste el umbral: el nivel se asigna en la próxima evaluación.'
                          : `Te faltan ${cantidad(progreso.nextTier.remainingSales, 'venta', 'ventas')}.`,
                      hecho: progreso.nextTier.remainingSales === 0,
                    },
                  ]}
                />
              </div>
              <p className={estilos.bajada}>
                {progreso.nextTier.name} paga {progreso.nextTier.rateLabel} de comisión
                {progreso.nextTier.description === null
                  ? '.'
                  : `. ${progreso.nextTier.description}`}
              </p>
            </Seccion>
          )}

          <Seccion titulo="Los niveles">
            <div className={estilos.marcoVentas}>
              <Tabla titulo="Niveles de vendedor" tituloVisible={false}>
                <thead>
                  <tr>
                    <th scope="col">Nivel</th>
                    <th scope="col">Qué te da</th>
                    <EncabezadoNumero>Desde</EncabezadoNumero>
                    <EncabezadoNumero>Comisión</EncabezadoNumero>
                  </tr>
                </thead>
                <tbody>
                  {niveles.map((nivel) => {
                    const esElTuyo = nivel.code === progreso.currentTier?.code;

                    return (
                      <tr key={nivel.code} data-actual={esElTuyo ? '' : undefined}>
                        <td>
                          <InsigniaDeNivel nombre={nivel.name} destacada={esElTuyo} />
                          {esElTuyo && <span className="solo-lectores"> (tu nivel actual)</span>}
                        </td>
                        <td>
                          <p className={estilos.celdaMeta}>
                            {nivel.description ??
                              (nivel.usesGlobalRate
                                ? 'Usa la comisión general de Offside.'
                                : 'Una comisión más baja sobre cada venta.')}
                          </p>
                        </td>
                        <CeldaNumero>
                          {nivel.minCompletedSales === 0
                            ? '0'
                            : cantidad(nivel.minCompletedSales, 'venta', 'ventas')}
                        </CeldaNumero>
                        <CeldaNumero>
                          <strong>{nivel.rateLabel}</strong>
                        </CeldaNumero>
                      </tr>
                    );
                  })}
                </tbody>
              </Tabla>
            </div>
          </Seccion>

          <div className={`${estilos.cierre} sup-2 patron-vivo diagonales-vivas`}>
            <p className={estilos.nota}>
              Sólo cuentan las ventas <strong>completadas</strong>: las canceladas y las que siguen
              en curso no suman. Subir de nivel no cambia lo que ya vendiste, porque cada orden
              congela su comisión al crearse — hoy la tuya es{' '}
              {porcentajeDeComision(progreso.currentBasisPoints)}.
            </p>
          </div>
        </main>
      </PanelDeCuenta>
    </Pantalla>
  );
}
