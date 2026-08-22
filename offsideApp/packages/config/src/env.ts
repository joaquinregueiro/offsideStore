import { z } from 'zod';

/**
 * Esquema de variables de entorno.
 *
 * Convenciones:
 * - Lo que la app necesita HOY para arrancar es obligatorio.
 * - Lo que pertenece a un modulo todavia no implementado (S3, Mercado Pago,
 *   Correo Argentino, secretos de auth) es opcional aca y se valida cuando ese
 *   modulo se construya. Ver `requireEnv()` mas abajo.
 *
 * Este archivo NO es el Config Store de negocio (DEC-013 / DEC-038). Ver el
 * README del paquete.
 */

const nonEmpty = (label: string) => z.string().min(1, `${label} no puede estar vacio`);

export const appEnvSchema = z.enum(['development', 'test', 'production']);
export type AppEnv = z.infer<typeof appEnvSchema>;

export const envSchema = z.object({
  // --- Aplicacion ---
  APP_ENV: appEnvSchema.default('development'),
  APP_URL: z.url('APP_URL debe ser una URL valida').default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // --- Datos (requeridos para arrancar) ---
  DATABASE_URL: nonEmpty('DATABASE_URL').startsWith(
    'postgres',
    'DATABASE_URL debe ser una connection string de PostgreSQL',
  ),
  REDIS_URL: nonEmpty('REDIS_URL').startsWith(
    'redis',
    'REDIS_URL debe ser una connection string de Redis',
  ),

  // --- S3 (modulo de archivos: no implementado) ---
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),

  // --- Mercado Pago (modulo payments: no implementado) ---
  MERCADOPAGO_CLIENT_ID: z.string().optional(),
  MERCADOPAGO_CLIENT_SECRET: z.string().optional(),
  MERCADOPAGO_ACCESS_TOKEN: z.string().optional(),
  MERCADOPAGO_WEBHOOK_SECRET: z.string().optional(),

  // --- Correo Argentino (modulo shipments: no implementado) ---
  CORREO_ARGENTINO_API_KEY: z.string().optional(),

  // --- Seguridad / auth ---
  /**
   * Pepper con el que se deriva el hash de los tokens de sesion (HMAC-SHA256).
   * Obligatorio para el modulo `auth`; se exige con `requireEnv()` en su borde,
   * no aca, para que el resto del sistema pueda arrancar sin el.
   */
  AUTH_SESSION_SECRET: z.string().optional(),
  TOKEN_ENCRYPTION_KEY: z.string().optional(),

  /**
   * Parametros operables de auth.
   *
   * ⚠️ NO son reglas de negocio del marketplace (comision, ventanas de pago,
   * plazos de refund): esos van al Config Store administrativo y siguen 🟡.
   * Estos son parametros de SEGURIDAD, que `configuration-registry.md` §3
   * agrupa como "parametros de seguridad operables". Viven en entorno para que
   * se cambien sin tocar codigo; si mas adelante se decide gobernarlos desde
   * Admin, se mueven a `app_settings` sin cambiar los Services.
   */
  AUTH_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  AUTH_PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(12),
  AUTH_EMAIL_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(24),
  AUTH_PASSWORD_RESET_TTL_HOURS: z.coerce.number().int().positive().default(1),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Valida un objeto de entorno y devuelve la configuracion tipada.
 *
 * Falla ruidosamente y temprano: si falta algo obligatorio, la app no arranca
 * (CLAUDE.md §9 — validar inputs en el borde, nada de fallos silenciosos).
 */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const detalle = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Configuracion de entorno invalida:\n${detalle}\n\n` +
        'Revisa tu archivo .env (podes partir de .env.example).',
    );
  }

  return result.data;
}

/**
 * Lee una variable opcional que un modulo concreto necesita de forma
 * obligatoria. Se usa en el borde del modulo, no al arrancar la app.
 *
 * @example
 *   const token = requireEnv(env, 'MERCADOPAGO_ACCESS_TOKEN');
 */
export function requireEnv<K extends keyof Env>(env: Env, key: K): NonNullable<Env[K]> {
  const value = env[key];

  if (value === undefined || value === '') {
    throw new Error(
      `La variable de entorno ${String(key)} es obligatoria para esta funcionalidad ` +
        'pero no esta definida. Ver .env.example.',
    );
  }

  return value;
}
