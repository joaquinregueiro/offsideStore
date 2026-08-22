/**
 * Identidad fiscal: normalizacion y validacion SINTACTICA del identificador.
 *
 * ⚠️ ALCANCE ESTRICTO. Este servicio responde una sola pregunta:
 *
 *     "¿este numero puede ser un identificador fiscal argentino valido?"
 *
 * NO responde "¿existe?" ni "¿cual es la condicion fiscal?". Eso es la
 * verificacion contra la fuente oficial, que vive en `fiscal-source/` y todavia
 * no esta integrada.
 *
 * No conoce HTTP, ni la base, ni comisiones.
 */

export type TaxIdType = 'CUIT' | 'CUIL' | 'CDI';

export const TAX_ID_TYPES: readonly TaxIdType[] = ['CUIT', 'CUIL', 'CDI'];

export type SyntaxValidationError =
  'EMPTY' | 'INVALID_CHARACTERS' | 'INVALID_LENGTH' | 'INVALID_CHECK_DIGIT';

export type SyntaxValidationResult =
  { valid: true; normalized: string } | { valid: false; error: SyntaxValidationError };

/** Longitud del identificador: 2 de prefijo + 8 de numero + 1 verificador. */
const TAX_ID_LENGTH = 11;

/**
 * Pesos del calculo del digito verificador (modulo 11), aplicados a los
 * primeros 10 digitos. Es el mismo algoritmo para CUIT, CUIL y CDI.
 */
const CHECK_DIGIT_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

/**
 * Normaliza el identificador: deja SOLO los digitos.
 *
 * "20-12345678-3" → "20123456783"
 *
 * Se guarda normalizado para que el mismo identificador no pueda entrar dos
 * veces escrito distinto. El formateo con guiones es responsabilidad de la UI.
 */
export function normalizeTaxId(raw: string): string {
  return raw.replace(/\D/g, '');
}

/** Enmascara el identificador para logs y mensajes de error. */
export function maskTaxId(taxId: string): string {
  const digits = normalizeTaxId(taxId);
  if (digits.length < 4) return '***';
  return `${digits.slice(0, 2)}${'*'.repeat(digits.length - 4)}${digits.slice(-2)}`;
}

/**
 * Calcula el digito verificador de los primeros 10 digitos.
 *
 * Algoritmo de modulo 11 usado por CUIT/CUIL/CDI:
 *   suma = Σ digito[i] × peso[i]
 *   resto = suma mod 11
 *   resto 0 → 0 · resto 1 → 9 · en otro caso → 11 − resto
 */
export function calculateCheckDigit(first10Digits: string): number {
  let sum = 0;
  for (let i = 0; i < CHECK_DIGIT_WEIGHTS.length; i++) {
    sum += Number(first10Digits[i]) * CHECK_DIGIT_WEIGHTS[i]!;
  }

  const remainder = sum % 11;
  if (remainder === 0) return 0;
  if (remainder === 1) return 9;
  return 11 - remainder;
}

export function isValidTaxIdType(value: unknown): value is TaxIdType {
  return typeof value === 'string' && (TAX_ID_TYPES as readonly string[]).includes(value);
}

/**
 * Valida el identificador y lo devuelve normalizado.
 *
 * Comprueba, en este orden: no vacio · solo digitos · 11 digitos · digito
 * verificador.
 *
 * ⚠️ NO valida el PREFIJO contra el `tax_id_type`. Es deliberado: la
 * correspondencia entre prefijos (20/23/24/27/30/33/34/…) y tipo no esta
 * definida en la documentacion del proyecto, y una tabla inventada rechazaria
 * identificadores legitimos. Se valida solo lo que es demostrablemente
 * incorrecto.
 */
export function validateTaxIdSyntax(rawTaxId: string): SyntaxValidationResult {
  const trimmed = rawTaxId.trim();
  if (trimmed === '') return { valid: false, error: 'EMPTY' };

  // Se rechaza cualquier caracter que no sea digito, espacio, guion o punto:
  // "20-12345678-3" es aceptable, "20-ABCDEFGH-3" no.
  if (/[^\d\s.-]/.test(trimmed)) return { valid: false, error: 'INVALID_CHARACTERS' };

  const normalized = normalizeTaxId(trimmed);
  if (normalized.length !== TAX_ID_LENGTH) return { valid: false, error: 'INVALID_LENGTH' };

  const expected = calculateCheckDigit(normalized.slice(0, 10));
  if (Number(normalized[10]) !== expected) {
    return { valid: false, error: 'INVALID_CHECK_DIGIT' };
  }

  return { valid: true, normalized };
}
