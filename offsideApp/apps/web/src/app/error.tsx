'use client';

import { BotonEnlace, EstadoVacio } from '@/components/ui';

/**
 * Pantalla de error.
 *
 * ⚠️ TIENE QUE SER CLIENT COMPONENT: Next lo exige porque necesita el
 * `ErrorBoundary` de React, que vive en el cliente. Es la unica excepcion al
 * criterio de mantener todo en el servidor.
 *
 * ⚠️ NO SE MUESTRA `error.message`. Puede arrastrar detalle interno —una
 * consulta, una ruta, el nombre de una tabla— que no le sirve a la persona y sí
 * a quien quiera atacar. El detalle va al log del servidor.
 */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '80px 24px' }}>
      <EstadoVacio titulo="Algo salió mal">
        <p style={{ marginBottom: 24 }}>
          Tuvimos un problema al cargar esta página. Probá de nuevo en un momento.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button
            onClick={reset}
            style={{
              padding: '12px 20px',
              border: '1px solid var(--color-cancha)',
              borderRadius: 'var(--radio)',
              background: 'transparent',
              color: 'var(--color-cancha)',
              cursor: 'pointer',
              font: 'inherit',
              textTransform: 'uppercase',
            }}
          >
            Reintentar
          </button>
          <BotonEnlace href="/">Ir al catálogo</BotonEnlace>
        </div>
      </EstadoVacio>
    </main>
  );
}
