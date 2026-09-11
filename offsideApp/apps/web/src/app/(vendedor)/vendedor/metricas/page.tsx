import type { Metadata } from 'next';
import Link from 'next/link';

import { IconoEtiqueta } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import {
  CeldaNumero,
  Cifras,
  EncabezadoNumero,
  EstadoVacio,
  Seccion,
  Tabla,
} from '@/components/ui';
import { cantidad, precio } from '@/lib/formato';
import { requireSellerSessionUser } from '@/lib/session';
import { PanelDeCuenta, SolapasDeCuenta } from '../../../(cuenta)/panel';
import { listMySales } from '@/modules/orders/services/order.service';

import { Chapa } from '../../chapa';
import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Mis métricas' };
export const dynamic = 'force-dynamic';

/** Cuántos meses se dibujan. Más que esto deja de ser una lectura y es un reporte. */
const MESES = 12;

/** Cuántas publicaciones entran en el top sin volverse un inventario. */
const TOP = 10;

const NOMBRES_DE_MES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** `2026-09` → `septiembre 2026`. La clave ordena; el nombre se lee. */
function nombreDelMes(clave: string): string {
  const [anio, mes] = clave.split('-');
  const indice = Number(mes) - 1;

  return `${NOMBRES_DE_MES[indice] ?? mes} ${anio}`;
}

/**
 * Métricas del vendedor.
 *
 * ⚠️ SOLO CUENTAN LAS ORDENES `COMPLETED`, y no es una elección estética: es la
 * misma regla con la que se calculan el nivel y la reputación (BR-051). Si esta
 * pantalla contara las órdenes en curso, el vendedor vería un número más alto
 * acá que en `/vendedor/nivel` y ninguno de los dos sería creíble.
 *
 * ⚠️ TODO SE SUMA CON `BigInt`. Los importes viajan como string de centavos
 * justamente para no perder precisión; `precio()` recién convierte al final,
 * para dibujar. El ticket promedio se divide en centavos enteros: dividir dos
 * `Number` de centavos reintroduce el problema que el resto del sistema evita
 * con cuidado.
 *
 * ⚠️ SE CALCULA EN MEMORIA SOBRE `listMySales`, Y ESO TIENE TECHO. Para un
 * vendedor con decenas de órdenes es correcto y es una sola consulta; con
 * miles, agrupar por mes y por publicación pertenece a SQL —un `GROUP BY` en el
 * repositorio de `orders`—. Queda anotado como faltante: mover el cálculo no
 * cambia ninguna de las cifras de esta pantalla.
 */
export default async function MisMetricas() {
  const user = await requireSellerSessionUser('/vendedor/metricas');

  const ventas = await listMySales(user);
  const completadas = ventas.filter((venta) => venta.status === 'COMPLETED');

  const moneda = completadas[0]?.currency ?? ventas[0]?.currency ?? 'ARS';

  const facturado = completadas.reduce((suma, venta) => suma + BigInt(venta.totalAmount), 0n);
  const neto = completadas.reduce((suma, venta) => suma + BigInt(venta.sellerAmount), 0n);
  const comision = completadas.reduce((suma, venta) => suma + BigInt(venta.commissionAmount), 0n);

  const ticket = completadas.length === 0 ? 0n : facturado / BigInt(completadas.length);

  /*
   * ⚠️ EL MES SE SACA DE `completedAt` Y NO DE `createdAt`. Una orden creada en
   * agosto y cerrada en septiembre es una venta de septiembre: es la fecha en la
   * que la plata quedó firme. Si faltara, se cae a `paidAt` y por último a la
   * creación, para no descartar la fila.
   */
  const porMes = new Map<string, { ordenes: number; facturado: bigint; neto: bigint }>();

  for (const venta of completadas) {
    const iso = venta.completedAt ?? venta.paidAt ?? venta.createdAt;
    const momento = new Date(iso);
    const clave = `${momento.getFullYear()}-${String(momento.getMonth() + 1).padStart(2, '0')}`;

    const actual = porMes.get(clave) ?? { ordenes: 0, facturado: 0n, neto: 0n };

    porMes.set(clave, {
      ordenes: actual.ordenes + 1,
      facturado: actual.facturado + BigInt(venta.totalAmount),
      neto: actual.neto + BigInt(venta.sellerAmount),
    });
  }

  const meses = [...porMes.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, MESES);

  /*
   * ⚠️ SE AGRUPA POR `listingId` PERO SE MUESTRA EL TITULO CONGELADO DE LA ORDEN
   * (DEC-030). El id es lo único estable; el título de la publicación de hoy
   * puede haber cambiado, y el de la orden dice qué se vendió realmente.
   */
  const porPublicacion = new Map<string, { titulo: string; unidades: number; facturado: bigint }>();

  for (const venta of completadas) {
    for (const item of venta.items) {
      const actual = porPublicacion.get(item.listingId) ?? {
        titulo: item.title,
        unidades: 0,
        facturado: 0n,
      };

      porPublicacion.set(item.listingId, {
        titulo: actual.titulo,
        unidades: actual.unidades + item.quantity,
        facturado: actual.facturado + BigInt(item.unitPriceAmount) * BigInt(item.quantity),
      });
    }
  }

  const top = [...porPublicacion.entries()]
    .sort((a, b) => (b[1].facturado > a[1].facturado ? 1 : -1))
    .slice(0, TOP);

  // Para dibujar la barra de cada mes sin inventar una escala: el mes más alto.
  const maximo = meses.reduce(
    (mayor, [, dato]) => (dato.facturado > mayor ? dato.facturado : mayor),
    1n,
  );

  return (
    <Pantalla>
      <PanelDeCuenta user={user} seccion="publicaciones">
        <main id="contenido">
          <Chapa
            rotulo="Publicaciones"
            titulo="Mis métricas"
            chica
            detalle={
              <p className={estilos.chapaDetalle}>
                Sobre tus {cantidad(completadas.length, 'venta completada', 'ventas completadas')}.
              </p>
            }
          />

          <SolapasDeCuenta user={user} seccion="publicaciones" activa="metricas" />

          {completadas.length === 0 ? (
            <EstadoVacio
              titulo="Todavía no hay nada que medir"
              icono={<IconoEtiqueta tamanio={40} />}
            >
              <p>
                Acá van a aparecer tus ventas por mes, el ticket promedio y qué publicaciones se
                venden más. Sólo cuentan las órdenes completadas: las que están en curso todavía
                pueden cancelarse. <Link href="/vendedor/ventas">Ver tus ventas</Link>
              </p>
            </EstadoVacio>
          ) : (
            <>
              <div className={`${estilos.tablero} sup-noche con-grano`}>
                <Cifras
                  cifras={[
                    {
                      valor: precio(facturado.toString(), moneda),
                      etiqueta: 'Facturado',
                      detalle: 'lo que pagaron los compradores',
                    },
                    {
                      valor: precio(neto.toString(), moneda),
                      etiqueta: 'Te quedó',
                      detalle: 'antes del costo de Mercado Pago',
                    },
                    {
                      valor: precio(ticket.toString(), moneda),
                      etiqueta: 'Ticket promedio',
                      detalle: cantidad(completadas.length, 'orden', 'órdenes'),
                    },
                    {
                      valor: precio(comision.toString(), moneda),
                      etiqueta: 'Comisión de Offside',
                    },
                  ]}
                />
              </div>

              <Seccion titulo="Por mes">
                <div className={estilos.marcoVentas}>
                  <Tabla titulo="Ventas por mes">
                    <thead>
                      <tr>
                        <th scope="col">Mes</th>
                        <EncabezadoNumero>Órdenes</EncabezadoNumero>
                        <EncabezadoNumero>Facturado</EncabezadoNumero>
                        <EncabezadoNumero>Te quedó</EncabezadoNumero>
                      </tr>
                    </thead>
                    <tbody>
                      {meses.map(([clave, dato]) => (
                        <tr key={clave}>
                          <td>
                            <p className={estilos.celdaTitulo}>{nombreDelMes(clave)}</p>
                            {/*
                            ⚠️ LA BARRA ES FORMA Y VA `aria-hidden`: los tres
                            números de la fila son el dato. Sirve para comparar
                            doce meses de un vistazo sin dividir mentalmente, y la
                            escala es el mes más alto, no un máximo inventado.
                          */}
                            <span
                              className={estilos.barraMes}
                              style={{
                                width: `${Number((dato.facturado * 100n) / maximo)}%`,
                              }}
                              aria-hidden="true"
                            />
                          </td>
                          <CeldaNumero>{dato.ordenes}</CeldaNumero>
                          <CeldaNumero>{precio(dato.facturado.toString(), moneda)}</CeldaNumero>
                          <CeldaNumero>
                            <strong>{precio(dato.neto.toString(), moneda)}</strong>
                          </CeldaNumero>
                        </tr>
                      ))}
                    </tbody>
                  </Tabla>
                </div>
              </Seccion>

              <Seccion titulo="Lo que más se vendió">
                <div className={estilos.marcoVentas}>
                  <Tabla titulo="Publicaciones más vendidas">
                    <thead>
                      <tr>
                        <th scope="col">Publicación</th>
                        <EncabezadoNumero>Unidades</EncabezadoNumero>
                        <EncabezadoNumero>Facturado</EncabezadoNumero>
                      </tr>
                    </thead>
                    <tbody>
                      {top.map(([listingId, dato]) => (
                        <tr key={listingId}>
                          <td>
                            <p className={estilos.celdaTitulo}>
                              <Link href={`/p/${listingId}`} className="subraya">
                                {dato.titulo}
                              </Link>
                            </p>
                          </td>
                          <CeldaNumero>{dato.unidades}</CeldaNumero>
                          <CeldaNumero>
                            <strong>{precio(dato.facturado.toString(), moneda)}</strong>
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
              Sólo se cuentan las órdenes completadas, que son las mismas que miran tu nivel y tu
              reputación. Las que están en curso no aparecen acá porque todavía pueden cancelarse.
              Los importes son el snapshot de cada orden: cambiar un precio hoy no mueve ningún
              número de esta pantalla.
            </p>
          </div>
        </main>
      </PanelDeCuenta>
    </Pantalla>
  );
}
