import { NavDeSeccion } from '@/components/ui';

import estilos from './cuenta.module.css';

/** Las nueve pestañas de la cuenta. La clave la pasa cada pantalla. */
export type PestanaDeCuenta =
  | 'resumen'
  | 'compras'
  | 'favoritos'
  | 'reclamos'
  | 'notificaciones'
  | 'preguntas'
  | 'resenas'
  | 'direcciones'
  | 'datos';

/**
 * Navegación del panel del comprador.
 *
 * ⚠️ NO VIVE EN EL LAYOUT, y es por una razón concreta: para marcar la pestaña
 * activa hace falta saber la ruta, y saberla en un layout obliga a
 * `usePathname`, que es un hook. Eso convertiría el layout de la cuenta —y con
 * él la barra y el pie— en Client Component, para resolver algo que cada
 * pantalla ya sabe de sí misma. Cada página pasa su clave y listo.
 *
 * ⚠️ SON ENLACES A URLs DISTINTAS, NO PESTAÑAS CON ESTADO. Cada una se comparte,
 * se guarda en favoritos, vuelve con el botón atrás y anda sin JavaScript.
 *
 * ⚠️ LOS CONTADORES SON OPCIONALES. Las pantallas que ya tienen el número a mano
 * lo pasan; ninguna va a pedir cuatro `COUNT` extra sólo para pintar numeritos
 * en un riel.
 *
 * ⚠️ EL MARCO NO ES DECORACIÓN: ES EL ÚNICO ENGANCHE POSIBLE. `NavDeSeccion` es
 * compartida con el vendedor y el back-office y la clase de su item activo la
 * hashea el CSS Module, así que desde acá no se puede escribir. El marco permite
 * alcanzarla por `[aria-current="page"]` —que es además la señal accesible, o
 * sea que estilo y semántica no pueden desincronizarse— sin tocar el componente
 * ni cambiar cómo se ve en las otras dos secciones.
 */
export function NavDeCuenta({
  activo,
  compras,
  favoritos,
  reclamos,
  sinLeer,
}: {
  activo: PestanaDeCuenta;
  compras?: number;
  favoritos?: number;
  reclamos?: number;
  sinLeer?: number;
}) {
  return (
    <div className={estilos.navMarco}>
      <NavDeSeccion
        etiqueta="Mi cuenta"
        activo={activo}
        items={[
          { clave: 'resumen', texto: 'Resumen', href: '/cuenta' },
          {
            clave: 'compras',
            texto: 'Compras',
            href: '/cuenta/compras',
            ...(compras === undefined ? {} : { dato: compras }),
          },
          {
            clave: 'favoritos',
            texto: 'Favoritos',
            href: '/cuenta/favoritos',
            ...(favoritos === undefined ? {} : { dato: favoritos }),
          },
          {
            clave: 'reclamos',
            texto: 'Reclamos',
            href: '/cuenta/reclamos',
            ...(reclamos === undefined ? {} : { dato: reclamos }),
          },
          {
            clave: 'notificaciones',
            texto: 'Avisos',
            href: '/cuenta/notificaciones',
            ...(sinLeer === undefined ? {} : { dato: sinLeer }),
          },
          { clave: 'preguntas', texto: 'Preguntas', href: '/cuenta/preguntas' },
          /*
           * ⚠️ LA RUTA VA SIN EÑE A PROPÓSITO. Un `ñ` en una URL viaja
           * percent-encoded (`rese%C3%B1as`) y así aparece al copiarla, al
           * compartirla por WhatsApp y en cualquier log. El texto visible sí
           * lleva la eñe, que es lo que se lee.
           */
          { clave: 'resenas', texto: 'Reseñas', href: '/cuenta/resenas' },
          { clave: 'direcciones', texto: 'Direcciones', href: '/cuenta/direcciones' },
          { clave: 'datos', texto: 'Mis datos', href: '/cuenta/datos' },
        ]}
      />
    </div>
  );
}
