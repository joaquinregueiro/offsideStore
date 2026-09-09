import { getDatabase, schema } from '@offside/database';
import { like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as SuppressionService from './services/email-suppression.service';
import type * as EmailService from './services/email.service';

/**
 * Tests de integracion de la lista de supresion, contra PostgreSQL REAL.
 *
 * Se testea contra la base y no con un doble porque lo que hay que demostrar
 * son propiedades del ESQUEMA: que el UNIQUE hace idempotente al upsert y que
 * `citext` compara sin distinguir mayusculas. Un repositorio simulado diria que
 * si a las dos cosas sin probar ninguna.
 *
 * LIMPIEZA: todas las direcciones usan el sufijo `@itest.offside`.
 */

const SUFIJO = '@itest.offside';
const email = (n: string) => `${n}${SUFIJO}`;

let suppressionService: typeof SuppressionService;
let emailService: typeof EmailService;

/** Usuario que hace de administrador para la FK `released_by`. */
let adminId: string;

beforeAll(async () => {
  const { loadRootEnv } = await import('@offside/config');
  loadRootEnv(import.meta.dirname);

  suppressionService = await import('./services/email-suppression.service');
  emailService = await import('./services/email.service');

  await limpiar();

  const [admin] = await getDatabase()
    .insert(schema.users)
    .values({ email: email('admin-supresion') })
    .returning({ id: schema.users.id });

  adminId = admin!.id;
});

afterAll(async () => {
  await limpiar();
});

async function limpiar() {
  const db = getDatabase();

  // Las supresiones primero: `released_by` referencia al usuario con RESTRICT.
  await db
    .delete(schema.emailSuppressions)
    .where(like(schema.emailSuppressions.email, `%${SUFIJO}`));
  await db.delete(schema.users).where(like(schema.users.email, `%${SUFIJO}`));
}

/** Notificacion de rebote duro, con la forma que manda SES. */
function reboteDuro(direccion: string) {
  return {
    notificationType: 'Bounce',
    mail: { messageId: 'mensaje-de-prueba' },
    bounce: {
      bounceType: 'Permanent',
      bounceSubType: 'General',
      bouncedRecipients: [{ emailAddress: direccion }],
    },
  };
}

describe('lista de supresion', () => {
  it('una direccion que rebota duro deja de recibir', async () => {
    const direccion = email('rebota');

    expect(await suppressionService.isSuppressed(direccion)).toBe(false);

    const resultado = await suppressionService.processFeedback(reboteDuro(direccion));

    expect(resultado).toEqual({ suprimidas: 1, reconocida: true });
    expect(await suppressionService.isSuppressed(direccion)).toBe(true);
  });

  it('⚠️ la misma notificacion dos veces no duplica ni falla', async () => {
    // SNS reintenta y entrega desordenado, igual que los webhooks de Mercado
    // Pago. Con un INSERT a secas la segunda entrega reventaria contra el
    // UNIQUE, el endpoint devolveria un error y SNS reintentaria para siempre.
    const direccion = email('repetida');

    await suppressionService.processFeedback(reboteDuro(direccion));
    await suppressionService.processFeedback(reboteDuro(direccion));

    const filas = await getDatabase()
      .select()
      .from(schema.emailSuppressions)
      .where(like(schema.emailSuppressions.email, direccion));

    expect(filas).toHaveLength(1);
  });

  it('⚠️ compara sin distinguir mayusculas', async () => {
    // `citext`, igual que `users.email`. SES devuelve la direccion como venia en
    // el mensaje original, que puede no coincidir en capitalizacion con la que
    // guardamos: comparando sensible al caso la supresion no encontraria nunca
    // al usuario y el email se seguiria mandando.
    const direccion = email('MayUsculas');

    await suppressionService.processFeedback(reboteDuro(direccion));

    expect(await suppressionService.isSuppressed(direccion.toLowerCase())).toBe(true);
    expect(await suppressionService.isSuppressed(direccion.toUpperCase())).toBe(true);
  });

  it('guarda el payload crudo del proveedor', async () => {
    // Mismo criterio que DEC-035 con Mercado Pago: se conserva lo que dijo el
    // tercero ademas de nuestra interpretacion.
    const direccion = email('crudo');
    await suppressionService.processFeedback(reboteDuro(direccion));

    const [fila] = await getDatabase()
      .select()
      .from(schema.emailSuppressions)
      .where(like(schema.emailSuppressions.email, direccion));

    expect(fila?.raw).toMatchObject({ notificationType: 'Bounce' });
    expect(fila?.providerSubtype).toBe('General');
    expect(fila?.providerMessageId).toBe('mensaje-de-prueba');
  });

  it('un rebote blando no suprime nada', async () => {
    const direccion = email('blando');

    const resultado = await suppressionService.processFeedback({
      notificationType: 'Bounce',
      mail: { messageId: 'x' },
      bounce: {
        bounceType: 'Transient',
        bounceSubType: 'MailboxFull',
        bouncedRecipients: [{ emailAddress: direccion }],
      },
    });

    expect(resultado.suprimidas).toBe(0);
    expect(await suppressionService.isSuppressed(direccion)).toBe(false);
  });
});

describe('liberar una direccion', () => {
  it('vuelve a recibir, y queda registrado quien la libero', async () => {
    const direccion = email('liberada');

    await suppressionService.processFeedback(reboteDuro(direccion));
    expect(await suppressionService.isSuppressed(direccion)).toBe(true);

    expect(await suppressionService.release(direccion, adminId)).toBe(true);
    expect(await suppressionService.isSuppressed(direccion)).toBe(false);

    const [fila] = await getDatabase()
      .select()
      .from(schema.emailSuppressions)
      .where(like(schema.emailSuppressions.email, direccion));

    expect(fila?.releasedBy).toBe(adminId);
    expect(fila?.releasedAt).not.toBeNull();
  });

  it('⚠️ un rebote nuevo vuelve a suprimir una direccion liberada', async () => {
    // Si no, liberar una casilla que sigue rota la dejaria recibiendo rebotes
    // indefinidamente, que es justo lo que arruina la reputacion de envio.
    const direccion = email('recaida');

    await suppressionService.processFeedback(reboteDuro(direccion));
    await suppressionService.release(direccion, adminId);
    expect(await suppressionService.isSuppressed(direccion)).toBe(false);

    await suppressionService.processFeedback(reboteDuro(direccion));
    expect(await suppressionService.isSuppressed(direccion)).toBe(true);
  });
});

describe('el envio consulta la supresion', () => {
  it('⚠️ NO manda a una direccion suprimida, y no lanza', async () => {
    // Es el punto de todo el modulo. Lanzar haria que BullMQ reintentara cinco
    // veces algo que por definicion no se puede mandar.
    const direccion = email('no-recibe');
    await suppressionService.processFeedback(reboteDuro(direccion));

    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      emailService.processEmailJob({
        kind: 'email_verification',
        to: direccion,
        token: 'token-de-prueba',
        hoursValid: 24,
      }),
    ).resolves.toBeUndefined();

    // Se descarta ANTES de construir el mensaje y de tocar el proveedor.
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining('NO enviado'));

    aviso.mockRestore();
  });
});
