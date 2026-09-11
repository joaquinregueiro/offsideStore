import type { Metadata } from 'next';
import Link from 'next/link';

import { AreaDeTexto, Campo, CampoOculto, Formulario } from '@/components/form';
import { Pantalla } from '@/components/movimiento';
import {
  Aviso,
  BotonEnlace,
  CeldaNumero,
  Confirmar,
  EncabezadoNumero,
  Etiqueta,
  Tabla,
} from '@/components/ui';
import { fecha, fechaYHora } from '@/lib/formato';
import { CAPABILITIES } from '@/lib/permissions';
import { requireCapabilitySessionUser } from '@/lib/session';
import {
  getSettingHistory,
  listSettings,
  type SettingListEntry,
} from '@/modules/config/services/setting-store.service';
import { isSettingKey } from '@/modules/config/services/settings-registry';

import { cambiarAjuste } from '../../acciones';
import { Consola } from '../../consola';
import estilos from '../../admin.module.css';

export const metadata: Metadata = { title: 'Configuración' };
export const dynamic = 'force-dynamic';

/**
 * CONFIG STORE COMPLETO (DEC-013 / DEC-038 / DEC-039).
 *
 * Hasta hoy el back-office editaba UNA de las treinta y tres claves —la
 * comisión— y las otras treinta y dos se cambiaban por SQL contra producción.
 * Todo lo que `docs/` marca ⚙️ CONFIGURABLE tiene que ser operable desde acá
 * (CLAUDE.md §12); el mecanismo existía entero en `setting-store.service.ts` y
 * no tenía pantalla.
 *
 * ⚠️ ESTO CAMBIA REGLAS DE NEGOCIO PARA TODA LA PLATAFORMA, sin redeploy y sin
 * SQL. Por eso pide `system_config:manage` y no simplemente "ser admin".
 *
 * ⚠️ NO RECALCULA NADA (DEC-030). Lo que una transacción ya congeló —la
 * comisión de una orden, el multiplicador de una promoción, el plazo de pago de
 * una orden abierta— sigue siendo lo que era. Lo nuevo rige para lo nuevo.
 *
 * ⚠️ EL HISTORIAL SE CARGA DE A UNA CLAVE, POR `?clave=`. Pedir el historial de
 * las treinta y tres serían treinta y tres consultas en cada entrada a una
 * pantalla que es `force-dynamic`. Va por enlace, así que anda sin JavaScript,
 * se comparte y vuelve con el botón atrás.
 */

/**
 * Familias por PREFIJO, no por lista de claves.
 *
 * ⚠️ ES DELIBERADO Y NO ES PEREZA. Una lista explícita de claves sería una
 * segunda copia del registro: el día que alguien agregue una clave, la pantalla
 * la perdería en silencio. Con prefijos, una clave nueva cae en su familia
 * sola, y si no matchea ninguna cae en "Otras claves" —visible, no perdida—.
 */
const FAMILIAS: { titulo: string; detalle: string; prefijos: readonly string[] }[] = [
  {
    titulo: 'Interruptores',
    detalle:
      'Encienden y apagan funcionalidades enteras del sitio. Apagar una la esconde para todo el mundo.',
    prefijos: ['feature_'],
  },
  {
    titulo: 'Comisión',
    detalle: 'Lo que Offside retiene de cada venta. Tiene además su propia pantalla.',
    prefijos: ['commission_'],
  },
  {
    titulo: 'Publicaciones y búsqueda',
    detalle: 'Límites de las fotos y pesos del ranking (DEC-042).',
    prefijos: ['listing_', 'search_'],
  },
  {
    titulo: 'Ciclo de la orden',
    detalle: 'Los plazos que mueven una compra de un estado al siguiente (DEC-029 / DEC-033).',
    prefijos: ['payment_', 'dispatch_', 'buyer_protection', 'review_window'],
  },
  {
    titulo: 'Reclamos y conciliación',
    detalle: 'Plazos de una disputa y ventana de conciliación con Mercado Pago.',
    prefijos: ['dispute_', 'reconciliation_'],
  },
  {
    titulo: 'Promociones',
    detalle: 'Cuánto se agrava la comisión de una publicación promocionada y por cuánto tiempo.',
    prefijos: ['promotion_', 'promoted_'],
  },
  {
    titulo: 'Niveles de vendedor',
    detalle: 'Cómo se evalúa y se asigna el tier (BR-051). Los niveles se editan en Niveles.',
    prefijos: ['seller_tier_'],
  },
  {
    titulo: 'Niveles de usuario y reputación',
    detalle: 'Umbrales de nivel (DEC-020) y pesos del score derivado (DEC-036).',
    prefijos: ['user_level_', 'reputation_'],
  },
  {
    titulo: 'Envíos',
    detalle: 'Modos admitidos y transportistas. No hay integración real todavía.',
    prefijos: ['shipping_'],
  },
  {
    titulo: 'Preguntas y favoritos',
    detalle: 'Techos de las preguntas y umbral del aviso de baja de precio.',
    prefijos: ['questions_', 'favorites_'],
  },
];

const OTRAS = 'Otras claves';

function familiaDe(clave: string): string {
  return (
    FAMILIAS.find((familia) => familia.prefijos.some((prefijo) => clave.startsWith(prefijo)))
      ?.titulo ?? OTRAS
  );
}

/** Los tipos del registro, en palabras. `valueType` es informativo: valida el schema. */
const TIPOS: Record<string, string> = {
  number: 'Número',
  rate: 'Tasa (basis points)',
  bool: 'Interruptor',
  string: 'Texto',
  json: 'JSON',
};

/**
 * De dónde salió el valor que rige hoy.
 *
 * ⚠️ `default` NO ES "está bien". Significa que la fila NO EXISTE en
 * `app_settings` y rige el valor transitorio del registro: falta correr una
 * migración de datos. `missing` es peor: no hay fila ni default, y leer esa
 * clave LANZA.
 */
interface Origen {
  texto: string;
  tono: 'neutro' | 'marca' | 'alerta';
}

const CONFIGURADA: Origen = { texto: 'Configurada', tono: 'marca' };

const ORIGENES: Record<string, Origen> = {
  global: CONFIGURADA,
  default: { texto: 'Default del registro', tono: 'alerta' },
  missing: { texto: 'Sin cargar', tono: 'alerta' },
};

/**
 * El valor, como texto editable.
 *
 * ⚠️ SE DISCRIMINA CADA PRIMITIVO EN VEZ DE LLAMAR A `String()` SOBRE
 * `unknown`. El valor viene de `jsonb` y puede ser cualquier cosa: un objeto
 * pasado por `String()` da `[object Object]`, que dentro de un `<textarea>` de
 * edición es un valor que alguien guardaría sin darse cuenta.
 *
 * ⚠️ EL JSON SE INDENTA. Un `search_rank_weights` en una sola línea dentro de un
 * `<textarea>` es una pared: quien tiene que cambiar un peso necesita ver la
 * estructura, y el servidor lo reparsea igual.
 */
function comoTexto(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);

  return JSON.stringify(valor, null, 2) ?? '';
}

/** Una línea: el valor vigente, para mostrarlo monoespaciado y sin envolver. */
function enUnaLinea(valor: unknown): string {
  if (valor === null || valor === undefined) return '—';
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);

  return JSON.stringify(valor) ?? '—';
}

function FichaDeClave({
  entrada,
  abierta,
  historial,
}: {
  entrada: SettingListEntry;
  abierta: boolean;
  historial: { id: string; version: number; value: unknown; createdAt: Date }[];
}) {
  const origen = ORIGENES[entrada.source] ?? CONFIGURADA;
  const esBool = entrada.valueType === 'bool';
  const esJson = entrada.valueType === 'json';
  const encendido = entrada.value === true;

  return (
    <article
      className={`${estilos.tarjeta} ${entrada.problem === null ? estilos.fichaNeutra : estilos.fichaAlerta}`}
      id={entrada.key}
    >
      <div className={estilos.tarjetaCabecera}>
        <code className={estilos.claveAjuste}>{entrada.key}</code>
        <span className={estilos.estadoGrupo}>
          <span className={estilos.rotuloEstado}>Origen</span>
          <Etiqueta tono={origen.tono}>{origen.texto}</Etiqueta>
        </span>
      </div>

      <p className={estilos.descripcionAjuste}>{entrada.descripcion}</p>

      {/*
        ⚠️ UN VALOR QUE NO PASA SU PROPIO SCHEMA SE MUESTRA, NO SE ESCONDE.
        `listSettings` devuelve el valor CRUDO justamente para esto: si el
        listado lanzara como lanza `getSetting`, la única pantalla desde la que
        se puede corregir sería la que no carga.
      */}
      {entrada.problem !== null && (
        <div className={estilos.avisoDeFicha}>
          <Aviso tono="error">
            El valor guardado no pasa la validación de su clave: {entrada.problem}. Cualquier
            lectura de <code>{entrada.key}</code> va a fallar hasta que se corrija acá.
          </Aviso>
        </div>
      )}

      <div className={estilos.datos}>
        <div className={estilos.datoAjuste}>
          <span className={estilos.rotuloEstado}>Valor vigente</span>
          <code className={estilos.crudo}>{enUnaLinea(entrada.value)}</code>
        </div>
        <div className={estilos.datoAjuste}>
          <span className={estilos.rotuloEstado}>Tipo</span>
          <span>{TIPOS[entrada.valueType] ?? entrada.valueType}</span>
        </div>
        <div className={estilos.datoAjuste}>
          <span className={estilos.rotuloEstado}>Versión</span>
          <span>{entrada.version ?? '—'}</span>
        </div>
        <div className={estilos.datoAjuste}>
          <span className={estilos.rotuloEstado}>Última vez</span>
          <span>{entrada.updatedAt === null ? '—' : fecha(entrada.updatedAt.toISOString())}</span>
        </div>
      </div>

      {/*
        ⚠️ LOS OVERRIDES SE VEN Y NO SE EDITAN, Y HAY QUE DECIRLO. Un valor por
        tier GANA sobre el global (`SCOPE_PRECEDENCE`): cambiar el global y no
        ver que un tier lo pisa es la forma de creer que un cambio no funcionó.
        Editarlos pide elegir el ámbito y esa pantalla no existe; queda
        reportado.
      */}
      {entrada.overrides.length > 0 && (
        <div className={estilos.overrides}>
          <p className={estilos.rotuloEstado}>
            Overrides vigentes (ganan sobre el global, y desde acá no se editan)
          </p>
          <ul className={estilos.listaOverrides}>
            {entrada.overrides.map((override) => (
              <li key={`${override.scope}-${override.scopeId}`}>
                <span>{override.scope === 'seller_tier' ? 'Nivel' : 'Categoría'}</span>{' '}
                <code className={estilos.crudo}>{override.scopeId}</code> →{' '}
                <code className={estilos.crudo}>{enUnaLinea(override.value)}</code> (v
                {override.version})
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        ⚠️ EL CAMBIO VA EN DOS PASOS, aun siendo versionado y reversible. Son
        reglas que rigen para toda la plataforma y se entra acá a MIRAR: apagar
        el carrito de todo el sitio no puede pasar con un clic de más.
      */}
      {esBool ? (
        <div className={estilos.zonaAccion}>
          <Confirmar
            etiqueta={encendido ? 'Apagar' : 'Encender'}
            pregunta={
              encendido
                ? 'Se apaga para TODO el sitio, no sólo para vos. Lo que ya existe no se borra: deja de mostrarse y de poder usarse.'
                : 'Se enciende para TODO el sitio. Revisá que la funcionalidad esté lista antes de mostrarla.'
            }
          >
            <Formulario
              accion={cambiarAjuste}
              enviar={encendido ? 'Confirmar apagado' : 'Confirmar encendido'}
              variante={encendido ? 'peligro' : 'primario'}
              tamanio="medio"
              bloque={false}
            >
              <CampoOculto nombre="clave" valor={entrada.key} />
              <CampoOculto nombre="valor" valor={encendido ? 'false' : 'true'} />
            </Formulario>
          </Confirmar>
        </div>
      ) : (
        <div className={estilos.zonaAccion}>
          <Confirmar
            etiqueta="Cambiar valor"
            pregunta="El cambio rige desde el momento en que se guarda y para toda la plataforma. Lo que ya se congeló en una transacción no se toca (DEC-030)."
          >
            <Formulario accion={cambiarAjuste} enviar="Guardar" tamanio="medio" bloque={false}>
              <CampoOculto nombre="clave" valor={entrada.key} />
              {esJson ? (
                <AreaDeTexto
                  nombre="valor"
                  identificador={`valor-${entrada.key}`}
                  etiqueta="Valor nuevo (JSON)"
                  filas={6}
                  requerido
                  defaultValue={comoTexto(entrada.value)}
                  ayuda="Se valida contra el schema de la clave antes de guardarse."
                />
              ) : (
                <Campo
                  nombre="valor"
                  identificador={`valor-${entrada.key}`}
                  etiqueta="Valor nuevo"
                  tipo={entrada.valueType === 'string' ? 'text' : 'number'}
                  defaultValue={comoTexto(entrada.value)}
                  {...(entrada.valueType === 'string'
                    ? {}
                    : { step: 'any' as const, inputMode: 'decimal' as const })}
                  ayuda="Se guarda como una versión nueva: la anterior queda en el historial."
                />
              )}
            </Formulario>
          </Confirmar>
        </div>
      )}

      {/*
        ⚠️ EL HISTORIAL ES UN ENLACE, NO UN `<details>` CON TODO YA CARGADO.
        Traer treinta y tres historiales en cada entrada sería el costo fijo de
        la pantalla para un dato que se mira de a una clave por vez.
      */}
      <p className={estilos.nota}>
        {abierta ? (
          <Link href="/admin/configuracion" scroll={false}>
            Ocultar el historial
          </Link>
        ) : (
          <Link href={`/admin/configuracion?clave=${entrada.key}#${entrada.key}`} scroll={false}>
            Ver el historial de esta clave
          </Link>
        )}
      </p>

      {abierta && (
        <div className={estilos.historial}>
          {historial.length === 0 ? (
            <p className={estilos.nota}>
              <span>
                Todavía no hay ninguna versión de esta clave en la base: rige el default del
                registro.
              </span>
            </p>
          ) : (
            <Tabla titulo={`Historial de ${entrada.key}`} tituloVisible>
              <thead>
                <tr>
                  <EncabezadoNumero>Versión</EncabezadoNumero>
                  <th scope="col">Valor</th>
                  <th scope="col">Desde</th>
                </tr>
              </thead>
              <tbody>
                {historial.map((version) => (
                  <tr key={version.id}>
                    <CeldaNumero>{version.version}</CeldaNumero>
                    <td>
                      <code className={estilos.crudo}>{enUnaLinea(version.value)}</code>
                    </td>
                    <td>{fechaYHora(version.createdAt.toISOString())}</td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          )}
          {/*
            ⚠️ FALTA EL EMAIL DE QUIEN CAMBIO CADA VERSION. La fila guarda
            `updated_by` con el id del usuario y resolverlo a un email pide una
            consulta cruzada que el Service todavía no hace. Es el mismo hueco
            que ya tenía el historial de la comisión. Reportado.
          */}
          <p className={estilos.nota}>
            <span>
              Cada versión guarda quién la hizo (<code>updated_by</code>), pero el Service todavía
              no resuelve ese id a un email.
            </span>
          </p>
        </div>
      )}
    </article>
  );
}

export default async function Configuracion({
  searchParams,
}: {
  searchParams: Promise<{ clave?: string }>;
}) {
  const [{ clave }, admin] = await Promise.all([
    searchParams,
    requireCapabilitySessionUser(CAPABILITIES.SYSTEM_CONFIG_MANAGE, '/admin/configuracion'),
  ]);

  const claves = await listSettings();

  /*
   * ⚠️ LA CLAVE DE LA URL SE VALIDA CONTRA EL REGISTRO ANTES DE USARLA.
   * `getSettingHistory` lanza con una clave desconocida, y un `?clave=` de la
   * URL lo escribe cualquiera: sin este control, un enlace roto tira la
   * pantalla entera en vez de mostrarla sin historial.
   */
  const claveAbierta = clave !== undefined && isSettingKey(clave) ? clave : null;
  const historial =
    claveAbierta === null ? [] : await getSettingHistory(claveAbierta, undefined, 12);

  const conProblema = claves.filter((entrada) => entrada.problem !== null).length;
  const sinCargar = claves.filter((entrada) => entrada.source !== 'global').length;

  const familias = [...FAMILIAS.map((familia) => familia.titulo), OTRAS];

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Consola
          rol={admin.adminRole}
          email={admin.email}
          activo="configuracion"
          titulo="Configuración"
        />

        <div className={estilos.hoja}>
          <p className={estilos.bajada}>
            Son las {claves.length} claves del Config Store. Cada cambio inserta una{' '}
            <strong>versión nueva</strong> con tu usuario: nunca se pisa la anterior, y lo que una
            orden o una promoción ya congeló no se toca.
          </p>

          {conProblema > 0 && (
            <div className={estilos.avisoDeConsola}>
              <Aviso tono="error">
                Hay {conProblema} clave{conProblema === 1 ? '' : 's'} con un valor que no pasa su
                propia validación. Cualquier lectura de esas claves falla hasta corregirlas.
              </Aviso>
            </div>
          )}

          {sinCargar > 0 && (
            <div className={estilos.avisoDeConsola}>
              <Aviso>
                Hay {sinCargar} clave{sinCargar === 1 ? '' : 's'} sin fila en la base: rige el valor
                transitorio del registro. Guardar cualquier valor desde acá crea la fila.
              </Aviso>
            </div>
          )}

          {familias.map((titulo) => {
            const delGrupo = claves.filter((entrada) => familiaDe(entrada.key) === titulo);
            if (delGrupo.length === 0) return null;

            const detalle = FAMILIAS.find((familia) => familia.titulo === titulo)?.detalle;

            return (
              <section key={titulo} className={estilos.familia} aria-labelledby={`fam-${titulo}`}>
                <h2 id={`fam-${titulo}`} className={estilos.subtitulo}>
                  {titulo}
                </h2>
                {detalle !== undefined && <p className={estilos.bajada}>{detalle}</p>}

                {delGrupo.map((entrada) => (
                  <FichaDeClave
                    key={entrada.key}
                    entrada={entrada}
                    abierta={entrada.key === claveAbierta}
                    historial={historial}
                  />
                ))}
              </section>
            );
          })}

          <div className={estilos.pie}>
            <BotonEnlace href="/admin" variante="secundario">
              Volver
            </BotonEnlace>
          </div>
        </div>
      </main>
    </Pantalla>
  );
}
