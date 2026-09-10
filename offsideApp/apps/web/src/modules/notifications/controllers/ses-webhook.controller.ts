import { NextResponse } from 'next/server';

import { getEnv } from '@offside/config';

import { firmaValida, snsMessageSchema } from '@/lib/sns-signature';

import * as suppressionService from '../services/email-suppression.service';

/**
 * Webhook de SNS por el que Amazon SES publica rebotes y quejas.
 *
 * Sin reglas de negocio: autentica, interpreta el sobre de SNS y delega.
 *
 * =============================================================================
 * ⚠️ ESTE ENDPOINT ES PUBLICO Y NO TIENE SESION
 * =============================================================================
 *
 * Se autentica por FIRMA, igual que el webhook de Mercado Pago. Sin eso,
 * cualquiera que descubra la URL podria postear un rebote falso con la
 * direccion de otra persona y dejar esa cuenta sin recibir email nunca mas: no
 * hace falta robar nada, solo saber un email ajeno.
 *
 * HAY DOS PUERTAS INDEPENDIENTES, y el ORDEN entre ellas importa:
 *
 *  1. **El `TopicArn` esperado.** Va PRIMERO a proposito. Verificar la firma
 *     puede obligar a DESCARGAR el certificado, y esa descarga la dispara un
 *     desconocido: sin este filtro, repetir el POST con URLs de certificado
 *     distintas convierte al endpoint en un generador de trafico saliente. El
 *     ARN no viaja en ningun lado publico, asi que frena eso antes de gastar.
 *  2. **La firma criptografica**, en `lib/sns-signature.ts`.
 *
 * ⚠️ NO TIENE RATE LIMIT, y es deliberado. El trabajo por request esta acotado
 * y es barato —un verify RSA con el certificado ya cacheado—, y limitarlo por
 * IP descartaria rafagas legitimas de SNS, que entrega desde muchas IPs. Lo
 * caro queda detras de las dos puertas.
 */

/** SNS reintenta ante cualquier respuesta que no sea 2xx. */
const ACEPTADO = { received: true };

/**
 * ⚠️ SIEMPRE 200 CUANDO EL MENSAJE ES LEGITIMO, aunque no hagamos nada con el.
 * Un `Delivery`, o una queja `not-spam`, no suprimen nada y NO son un error:
 * responder 4xx haria que SNS reintentara el mismo mensaje durante dias.
 */
export async function webhook(request: Request): Promise<NextResponse> {
  const arnEsperado = getEnv().SES_SNS_TOPIC_ARN;

  if (arnEsperado === undefined || arnEsperado === '') {
    // No configurado. Se rechaza en vez de aceptar cualquier topic, y se avisa
    // fuerte: un webhook que acepta sin poder validar es peor que no tenerlo.
    console.error('[ses-webhook] SES_SNS_TOPIC_ARN no esta configurado: se rechaza la entrega');

    return NextResponse.json({ error: 'NOT_CONFIGURED' }, { status: 503 });
  }

  let cuerpo: unknown;

  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const parseado = snsMessageSchema.safeParse(cuerpo);

  if (!parseado.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  const mensaje = parseado.data;

  // Puerta 1. Antes que la firma, para no descargar certificados a pedido de
  // cualquiera.
  if (mensaje.TopicArn !== arnEsperado) {
    console.error('[ses-webhook] mensaje de un topic inesperado, rechazado');

    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  // Puerta 2.
  if (!(await firmaValida(mensaje))) {
    console.error(`[ses-webhook] firma invalida en el mensaje ${mensaje.MessageId}, rechazado`);

    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  switch (mensaje.Type) {
    case 'SubscriptionConfirmation':
      await confirmarSuscripcion(mensaje.SubscribeURL);
      return NextResponse.json(ACEPTADO);

    case 'UnsubscribeConfirmation':
      // Alguien desuscribio el endpoint. No hay nada que hacer por codigo, pero
      // dejar de recibir rebotes en silencio es exactamente lo que no queremos.
      console.warn('[ses-webhook] el endpoint fue desuscripto del topic de SES');
      return NextResponse.json(ACEPTADO);

    case 'Notification':
      return procesarNotificacion(mensaje.Message, mensaje.MessageId);
  }
}

/**
 * Confirma la suscripcion visitando la `SubscribeURL`.
 *
 * ⚠️ ES UNA PETICION SALIENTE A UNA URL QUE VIENE EN EL MENSAJE, asi que se
 * valida el host antes de tocarla. Llega aca sólo despues de que el ARN y la
 * firma dieron bien, pero eso no alcanza por si solo: la regla es no hacer
 * jamas un fetch a una URL de un payload sin comprobar a donde apunta.
 */
async function confirmarSuscripcion(subscribeUrl: string | undefined): Promise<void> {
  if (subscribeUrl === undefined) {
    console.error('[ses-webhook] confirmacion de suscripcion sin SubscribeURL');
    return;
  }

  if (!urlDeSns(subscribeUrl)) {
    console.error('[ses-webhook] SubscribeURL con un host inesperado, no se confirma');
    return;
  }

  try {
    const respuesta = await fetch(subscribeUrl);

    console.warn(
      `[ses-webhook] suscripcion confirmada (HTTP ${respuesta.status}). ` +
        'A partir de ahora llegan los rebotes.',
    );
  } catch (error) {
    console.error(
      '[ses-webhook] no se pudo confirmar la suscripcion:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** HTTPS y un host de SNS. Sin exigir `.pem`, que es cosa del certificado. */
function urlDeSns(url: string): boolean {
  try {
    const parsed = new URL(url);

    return (
      parsed.protocol === 'https:' &&
      /^sns\.[a-zA-Z0-9-]{3,}\.amazonaws\.com(\.cn)?$/.test(parsed.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * El contenido de SES viaja como TEXTO JSON dentro de `Message`.
 *
 * Es una particularidad del sobre de SNS: `Message` es un string, no un objeto.
 * Parsearlo mal seria descartar todos los rebotes sin que nadie se entere.
 */
async function procesarNotificacion(message: string, messageId: string): Promise<NextResponse> {
  let contenido: unknown;

  try {
    contenido = JSON.parse(message);
  } catch {
    console.error(`[ses-webhook] el Message de ${messageId} no es JSON`);

    // 200: el mensaje es legitimo y reintentarlo daria igual.
    return NextResponse.json(ACEPTADO);
  }

  const resultado = await suppressionService.processFeedback(contenido);

  if (!resultado.reconocida) {
    console.warn(`[ses-webhook] notificacion ${messageId} con una forma no reconocida`);
  }

  return NextResponse.json({ ...ACEPTADO, suppressed: resultado.suprimidas });
}
