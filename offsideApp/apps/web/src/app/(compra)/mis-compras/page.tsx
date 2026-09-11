import { permanentRedirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * `/mis-compras` se mudo a `/cuenta/compras`.
 *
 * ⚠️ LA PANTALLA NO SE BORRA, SE REDIRIGE, y no es cortesia: esta URL esta en el
 * historial de todo el que compro, en la barra superior y en los emails y
 * avisos que ya se mandaron. Borrarla convierte cada uno de esos enlaces en un
 * 404 sobre la pantalla donde la gente va a buscar la plata que gasto.
 *
 * ⚠️ ES UN 308 (`permanentRedirect`) Y NO UN 307. El contenido se mudo para
 * siempre: con el permanente, el navegador y los buscadores dejan de pedir la
 * vieja. Un temporal haria que la redireccion se repita indefinidamente.
 *
 * ⚠️ NO SE EXIGE SESION ACA. El guard vive en la pantalla destino: pedir login
 * para despues redirigir mandaria a `/ingresar?next=/mis-compras` y, al volver,
 * a otra redireccion. Quien no tenga sesion la va a pedir `/cuenta/compras`, que
 * es la URL que corresponde conservar.
 */
export default function MisCompras(): never {
  permanentRedirect('/cuenta/compras');
}
