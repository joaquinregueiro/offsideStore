import * as errors from '../listings.errors';

/**
 * Envio DECLARADO por el vendedor (`listings.shipping_mode` /
 * `shipping_cost_amount`, delta al ERD del 2026-09-10 §11). Reglas puras.
 *
 * Correo Argentino no existe, asi que no hay cotizacion (SH-011) y
 * `shipping.md` §5.b deja "quien paga" y "retiro presencial" 🟡: lo unico que
 * puede saber el comprador es lo que quien vende declara. El importe se
 * CONGELA en `orders.shipping_amount` al crear la orden (DEC-030), igual que
 * el precio (BR-023): cambiarlo despues no toca ordenes existentes.
 */

export const SHIPPING_MODES = ['included', 'buyer_pays', 'to_agree', 'pickup'] as const;

export type ShippingMode = (typeof SHIPPING_MODES)[number];

export function isShippingMode(valor: unknown): valor is ShippingMode {
  return typeof valor === 'string' && (SHIPPING_MODES as readonly string[]).includes(valor);
}

/**
 * Etiqueta legible de cada modo. Es texto visible: con tildes.
 *
 * Vive aca y no en la pantalla para que la vitrina, la ficha y la busqueda
 * digan exactamente lo mismo.
 */
const ETIQUETAS: Readonly<Record<ShippingMode, string>> = {
  included: 'Envío incluido en el precio',
  buyer_pays: 'Envío a cargo del comprador',
  to_agree: 'Envío a convenir con el vendedor',
  pickup: 'Retiro en persona',
};

export function shippingModeLabel(mode: ShippingMode): string {
  return ETIQUETAS[mode];
}

/** Lo minimo que hace falta de una publicacion para describir su envio. */
export interface ShippingOfListing {
  shippingMode: string;
  shippingCostAmount: bigint | null;
}

/** Como se expone el envio en vitrina, ficha, busqueda y panel: siempre igual. */
export interface ShippingSummary {
  shippingMode: ShippingMode;
  /** Centavos como string, solo con `buyer_pays`. */
  shippingCostAmount: string | null;
  /** Texto visible. Con `buyer_pays` NO incluye el importe: lo formatea la pantalla. */
  shippingLabel: string;
}

/**
 * Resumen publico del envio de una publicacion.
 *
 * ⚠️ TOLERA UNA FILA VIEJA. `shipping_mode` es `text` con CHECK, asi que en la
 * practica siempre es uno de los cuatro; pero si alguien lo toco por SQL, se
 * cae a `to_agree` —el DEFAULT de la columna— en vez de romper la vitrina.
 */
export function shippingSummaryFor(listing: ShippingOfListing): ShippingSummary {
  const modo: ShippingMode = isShippingMode(listing.shippingMode)
    ? listing.shippingMode
    : 'to_agree';

  return {
    shippingMode: modo,
    shippingCostAmount:
      modo === 'buyer_pays' && listing.shippingCostAmount !== null
        ? listing.shippingCostAmount.toString()
        : null,
    shippingLabel: ETIQUETAS[modo],
  };
}

/** Lo que el vendedor declara. Los dos opcionales: se completan con el default. */
export interface ShippingDeclarationInput {
  /**
   * ⚠️ ES `string` Y NO `ShippingMode`, A PROPOSITO. Este valor viene de un
   * `<select>`: en el borde es texto que alguien pudo escribir a mano en un
   * POST directo. Tiparlo como el union obligaria a validarlo ANTES de
   * llamar a la unica funcion que existe para validarlo, y esa validacion
   * duplicada es la que un dia se olvida. `validateShippingDeclaration`
   * rechaza cualquier cosa que no sea un modo conocido.
   */
  shippingMode?: string | null | undefined;
  /** Centavos. `null` = no aplica. */
  shippingCostAmount?: bigint | null | undefined;
}

/** Lo que se guarda, ya validado. */
export interface ShippingDeclaration {
  shippingMode: ShippingMode;
  shippingCostAmount: bigint | null;
}

/** Los dos parametros ⚙️ del Config Store que gobiernan la declaracion. */
export interface ShippingSettings {
  /** `shipping_default_mode`: modo al publicar si el vendedor no elige. */
  defaultMode: ShippingMode;
  /** `shipping_pickup_allowed`: si `pickup` se ofrece como opcion. */
  pickupAllowed: boolean;
  /**
   * `shipping_to_agree_allowed`: si el vendedor puede ELEGIR `to_agree`.
   *
   * ⚠️ ASUMIDO (2026-09-11): la clave NO esta sembrada en `app_settings` ni
   * definida en el registro de `config`; si no existe se toma `false`. Ver
   * `validateShippingDeclaration` para por que eso no rompe el default.
   */
  toAgreeAllowed: boolean;
}

/**
 * Los modos que el vendedor puede elegir con esta configuracion.
 *
 * ⚠️ EL MODO POR DEFECTO SIEMPRE ESTA PERMITIDO, y no es una excepcion
 * comoda: `shipping_default_mode` esta sembrado como `to_agree` y
 * `shipping_to_agree_allowed` no existe (=> `false`). Leido al pie de la
 * letra, publicar sin elegir modo —que cae al default— se rechazaria por el
 * mismo Config Store que lo eligio. Un administrador que fijo un modo como
 * default lo habilito; lo que las dos perillas gobiernan es lo que el
 * vendedor puede elegir ADEMAS del default.
 */
export function allowedShippingModes(settings: ShippingSettings): ShippingMode[] {
  return SHIPPING_MODES.filter(
    (modo) =>
      modo === settings.defaultMode ||
      ((modo === 'pickup' ? settings.pickupAllowed : true) &&
        (modo === 'to_agree' ? settings.toAgreeAllowed : true)),
  );
}

/**
 * Valida y normaliza la declaracion de envio.
 *
 * `actual` es lo que la publicacion ya tiene (al editar); `undefined` al
 * publicar. Un campo ausente en `input` conserva el actual —o el default del
 * Config Store si no hay actual—, para que corregir un typo en el titulo no
 * pise el envio, que es el mismo bug que ya tuvieron los catalogos.
 *
 * Reglas:
 *  - `buyer_pays` EXIGE `shippingCostAmount > 0`: un envio "a cargo del
 *    comprador" sin importe no le dice nada a nadie, y en cero es `included`.
 *  - Los otros tres modos NO llevan importe: se normaliza a `null`, y si el
 *    vendedor mando uno se rechaza en vez de guardarlo en silencio (seria un
 *    dato que ninguna pantalla muestra y que la orden podria cobrar por error).
 *  - `pickup` solo si el Config Store lo habilita.
 *
 * ⚠️ SE VALIDA EN LA APP Y NO CON UN CHECK, a proposito (delta §11): en un
 * mismo formulario el modo puede cambiar antes que el importe y un CHECK
 * cruzado rechazaria estados intermedios legitimos de un UPDATE parcial.
 */
export function validateShippingDeclaration(
  input: ShippingDeclarationInput,
  settings: ShippingSettings,
  actual?: ShippingDeclaration,
): ShippingDeclaration {
  const modo = input.shippingMode ?? actual?.shippingMode ?? settings.defaultMode;

  if (!isShippingMode(modo)) throw errors.invalidShippingMode();

  // Al EDITAR, conservar el modo que ya tenia nunca se rechaza: si Admin
  // apago `pickup` despues de que alguien lo eligio, corregir un typo en el
  // titulo no puede fallar por un campo que no se toco. Lo que se gobierna es
  // ELEGIR el modo, y eso solo pasa cuando viene en el input.
  const loEligeAhora = input.shippingMode !== undefined && input.shippingMode !== null;

  if (loEligeAhora && !allowedShippingModes(settings).includes(modo)) {
    if (modo === 'pickup') throw errors.pickupNotAllowed();
    if (modo === 'to_agree') throw errors.toAgreeNotAllowed();
  }

  // Si el modo cambia, el importe anterior deja de tener sentido: solo se
  // hereda cuando el modo se mantiene.
  const heredado = actual?.shippingMode === modo;
  const importe =
    input.shippingCostAmount === undefined
      ? heredado
        ? actual.shippingCostAmount
        : null
      : input.shippingCostAmount;

  if (modo === 'buyer_pays') {
    if (importe === null || importe <= 0n) throw errors.shippingCostRequired();

    return { shippingMode: modo, shippingCostAmount: importe };
  }

  if (importe !== null && importe !== 0n) throw errors.shippingCostNotApplicable();

  return { shippingMode: modo, shippingCostAmount: null };
}

/**
 * Cuanto se le cobra al comprador de envio por ESTA publicacion, en centavos.
 *
 * Es lo que `orders` congela en `shipping_amount` al crear la orden
 * (DEC-030). Solo `buyer_pays` suma; el resto es cero, porque o ya esta en el
 * precio, o se arregla afuera de la plataforma, o no hay envio.
 *
 * ⚠️ NO multiplica por cantidad: el vendedor declara un costo por ENVIO, no
 * por unidad, y una orden es un solo envio (DEC-026: una orden, un vendedor).
 */
export function shippingAmountFor(listing: {
  shippingMode: string;
  shippingCostAmount: bigint | null;
}): bigint {
  if (listing.shippingMode !== 'buyer_pays') return 0n;

  return listing.shippingCostAmount ?? 0n;
}
