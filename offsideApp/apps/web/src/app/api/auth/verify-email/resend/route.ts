import * as controller from '@/modules/auth/controllers/auth.controller';

/**
 * POST /api/auth/verify-email/resend — reenvía el email de verificación.
 *
 * Sin esto, una cuenta cuyo email nunca llegó queda muerta: no puede ingresar
 * (BR-001) y no había forma de emitir un token nuevo.
 */
export const POST = controller.resendVerification;
