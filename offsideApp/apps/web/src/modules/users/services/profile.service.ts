import * as audit from '../../audit/services/audit.service';
import type { PublicUser } from '../../auth/services/auth.service';
import * as profileRepo from '../repositories/user-profile.repository';
import * as errors from '../users.errors';

/**
 * Perfil de la cuenta: lo que la persona elige mostrar (ERD §2).
 *
 * ⚠️ ESTE SERVICE NO EXISTIA Y POR ESO `/cuenta/datos` ERA DE SOLO LECTURA. La
 * pantalla lo decia con todas las letras: "está en solo lectura porque no
 * existe la acción para editarla, no porque se haya decidido que no se edite".
 * Escribir la mutacion desde la pantalla habria salteado el dominio y dejado
 * SIN AUDITAR un cambio de identidad.
 *
 * ⚠️ ALCANCE: SOLO EL NOMBRE VISIBLE. Lo que sigue sin poder cambiarse desde
 * aca, y por que:
 *
 *  - **El email** es la credencial de ingreso y el destino de los tokens de
 *    verificacion y de reset. Cambiarlo pide reverificar la direccion nueva
 *    ANTES de soltar la vieja —si no, un typo deja la cuenta muerta— y decidir
 *    que pasa con las sesiones abiertas. Es trabajo de `auth`, no un UPDATE.
 *  - **La baja de cuenta** depende de DEC-011 (modelo fiscal, 🔴 REQUIERE
 *    ASESORAMIENTO PROFESIONAL) y del regimen de datos personales: hay ordenes,
 *    pagos y comprobantes con obligaciones de conservacion. No se implementa
 *    desde el codigo (CLAUDE.md §7).
 *  - **`users.username`** existe en el ERD con UNIQUE parcial y nadie lo
 *    asigna. Habilitarlo pide decidir reserva de nombres, palabras prohibidas y
 *    que pasa al liberarlo; nada de eso esta documentado.
 */

const ENTITY_TYPE = 'user';

/**
 * Tope del nombre visible.
 *
 * `users.display_name` es `text` sin limite en el ERD, asi que el techo lo pone
 * la app. Sesenta alcanza para un nombre y un apellido largos y evita que la
 * bandeja de ventas del vendedor —que muestra este nombre para despachar— se
 * rompa con un parrafo.
 */
export const TOPE_NOMBRE_VISIBLE = 60;

/** Minimo util. Una sola letra no identifica a nadie ante quien despacha. */
export const MINIMO_NOMBRE_VISIBLE = 2;

/**
 * Normaliza el nombre visible tal como llega de un formulario.
 *
 * ⚠️ VACIO ES `null`, NO `''`. El ERD deja la columna anulable para decir "no
 * cargó ninguno", y la pantalla ya muestra "Sin nombre cargado" para ese caso.
 * Una cadena vacia seria un tercer valor con el mismo significado, y encima se
 * veria como un hueco en la bandeja de ventas.
 */
export function normalizarNombreVisible(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;

  const limpio = valor.trim().replace(/\s+/g, ' ');

  return limpio === '' ? null : limpio.slice(0, TOPE_NOMBRE_VISIBLE);
}

/**
 * Cambia el nombre visible de la cuenta.
 *
 * ⚠️ SE AUDITA, Y NO ES CELO BUROCRATICO. Este nombre es lo que ve un vendedor
 * cuando tiene que despachar y lo que ve un comprador en una pregunta: cambiarlo
 * es una operacion de identidad, no una preferencia de interfaz. `audit_log` es
 * append-only (ERD §19.1), asi que queda el valor anterior Y el nuevo.
 *
 * ⚠️ VACIARLO ES UNA OPERACION VALIDA. Quien cargo su nombre real y se
 * arrepiente tiene que poder sacarlo; obligarlo a dejar algo lo empuja a poner
 * un nombre falso, que es peor para quien despacha.
 *
 * Devuelve el nombre ya normalizado, que es lo que quedo guardado.
 */
export async function updateDisplayName(
  user: PublicUser,
  nombre: string | null,
): Promise<string | null> {
  const nuevo = normalizarNombreVisible(nombre);

  if (nuevo !== null && nuevo.length < MINIMO_NOMBRE_VISIBLE) {
    throw errors.displayNameTooShort(MINIMO_NOMBRE_VISIBLE);
  }

  // Sin cambio no se escribe ni se audita: guardar dos veces lo mismo llenaria
  // `audit_log` de filas que no cuentan ninguna historia.
  if (nuevo === user.displayName) return nuevo;

  await profileRepo.updateDisplayName(user.id, nuevo);

  await audit.record({
    actorType: 'user',
    actorId: user.id,
    action: 'USER_DISPLAY_NAME_UPDATED',
    entityType: ENTITY_TYPE,
    entityId: user.id,
    before: { displayName: user.displayName },
    after: { displayName: nuevo },
  });

  return nuevo;
}
