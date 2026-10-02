/**
 * EL TEMA DEL SITIO: CLARO, FIJO.
 *
 * ⚠️ NO HAY ELECCION, POR DECISION DEL DUEÑO (2026-10-02). Hubo un modo oscuro
 * con interruptor en la barra y en el pie; se saco el interruptor y el sitio
 * quedo en claro para todos.
 *
 * ⚠️ EL ATRIBUTO SE ESCRIBE IGUAL, Y ES LO QUE LO HACE FIJO. `tokens.css` todavia
 * tiene los dos bloques del oscuro: uno por `@media (prefers-color-scheme:
 * dark)` y otro por `[data-tema='oscuro']`. El del sistema operativo esta
 * guardado con `:root:not([data-tema='claro'])`, asi que con
 * `data-tema="claro"` en el `<html>` **ninguno de los dos aplica**, aunque quien
 * mira tenga el telefono en oscuro. Sin el atributo, ese telefono veria oscuro.
 *
 * ⚠️ LOS BLOQUES OSCUROS SE CONSERVAN, DORMIDOS. Volver a ofrecer el oscuro es
 * cambiar este valor y devolver el interruptor; `check:tema` sigue verificando
 * que los dos bloques digan lo mismo para que ese dia no haya sorpresas.
 */
export const TEMA_DEL_SITIO = 'claro' as const;

/** El atributo que va en el `<html>`. */
export function atributoDeTema(): { 'data-tema': typeof TEMA_DEL_SITIO } {
  return { 'data-tema': TEMA_DEL_SITIO };
}
