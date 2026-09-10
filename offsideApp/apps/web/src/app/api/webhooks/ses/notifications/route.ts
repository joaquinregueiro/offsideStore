import * as controller from '@/modules/notifications/controllers/ses-webhook.controller';

/**
 * POST /api/webhooks/ses/notifications — rebotes y quejas de Amazon SES,
 * publicados por SNS.
 *
 * ⚠️ Esta URL es la que se suscribe al topic de SNS. Se autentica por FIRMA y
 * por `TopicArn`, no por sesion: SNS no manda credenciales.
 */
export const POST = controller.webhook;
