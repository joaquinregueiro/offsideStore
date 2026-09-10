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
import { BotonEnlace, FilaDeAcciones } from '@/components/ui';
import {
  basisPointsToPercent,
  getCommissionRateBasisPoints,
} from '@/modules/config/services/settings.service';

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
    titulo: 'No calculamos el envío.',
    texto:
      'El total de una compra no lo incluye, y todavía no hay seguimiento dentro de Offside. Lo arreglan el comprador y el vendedor por su cuenta.',
  },
  {
    titulo: 'No hay reseñas ni reputación.',
    texto:
      'Ningún vendedor tiene puntaje, y no mostramos sellos de confianza que no podamos respaldar.',
  },
  {
    titulo: 'No hay un sistema de reclamos.',
    texto:
      'Si algo sale mal, todavía no existe un camino automático dentro del producto para resolverlo.',
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
  { id: 'lo-que-falta', numero: '04', texto: 'Lo que falta' },
] as const;

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
  const basisPoints = await getCommissionRateBasisPoints();

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
            </div>
          </section>

          {/* ------------------------------------------------ lo que falta */}
          <section id="lo-que-falta" className={estilos.falta}>
            <div className={estilos.tramoInterior}>
              <header className={estilos.tramoEncabezado}>
                <hr className={estilos.faltaRegla} />
                <p className={estilos.tramoRotulo}>04 · Sin maquillaje</p>
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
