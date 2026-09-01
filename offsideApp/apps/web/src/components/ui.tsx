import type { ButtonHTMLAttributes, ReactNode } from 'react';

import estilos from './ui.module.css';

/**
 * Primitivas de interfaz.
 *
 * Todas son SERVER COMPONENTS: no tienen estado ni manejadores de eventos. Un
 * boton dentro de un `<form>` que apunta a una Server Action funciona sin
 * JavaScript en el cliente, y por eso no necesita `'use client'`.
 */

type VarianteBoton = 'primario' | 'secundario';

export function Boton({
  variante = 'primario',
  bloque = false,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: VarianteBoton;
  bloque?: boolean;
}) {
  const clases = [
    estilos.boton,
    variante === 'primario' ? estilos.botonPrimario : estilos.botonSecundario,
    bloque ? estilos.botonBloque : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={clases} {...props}>
      {children}
    </button>
  );
}

/** Enlace con aspecto de boton. Es un `<a>`, no un `<button>`: navega. */
export function BotonEnlace({
  href,
  variante = 'primario',
  bloque = false,
  children,
}: {
  href: string;
  variante?: VarianteBoton;
  bloque?: boolean;
  children: ReactNode;
}) {
  const clases = [
    estilos.boton,
    variante === 'primario' ? estilos.botonPrimario : estilos.botonSecundario,
    bloque ? estilos.botonBloque : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <a href={href} className={clases}>
      {children}
    </a>
  );
}

export function Etiqueta({ aviso = false, children }: { aviso?: boolean; children: ReactNode }) {
  return (
    <span className={`${estilos.etiqueta} ${aviso ? estilos.etiquetaAviso : ''}`.trim()}>
      {children}
    </span>
  );
}

/**
 * Aviso al usuario.
 *
 * ⚠️ `role="alert"` cuando es un error: hace que los lectores de pantalla lo
 * anuncien al aparecer. Sin eso, alguien que no ve la pantalla no se entera de
 * que su formulario fallo.
 */
export function Aviso({ error = false, children }: { error?: boolean; children: ReactNode }) {
  return (
    <p
      className={`${estilos.aviso} ${error ? estilos.avisoError : ''}`.trim()}
      role={error ? 'alert' : undefined}
    >
      {children}
    </p>
  );
}

export function EstadoVacio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className={estilos.vacio}>
      <p className={estilos.vacioTitulo}>{titulo}</p>
      {children}
    </div>
  );
}
