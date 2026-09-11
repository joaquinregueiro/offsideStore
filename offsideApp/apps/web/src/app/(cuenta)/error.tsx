'use client';

import { ErrorDePantalla } from '@/components/error-de-pantalla';

/**
 * Limite de error del grupo (cuenta).
 *
 * ⚠️ VIVE ADENTRO DEL GRUPO PARA QUE EL LAYOUT SOBREVIVA. Con un solo
 * `error.tsx` en la raiz, un fallo en el detalle de un reclamo se llevaba
 * puesta tambien la barra superior y el pie: la persona quedaba en una pantalla
 * sin ninguna forma de seguir navegando.
 *
 * ⚠️ EL `<main id="contenido">` NO ES DECORATIVO. `ErrorDePantalla` devuelve un
 * `Contenedor`, que es un `<div>`: sin el `<main>` el enlace "Saltar al
 * contenido" de la barra apunta a un ancla inexistente y `body > main` no
 * aplica, con lo que el pie se sube a media pantalla.
 *
 * ⚠️ EL TEXTO NO PROMETE QUE NO SE PERDIO NADA EN GENERAL, dice lo unico que es
 * verdad: esto es una pantalla de lectura y lo que ya paso —una compra, un
 * reclamo— vive en la base, no en esta pagina.
 */
export default function ErrorDelGrupo({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="contenido">
      <ErrorDePantalla
        titulo="No pudimos cargar tu cuenta"
        detalle="Nada de lo tuyo se perdió: tus compras, tus reclamos y tus favoritos siguen guardados. Probá de nuevo en un momento."
        volverA="/cuenta"
        textoVolver="Volver a mi cuenta"
        reset={reset}
      />
    </main>
  );
}
