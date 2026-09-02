'use client';

import { useActionState } from 'react';
import type { ReactNode } from 'react';

import type { EstadoFormulario } from '@/app/(auth)/acciones';

import estilos from './form.module.css';
import { Aviso, Boton } from './ui';

/**
 * Formulario con Server Action.
 *
 * ⚠️ ES CLIENT COMPONENT, y es la excepcion necesaria: `useActionState` es un
 * hook. Pero el formulario **sigue funcionando sin JavaScript**: sin JS el
 * navegador hace el POST nativo y el servidor responde con la pagina; con JS,
 * React se queda en la pagina y muestra el error sin recargar. Es progressive
 * enhancement de verdad, no una promesa.
 *
 * ⚠️ El estado `pending` deshabilita el boton: sin eso, un doble clic manda dos
 * altas o dos logins.
 */
export function Formulario({
  accion,
  enviar,
  children,
}: {
  accion: (estado: EstadoFormulario, formData: FormData) => Promise<EstadoFormulario>;
  enviar: string;
  children: ReactNode;
}) {
  const [estado, action, pending] = useActionState(accion, {});

  return (
    <form action={action} className={estilos.formulario} noValidate>
      {estado.error !== undefined && <Aviso error>{estado.error}</Aviso>}
      {estado.ok !== undefined && <Aviso>{estado.ok}</Aviso>}

      {children}

      <Boton type="submit" bloque disabled={pending}>
        {pending ? 'Enviando…' : enviar}
      </Boton>
    </form>
  );
}

/**
 * Campo con etiqueta.
 *
 * ⚠️ La etiqueta usa `htmlFor` contra el `id` del control: sin esa asociacion,
 * un lector de pantalla no sabe que texto corresponde a que campo, y hacer clic
 * en la etiqueta no enfoca el campo.
 */
export function Campo({
  nombre,
  etiqueta,
  tipo = 'text',
  ayuda,
  requerido = true,
  autoComplete,
  defaultValue,
}: {
  nombre: string;
  etiqueta: string;
  tipo?: string;
  ayuda?: string;
  requerido?: boolean;
  autoComplete?: string;
  defaultValue?: string;
}) {
  const idAyuda = ayuda === undefined ? undefined : `${nombre}-ayuda`;

  return (
    <div className={estilos.campo}>
      <label htmlFor={nombre} className={estilos.etiqueta}>
        {etiqueta}
      </label>
      <input
        id={nombre}
        name={nombre}
        type={tipo}
        className={estilos.control}
        required={requerido}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        aria-describedby={idAyuda}
      />
      {ayuda !== undefined && (
        <span id={idAyuda} className={estilos.ayuda}>
          {ayuda}
        </span>
      )}
    </div>
  );
}

/**
 * Casilla de verificacion.
 *
 * La etiqueta ENVUELVE al control y ademas lo referencia con `htmlFor`.
 * Envolver ya alcanza —verificado en el navegador: `input.labels` devuelve la
 * etiqueta correcta—, pero la asociacion explicita sobrevive a que alguien
 * reordene el marcado mas adelante.
 */
export function Casilla({ nombre, children }: { nombre: string; children: ReactNode }) {
  return (
    <label className={estilos.casilla} htmlFor={nombre}>
      <input type="checkbox" id={nombre} name={nombre} required />
      <span>{children}</span>
    </label>
  );
}

/** Opcion de un `Seleccion`. `valor` es lo que viaja; `etiqueta` lo que se lee. */
export interface Opcion {
  valor: string;
  etiqueta: string;
}

/**
 * Lista desplegable.
 *
 * ⚠️ SIN OPCION VACIA CUANDO ES REQUERIDA. Un `<select required>` cuyo primer
 * item ya es valido nunca puede quedar sin elegir, que es lo que queremos para
 * campos como la condicion. Cuando el campo es opcional —`vacio`— la primera
 * opcion vale cadena vacia y el Server Action la trata como ausente.
 */
export function Seleccion({
  nombre,
  etiqueta,
  opciones,
  vacio,
  ayuda,
  defaultValue,
}: {
  nombre: string;
  etiqueta: string;
  opciones: Opcion[];
  vacio?: string;
  ayuda?: string;
  // `| undefined` explicito: con `exactOptionalPropertyTypes` un opcional NO
  // acepta que le pasen `undefined` a proposito, y quien arma la lista puede
  // no tener todavia un valor por defecto.
  defaultValue?: string | undefined;
}) {
  const idAyuda = ayuda === undefined ? undefined : `${nombre}-ayuda`;

  return (
    <div className={estilos.campo}>
      <label htmlFor={nombre} className={estilos.etiqueta}>
        {etiqueta}
      </label>
      <select
        id={nombre}
        name={nombre}
        className={estilos.control}
        defaultValue={defaultValue}
        aria-describedby={idAyuda}
      >
        {vacio !== undefined && <option value="">{vacio}</option>}
        {opciones.map((opcion) => (
          <option key={opcion.valor} value={opcion.valor}>
            {opcion.etiqueta}
          </option>
        ))}
      </select>
      {ayuda !== undefined && (
        <span id={idAyuda} className={estilos.ayuda}>
          {ayuda}
        </span>
      )}
    </div>
  );
}

/** Campo de texto largo: bio, politica de envios, descripcion. */
export function AreaDeTexto({
  nombre,
  etiqueta,
  ayuda,
  requerido = false,
  filas = 4,
  defaultValue,
}: {
  nombre: string;
  etiqueta: string;
  ayuda?: string;
  requerido?: boolean;
  filas?: number;
  defaultValue?: string;
}) {
  const idAyuda = ayuda === undefined ? undefined : `${nombre}-ayuda`;

  return (
    <div className={estilos.campo}>
      <label htmlFor={nombre} className={estilos.etiqueta}>
        {etiqueta}
      </label>
      <textarea
        id={nombre}
        name={nombre}
        rows={filas}
        className={estilos.control}
        required={requerido}
        defaultValue={defaultValue}
        aria-describedby={idAyuda}
      />
      {ayuda !== undefined && (
        <span id={idAyuda} className={estilos.ayuda}>
          {ayuda}
        </span>
      )}
    </div>
  );
}

/** Valor que viaja con el formulario sin que la persona lo vea ni lo edite. */
export function CampoOculto({ nombre, valor }: { nombre: string; valor: string }) {
  return <input type="hidden" name={nombre} value={valor} />;
}
