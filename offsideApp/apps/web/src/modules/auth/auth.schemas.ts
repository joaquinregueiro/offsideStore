import { getEnv } from '@offside/config';
import { z } from 'zod';

/**
 * Validacion de los inputs del borde (CLAUDE.md §9).
 *
 * La longitud minima de password sale de `AUTH_PASSWORD_MIN_LENGTH`: es un
 * parametro de seguridad operable, no una regla de negocio del marketplace.
 */

const passwordSchema = () => {
  const min = getEnv().AUTH_PASSWORD_MIN_LENGTH;
  return (
    z
      .string()
      .min(min, `La contrasena debe tener al menos ${min} caracteres`)
      // Tope alto: argon2 no tiene el limite de 72 bytes de bcrypt, pero un input
      // sin cota es una via de DoS (hashear megabytes cuesta CPU).
      .max(200, 'La contrasena no puede superar los 200 caracteres')
  );
};

const emailSchema = z
  .string()
  .trim()
  .min(1, 'El email es obligatorio')
  .max(254, 'El email es demasiado largo')
  .pipe(z.email('Email invalido'));

/**
 * BS-002: aceptacion de terminos y politica de privacidad en el alta.
 * Debe ser exactamente `true`; un `false` explicito no alcanza.
 */
const acceptedTermsSchema = z.literal(true, {
  message: 'Tenes que aceptar los terminos y la politica de privacidad',
});

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema(),
  displayName: z.string().trim().min(1).max(120).optional(),
  acceptedTerms: acceptedTermsSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  // En login NO se aplica la politica de longitud: la password guardada pudo
  // crearse con otra politica. Validar de mas aca solo filtraria usuarios
  // legitimos y filtraria informacion sobre la politica.
  password: z.string().min(1, 'La contrasena es obligatoria').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Token requerido'),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token requerido'),
  password: passwordSchema(),
});

/**
 * SS-001 / SS-002: el usuario ya registrado solicita habilitar el rol vendedor
 * y acepta los terminos especificos de vendedor.
 *
 * ⚠️ NO incluye `sellerTierId`: los tiers estan 🟡 sin definir (DEC-037) y la
 * columna es nullable a proposito.
 */
/**
 * Identidad fiscal del vendedor.
 *
 * Solo valida la FORMA del input. La validacion sintactica fina (longitud y
 * digito verificador) la hace `fiscal-identity.service`, y la verificacion
 * contra la fuente oficial es otra cosa todavia.
 */
export const submitTaxIdentitySchema = z.object({
  taxIdType: z.enum(['CUIT', 'CUIL', 'CDI'], {
    message: 'El tipo de identificacion debe ser CUIT, CUIL o CDI',
  }),
  // Se acepta con o sin guiones; el Service lo normaliza.
  taxId: z.string().trim().min(1, 'Ingresa tu numero de identificacion fiscal').max(20),
});
export type SubmitTaxIdentityInput = z.infer<typeof submitTaxIdentitySchema>;

export const createSellerProfileSchema = z.object({
  displayName: z.string().trim().min(1, 'El nombre de tienda es obligatorio').max(120),
  bio: z.string().trim().max(2000).optional(),
  shippingPolicy: z.string().trim().max(2000).optional(),
  acceptedSellerTerms: z.literal(true, {
    message: 'Tenes que aceptar los terminos de vendedor',
  }),
});
export type CreateSellerProfileInput = z.infer<typeof createSellerProfileSchema>;
