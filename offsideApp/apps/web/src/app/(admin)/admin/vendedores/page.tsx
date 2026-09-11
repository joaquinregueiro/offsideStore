import type { Metadata } from 'next';
import Link from 'next/link';

import { Pantalla } from '@/components/movimiento';
import { Boton, BotonEnlace, EstadoVacio, Etiqueta, Tabla } from '@/components/ui';
import { estadoDeVendedor, fecha, nivelDeUsuario, tonoDeVendedor } from '@/lib/formato';
import { CAPABILITIES } from '@/lib/permissions';
import { requireCapabilitySessionUser } from '@/lib/session';

import { buscarVendedores } from '../../datos';
import { Consola } from '../../consola';
import estilos from '../../admin.module.css';

export const metadata: Metadata = { title: 'Vendedores' };
export const dynamic = 'force-dynamic';

/**
 * Moderación de vendedores (`trust:moderate`, AR-006 "usuarios y suspensiones").
 *
 * ⚠️ NO ES UN LISTADO COMPLETO Y NO DEBE SERLO. Un padrón de todos los
 * vendedores con su email es la pantalla que no conviene tener abierta ni
 * indexada: sin búsqueda se muestran los últimos 25 por alta, que es lo que se
 * mira cuando no se busca a nadie en particular. Es el mismo criterio de la
 * consola de pagos.
 *
 * ⚠️ LA BUSQUEDA VA POR GET. Se comparte con el equipo y anda sin JavaScript.
 * El texto se busca contra el nombre visible y contra el email, que son las dos
 * formas en que llega un caso.
 *
 * ⚠️ NO HAY SERVICE QUE RESUELVA ESTO. `sellers` sólo sabe buscar el perfil
 * PROPIO. La consulta vive en `app/(admin)/datos.ts` y pertenece a un
 * repositorio de `sellers`: reportado.
 */
export default async function Vendedores({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ q }, admin] = await Promise.all([
    searchParams,
    requireCapabilitySessionUser(CAPABILITIES.TRUST_MODERATE, '/admin/vendedores'),
  ]);

  const buscado = q?.trim() ?? '';
  const vendedores = await buscarVendedores(buscado);

  const buscador = (
    <form
      method="get"
      className={buscado === '' ? `${estilos.buscador} ${estilos.buscadorHeroe}` : estilos.buscador}
    >
      <div className={estilos.buscadorCampo}>
        <label htmlFor="q" className={estilos.etiquetaCampo}>
          Nombre del vendedor o email
        </label>
        <input
          id="q"
          name="q"
          className={estilos.control}
          defaultValue={buscado}
          placeholder="camisetasretro o alguien@ejemplo.com"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {/*
        ⚠️ `Boton` ES EL UNICO COMPONENTE DE `ui.tsx` QUE PUEDE VIVIR ADENTRO DE
        LA BANDA OSCURA: lee los ocho tokens `--boton-*` que `.sup-noche`
        cablea. Los demás escriben `--color-tinta` literal.
      */}
      <Boton type="submit" className="presiona">
        Buscar
      </Boton>

      {buscado === '' && (
        <p className={estilos.ayudaBuscador}>
          Sin texto se muestran los <strong>últimos 25</strong> vendedores dados de alta.
        </p>
      )}
    </form>
  );

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Consola rol={admin.adminRole} email={admin.email} activo="vendedores" titulo="Vendedores">
          {buscador}
        </Consola>

        <div className={estilos.hoja}>
          {vendedores.length === 0 ? (
            <EstadoVacio titulo="No encontramos ningún vendedor">
              Probá con parte del nombre visible o con el email completo.
            </EstadoVacio>
          ) : (
            <div className={estilos.historial}>
              <Tabla
                titulo={
                  buscado === ''
                    ? 'Últimos vendedores'
                    : `Vendedores que coinciden con “${buscado}”`
                }
                tituloVisible
              >
                <thead>
                  <tr>
                    <th scope="col">Vendedor</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Nivel de cuenta</th>
                    <th scope="col">Nivel de vendedor</th>
                    <th scope="col">Alta</th>
                  </tr>
                </thead>
                <tbody>
                  {vendedores.map((vendedor) => (
                    <tr key={vendedor.sellerId}>
                      <td>
                        <Link href={`/admin/vendedores/${vendedor.sellerId}`}>
                          {vendedor.displayName}
                        </Link>
                        <span className={estilos.metaFila}>{vendedor.email}</span>
                      </td>
                      <td>
                        <Etiqueta tono={tonoDeVendedor(vendedor.status)}>
                          {estadoDeVendedor(vendedor.status)}
                        </Etiqueta>
                      </td>
                      <td>{nivelDeUsuario(vendedor.userLevel)}</td>
                      <td>{vendedor.tierName ?? 'Sin nivel'}</td>
                      <td>{fecha(vendedor.createdAt.toISOString())}</td>
                    </tr>
                  ))}
                </tbody>
              </Tabla>
            </div>
          )}

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
