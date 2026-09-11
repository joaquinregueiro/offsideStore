import { NavDeSeccion, type ItemDeSeccion } from '@/components/ui';

import estilos from './vendedor.module.css';

/** Las once pantallas del panel. La clave es la que cada página pasa como `activo`. */
export type SeccionDelVendedor =
  | 'panel'
  | 'publicaciones'
  | 'ventas'
  | 'preguntas'
  | 'reputacion'
  | 'nivel'
  | 'promociones'
  | 'tienda'
  | 'vacaciones'
  | 'metricas'
  | 'mercadopago'
  | 'fiscal';

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
 * ⚠️ ONCE ITEMS NO ENTRAN EN UN TELEFONO, Y POR ESO EL RIEL SE DESLIZA DE
 * COSTADO (`overflow-x` propio en `.navMarco`, ver el CSS). Sin eso el que
 * scrollea de lado es el documento entero: la barra superior se corre, el pie
 * se corre, y el sitio parece roto. La alternativa —plegarlos en un menú—
 * escondería detrás de un clic las nueve pantallas que el vendedor usa todos
 * los días.
 *
 * ⚠️ EL ORDEN NO ES ALFABETICO NI CASUAL: primero lo que se mira todos los días
 * (panel, inventario, ventas), después lo que contesta gente (preguntas),
 * después lo que mide (reputación, nivel, métricas), y al final la
 * configuración de la cuenta, que se toca una vez. "Identidad fiscal" queda
 * último a propósito: es el único que, una vez resuelto, no se vuelve a abrir.
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
  preguntas,
  reclamos,
}: {
  activo: SeccionDelVendedor;
  publicaciones?: number;
  ventas?: number;
  /** Preguntas sin responder. Es la única pestaña que pide una acción. */
  preguntas?: number;
  /** Reclamos abiertos. Se muestra sobre "Ventas": el reclamo vive en la orden. */
  reclamos?: number;
}) {
  /*
   * ⚠️ EL DATO SE ARMA POR SPREAD Y NO CON UN TERNARIO A `undefined`. Con
   * `exactOptionalPropertyTypes` una prop opcional NO acepta que le pasen
   * `undefined` a propósito, y `NavDeSeccion` ya ignora los ceros.
   */
  const dato = (n: number | undefined): Pick<ItemDeSeccion, 'dato'> =>
    n === undefined ? {} : { dato: n };

  const items: ItemDeSeccion[] = [
    { clave: 'panel', texto: 'Panel', href: '/vendedor' },
    {
      clave: 'publicaciones',
      texto: 'Publicaciones',
      href: '/vendedor/publicaciones',
      ...dato(publicaciones),
    },
    {
      clave: 'ventas',
      texto: 'Ventas',
      href: '/vendedor/ventas',
      ...dato(ventas ?? reclamos),
    },
    { clave: 'preguntas', texto: 'Preguntas', href: '/vendedor/preguntas', ...dato(preguntas) },
    { clave: 'reputacion', texto: 'Reputación', href: '/vendedor/reputacion' },
    { clave: 'nivel', texto: 'Nivel', href: '/vendedor/nivel' },
    { clave: 'promociones', texto: 'Promociones', href: '/vendedor/promociones' },
    { clave: 'metricas', texto: 'Métricas', href: '/vendedor/metricas' },
    { clave: 'tienda', texto: 'Tienda', href: '/vendedor/tienda' },
    { clave: 'vacaciones', texto: 'Vacaciones', href: '/vendedor/vacaciones' },
    { clave: 'mercadopago', texto: 'Mercado Pago', href: '/vendedor/mercadopago' },
    { clave: 'fiscal', texto: 'Identidad fiscal', href: '/vendedor/fiscal' },
  ];

  return (
    <div className={estilos.navMarco}>
      <NavDeSeccion etiqueta="Panel de vendedor" activo={activo} items={items} />
    </div>
  );
}
