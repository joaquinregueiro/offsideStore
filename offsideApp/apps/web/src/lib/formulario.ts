import type { z } from 'zod';

/**
 * Lo que una Server Action le devuelve a un formulario.
 *
 * ⚠️ EL TIPO VIVE ACA Y NO EN `app/(auth)/acciones.ts`. Estaba ahi, y eso hacia
 * que `components/form.tsx` —un componente compartido por los cuatro grupos de
 * rutas— dependiera de UN grupo en particular. Con la dependencia invertida,
 * cualquier accion de cualquier grupo puede devolver el mismo contrato.
 */
export interface EstadoFormulario {
  /** Mensaje general: lo que fallo, en una frase. */
  error?: string;
  /** Confirmacion cuando la accion se queda en la misma pantalla. */
  ok?: string;
  /**
   * Error POR CAMPO, con la clave del `name` del control.
   *
   * ⚠️ ES LO QUE FALTABA PARA QUE UN FORMULARIO LARGO SEA USABLE. Antes se
   * mostraba `issues[0].message` y nada mas: en la pantalla de compra, con seis
   * campos de direccion, "El código postal no es válido" aparecia arriba de
   * todo sin decir cual de los seis era.
   */
  errores?: Record<string, string>;
  /**
   * Lo que la persona habia escrito, para volver a ponerlo.
   *
   * ⚠️ SIN ESTO EL FORMULARIO SE VACIA AL FALLAR. Un codigo postal mal tipeado
   * borraba las seis lineas de direccion, en un telefono. Es el peor momento
   * posible para pedirle a alguien que escriba todo de nuevo: ya decidio
   * comprar.
   *
   * ⚠️ NUNCA INCLUYE CONTRASEÑAS. Quien llama elige que claves preservar, y
   * `valoresDelFormulario` ademas ignora las sensibles: devolverlas al cliente
   * las deja escritas en el HTML de la respuesta.
   */
  valores?: Record<string, string>;
  /** Una salida concreta para el error, cuando la hay. */
  enlace?: { href: string; texto: string };
}

/**
 * Convierte los issues de Zod en un mapa `campo -> mensaje`.
 *
 * ⚠️ SE QUEDA CON EL PRIMER ERROR DE CADA CAMPO, no con todos. Un campo con
 * tres reglas rotas muestra la primera: la lista completa no ayuda a arreglarlo
 * y convierte el formulario en una pared roja.
 */
export function erroresDeZod(error: z.ZodError): Record<string, string> {
  const mapa: Record<string, string> = {};

  for (const issue of error.issues) {
    const campo = issue.path[0];
    if (typeof campo !== 'string') continue;
    if (mapa[campo] !== undefined) continue;

    mapa[campo] = issue.message;
  }

  return mapa;
}

/** Campos cuyo valor NUNCA vuelve al cliente. */
const NUNCA_SE_DEVUELVEN = ['password', 'newPassword', 'token'];

/**
 * Lee del `FormData` los valores que hay que volver a mostrar.
 *
 * ⚠️ TOMA UNA LISTA EXPLICITA DE CLAVES. Devolver todo lo que vino seria
 * devolver tambien lo que no corresponde, y ademas dejaria que un POST directo
 * con campos inventados los haga aparecer en la pantalla siguiente.
 */
export function valoresDelFormulario(
  formData: FormData,
  claves: readonly string[],
): Record<string, string> {
  const valores: Record<string, string> = {};

  for (const clave of claves) {
    if (NUNCA_SE_DEVUELVEN.includes(clave)) continue;

    const valor = formData.get(clave);
    if (typeof valor === 'string' && valor !== '') valores[clave] = valor;
  }

  return valores;
}
