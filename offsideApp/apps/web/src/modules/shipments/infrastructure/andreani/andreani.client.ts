import { createHash } from 'node:crypto';

import { getRedisClient } from '@offside/jobs';

import { ShippingError } from '../shipping/shipping.port';
import { leerSesion, mensajeDeError, type SesionAndreani } from './andreani.mapper';

/**
 * Cliente HTTP de la API PyME de Andreani.
 *
 * ⚠️ LA URL ES UNA CONSTANTE, NO CONFIGURACION. Es el backend del plugin
 * oficial (`Andreani_Api_Config::$api_base_url`) y es parte del contrato del
 * proveedor, igual que las URLs de Mercado Pago. No hay ambiente de pruebas: la
 * API PyME es una sola. Por eso el adaptador real solo se enciende con una
 * credencial cargada, y sin ella se usa el simulado.
 */
const BASE = 'https://woocommerce-api-acom.andreani.com';

const TIMEOUT_MS = 15_000;

/**
 * ⚠️ CUANTO DURA EL TOKEN NO ESTA DOCUMENTADO 🔵. El plugin lo guarda y lo
 * reusa sin fecha; cuando vence, la API contesta 401 y se vuelve a loguear. Se
 * cachea seis horas para no loguear en cada pedido, y el 401 sigue siendo la
 * red: si vence antes, se renueva y se reintenta UNA vez.
 */
const SESION_TTL_SEGUNDOS = 6 * 60 * 60;

/**
 * La clave de Redis lleva un resumen de la credencial y no la credencial.
 *
 * ⚠️ LA CREDENCIAL NUNCA SE ESCRIBE EN REDIS NI EN LOS LOGS. Si se regenera en
 * andreani.com, el resumen cambia y la sesion vieja queda huerfana sola —no hay
 * que acordarse de borrarla—.
 */
function claveDeSesion(credencial: string): string {
  const resumen = createHash('sha256').update(credencial).digest('hex').slice(0, 16);

  return `andreani:sesion:${resumen}`;
}

export interface ClienteAndreani {
  /** POST/GET con el token, renovandolo una vez si vencio. */
  pedir(
    metodo: 'GET' | 'POST',
    ruta: string,
    cuerpo?: unknown,
    opciones?: { binario?: boolean },
  ): Promise<{ estado: number; json: unknown; bytes: Buffer | null }>;
  sesion(): Promise<SesionAndreani>;
}

async function llamar(
  metodo: 'GET' | 'POST',
  url: string,
  encabezados: Record<string, string>,
  cuerpo: unknown,
): Promise<Response> {
  try {
    return await fetch(url, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...encabezados },
      body: cuerpo === undefined ? null : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    /*
     * ⚠️ UN TIMEOUT NO DICE QUE NO PASO NADA. Si el alta llego y la respuesta se
     * perdio, el envio existe en Andreani. Por eso aca no hay reintento: el
     * plugin tampoco lo tiene ("el alta no es idempotente"), y el Service usa la
     * referencia para ir a buscarlo antes de volver a darlo de alta.
     */
    throw new ShippingError(
      'unreachable',
      `No hubo respuesta de Andreani (${error instanceof Error ? error.name : 'error de red'}).`,
    );
  }
}

async function leerJson(respuesta: Response): Promise<unknown> {
  const textoCrudo = await respuesta.text();
  if (textoCrudo.trim() === '') return null;

  try {
    return JSON.parse(textoCrudo) as unknown;
  } catch {
    return { message: textoCrudo.slice(0, 300) };
  }
}

export function crearClienteAndreani(credencial: string): ClienteAndreani {
  const redis = getRedisClient();
  const clave = claveDeSesion(credencial);

  async function loguear(): Promise<SesionAndreani> {
    // El login va con la credencial en `Authorization`, sin "Bearer": asi lo
    // hace el plugin (`validate_hash`).
    const respuesta = await llamar(
      'POST',
      `${BASE}/api/v1/Login`,
      { Authorization: credencial },
      undefined,
    );
    const json = await leerJson(respuesta);

    if (respuesta.status === 401 || respuesta.status === 403) {
      throw new ShippingError(
        'not_configured',
        'Andreani rechazó la credencial. Generá una nueva en andreani.com > Integraciones > WooCommerce.',
      );
    }
    if (!respuesta.ok) {
      throw new ShippingError(
        'unreachable',
        `Andreani no pudo iniciar sesión (HTTP ${respuesta.status}): ${mensajeDeError(json) ?? 'sin detalle'}`,
      );
    }

    const sesion = leerSesion(json);
    await redis.set(clave, JSON.stringify(sesion), 'EX', SESION_TTL_SEGUNDOS);

    return sesion;
  }

  async function sesion(forzar = false): Promise<SesionAndreani> {
    if (!forzar) {
      const guardada = await redis.get(clave);
      if (guardada !== null) {
        try {
          return JSON.parse(guardada) as SesionAndreani;
        } catch {
          // Un valor ilegible se descarta y se vuelve a loguear: no vale romper el envio por la cache.
        }
      }
    }

    return loguear();
  }

  async function pedir(
    metodo: 'GET' | 'POST',
    ruta: string,
    cuerpo?: unknown,
    opciones: { binario?: boolean } = {},
  ) {
    for (let intento = 0; intento < 2; intento += 1) {
      const actual = await sesion(intento > 0);
      const respuesta = await llamar(
        metodo,
        `${BASE}${ruta}`,
        { 'X-Auth-Token': actual.accessToken },
        cuerpo,
      );

      /*
       * ⚠️ EL UNICO REINTENTO ES EL DE UN 401, y es seguro incluso para el alta:
       * un 401 significa que la API NO proceso el pedido, asi que repetirlo con
       * un token nuevo no puede duplicar un envio.
       */
      if ((respuesta.status === 401 || respuesta.status === 403) && intento === 0) {
        await redis.del(clave);
        continue;
      }

      if (opciones.binario === true && respuesta.ok) {
        return {
          estado: respuesta.status,
          json: null,
          bytes: Buffer.from(await respuesta.arrayBuffer()),
        };
      }

      const json = await leerJson(respuesta);

      if (!respuesta.ok) {
        const detalle = mensajeDeError(json) ?? `HTTP ${respuesta.status}`;
        throw new ShippingError(
          respuesta.status >= 500 ? 'unreachable' : 'rejected',
          `Andreani: ${detalle}`,
        );
      }

      return { estado: respuesta.status, json, bytes: null };
    }

    throw new ShippingError('not_configured', 'Andreani rechazó la sesión dos veces seguidas.');
  }

  return { pedir, sesion: () => sesion(false) };
}
