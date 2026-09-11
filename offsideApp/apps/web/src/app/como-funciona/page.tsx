import type { Metadata } from 'next';
import type { CSSProperties, ReactNode } from 'react';

import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import {
  IconoAutenticado,
  IconoCamiseta,
  IconoEtiqueta,
  IconoIntercambio,
} from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import { BotonEnlace, FilaDeAcciones, InsigniaDeNivel } from '@/components/ui';
import { cantidad, multiplicador, porcentajeDeComision } from '@/lib/formato';
import {
  getBuyerProtectionDays,
  getDisputeWindowDays,
  getShippingSettings,
  isFeatureEnabled,
} from '@/modules/config/services/setting-store.service';
import {
  basisPointsToPercent,
  getCommissionRateBasisPoints,
} from '@/modules/config/services/settings.service';
import { getPromotionSettings } from '@/modules/listings/services/listing-settings.service';
import {
  shippingModeLabel,
  SHIPPING_MODES,
  type ShippingMode,
} from '@/modules/listings/services/shipping-declaration';
import { listTiers, type TierSummary } from '@/modules/sellers/services/seller-tier.service';

import estilos from './page.module.css';

export const metadata: Metadata = {
  title: 'Cómo funciona',
  description:
    'Cómo se compra y se vende en Offside Store: pagos con Mercado Pago, requisitos para publicar y qué falta todavía.',
};

export const dynamic = 'force-dynamic';

/**
 * Un paso de una de las dos secuencias.
 *
 * ⚠️ SON DATOS Y NO JSX SUELTO porque las dos secuencias se dibujan con el mismo
 * componente: si "Comprar" y "Vender" se escribieran a mano por separado,
 * terminarian divergiendo en el primer retoque.
 */
interface PasoDeFlujo {
  icono: ReactNode;
  titulo: string;
  texto: ReactNode;
}

/**
 * ⚠️ EL NUMERO NO VA EN EL MARCADO. Lo dibuja un contador de CSS sobre un pseudo
 * decorativo: un lector de pantalla ya recorre el `<ol>` diciendo "1 de 4", y
 * escribirlo tambien en el HTML lo haria decirlo dos veces.
 */
function Secuencia({ pasos }: { pasos: PasoDeFlujo[] }) {
  return (
    /*
      `revela-grilla`: cada paso se revela al entrar en pantalla y el escalonado
      sale de la GEOMETRIA, no de un delay por item. En una animacion dirigida
      por scroll `animation-delay` no hace absolutamente nada.
    */
    <ol className={`${estilos.pasos} revela-grilla`}>
      {pasos.map((paso) => (
        <li key={paso.titulo} className={estilos.paso}>
          <div className={estilos.pasoMarca} aria-hidden="true">
            <span className={estilos.pasoIcono}>{paso.icono}</span>
          </div>
          <div>
            <h3 className={estilos.pasoTitulo}>{paso.titulo}</h3>
            <p className={estilos.pasoTexto}>{paso.texto}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

const COMPRAR: PasoDeFlujo[] = [
  {
    icono: <IconoCamiseta tamanio={20} />,
    titulo: 'Elegís la camiseta',
    texto: (
      <>
        Podés mirar todo el catálogo sin cuenta. Filtrá por club, selección, marca o temporada: los
        filtros muestran sólo lo que hay publicado de verdad, así que ninguno te lleva a una lista
        vacía.
      </>
    ),
  },
  {
    icono: <IconoEtiqueta tamanio={20} />,
    titulo: 'Confirmás la dirección',
    texto: (
      <>
        Para comprar hace falta una cuenta con el email verificado. En ese momento el precio queda{' '}
        <strong>congelado en tu orden</strong>: aunque el vendedor lo cambie después, vos pagás el
        que aceptaste.
      </>
    ),
  },
  {
    icono: <IconoIntercambio tamanio={20} />,
    titulo: 'Pagás con Mercado Pago',
    texto: (
      <>
        El pago ocurre dentro de Mercado Pago. Offside nunca ve ni guarda los datos de tu tarjeta.
        Si pagás en efectivo, la orden se confirma sola cuando el pago se acredita.
      </>
    ),
  },
  {
    icono: <IconoAutenticado tamanio={20} />,
    titulo: 'El vendedor prepara el envío',
    texto: (
      <>
        Cuando Mercado Pago confirma el pago, la orden pasa a <strong>Pagada</strong> y el vendedor
        puede despachar. Lo vas siguiendo desde Mis compras.
      </>
    ),
  },
];

const VENDER: PasoDeFlujo[] = [
  {
    icono: <IconoAutenticado tamanio={20} />,
    titulo: 'Verificás tu email',
    texto: <>Es el requisito para operar en Offside, no sólo para vender.</>,
  },
  {
    icono: <IconoEtiqueta tamanio={20} />,
    titulo: 'Declarás tu identidad fiscal',
    texto: (
      <>
        Tu CUIT, CUIL o CDI. Se valida el formato y el dígito verificador.{' '}
        <strong>No se verifica contra ARCA</strong>: no prueba titularidad por sí solo, y preferimos
        decirlo.
      </>
    ),
  },
  {
    icono: <IconoIntercambio tamanio={20} />,
    titulo: 'Conectás Mercado Pago',
    texto: (
      <>
        Cobrás en tu propia cuenta. Nunca vemos tu contraseña: la autorización la das en Mercado
        Pago y podés revocarla desde ahí cuando quieras.
      </>
    ),
  },
  {
    icono: <IconoCamiseta tamanio={20} />,
    titulo: 'Publicás',
    texto: (
      <>
        Con las tres cosas, la habilitación es <strong>automática</strong>: no hay nadie revisando
        del otro lado ni una lista de espera.
      </>
    ),
  },
];

/**
 * ⚠️ ESTA LISTA ES LA PARTE MAS IMPORTANTE DE LA PANTALLA. Un marketplace nuevo
 * que promete todo se parece a una estafa; uno que dice qué le falta se parece a
 * un negocio. Todo lo de acá es verificable en el codigo: no hay modulo de
 * envios, no hay disputas, no hay reviews, no hay reputacion.
 */
const FALTANTES = [
  {
    titulo: 'No imprimimos la etiqueta ni seguimos el paquete.',
    texto:
      'No hay integración con ningún correo: el vendedor despacha por su cuenta y carga el número de seguimiento A MANO. Si se equivoca al tipearlo, el enlace no lleva a ninguna parte.',
  },
  {
    titulo: 'No hay compra protegida en el sentido legal.',
    texto:
      'Podés abrir un reclamo y hay un plazo para hacerlo, pero eso es un proceso NUESTRO: no es un seguro, no es una garantía y no reemplaza a Defensa del Consumidor.',
  },
  {
    titulo: 'No hay cuotas decididas por Offside.',
    texto:
      'Las que veas al pagar son las que ofrece Mercado Pago con tu medio de pago. Offside no agrega, no financia y no decide ninguna.',
  },
  {
    titulo: 'No hay chat entre comprador y vendedor.',
    texto:
      'Lo único que existe son las preguntas públicas de cada publicación. No hay mensajería privada, así que los datos de contacto se intercambian por fuera.',
  },
  {
    titulo: 'La autenticidad la declara el vendedor.',
    texto: 'Offside no verifica que una camiseta sea original. Lo que ves es lo que él afirma.',
  },
] as const;

const INDICE = [
  { id: 'comprar', numero: '01', texto: 'Comprar' },
  { id: 'vender', numero: '02', texto: 'Vender' },
  { id: 'la-plata', numero: '03', texto: 'La plata' },
  { id: 'confianza', numero: '04', texto: 'Confianza' },
  { id: 'el-envio', numero: '05', texto: 'El envío' },
  { id: 'lo-que-falta', numero: '06', texto: 'Lo que falta' },
] as const;

/**
 * Todo lo que esta pantalla dice del Config Store, leido de una vez.
 *
 * ⚠️ CADA LECTURA PUEDE FALTAR Y NINGUNA PUEDE VOLTEAR LA PANTALLA. `listTiers()`
 * TIRA (`noActiveTiers`) cuando `seller_tiers` esta vacia —que es exactamente el
 * estado que tuvo la tabla hasta hace poco—, y `getPromotionSettings()` tira si
 * la clave no esta sembrada. Esta pagina existe para explicar como funciona el
 * sistema: que se caiga entera porque una funcionalidad todavia no esta
 * configurada seria el peor cambio posible. Lo que falta simplemente NO SE
 * MUESTRA, que es la misma regla que aplica a las facetas vacias de `/buscar`.
 */
interface ReglasDeLaPantalla {
  basisPoints: number;
  tiers: TierSummary[];
  promocion: { commissionMultiplier: number; durationDays: number } | null;
  envio: { defaultMode: ShippingMode; pickupAllowed: boolean; toAgreeAllowed: boolean } | null;
  plazos: { reclamoDias: number; proteccionDias: number } | null;
}

/** Devuelve `null` en vez de propagar: ver el comentario de `ReglasDeLaPantalla`. */
async function opcional<T>(promesa: Promise<T>, que: string): Promise<T | null> {
  try {
    return await promesa;
  } catch (error) {
    console.error(`[como-funciona] no se pudo leer ${que}`, error);

    return null;
  }
}

async function leerReglas(): Promise<ReglasDeLaPantalla> {
  const [basisPoints, tiers, promociones, promocion, envio, reclamoDias, proteccionDias] =
    await Promise.all([
      getCommissionRateBasisPoints(),
      opcional(listTiers(), 'los niveles de vendedor'),
      opcional(isFeatureEnabled('promotions'), 'el interruptor de promociones'),
      opcional(getPromotionSettings(), 'los parámetros de promoción'),
      opcional(getShippingSettings(), 'la configuración de envío'),
      opcional(getDisputeWindowDays(), 'el plazo de reclamo'),
      opcional(getBuyerProtectionDays(), 'la ventana de protección'),
    ]);

  return {
    basisPoints,
    tiers: tiers ?? [],
    // Con la funcionalidad apagada no se explica: seria describir algo que hoy
    // nadie puede contratar.
    promocion: promociones === true ? promocion : null,
    envio,
    plazos:
      reclamoDias === null || proteccionDias === null ? null : { reclamoDias, proteccionDias },
  };
}

/**
 * Cómo funciona Offside.
 *
 * ⚠️ NO ES UNA PAGINA DE MARKETING, Y ESA ES LA DECISION DE DISEÑO. En un
 * marketplace de segunda mano donde el riesgo central es la falsificación, la
 * confianza no se construye con adjetivos: se construye diciendo exactamente
 * cómo funciona el dinero y qué NO hace todavía la plataforma.
 *
 * ⚠️ NINGUNA CIFRA ESTA ESCRITA A MANO. La comisión se lee del Config Store
 * (`app_settings`, ⚙️ CONFIGURABLE, CLAUDE.md §12): escribir "6%" acá la
 * volvería a clavar en el código, y el día que el owner la cambie esta pantalla
 * mentiría. Es también el motivo por el que no hay ninguna barra de reparto
 * dibujada: mostrar "comisión / resto" sugeriría que el vendedor recibe
 * exactamente el complemento, y el costo de Mercado Pago —que no es nuestro y no
 * es configurable— se descuenta de su lado.
 *
 * ⚠️ NO HAY TERMINOS NI POLITICA DE PRIVACIDAD, y no es un olvido: redactarlos
 * es 🔴 (`docs/01-business/legal.md`). Esta pantalla explica el funcionamiento,
 * no reemplaza un documento legal, y no se presenta como si lo hiciera.
 */
export default async function ComoFunciona() {
  const { basisPoints, tiers, promocion, envio, plazos } = await leerReglas();

  /**
   * Los modos de envío que hoy se pueden declarar.
   *
   * ⚠️ NO SE USA `allowedShippingModes()` AUNQUE EXISTA. Esa función decide qué
   * puede ELEGIR el vendedor al publicar; esta pantalla le explica al COMPRADOR
   * qué puede llegar a leer en una ficha, y las publicaciones viejas conservan
   * un modo que hoy podría estar deshabilitado. Se muestran los cuatro y se
   * marca cuál rige por defecto.
   */
  const modosDeEnvio = SHIPPING_MODES;

  return (
    <>
      <Header />

      {/*
        Progreso de lectura.

        ⚠️ VA `aria-hidden` Y FUERA DE `Pantalla`, igual que el de la vitrina: es
        informacion redundante para un lector de pantalla —ya sabe donde esta
        parado en el documento— y es `position: fixed`, asi que no tiene por que
        entrar en la captura de la transicion de pantalla. Adentro, el navegador
        lo snapshotea junto con el contenido y durante la transicion la barra
        viaja con el, que es exactamente lo que un elemento anclado al viewport
        no tiene que hacer.
      */}
      <div className={estilos.lectura} aria-hidden="true" />

      <Pantalla>
        <main id="contenido">
          {/* ------------------------------------------------------ portada */}
          <section className={`${estilos.portada} sup-cancha`}>
            <div className={estilos.portadaTrama} aria-hidden="true">
              <div className={`${estilos.portadaTramaCapa} patron-vivo`} />
            </div>

            <div className={estilos.portadaInterior}>
              <p className={`${estilos.antetitulo} entra`}>Cómo funciona</p>

              {/*
                ⚠️ EL CORTE DE LINEA ESTA ESCRITO A MANO Y ES COMPOSICION, no un
                atajo: no hay forma de partir un titular en lineas con CSS sin
                JavaScript, y cada linea necesita su propia mascara para poder
                subir desde atras. Es texto fijo y corto: decidir donde corta es
                exactamente lo que se hace en una revista.
              */}
              <h1 className="display entra-lineas">
                <span>
                  <span>Sin</span>
                </span>
                <span>
                  <span className="oblicuo">vueltas</span>
                </span>
              </h1>

              <p
                className={`${estilos.bajada} entra`}
                style={{ '--retraso': '320ms' } as CSSProperties}
              >
                Offside conecta a quien vende una camiseta con quien la está buscando. El dinero
                pasa por Mercado Pago y el vendedor cobra en su propia cuenta. Acá está todo lo que
                pasa, y también lo que todavía no.
              </p>
            </div>
          </section>

          {/* ------------------------------------------------------- indice */}
          <nav className={estilos.indice} aria-label="Contenido de esta página">
            <ol className={estilos.indiceLista}>
              {INDICE.map((item) => (
                <li key={item.id}>
                  {/*
                    ⚠️ EL SUBRAYADO ENVUELVE SOLO LA ETIQUETA Y NO ES LA GLOBAL
                    `subraya`: esa dibuja el filete contra el borde de abajo de
                    la caja de relleno, y acá ese borde esta 12px debajo del
                    texto —el relleno que da el area tactil de 44px—, o sea
                    encima de la regla de la fila. La zona sensible sigue siendo
                    el enlace entero.
                  */}
                  <a href={`#${item.id}`} className={estilos.indiceEnlace}>
                    <span className={estilos.indiceNumero} aria-hidden="true">
                      {item.numero}
                    </span>
                    <span className={estilos.indiceTexto}>{item.texto}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          {/* ------------------------------------------------------ comprar */}
          <section id="comprar" className={estilos.tramo}>
            <div className={estilos.tramoInterior}>
              <header className={estilos.tramoEncabezado}>
                <p className={estilos.tramoRotulo}>01 · Para comprar</p>
                <h2 className={`${estilos.tramoTitulo} display-3`}>Elegís, pagás, te llega</h2>
                <span className={`${estilos.tramoFilete} revela-linea`} aria-hidden="true" />
              </header>
              <Secuencia pasos={COMPRAR} />
            </div>
          </section>

          {/* ------------------------------------------------------- vender */}
          <section id="vender" className={`${estilos.tramoTenido} sup-2 con-grano`}>
            <div className={estilos.tramoInterior}>
              <header className={estilos.tramoEncabezado}>
                <p className={estilos.tramoRotulo}>02 · Para vender</p>
                <h2 className={`${estilos.tramoTitulo} display-3`}>Tres requisitos y publicás</h2>
                <span className={`${estilos.tramoFilete} revela-linea`} aria-hidden="true" />
              </header>
              <Secuencia pasos={VENDER} />
            </div>
          </section>

          {/* ----------------------------------------------------- la plata */}
          <section id="la-plata" className={`${estilos.plata} sup-noche con-grano`}>
            {/* Cinta de seccion (identidad §05), en su escala real y en deriva. */}
            <div className={`${estilos.cinta} patron-vivo patron-vivo-cinta`} aria-hidden="true" />

            <div className={estilos.plataInterior}>
              <p className={estilos.plataRotulo}>03 · La plata</p>
              <h2 className={`${estilos.plataTitulo} display-3`}>Quién cobra qué</h2>

              {/*
                ⚠️ EL PORCENTAJE SALE DEL CONFIG STORE, NO DEL CODIGO. Y entra
                animado UNA VEZ: `cifra-entra` lo levanta detras de su mascara
                mostrando el valor FINAL desde el primer cuadro. Nada de contar
                hacia arriba — es plata que se le descuenta a alguien.
              */}
              <span className={`${estilos.cifra} cifra-entra`}>
                <span>{basisPointsToPercent(basisPoints)}</span>
              </span>
              <p className={estilos.cifraPie}>Es lo que retiene Offside de cada venta</p>

              <p className={estilos.plataTexto}>
                El resto va <strong>directo a la cuenta de Mercado Pago del vendedor</strong>. No
                hay un paso intermedio en el que Offside tenga el dinero: el reparto lo hace Mercado
                Pago dentro del mismo pago.
              </p>
              <p className={estilos.plataTexto}>
                El costo de procesamiento que cobra Mercado Pago se descuenta del lado del vendedor,
                así que la comisión de Offside es limpia.
              </p>

              {/*
                NIVELES DE VENDEDOR (DEC-037).

                ⚠️ NI UN SOLO PORCENTAJE ESCRITO A MANO: cada tasa sale de
                `seller_tiers` y, cuando el nivel no fija una propia, de la
                comisión global. `usesGlobalRate` existe justamente para que la
                pantalla NO tenga que adivinar qué significa un `null`.

                ⚠️ NO SE MUESTRA SI LA TABLA ESTÁ VACÍA. Un bloque "Niveles" con
                cero filas promete un sistema de beneficios que no existe.
              */}
              {tiers.length > 0 && (
                <div className={estilos.bloqueNiveles}>
                  <h3 className={estilos.plataSubtitulo}>Cuántas ventas llevás cambia la tasa</h3>
                  <p className={estilos.plataTexto}>
                    La comisión no es la misma para todos: sube de nivel con las ventas completadas
                    y baja el porcentaje que retiene Offside.
                  </p>

                  <ul className={estilos.niveles}>
                    {tiers.map((tier) => (
                      <li key={tier.code} className={estilos.nivel}>
                        <InsigniaDeNivel
                          nombre={tier.name}
                          tasa={porcentajeDeComision(tier.basisPoints)}
                        />
                        <p className={estilos.nivelDetalle}>
                          {tier.minCompletedSales === 0
                            ? 'Desde la primera publicación.'
                            : `Desde ${cantidad(tier.minCompletedSales, 'venta')} completadas.`}
                          {tier.usesGlobalRate && ' Usa la comisión general.'}
                        </p>
                        {tier.description !== null && (
                          <p className={estilos.nivelDetalle}>{tier.description}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/*
                PROMOCIONADAS (PS-021).

                ⚠️ EL MULTIPLICADOR Y LOS DÍAS SALEN DEL CONFIG STORE. Escribir
                "el triple durante 7 días" acá volvería a clavar en el código dos
                valores que Admin cambia sin redeploy — el mismo error que la
                comisión ya no comete.

                ⚠️ SE DICE QUE **NO SE PUEDE CANCELAR ANTES DE TIEMPO**, que es la
                parte incómoda y la que más importa saber antes de contratarla.
                Una página que explica el beneficio y esconde el compromiso es
                publicidad, no una explicación.
              */}
              {promocion !== null && (
                <div className={estilos.bloqueNiveles}>
                  <h3 className={estilos.plataSubtitulo}>Aparecer primero se paga con comisión</h3>
                  <p className={estilos.plataTexto}>
                    Un vendedor puede promocionar una publicación: durante{' '}
                    <strong>{cantidad(promocion.durationDays, 'día')}</strong> aparece antes que el
                    resto en la vitrina y en la búsqueda, con el cartel{' '}
                    <strong>“Promocionada”</strong> a la vista. No se paga por adelantado: si esa
                    publicación se vende, la comisión de esa venta se multiplica por{' '}
                    <strong>{multiplicador(promocion.commissionMultiplier)}</strong>.
                  </p>
                  <p className={estilos.plataTexto}>
                    El multiplicador queda congelado el día que se contrata, así que un cambio
                    posterior no la afecta — y la promoción <strong>no se puede cancelar</strong>{' '}
                    antes de que termine.
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* ----------------------------------------------------- confianza */}
          <section id="confianza" className={estilos.tramo}>
            <div className={estilos.tramoInterior}>
              <header className={estilos.tramoEncabezado}>
                <p className={estilos.tramoRotulo}>04 · Confianza</p>
                <h2 className={`${estilos.tramoTitulo} display-3`}>Números, no adjetivos</h2>
                <span className={`${estilos.tramoFilete} revela-linea`} aria-hidden="true" />
              </header>

              {/*
                ⚠️ ESTE BLOQUE NO PUEDE PROMETER UN SELLO. DEC-036 y TS-020 son
                explícitos: el score es DERIVADO y no decide nada. Lo que se
                muestra en una ficha son las métricas crudas —ventas, reclamos,
                cuánto tarda en responder, promedio de reseñas— porque son
                verificables; "vendedor confiable" no lo es.
              */}
              <div className={estilos.dobleColumna}>
                <div className={estilos.bloqueTexto}>
                  <h3 className={estilos.bloqueTitulo}>Reputación</h3>
                  <p className={estilos.bloqueParrafo}>
                    Cada vendedor muestra lo que hizo, no una medalla: cuántas ventas completó,
                    cuántos reclamos tiene, cuánto tarda en responder preguntas y el promedio de las
                    reseñas que le dejaron los compradores.
                  </p>
                  <p className={estilos.bloqueParrafo}>
                    Las reseñas las escribe quien <strong>compró de verdad</strong>, sobre una orden
                    completada. El vendedor puede responderlas una vez, y su respuesta queda abajo
                    de la reseña: no puede borrarla ni editarla.
                  </p>
                  <p className={estilos.bloqueParrafo}>
                    Un vendedor nuevo no tiene números todavía, y la ficha lo dice con esas
                    palabras. No aparece con cero estrellas, que se leería como “lo calificaron
                    mal”.
                  </p>
                </div>

                <div className={estilos.bloqueTexto}>
                  <h3 className={estilos.bloqueTitulo}>Reclamos</h3>
                  <p className={estilos.bloqueParrafo}>
                    Si el paquete no llega o llega distinto a lo publicado, se abre un reclamo sobre
                    esa orden
                    {plazos === null
                      ? ''
                      : `, dentro de los ${cantidad(plazos.reclamoDias, 'día')} posteriores`}
                    . El vendedor tiene su turno para responder con su versión y sus fotos, y si no
                    se resuelve entre las partes lo decide Offside.
                  </p>
                  {plazos !== null && (
                    <p className={estilos.bloqueParrafo}>
                      Una orden entregada se cierra sola después de{' '}
                      <strong>{cantidad(plazos.proteccionDias, 'día')}</strong> sin reclamo. Ese es
                      el plazo que tenés para revisar lo que recibiste.
                    </p>
                  )}
                  <p className={estilos.bloqueParrafo}>
                    Y cualquiera puede <strong>reportar una publicación</strong> desde su ficha
                    —réplica vendida como original, fotos que no son del producto, descripción
                    engañosa—. El reporte va a moderación; no baja la publicación sola.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* ------------------------------------------------------ el envío */}
          <section id="el-envio" className={`${estilos.tramoTenido} sup-2 con-grano`}>
            <div className={estilos.tramoInterior}>
              <header className={estilos.tramoEncabezado}>
                <p className={estilos.tramoRotulo}>05 · El envío</p>
                <h2 className={`${estilos.tramoTitulo} display-3`}>Lo declara el vendedor</h2>
                <span className={`${estilos.tramoFilete} revela-linea`} aria-hidden="true" />
              </header>

              {/*
                ⚠️ ESTA SECCIÓN EXISTE PORQUE NO HAY COTIZACIÓN. `shipping.md` deja
                "quién paga" 🟡 y no hay integración con ningún correo, así que lo
                ÚNICO que el comprador puede saber es lo que quien vende declaró.
                Decirlo así es lo contrario de simular un cálculo de envío.

                ⚠️ LAS ETIQUETAS SALEN DE `shippingModeLabel`, que es la misma
                función que usan la vitrina, la ficha y la búsqueda. Escribirlas
                a mano acá haría que el día que cambie una, esta página diga otra
                cosa que el resto del sitio.
              */}
              <p className={estilos.bloqueParrafo}>
                Offside no cotiza el envío ni imprime etiquetas. Cada publicación dice cuál de estas
                cuatro modalidades eligió el vendedor, y ese dato viaja congelado a la orden: si
                después la cambia, tu compra no se entera.
              </p>

              <ul className={estilos.modos}>
                {modosDeEnvio.map((modo) => (
                  <li key={modo} className={estilos.modo}>
                    <span className={estilos.modoMarca} aria-hidden="true" />
                    <span className={estilos.modoNombre}>{shippingModeLabel(modo)}</span>
                    {envio?.defaultMode === modo && (
                      <span className={estilos.modoDefecto}>Es lo que rige si no elige nada</span>
                    )}
                  </li>
                ))}
              </ul>

              <p className={estilos.bloqueParrafo}>
                Cuando el envío corre por tu cuenta, el importe está declarado en la publicación y
                se suma al total antes de pagar. Cuando dice “a convenir”, no hay un número: lo
                arreglan por las preguntas de la publicación antes de comprar.
              </p>
            </div>
          </section>

          {/* ------------------------------------------------ lo que falta */}
          <section id="lo-que-falta" className={estilos.falta}>
            <div className={estilos.tramoInterior}>
              <header className={estilos.tramoEncabezado}>
                <hr className={estilos.faltaRegla} />
                <p className={estilos.tramoRotulo}>06 · Sin maquillaje</p>
                <h2 className={`${estilos.tramoTitulo} display-3`}>Lo que todavía no hacemos</h2>
              </header>

              <p className={estilos.faltaLead}>
                Preferimos decirlo acá y no que te enteres comprando.
              </p>

              {/*
                El rombo HUECO es el mismo vocabulario de forma que ya usa la
                primitiva `Pasos`: lleno = hecho, hueco = pendiente. Quien no
                distingue colores lee igual la diferencia.
              */}
              <ul className={`${estilos.faltantes} revela-grilla`}>
                {FALTANTES.map((item) => (
                  <li key={item.titulo} className={estilos.faltante}>
                    <span className={estilos.faltanteMarca} aria-hidden="true" />
                    <div>
                      <h3 className={estilos.faltanteTitulo}>{item.titulo}</h3>
                      <p className={estilos.faltanteTexto}>{item.texto}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* ------------------------------------------------------- cierre */}
          <section className={`${estilos.cierre} sup-cancha`}>
            <div className={estilos.cierreInterior}>
              <p className={estilos.cierreRotulo}>Ya está</p>
              <p className={`${estilos.cierreTitulo} display display-3 oblicuo revela-suave`}>
                Empezá por acá
              </p>
              <p className={estilos.cierreBajada}>
                Mirar el catálogo no pide cuenta. Publicar pide tres cosas y se aprueba solo.
              </p>
              <FilaDeAcciones>
                <BotonEnlace href="/buscar" flecha>
                  Ver camisetas
                </BotonEnlace>
                <BotonEnlace href="/vendedor/empezar" variante="secundario">
                  Empezar a vender
                </BotonEnlace>
              </FilaDeAcciones>
            </div>
          </section>
        </main>
      </Pantalla>

      <Footer />
    </>
  );
}
