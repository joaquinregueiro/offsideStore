'use client';

import { ErrorDePantalla } from '@/components/error-de-pantalla';

/**
 * Límite de error del grupo (vendedor).
 *
 * ⚠️ VIVE ADENTRO DEL GRUPO PARA QUE EL LAYOUT SOBREVIVA. Con un solo
 * `error.tsx` en la raíz, cualquier fallo acá se llevaba puesta también la barra
 * superior y el pie: la persona quedaba en una pantalla sin ninguna forma de
 * seguir navegando.
 */
export default function ErrorDelGrupo({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorDePantalla
      titulo="No pudimos cargar tu panel"
      detalle="Nada de lo que publicaste se tocó. Probá de nuevo; si sigue pasando, no es cosa tuya."
      volverA="/vendedor"
      textoVolver="Volver al panel"
      reset={reset}
    />
  );
}
