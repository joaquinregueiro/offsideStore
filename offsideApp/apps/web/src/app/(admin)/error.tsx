'use client';

import { ErrorDePantalla } from '@/components/error-de-pantalla';

import estilos from './admin.module.css';

/**
 * Límite de error del grupo (admin).
 *
 * ⚠️ VIVE ADENTRO DEL GRUPO PARA QUE EL LAYOUT SOBREVIVA. Con un solo
 * `error.tsx` en la raíz, cualquier fallo acá se llevaba puesta también la barra
 * superior y el pie: la persona quedaba en una pantalla sin ninguna forma de
 * seguir navegando.
 *
 * ⚠️ AHORA CONSERVA LA BANDA DE CONTEXTO, Y ES EL ARREGLO DE ESTE ARCHIVO. La
 * única señal de que se está adentro del back-office desaparecía exactamente
 * cuando algo falla —que es cuando más importa saber dónde se está parado y qué
 * NO se ejecutó—. Se dibuja acá con marcado propio y no con `<Consola>`: este es
 * un Client Component sin sesión, así que no hay rol, ni email, ni capacidades
 * para filtrar pestañas. Prometer una navegación que no puede saber si existe
 * sería peor que no ponerla.
 *
 * ⚠️ SE AGREGA EL `<main id="contenido">` QUE FALTABA. Sin él, el enlace de
 * saltar al contenido de la barra apunta a un ancla que no existe en esta
 * pantalla, y el pie deja de quedar pegado abajo (`body > main` es quien empuja).
 */
export default function ErrorDelGrupo({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="contenido" className={estilos.pagina}>
      <div className={`${estilos.consola} sup-noche con-grano`}>
        <span className={estilos.rombos} aria-hidden="true" />
        <div className={estilos.consolaCentro}>
          <p className={estilos.marcaConsola}>Back-office</p>
        </div>
      </div>

      <ErrorDePantalla
        titulo="No pudimos cargar esta pantalla"
        detalle="La operación que ibas a hacer no se ejecutó. Probá de nuevo antes de asumir cualquier otra cosa."
        volverA="/admin"
        textoVolver="Volver al back-office"
        reset={reset}
      />
    </main>
  );
}
