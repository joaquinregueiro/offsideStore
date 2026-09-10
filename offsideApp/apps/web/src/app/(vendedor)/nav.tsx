import { NavDeSeccion } from '@/components/ui';

import estilos from './vendedor.module.css';

/**
 * Navegación del panel del vendedor.
 *
 * ⚠️ NO VIVE EN EL LAYOUT, Y ES POR UNA RAZON CONCRETA: para marcar el item
 * activo hace falta saber la ruta, y saberla en un layout obliga a
 * `usePathname`, que es un hook. Eso convertiría el layout del vendedor —y con
 * él todo lo que envuelve— en Client Component, para resolver algo que cada
 * pantalla ya sabe de sí misma. Cada página pasa su clave y listo.
 *
 * ⚠️ LOS CONTADORES SON OPCIONALES. Las pantallas que ya los tienen a mano los
 * pasan; las que no, no van a pedir dos `COUNT` extra sólo para pintar un
 * numerito en una pestaña.
 *
 * ⚠️ EL MARCO NO ES DECORACION: ES EL UNICO ENGANCHE POSIBLE. `NavDeSeccion` es
 * compartida con el back-office y la clase de su item activo la hashea el CSS
 * Module, así que desde acá no se puede escribir. El marco permite alcanzarla
 * por `[aria-current="page"]` —que es además la señal accesible, o sea que
 * estilo y semántica no pueden desincronizarse— sin tocar el componente ni
 * cambiar cómo se ve en el back-office.
 */
export function NavDelVendedor({
  activo,
  publicaciones,
  ventas,
}: {
  activo: 'panel' | 'publicaciones' | 'ventas' | 'mercadopago' | 'fiscal';
  publicaciones?: number;
  ventas?: number;
}) {
  return (
    <div className={estilos.navMarco}>
      <NavDeSeccion
        etiqueta="Panel de vendedor"
        activo={activo}
        items={[
          { clave: 'panel', texto: 'Panel', href: '/vendedor' },
          {
            clave: 'publicaciones',
            texto: 'Publicaciones',
            href: '/vendedor/publicaciones',
            ...(publicaciones === undefined ? {} : { dato: publicaciones }),
          },
          {
            clave: 'ventas',
            texto: 'Ventas',
            href: '/vendedor/ventas',
            ...(ventas === undefined ? {} : { dato: ventas }),
          },
          { clave: 'mercadopago', texto: 'Mercado Pago', href: '/vendedor/mercadopago' },
          { clave: 'fiscal', texto: 'Identidad fiscal', href: '/vendedor/fiscal' },
        ]}
      />
    </div>
  );
}
