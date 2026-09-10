'use client';

import { ErrorDePantalla } from '@/components/error-de-pantalla';

import propios from './auth.module.css';

/**
 * Límite de error del grupo (auth).
 *
 * ⚠️ VIVE ADENTRO DEL GRUPO PARA QUE EL LAYOUT SOBREVIVA. Con un solo
 * `error.tsx` en la raíz, cualquier fallo acá se llevaba puesta también la barra
 * superior y el pie: la persona quedaba en una pantalla sin ninguna forma de
 * seguir navegando.
 *
 * ⚠️ ACÁ NO VA UN `<main>`, AL REVÉS QUE EN `(compra)` Y `(admin)`. En esos dos
 * grupos el `<main>` lo pone cada `page.tsx`, así que al reemplazarlo el límite
 * de error se quedaba sin ninguno. Acá lo pone el LAYOUT, que sobrevive: sumar
 * otro daría dos `<main id="contenido">` en la misma pantalla y el enlace de
 * saltar al contenido pasaría a tener dos destinos.
 *
 * ⚠️ EL ENVOLTORIO APAGA EL CANAL Y NO ES DECORACIÓN. `ErrorDePantalla` trae su
 * propio `Contenedor`, que ya paga `--canal`, y cae adentro de `.columna`, que
 * también: a 320px eran 32px de cada lado.
 */
export default function ErrorDelGrupo({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className={propios.limiteDeError}>
      <ErrorDePantalla
        titulo="Algo salió mal"
        detalle="Tu cuenta no se tocó. Probá de nuevo en un momento."
        volverA="/"
        textoVolver="Ir al catálogo"
        reset={reset}
      />
    </div>
  );
}
