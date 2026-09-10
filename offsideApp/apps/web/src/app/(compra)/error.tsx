'use client';

import { ErrorDePantalla } from '@/components/error-de-pantalla';

/**
 * Limite de error del grupo (compra).
 *
 * ⚠️ VIVE ADENTRO DEL GRUPO PARA QUE EL LAYOUT SOBREVIVA. Con un solo
 * `error.tsx` en la raiz, cualquier fallo aca se llevaba puesta tambien la barra
 * superior y el pie: la persona quedaba en una pantalla sin ninguna forma de
 * seguir navegando.
 *
 * ⚠️ EL `<main id="contenido">` NO ES DECORATIVO Y FALTABA. `ErrorDePantalla`
 * devuelve un `Contenedor`, que es un `<div>`: en el estado de error no habia
 * ningun `<main>`, asi que el enlace "Saltar al contenido" de la barra apuntaba
 * a un ancla inexistente y `body > main { flex: 1 0 auto }` no aplicaba, con lo
 * que el pie se subia a media pantalla.
 */
export default function ErrorDelGrupo({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="contenido">
      <ErrorDePantalla
        titulo="No pudimos cargar tu compra"
        detalle="Tu orden no se perdió: si ya pagaste, el pago sigue su curso y la vas a ver en Mis compras. Probá de nuevo en un momento."
        volverA="/mis-compras"
        textoVolver="Ver mis compras"
        reset={reset}
      />
    </main>
  );
}
