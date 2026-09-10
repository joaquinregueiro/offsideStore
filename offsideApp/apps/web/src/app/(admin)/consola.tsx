import type { ReactNode } from 'react';
import Link from 'next/link';

import { rolLegible } from '@/lib/formato';
import { CAPABILITIES, hasCapability, type AdminRole } from '@/lib/permissions';

import estilos from './admin.module.css';

interface Pestania {
  clave: string;
  texto: string;
  href: string;
}

/**
 * Banda de contexto del back-office.
 *
 * ⚠️ EXISTE PORQUE EL PANEL SE PARECIA AL RESTO DEL SITIO, y la version
 * anterior lo decia con todas las letras sin llegar a resolverlo: era un `<p>`
 * con fondo tinta de 20px de alto arriba del titulo. Ahora es una superficie
 * oscura a sangre que no se puede confundir con una pantalla publica ni de
 * reojo.
 *
 * ⚠️ EL `<h1>` VIVE ACA ADENTRO, Y ES DELIBERADO. Un titulo de operaciones en
 * el mismo plano que los datos es un `<h1>` de CRUD; sobre el plano oscuro,
 * junto al rol y a la navegacion, es la cabecera de una consola. Ademas obliga
 * a que las tres pantallas empiecen exactamente igual.
 *
 * ⚠️ EL ROL VA EN LAS TRES PANTALLAS Y CON EL EMAIL. Hasta hoy el rol salia en
 * la bajada de `/admin` y desaparecia en comision y en pagos, que es justo
 * donde se opera. Y "ADMIN" no distingue dos cuentas ADMIN: quien tiene dos
 * necesita saber con cual esta parado ANTES de apretar "Confirmar reembolso".
 *
 * ⚠️ LA NAVEGACION SE FILTRA POR CAPACIDAD, Y ES CORTESIA, NO SEGURIDAD. Cada
 * pantalla y cada Server Action vuelven a exigir la suya contra el mismo mapa
 * de `lib/permissions.ts`. Esconder una pestaña solo evita llegar a un 404.
 *
 * ⚠️ NO SE USA `NavDeSeccion` Y NO ES DUPLICACION GRATUITA. Su item activo
 * declara `color: var(--color-tinta)` literal, y esta banda ES `--color-tinta`.
 * Remapear `--color-tinta` en una superficie oscura esta prohibido por el
 * sistema visual, y cambiar el componente tocaria `app/(vendedor)/nav.tsx`, que
 * es su otro uso. 🟡 La salida de fondo —indireccionar el componente con
 * `--nav-activo` / `--nav-acento` y fallbacks iguales a los valores de hoy—
 * queda pedida en `admin.module.css`.
 *
 * ⚠️ ADENTRO DE ESTA BANDA SOLO PUEDE IR `Boton` Y MARCADO PROPIO. Los demas
 * componentes de `ui.tsx` escriben `--color-tinta` o `--color-tiempo-extra`
 * literales en su color de texto, asi que sobre un plano oscuro desaparecen.
 */
export function Consola({
  rol,
  email,
  activo,
  titulo,
  children,
}: {
  rol: AdminRole | null;
  email: string;
  activo: 'inicio' | 'comision' | 'pagos';
  titulo: string;
  /** El buscador de la consola de pagos. Ninguna otra pantalla lo usa. */
  children?: ReactNode;
}) {
  const pestanias: Pestania[] = [{ clave: 'inicio', texto: 'Inicio', href: '/admin' }];

  if (hasCapability(rol, CAPABILITIES.SYSTEM_CONFIG_MANAGE)) {
    pestanias.push({ clave: 'comision', texto: 'Comisión', href: '/admin/comision' });
  }

  if (hasCapability(rol, CAPABILITIES.PAYMENTS_REFUND)) {
    pestanias.push({ clave: 'pagos', texto: 'Pagos y reembolsos', href: '/admin/pagos' });
  }

  return (
    <div className={`${estilos.consola} sup-noche con-grano`}>
      {/*
        Rombos de la bandera, estaticos y en la mitad derecha. Van en un span
        propio porque `sup-noche` ya usa `::before` (el filo de luz) y
        `con-grano` usa `::after`.
      */}
      <span className={estilos.rombos} aria-hidden="true" />

      <div className={estilos.consolaCentro}>
        <div className={estilos.consolaEncabezado}>
          <p className={estilos.marcaConsola}>Back-office</p>
          <p className={estilos.identidad}>
            Operando como <strong>{rolLegible(rol)}</strong> · <strong>{email}</strong>
          </p>
        </div>

        <nav className={estilos.navConsola} aria-label="Back-office">
          <ul className={estilos.navConsolaLista}>
            {pestanias.map((pestania) => {
              const esActivo = pestania.clave === activo;

              return (
                <li key={pestania.clave}>
                  {/*
                    ⚠️ `barrido` Y NO `avanza`/`retrocede`. Entre las pestañas de
                    una consola no hay adentro ni atras: son hermanas, y un
                    deslizamiento con direccion mentiria sobre la jerarquia.
                  */}
                  <Link
                    href={pestania.href}
                    className={esActivo ? estilos.navConsolaActivo : estilos.navConsolaItem}
                    aria-current={esActivo ? 'page' : undefined}
                    transitionTypes={['barrido']}
                  >
                    {pestania.texto}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <h1 className={`display display-3 ${estilos.titulo}`}>{titulo}</h1>
        <hr className={estilos.filete} aria-hidden="true" />

        {children}
      </div>
    </div>
  );
}
