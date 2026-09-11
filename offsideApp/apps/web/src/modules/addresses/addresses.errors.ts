import { AuthError } from '../auth/auth.errors';

/**
 * Errores del modulo addresses (BS-020 / BS-070, ERD §6.1).
 *
 * Reutilizan `AuthError` para que el mapa de traduccion a HTTP de `lib/http.ts`
 * siga siendo uno solo y para que las pantallas muestren el mensaje tal cual
 * (`lib/errores.ts` solo muestra el texto de un `AuthError`; cualquier otra
 * clase se convierte en "Tuvimos un problema").
 *
 * ⚠️ LOS CODIGOS SE REUSAN A PROPOSITO, igual que en `listings`: `AuthErrorCode`
 * es una union cerrada que vive en `auth/auth.errors.ts` y este modulo no la
 * puede ampliar. Se eligen los codigos existentes que traducen al HTTP
 * correcto. Cuando `AuthErrorCode` incorpore `ADDRESS_NOT_FOUND` y
 * `ADDRESS_LIMIT_REACHED`, migrar es cambiar el codigo en este archivo.
 */

/**
 * La direccion no existe O no es de quien la pide.
 *
 * ⚠️ UN SOLO ERROR PARA LOS DOS CASOS: distinguirlos permitiria enumerar
 * direcciones ajenas probando ids. Va como `VALIDATION_FAILED` (422) y no
 * como un 404 porque el unico uso es un id que llega desde un formulario
 * —elegir una direccion en el checkout— y ahi el id ES un dato invalido.
 */
export const addressNotFound = (): AuthError =>
  new AuthError('VALIDATION_FAILED', 'Esa dirección no existe');

/** Un campo no tiene la forma esperada. El mensaje dice cual. */
export const addressInvalid = (motivo: string): AuthError =>
  new AuthError('VALIDATION_FAILED', motivo);

/** Cupo de direcciones alcanzado (`MAX_ADDRESSES_PER_USER`). */
export const addressLimitReached = (maximo: number): AuthError =>
  new AuthError(
    'VALIDATION_FAILED',
    `Ya tenés el máximo de ${maximo} direcciones guardadas. Borrá una para agregar otra`,
  );

/**
 * `countries` no tiene la fila de Argentina.
 *
 * `user_addresses.country_id` es FK NOT NULL (ERD §6.1, "default AR") y la fila
 * la carga la migracion `0007`. Que falte es un problema de despliegue, no del
 * usuario: mismo criterio que `SETTING_NOT_CONFIGURED` en config.
 */
export const countryNotSeeded = (): AuthError =>
  new AuthError(
    'SETTING_NOT_CONFIGURED',
    'Falta el país Argentina en el catálogo. Corré las migraciones (0007)',
  );
