import type { Metadata } from 'next';
import Link from 'next/link';

import { IconoRayo } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import {
  Aviso,
  CeldaNumero,
  Cifras,
  EncabezadoNumero,
  EstadoVacio,
  Etiqueta,
  Seccion,
  Tabla,
} from '@/components/ui';
import { cantidad, fecha, multiplicador } from '@/lib/formato';
import { requireSellerSessionUser } from '@/lib/session';
import { PanelDeCuenta, SolapasDeCuenta } from '../../../(cuenta)/panel';
import { arePromotionsEnabled } from '@/modules/listings/services/listing-settings.service';
import { listPromotions } from '@/modules/listings/services/promotion.service';

import { Chapa } from '../../chapa';
import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Mis promociones' };
export const dynamic = 'force-dynamic';

/** Cuántos días duró (o lleva) una promoción, a partir de sus dos extremos. */
function duracionEnDias(desde: string, hasta: string): number {
  const ms = new Date(hasta).getTime() - new Date(desde).getTime();

  return Math.max(0, Math.round(ms / 86_400_000));
}

/**
 * Historial de promociones del vendedor.
 *
 * ⚠️ LA COLUMNA QUE JUSTIFICA ESTA PANTALLA ES "VENTAS". Una promoción cuesta
 * comisión agravada; sin saber cuántas ventas hizo cada una, el vendedor no
 * tiene forma de decidir si le conviene repetirla. `listPromotions` lo cuenta
 * en una sola consulta para todas las filas, no una por promoción.
 *
 * ⚠️ EL MULTIPLICADOR ES EL SNAPSHOT DE CADA PROMOCION, no el valor de hoy del
 * Config Store. Si Offside cambia el multiplicador mañana, estas filas siguen
 * diciendo por cuánto se multiplicó realmente la comisión de cada una.
 *
 * ⚠️ NO HAY BOTON DE CANCELAR, Y NO ES UN OLVIDO. El vendedor no puede terminar
 * una promoción antes de tiempo: si pudiera, promocionaría para llevarse las
 * visitas y la apagaría justo antes de vender, sin pagar la comisión agravada.
 * Terminarla es una acción de Admin, con motivo y auditoría.
 */
export default async function MisPromociones() {
  const user = await requireSellerSessionUser('/vendedor/promociones');

  const [promociones, habilitadas] = await Promise.all([
    listPromotions(user),
    arePromotionsEnabled(),
  ]);

  const vigentes = promociones.filter((p) => p.vigente);
  const ventas = promociones.reduce((suma, p) => suma + p.ventas, 0);

  return (
    <Pantalla>
      <PanelDeCuenta user={user} seccion="publicaciones">
        <main id="contenido">
          <Chapa rotulo="Visibilidad" titulo="Mis promociones" chica />

          <SolapasDeCuenta user={user} seccion="publicaciones" activa="promociones" />

          {!habilitadas && (
            <Aviso tono="neutro">
              Las promociones están apagadas en este momento. Las que ya activaste siguen su curso
              hasta terminar.
            </Aviso>
          )}

          {promociones.length === 0 ? (
            <EstadoVacio titulo="Todavía no promocionaste nada" icono={<IconoRayo tamanio={40} />}>
              <p>
                Promocionar hace que una publicación aparezca primero en la vitrina y en la búsqueda
                durante unos días, a cambio de una comisión más alta en lo que vendas.{' '}
                <Link href="/vendedor/publicaciones">Elegí una publicación</Link> para ver cuánto te
                costaría la tuya.
              </p>
            </EstadoVacio>
          ) : (
            <>
              <div className={`${estilos.tablero} sup-noche con-grano`}>
                <Cifras
                  cifras={[
                    { valor: String(promociones.length), etiqueta: 'Promociones hechas' },
                    {
                      valor: String(vigentes.length),
                      etiqueta: 'Vigentes ahora',
                      detalle: vigentes.length === 0 ? undefined : 'aparecen primero',
                    },
                    {
                      valor: String(ventas),
                      etiqueta: 'Ventas bajo promoción',
                      detalle: 'con la comisión agravada',
                    },
                  ]}
                />
              </div>

              <Seccion
                titulo="Historial"
                dato={cantidad(promociones.length, 'promoción', 'promociones')}
              >
                <div className={estilos.marcoVentas}>
                  <Tabla titulo="Promociones">
                    <thead>
                      <tr>
                        <th scope="col">Publicación</th>
                        <th scope="col">Estado</th>
                        <th scope="col">Cuándo</th>
                        <EncabezadoNumero>Comisión</EncabezadoNumero>
                        <EncabezadoNumero>Ventas</EncabezadoNumero>
                      </tr>
                    </thead>
                    <tbody>
                      {promociones.map((promocion) => (
                        <tr key={promocion.id}>
                          <td>
                            <p className={estilos.celdaTitulo}>
                              <Link href={`/p/${promocion.listingId}`} className="subraya">
                                {promocion.listingTitle}
                              </Link>
                            </p>
                          </td>
                          <td>
                            {/*
                            ⚠️ TRES ESTADOS DISTINTOS Y CADA UNO DICE ALGO. Vigente
                            es lo único que está costando comisión agravada ahora;
                            "terminada" es normal y "terminada por Offside" no, así
                            que no se pueden mostrar iguales.
                          */}
                            <Etiqueta
                              tono={
                                promocion.vigente
                                  ? 'marca'
                                  : promocion.cancelledAt === null
                                    ? 'neutro'
                                    : 'alerta'
                              }
                            >
                              {promocion.vigente
                                ? 'Vigente'
                                : promocion.cancelledAt === null
                                  ? 'Terminada'
                                  : 'Terminada por Offside'}
                            </Etiqueta>
                          </td>
                          <td>
                            <p className={estilos.celdaMeta}>
                              {fecha(promocion.startsAt)} → {fecha(promocion.endsAt)}
                            </p>
                            <p className={estilos.celdaMeta}>
                              {(() => {
                                const dias = duracionEnDias(promocion.startsAt, promocion.endsAt);

                                return promocion.vigente
                                  ? `Dura ${dias === 1 ? '1 día' : `${dias} días`}`
                                  : `Duró ${dias === 1 ? '1 día' : `${dias} días`}`;
                              })()}
                            </p>
                          </td>
                          <CeldaNumero>{multiplicador(promocion.multiplier)}</CeldaNumero>
                          <CeldaNumero>
                            <strong>{promocion.ventas}</strong>
                          </CeldaNumero>
                        </tr>
                      ))}
                    </tbody>
                  </Tabla>
                </div>
              </Seccion>
            </>
          )}

          <div className={`${estilos.cierre} sup-2 patron-vivo diagonales-vivas`}>
            <p className={estilos.nota}>
              Una promoción no se puede cortar antes de tiempo. La comisión agravada se aplica a las
              órdenes creadas mientras estuvo vigente, y cada orden la congela al crearse: lo
              vendido antes no cambia.
            </p>
          </div>
        </main>
      </PanelDeCuenta>
    </Pantalla>
  );
}
