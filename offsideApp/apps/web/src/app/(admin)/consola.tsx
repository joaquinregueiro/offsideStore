import type { ReactNode } from 'react';

import { NavDeSeccion, type ItemDeSeccion } from '@/components/ui';
import { rolLegible } from '@/lib/formato';
import { CAPABILITIES, hasCapability, type AdminRole } from '@/lib/permissions';

import estilos from './admin.module.css';

/** Las diez pantallas del back-office. La clave es la que cada `page.tsx` pasa. */
export type SeccionDeAdmin =
  | 'inicio'
  | 'configuracion'
  | 'niveles'
  | 'comision'
  | 'pagos'
  | 'disputas'
  | 'vendedores'
  | 'ordenes'
  | 'reportes'
  | 'ingresos';

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
 * a que las diez pantallas empiecen exactamente igual.
 *
 * ⚠️ EL ROL VA EN TODAS LAS PANTALLAS Y CON EL EMAIL. "ADMIN" no distingue dos
 * cuentas ADMIN: quien tiene dos necesita saber con cual esta parado ANTES de
 * apretar "Confirmar reembolso" o "Suspender vendedor".
 *
 * ⚠️ LA NAVEGACION SE FILTRA POR CAPACIDAD, Y ES CORTESIA, NO SEGURIDAD. Cada
 * pantalla y cada Server Action vuelven a exigir la suya contra el mismo mapa
 * de `lib/permissions.ts`. Esconder una pestaña solo evita llegar a un 404.
 *
 * ⚠️⚠️ AHORA SI SE USA `NavDeSeccion`, Y ESO CIERRA LA DEUDA QUE ESTE ARCHIVO
 * DEJO ANOTADA. No se podia usar porque su item activo escribia
 * `color: var(--color-tinta)` literal —tinta sobre la banda tinta da 1.00:1— y
 * remapear `--color-tinta` en una superficie oscura esta prohibido. La salida
 * que quedo pedida acá es la que el componente implementa hoy: pide el color
 * por variable (`--nav-activo`, `--nav-acento`, `--nav-hover`) con fallback
 * igual al valor de antes, asi que el panel del vendedor no cambio en nada.
 * Esta banda las declara en `.navConsola` (ver `admin.module.css`).
 *
 * Con diez pestañas el argumento se dio vuelta: mantener una copia propia
 * significaba mantener a mano el scroll horizontal, el `aria-current`, el
 * indicador animado y el contador, que es exactamente lo que el componente ya
 * resuelve para el panel del vendedor.
 *
 * ⚠️ ADENTRO DE ESTA BANDA SOLO PUEDE IR `Boton`, `NavDeSeccion` Y MARCADO
 * PROPIO. Los demas componentes de `ui.tsx` escriben `--color-tinta` o
 * `--color-tiempo-extra` literales en su color de texto, asi que sobre un plano
 * oscuro desaparecen.
 */
export function Consola({
  rol,
  email,
  activo,
  titulo,
  pendientes,
  children,
}: {
  rol: AdminRole | null;
  email: string;
  activo: SeccionDeAdmin;
  titulo: string;
  /**
   * Conteos para las pestañas que tienen cola de trabajo.
   *
   * ⚠️ SON OPCIONALES A PROPOSITO: solo el indice los tiene a mano. Ninguna
   * pantalla va a pedir tres `COUNT` de mas para pintar un numerito.
   */
  pendientes?: { disputas?: number; reportes?: number } | undefined;
  /** El buscador de la consola de pagos y el de ordenes. */
  children?: ReactNode;
}) {
  const puedeConfigurar = hasCapability(rol, CAPABILITIES.SYSTEM_CONFIG_MANAGE);
  const puedeReembolsar = hasCapability(rol, CAPABILITIES.PAYMENTS_REFUND);
  const puedeResolver = hasCapability(rol, CAPABILITIES.DISPUTES_RESOLVE);
  const puedeModerar = hasCapability(rol, CAPABILITIES.TRUST_MODERATE);

  const items: ItemDeSeccion[] = [{ clave: 'inicio', texto: 'Inicio', href: '/admin' }];

  if (puedeConfigurar) {
    items.push({ clave: 'configuracion', texto: 'Configuración', href: '/admin/configuracion' });
    items.push({ clave: 'niveles', texto: 'Niveles', href: '/admin/niveles' });
    items.push({ clave: 'comision', texto: 'Comisión', href: '/admin/comision' });
  }

  if (puedeReembolsar) {
    items.push({ clave: 'pagos', texto: 'Pagos', href: '/admin/pagos' });
  }

  if (puedeResolver) {
    items.push({
      clave: 'disputas',
      texto: 'Disputas',
      href: '/admin/disputas',
      ...(pendientes?.disputas === undefined ? {} : { dato: pendientes.disputas }),
    });
  }

  if (puedeModerar) {
    items.push({ clave: 'vendedores', texto: 'Vendedores', href: '/admin/vendedores' });
  }

  if (puedeConfigurar) {
    items.push({ clave: 'ordenes', texto: 'Órdenes', href: '/admin/ordenes' });
  }

  if (puedeModerar) {
    items.push({
      clave: 'reportes',
      texto: 'Reportes',
      href: '/admin/reportes',
      ...(pendientes?.reportes === undefined ? {} : { dato: pendientes.reportes }),
    });
  }

  if (puedeConfigurar) {
    items.push({ clave: 'ingresos', texto: 'Ingresos', href: '/admin/ingresos' });
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

        {/*
          ⚠️ EL MARCO NO ES DECORACION: ES EL ENGANCHE. Las clases de
          `NavDeSeccion` las hashea su propio CSS Module, asi que desde acá no
          se pueden escribir. El marco es donde esta banda declara los tres
          tokens de color que el componente pide, y donde recorta el margen
          inferior que el componente trae pensado para una hoja clara.
        */}
        <div className={estilos.navConsola}>
          <NavDeSeccion items={items} activo={activo} etiqueta="Back-office" />
        </div>

        <h1 className={`display display-3 ${estilos.titulo}`}>{titulo}</h1>
        <hr className={estilos.filete} aria-hidden="true" />

        {children}
      </div>
    </div>
  );
}
