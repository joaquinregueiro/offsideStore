import { resetEnvCache } from '@offside/config';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmailSender } from './infrastructure/email/index';
import { leerFeedback } from './infrastructure/email/ses-feedback';
import { resetSesClient } from './infrastructure/email/ses-email.sender';
import * as templates from './templates/auth.templates';

/**
 * Notificaciones por email.
 *
 * Lo que se protege acá es sobre todo **que no se filtre un token**: los emails
 * de verificación y de reset llevan credenciales de un solo uso.
 */

const ENTORNO_BASE = {
  DATABASE_URL: 'postgresql://unit:unit@localhost:5432/unit',
  REDIS_URL: 'redis://localhost:6379',
  AUTH_SESSION_SECRET: 'pepper-solo-para-tests',
  APP_URL: 'https://offside.test',
};

function configurar(extra: Record<string, string | undefined>): void {
  for (const [clave, valor] of Object.entries({ ...ENTORNO_BASE, ...extra })) {
    if (valor === undefined) delete process.env[clave];
    else process.env[clave] = valor;
  }

  resetEnvCache();
  resetSesClient();
}

const SES = {
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'clave-inventada-de-test',
  AWS_SECRET_ACCESS_KEY: 'secreto-inventado-de-test',
  EMAIL_FROM_ADDRESS: 'hola@offside.test',
};

const SIN_SES = {
  AWS_REGION: undefined,
  AWS_ACCESS_KEY_ID: undefined,
  AWS_SECRET_ACCESS_KEY: undefined,
  EMAIL_FROM_ADDRESS: undefined,
};

/**
 * ⚠️ ESTE ARCHIVO MUTA `process.env`, QUE ES COMPARTIDO.
 *
 * Vitest corre los archivos en paralelo entre workers pero SECUENCIALMENTE
 * dentro de cada uno, y `process.env` es del proceso. Un archivo que ensucia el
 * entorno y no lo limpia rompe al siguiente que le toque el mismo worker, de
 * forma intermitente y dificil de rastrear. Por eso se restaura entero.
 */
const ENTORNO_ORIGINAL = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  for (const clave of Object.keys(process.env)) {
    if (!(clave in ENTORNO_ORIGINAL)) delete process.env[clave];
  }
  Object.assign(process.env, ENTORNO_ORIGINAL);

  resetEnvCache();
  resetSesClient();
});

describe('eleccion del adaptador', () => {
  it('usa SES cuando esta configurado', () => {
    configurar({ ...SES, APP_ENV: 'production' });

    expect(createEmailSender().name).toBe('ses');
  });

  it('cae al log fuera de produccion cuando falta configuracion', () => {
    configurar({ ...SIN_SES, APP_ENV: 'development' });

    expect(createEmailSender().name).toBe('log');
  });

  it('⚠️ EN PRODUCCION SIN CONFIGURAR, SE ROMPE en vez de caer al log', () => {
    // Caer al log escribiria tokens de verificacion y de reset en el log del
    // servidor, y ademas el usuario nunca recibiria nada mientras el sistema
    // informa exito. Es preferible fallar ruidosamente.
    configurar({ ...SIN_SES, APP_ENV: 'production' });

    expect(() => createEmailSender()).toThrowError(/produccion/i);
  });

  it('no le alcanza con credenciales sin remitente', () => {
    configurar({
      ...SES,
      EMAIL_FROM_ADDRESS: undefined,
      APP_ENV: 'production',
    });

    expect(() => createEmailSender()).toThrowError(/EMAIL_FROM_ADDRESS/);
  });
});

describe('plantillas', () => {
  beforeEach(() => {
    configurar({ APP_ENV: 'development' });
  });

  it('el enlace de verificacion apunta a APP_URL y lleva el token', () => {
    const mensaje = templates.verificacionDeEmail('alguien@ejemplo.com', 'tok-123', 24);

    expect(mensaje.to).toBe('alguien@ejemplo.com');
    expect(mensaje.text).toContain('https://offside.test/verificar-email?token=tok-123');
    expect(mensaje.text).toContain('24 horas');
  });

  it('escapa el token en la URL', () => {
    // Un token con caracteres especiales no puede romper el enlace.
    const mensaje = templates.verificacionDeEmail('a@b.com', 'a+b/c=d', 24);

    expect(mensaje.text).toContain('token=a%2Bb%2Fc%3Dd');
  });

  it('el reset dice que el enlace es de un solo uso', () => {
    const mensaje = templates.resetDePassword('alguien@ejemplo.com', 'tok-456', 2);

    expect(mensaje.subject).toContain('contraseña');
    expect(mensaje.text).toContain('una sola vez');
    expect(mensaje.text).toContain('https://offside.test/restablecer-password?token=tok-456');
  });

  it('ambas traen texto plano, no solo HTML', () => {
    // El texto plano es el fallback universal: hay clientes que no muestran
    // HTML y filtros que puntuan peor un email sin alternativa de texto.
    for (const mensaje of [
      templates.verificacionDeEmail('a@b.com', 't', 24),
      templates.resetDePassword('a@b.com', 't', 2),
    ]) {
      expect(mensaje.text.length).toBeGreaterThan(0);
      expect(mensaje.html).toBeDefined();
    }
  });

  it('el token de verificacion y el de reset no se cruzan', () => {
    const verificacion = templates.verificacionDeEmail('a@b.com', 'TOKEN-VERIF', 24);
    const reset = templates.resetDePassword('a@b.com', 'TOKEN-RESET', 2);

    expect(verificacion.text).not.toContain('TOKEN-RESET');
    expect(reset.text).not.toContain('TOKEN-VERIF');
    expect(verificacion.text).not.toContain('restablecer-password');
    expect(reset.text).not.toContain('verificar-email');
  });
});

describe('el adaptador de log', () => {
  it('imprime el cuerpo: en desarrollo el log ES la casilla', async () => {
    configurar({ ...SIN_SES, APP_ENV: 'development' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await createEmailSender().send({
      to: 'alguien@ejemplo.com',
      subject: 'Asunto',
      text: 'cuerpo con el token tok-999',
    });

    const salida = warn.mock.calls.flat().join('\n');
    expect(salida).toContain('alguien@ejemplo.com');
    expect(salida).toContain('tok-999');
  });
});

/**
 * Lectura de los rebotes y quejas de SES.
 *
 * ⚠️ LO QUE SE TESTEA ES A QUIEN **NO** SE SUPRIME. Suprimir de mas es dejar a
 * una persona real sin poder usar su cuenta, y ese error no lo ve nadie hasta
 * que alguien se queja: no hay pantalla que lo muestre.
 */
describe('rebotes y quejas de SES', () => {
  const mail = { messageId: 'mensaje-123' };

  function rebote(bounceType: string, bounceSubType = 'General') {
    return {
      notificationType: 'Bounce',
      mail,
      bounce: {
        bounceType,
        bounceSubType,
        bouncedRecipients: [{ emailAddress: 'rebota@offside.test' }],
      },
    };
  }

  it('suprime un rebote PERMANENTE', () => {
    expect(leerFeedback(rebote('Permanent'))).toEqual([
      {
        email: 'rebota@offside.test',
        reason: 'BOUNCE',
        subtype: 'General',
        messageId: 'mensaje-123',
      },
    ]);
  });

  it('⚠️ NO suprime un rebote TRANSITORIO', () => {
    // Casilla llena o servidor caido. AWS dice que se puede reintentar cuando
    // se resuelva, y SES ya reintenta solo. Suprimir aca dejaria a alguien sin
    // su cuenta porque tuvo el buzon lleno un martes.
    expect(leerFeedback(rebote('Transient', 'MailboxFull'))).toEqual([]);
  });

  it('⚠️ NO suprime un rebote INDETERMINADO', () => {
    // "Rebotó y no se entiende por que". Adivinar es peor que no hacer nada: el
    // costo de equivocarse es una persona real afuera; el de no actuar, un
    // rebote mas.
    expect(leerFeedback(rebote('Undetermined', 'Undetermined'))).toEqual([]);
  });

  it('suprime una queja por spam', () => {
    const feedback = leerFeedback({
      notificationType: 'Complaint',
      mail,
      complaint: {
        complaintFeedbackType: 'abuse',
        complainedRecipients: [{ emailAddress: 'se-quejo@offside.test' }],
      },
    });

    expect(feedback).toEqual([
      {
        email: 'se-quejo@offside.test',
        reason: 'COMPLAINT',
        subtype: 'abuse',
        messageId: 'mensaje-123',
      },
    ]);
  });

  it('⚠️ NO suprime una queja `not-spam`', () => {
    // Es el unico valor del registro de IANA que significa lo contrario que los
    // demas: quien reporta dice que el mensaje NO era spam. Tratarlo como queja
    // seria dar de baja a alguien por haber sido defendido.
    const feedback = leerFeedback({
      notificationType: 'Complaint',
      mail,
      complaint: {
        complaintFeedbackType: 'not-spam',
        complainedRecipients: [{ emailAddress: 'defendido@offside.test' }],
      },
    });

    expect(feedback).toEqual([]);
  });

  it('procesa TODOS los destinatarios, no solo el primero', () => {
    // AWS avisa que una notificacion puede referirse a varios y que no garantiza
    // ni orden ni agrupamiento. Quedarse con el primero perderia supresiones en
    // silencio.
    const feedback = leerFeedback({
      notificationType: 'Bounce',
      mail,
      bounce: {
        bounceType: 'Permanent',
        bounceSubType: 'General',
        bouncedRecipients: [
          { emailAddress: 'uno@offside.test' },
          { emailAddress: 'dos@offside.test' },
        ],
      },
    });

    expect(feedback?.map((f) => f.email)).toEqual(['uno@offside.test', 'dos@offside.test']);
  });

  it('entiende `eventType`, que es como se llama con event publishing', () => {
    const feedback = leerFeedback({
      eventType: 'Bounce',
      mail,
      bounce: {
        bounceType: 'Permanent',
        bouncedRecipients: [{ emailAddress: 'rebota@offside.test' }],
      },
    });

    expect(feedback).toHaveLength(1);
  });

  it('no suprime nada ante una entrega exitosa', () => {
    expect(leerFeedback({ notificationType: 'Delivery', mail, delivery: {} })).toEqual([]);
  });

  it('tolera campos desconocidos: AWS se reserva agregarlos', () => {
    const feedback = leerFeedback({
      notificationType: 'Bounce',
      mail,
      inventado: { algo: 1 },
      bounce: {
        bounceType: 'Permanent',
        campoNuevo: true,
        bouncedRecipients: [{ emailAddress: 'rebota@offside.test', campoNuevo: 'x' }],
      },
    });

    expect(feedback).toHaveLength(1);
  });

  it('devuelve null si el cuerpo no tiene la forma esperada', () => {
    expect(leerFeedback('no soy un objeto')).toBeNull();
  });
});
