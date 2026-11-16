import type { ReactNode } from 'react';

/**
 * Envoltorios que antes animaban la navegacion.
 *
 * ⚠️ DESDE EL 2026-11-06 NO HAY TRANSICIONES ENTRE PANTALLAS: el sitio cambia de
 * pantalla de una. Los componentes quedan como paso directo porque los usan unas
 * sesenta pantallas y no cambian nada del dibujo.
 */
export function Pantalla({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function LlegaContenido({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function SeVaElEsqueleto({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
