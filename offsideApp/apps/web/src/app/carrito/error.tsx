'use client';

import { ErrorDePantalla } from '@/components/error-de-pantalla';

/**
 * Limite de error del carrito.
 *
 * ⚠️ VIVE ACA PARA QUE EL LAYOUT SOBREVIVA. Con un solo `error.tsx` en la raiz,
 * cualquier fallo del carrito se llevaba puesta tambien la barra superior y el
 * pie: la persona quedaba en una pantalla sin ninguna forma de seguir navegando.
 *
 * ⚠️ EL `<main id="contenido">` NO ES DECORATIVO. `ErrorDePantalla` devuelve un
 * `Contenedor`, que es un `<div>`: sin este `<main>`, el enlace "Saltar al
 * contenido" de la barra apunta a un ancla inexistente y el pie se sube a media
 * pantalla.
 */
export default function ErrorDelCarrito({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="contenido">
      <ErrorDePantalla
        titulo="No pudimos mostrar tu carrito"
        detalle="Lo que guardaste no se perdió: quedó asociado a tu cuenta. Probá de nuevo en un momento."
        volverA="/buscar"
        textoVolver="Seguir mirando camisetas"
        reset={reset}
      />
    </main>
  );
}
