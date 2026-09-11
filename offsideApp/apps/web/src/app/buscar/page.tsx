import type { Metadata } from 'next';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { IconoBuscar, IconoCerrar, IconoFiltro } from '@/components/iconos';
import { ListingCard, type EstadoDeFavorito } from '@/components/listing-card';
import { Pantalla } from '@/components/movimiento';
import { Aviso, BotonEnlace } from '@/components/ui';
import { condicion, manga, precio, tipoDeCamiseta } from '@/lib/formato';
import { getSessionUser } from '@/lib/session';
import { favoriteIdsOf } from '@/modules/favorites/services/favorite.service';
import {
  POR_PAGINA,
  searchListings,
  type Faceta,
  type SearchResponse,
} from '@/modules/listings/services/search.service';

import estilos from './page.module.css';

export const metadata: Metadata = { title: 'Buscar' };

/**
 * ⚠️ SIN CACHE, igual que la vitrina. Los resultados dependen del stock y del
 * estado de cada publicación: mostrar algo que ya se vendió lleva a un checkout
 * que falla.
 */
export const dynamic = 'force-dynamic';

/** Las claves de faceta que devuelve el Service, para que un typo no compile. */
type ClaveDeFaceta = keyof SearchResponse['facetas'];

interface FiltroActivo {
  clave: string;
  titulo: string;
  etiqueta: string;
}

/**
 * Cuantos valores devuelve como maximo cada faceta.
 *
 * ⚠️ ES UNA COPIA DE `MAX_VALORES_POR_FACETA`, QUE VIVE EN EL REPOSITORIO
 * (`listings/repositories/search.repository.ts`), Y ESO ES DEUDA CONOCIDA. Hace
 * falta para poder DECIR que la lista esta recortada —hay 38 clubes sembrados y
 * se muestran 12: sin el aviso la lista miente por omision—. El arreglo correcto
 * es re-exportarla desde el Service al lado de `POR_PAGINA`, por el mismo motivo
 * que ese comentario ya explica; una pantalla no puede importar un repositorio
 * sin saltearse una capa, y la capa de datos no es de esta superficie. Si alguien
 * cambia el numero alla, cambiarlo aca.
 */
const TOPE_DE_FACETA = 12;

/**
 * Los grupos de facetas, en orden.
 *
 * ⚠️ SON DATOS Y NO DIEZ LLAMADAS SUELTAS: la lista se recorre dos veces —para
 * las pastillas de filtros activos y para el panel— sin repetirla, que es como
 * los dos lados terminan diciendo cosas distintas.
 */
const GRUPOS: {
  titulo: string;
  /** Nombre del parametro en la URL. */
  clave: string;
  faceta: ClaveDeFaceta;
  etiquetar?: (valor: string) => string;
}[] = [
  // El catálogo va PRIMERO: club y marca son lo que la gente busca de verdad
  // en una camiseta. Categoría y talle son secundarios.
  { titulo: 'Club', clave: 'club', faceta: 'club' },
  { titulo: 'Selección', clave: 'seleccion', faceta: 'seleccion' },
  { titulo: 'Marca', clave: 'marca', faceta: 'marca' },
  { titulo: 'Temporada', clave: 'temporada', faceta: 'temporada' },
  { titulo: 'Competencia', clave: 'competicion', faceta: 'competicion' },
  { titulo: 'Categoría', clave: 'categoria', faceta: 'categoria' },
  { titulo: 'Talle', clave: 'talle', faceta: 'talle' },
  { titulo: 'Estado', clave: 'condicion', faceta: 'condicion', etiquetar: condicion },
  { titulo: 'Tipo', clave: 'kit', faceta: 'tipoDeCamiseta', etiquetar: tipoDeCamiseta },
  { titulo: 'Mangas', clave: 'manga', faceta: 'manga', etiquetar: manga },
];

/**
 * Los valores de `orden` que el Service acepta.
 *
 * ⚠️ EXISTE PARA VALIDAR, NO PARA DOCUMENTAR. Antes el parametro se CASTEABA
 * (`as 'relevancia' | …`), asi que `?orden=cualquiera` entraba tal cual: el
 * repositorio caia en relevancia por su `else`, ninguna pastilla quedaba
 * marcada —la comparacion era contra el texto crudo— y la basura se copiaba a
 * los diez enlaces de faceta, a los ocultos de los dos formularios y a la
 * paginacion. La URL terminaba diciendo una cosa y la pantalla mostrando otra.
 */
const ORDENES_VALIDOS = [
  'relevancia',
  'precio_asc',
  'precio_desc',
  'recientes',
  'reputacion',
] as const;

type Orden = (typeof ORDENES_VALIDOS)[number];

/**
 * Los cinco ordenes posibles. `undefined` es el de por defecto.
 *
 * ⚠️ "MEJOR REPUTACIÓN" ORDENA POR EL SCORE DEL VENDEDOR, QUE ES DERIVADO Y NO
 * DECIDE NADA (DEC-036 / TS-020). Sirve para ordenar, no para etiquetar: la
 * pantalla no dice "vendedor confiable" en ningún lado, y un vendedor sin
 * proyeccion todavia —uno nuevo— no queda AFUERA de los resultados, queda al
 * final (`NULLS LAST` en el repositorio).
 *
 * ⚠️ "POPULARIDAD" NO ESTÁ, aunque PS-021 la nombre: no hay metricas de visitas
 * ni de ventas por publicacion. Una opcion que ordene por algo que no se mide
 * es una opcion que miente.
 */
const ORDENES: { valor: Orden | undefined; texto: string; soloConTexto?: boolean }[] = [
  { valor: undefined, texto: 'Relevancia' },
  { valor: 'precio_asc', texto: 'Menor precio' },
  { valor: 'precio_desc', texto: 'Mayor precio' },
  { valor: 'reputacion', texto: 'Mejor reputación' },
  { valor: 'recientes', texto: 'Más recientes', soloConTexto: true },
];

/**
 * Búsqueda (PS-020 … PS-024).
 *
 * ⚠️ TODO VIAJA EN LA URL, por GET. Una búsqueda tiene que poder compartirse,
 * guardarse en favoritos y volver con el botón atrás. Guardar el estado en el
 * cliente rompería las tres cosas, y además obligaría a JavaScript para algo
 * que el navegador ya sabe hacer.
 *
 * ⚠️ UNA FACETA VACÍA NO SE MUESTRA. Los campos de catálogo son opcionales al
 * publicar, así que puede no haber ninguna camiseta con club cargado. Ofrecer
 * un filtro que no filtra nada es peor que no ofrecerlo.
 */
export default async function Buscar({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const uno = (clave: string): string | undefined => {
    const valor = params[clave];
    const texto = Array.isArray(valor) ? valor[0] : valor;

    return texto === undefined || texto.trim() === '' ? undefined : texto.trim();
  };

  const q = uno('q');

  /**
   * ⚠️ EL PRECIO VIAJA EN PESOS Y SE GUARDA EN CENTAVOS. En la URL van pesos
   * enteros porque es lo que la persona escribe y lo que va a leer si comparte
   * el enlace; la base guarda `bigint` en centavos (regla dura del ERD: dinero
   * nunca es float). Un valor que no sea un entero no negativo se descarta en
   * silencio: es un filtro, no un formulario que tenga que retar a nadie.
   */
  const aCentavos = (texto: string | undefined): bigint | undefined => {
    if (texto === undefined) return undefined;
    const pesos = Number.parseInt(texto, 10);

    return Number.isSafeInteger(pesos) && pesos >= 0 ? BigInt(pesos) * 100n : undefined;
  };

  const precioMin = aCentavos(uno('precioMin'));
  const precioMax = aCentavos(uno('precioMax'));

  /**
   * ⚠️ EL ORDEN SE VALIDA Y ADEMAS SE NORMALIZA, Y LA SEGUNDA MITAD NO ES
   * COSMETICA: sin texto, `recientes` YA ES el orden por defecto del Service
   * (`orden: query.orden ?? (texto === undefined ? 'recientes' : 'relevancia')`).
   * Con `?orden=recientes` y sin `q`, la unica pastilla que se dibuja es la del
   * defecto —la de `recientes` se esconde por `soloConTexto`— y ninguna quedaba
   * marcada, aunque los resultados SI estaban ordenados por fecha. Colapsarlo a
   * `undefined` hace que la pastilla activa diga la verdad y saca de la URL un
   * parametro que no cambia nada.
   */
  const ordenCrudo = uno('orden');
  const ordenPedido: Orden | undefined = ORDENES_VALIDOS.find((o) => o === ordenCrudo);
  const orden = ordenPedido === 'recientes' && q === undefined ? undefined : ordenPedido;

  /**
   * ⚠️ LA BUSQUEDA NO PAGINABA Y EL SERVICE YA SABIA HACERLO. `searchListings`
   * acepta `pagina`, recorta de a `POR_PAGINA` y devuelve el `total` real.
   */
  const pagina = Math.max(1, Number.parseInt(uno('pagina') ?? '1', 10) || 1);

  const resultado = await searchListings({
    pagina,
    ...(q === undefined ? {} : { texto: q }),
    ...(uno('categoria') === undefined ? {} : { categoryId: uno('categoria')! }),
    ...(uno('talle') === undefined ? {} : { sizeValue: uno('talle')! }),
    ...(uno('condicion') === undefined ? {} : { condition: uno('condicion')! }),
    ...(uno('kit') === undefined ? {} : { kitType: uno('kit')! }),
    ...(uno('manga') === undefined ? {} : { sleeve: uno('manga')! }),
    ...(uno('club') === undefined ? {} : { clubId: uno('club')! }),
    ...(uno('seleccion') === undefined ? {} : { nationalTeamId: uno('seleccion')! }),
    ...(uno('marca') === undefined ? {} : { brandId: uno('marca')! }),
    ...(uno('competicion') === undefined ? {} : { competitionId: uno('competicion')! }),
    ...(uno('temporada') === undefined ? {} : { seasonId: uno('temporada')! }),
    ...(precioMin === undefined ? {} : { precioMin }),
    ...(precioMax === undefined ? {} : { precioMax }),
    ...(orden === undefined ? {} : { orden }),
  });

  /**
   * La sesión, después de la búsqueda.
   *
   * ⚠️ VA DESPUES DE `searchListings` Y NO ADENTRO DE SU `Promise.all` porque
   * los favoritos NECESITAN los ids de los resultados: sin ellos habria que
   * pedir los favoritos de toda la cuenta.
   *
   * ⚠️ YA NO SE CRUZA CONTRA `listPromotedCatalog`. `SearchResult.promocionada`
   * viene de la fila: el cruce pedia las 60 promocionadas de la vitrina y
   * buscaba cada id ahi adentro, asi que la promocionada numero 61 dejaba de
   * mostrar su distintivo sin que nada fallara.
   */
  const user = await getSessionUser();

  const favoritos =
    user === null
      ? new Set<string>()
      : await favoriteIdsOf(
          user,
          resultado.resultados.map((item) => item.id),
        );

  /** Conserva los demás filtros al tocar uno: las facetas se combinan (PS-020). */
  const conFiltro = (clave: string, valor: string | undefined): string => {
    const siguientes = new URLSearchParams();

    for (const [k, v] of Object.entries(params)) {
      const texto = Array.isArray(v) ? v[0] : v;
      /*
        ⚠️ CAMBIAR UN FILTRO VUELVE A LA PAGINA 1. Sin esto, alguien parado en
        la pagina 3 que agrega "Talle M" cae en la pagina 3 de un resultado que
        quizas tiene una sola: pantalla vacia, sin explicacion y con el filtro
        aplicado.
      */
      if (k === 'pagina' && clave !== 'pagina') continue;
      /*
        ⚠️ EL AVISO NUNCA SE ARRASTRA. Es el resultado de UNA acción que falló;
        copiado a los diez enlaces de faceta y a la paginación, el cartel de
        "no pudimos guardar" seguiría a la persona por toda la búsqueda.
      */
      if (k === 'aviso') continue;
      /*
        ⚠️ UN `orden` INVALIDO O REDUNDANTE NO SE COPIA. Sin esto viaja intacto a
        los diez enlaces de faceta y a la paginacion: la URL sigue diciendo
        `orden=cualquiera` mientras la pantalla ordena por relevancia.
      */
      if (k === 'orden' && orden === undefined && clave !== 'orden') continue;
      if (texto !== undefined && texto !== '' && k !== clave) siguientes.set(k, texto);
    }

    if (valor !== undefined) siguientes.set(clave, valor);

    const query = siguientes.toString();

    return query === '' ? '/buscar' : `/buscar?${query}`;
  };

  /**
   * Campos ocultos de un `<form method="get">`: todo lo que hay en la URL menos
   * lo que ese formulario controla.
   *
   * ⚠️ SE DERIVA DE `params`, NO DE UNA LISTA ESCRITA A MANO. La version vieja
   * escupia un hidden por cada filtro de `activos`, asi que cualquier parametro
   * que no estuviera en `GRUPOS` —el orden, el precio— se perdia al enviar.
   */
  const ocultos = (excepto: string[]): ReactNode[] =>
    Object.entries(params).flatMap(([k, v]) => {
      const texto = Array.isArray(v) ? v[0] : v;
      if (texto === undefined || texto === '' || excepto.includes(k)) return [];
      // Mismo criterio que `conFiltro`: un orden que no existe no se reinyecta.
      if (k === 'orden' && orden === undefined) return [];
      // Ni el aviso de un guardado fallido, que no es un filtro.
      if (k === 'aviso') return [];

      return [<input key={k} type="hidden" name={k} value={texto} />];
    });

  /**
   * La URL de ESTA búsqueda, tal cual, para volver después de guardar.
   *
   * ⚠️ NO SE REUSA `conFiltro`: esa función tira `pagina` a propósito —cambiar un
   * filtro vuelve a la página 1— y acá pasa lo contrario, hay que conservarla.
   * Quien guarda una camiseta en la página 3 de una búsqueda filtrada tiene que
   * volver a la página 3 de esa misma búsqueda.
   *
   * ⚠️ `aviso` NO SE ARRASTRA. Si viajara, el cartel de error quedaría pegado en
   * la URL para siempre: reaparecería en el siguiente guardado aunque hubiera
   * salido bien.
   */
  const urlDeVuelta = ((): string => {
    const siguientes = new URLSearchParams();

    for (const [k, v] of Object.entries(params)) {
      const texto = Array.isArray(v) ? v[0] : v;
      if (k === 'aviso') continue;
      if (k === 'orden' && orden === undefined) continue;
      if (texto !== undefined && texto !== '') siguientes.set(k, texto);
    }

    const query = siguientes.toString();

    return `${query === '' ? '/buscar' : `/buscar?${query}`}#resultados`;
  })();

  const avisoDeFavorito = uno('aviso') === 'favorito';

  /**
   * El rango real de precios del resultado completo, ya formateado.
   *
   * ⚠️ LOS DOS EXTREMOS VIENEN O NO VIENEN JUNTOS. `precios` es `null` en los
   * dos campos cuando la búsqueda no devolvió nada; un mínimo sin máximo no
   * existe, y comprobar los dos evita dibujar "De $12.000 a —".
   */
  const rangoDePrecios =
    resultado.precios.minimo === null || resultado.precios.maximo === null
      ? null
      : {
          /*
            ⚠️ SIN MONEDA EXPLICITA: `precio` cae en ARS, que es la única que
            existe hoy. El rango es del resultado ENTERO y no de una fila, así
            que no hay un `currency` que copiarle — el día que haya más de una
            moneda, este renglón deja de tener sentido y el Service tendrá que
            decir cuál es.
          */
          desde: precio(resultado.precios.minimo),
          hasta: precio(resultado.precios.maximo),
        };

  /** Lo que la ficha necesita para su corazón, o `undefined` si no hay sesión. */
  const favoritoDe = (id: string): EstadoDeFavorito | undefined =>
    user === null ? undefined : { activo: favoritos.has(id), volverA: urlDeVuelta };

  const facetasDe = (nombre: ClaveDeFaceta): Faceta[] => resultado.facetas[nombre];

  /**
   * Filtros aplicados, con su nombre legible.
   *
   * ⚠️ ESTO ES LO QUE MAS FALTABA DE LA BÚSQUEDA. Con diez grupos de facetas y
   * el panel plegado en el teléfono, no había forma de saber qué filtros
   * estaban puestos: la única señal era una opción en negrita, perdida en una
   * lista larga que en móvil ni siquiera se veía.
   */
  const activos: FiltroActivo[] = [
    ...GRUPOS.flatMap((grupo): FiltroActivo[] => {
      const valor = uno(grupo.clave);
      if (valor === undefined) return [];

      const faceta = facetasDe(grupo.faceta).find((f) => f.valor === valor);
      const etiqueta = grupo.etiquetar?.(valor) ?? faceta?.etiqueta ?? valor;

      return [{ clave: grupo.clave, titulo: grupo.titulo, etiqueta }];
    }),
    ...(uno('precioMin') === undefined
      ? []
      : [{ clave: 'precioMin', titulo: 'Desde', etiqueta: `$${uno('precioMin')!}` }]),
    ...(uno('precioMax') === undefined
      ? []
      : [{ clave: 'precioMax', titulo: 'Hasta', etiqueta: `$${uno('precioMax')!}` }]),
  ];

  const hayFiltros = activos.length > 0 || q !== undefined;
  const paginas = Math.max(1, Math.ceil(resultado.total / POR_PAGINA));

  /*
    ⚠️ LA PAGINA SE ACOTA ANTES DE MOSTRAR NADA. Con `?pagina=99` sobre 50
    resultados, el calculo crudo daba «0–2352 de 50» al lado del estado vacio, y
    el riel `scaleX(33)`. Se acota para TODO lo que se muestra y para los
    enlaces; la consulta ya se hizo con el valor crudo, y eso es lo que produce
    el caso "esa pagina no existe" de mas abajo.
  */
  const paginaSegura = Math.min(pagina, paginas);
  const desde = (paginaSegura - 1) * POR_PAGINA + 1;
  const hasta = (paginaSegura - 1) * POR_PAGINA + resultado.resultados.length;

  /** Hubo resultados en total, pero no en ESTA pagina: la URL se fue de rango. */
  const fueraDeRango = resultado.total > 0 && resultado.resultados.length === 0;

  /*
    ⚠️ UNA SOLA CONSULTA EXTRA, Y SOLO EN EL ESTADO VACIO. Sirve para decir algo
    concreto —"sin filtros hay 12 para «river»"— en vez de "proba con menos
    palabras". No se hace una por filtro: cada `searchListings` son doce
    consultas contra PostgreSQL (resultados + total + diez facetas), asi que N
    filtros costarian 12N en la pantalla que menos lo justifica.
  */
  const sinFiltros =
    resultado.total === 0 && activos.length > 0
      ? await searchListings({ ...(q === undefined ? {} : { texto: q }) })
      : null;

  /*
    El titular se compone en DOS LINEAS a mano: no hay forma de partir un
    titular en lineas con CSS sin JavaScript, y decidir donde corta un titulo es
    composicion, igual que en una revista.
  */
  const lineasTitulo = q === undefined ? ['Todas las', 'camisetas'] : ['Resultados para', `“${q}”`];

  const pastilla = (clave: string, texto: string, etiquetaLectores: string) => (
    <Link key={clave} href={conFiltro(clave, undefined)} className={estilos.pastilla}>
      <span className={estilos.pastillaTexto}>{texto}</span>
      <IconoCerrar tamanio={14} />
      <span className="solo-lectores">{etiquetaLectores}</span>
    </Link>
  );

  const grupo = (
    titulo: string,
    clave: string,
    facetas: Faceta[],
    etiquetar?: (valor: string) => string,
  ) => {
    if (facetas.length === 0) return null;

    const activo = uno(clave);

    /*
      ⚠️ EL TECHO ES DEL GRUPO, NO DEL TOTAL. Contra el total, "Talle M (40)"
      aplastaria a los 38 clubes y todas las barras darian el piso.
    */
    const techo = Math.max(1, ...facetas.map((f) => f.cantidad));

    /*
      ⚠️ RAIZ CUADRADA CON PISO DEL 8%, NO PROPORCION LINEAL, Y NO ES UN
      CAPRICHO MATEMATICO. El catalogo es long-tail: en cualquier busqueda real
      un valor domina y el resto tiene 1 a 3. Lineal, una faceta con 1 sobre 40
      da `scaleX(0.025)` = 6px de barra, que no se lee como un dato sino como un
      artefacto de render pegado al borde izquierdo. La raiz es lo estandar para
      esta distribucion; el piso garantiza que toda barra existente se vea.
    */
    const escala = (cantidad: number) => Math.max(0.08, Math.sqrt(cantidad / techo)).toFixed(3);

    return (
      <section key={clave} className={estilos.grupo}>
        <h2 className={estilos.grupoTitulo}>{titulo}</h2>
        <ul className={estilos.opciones}>
          {facetas.map((faceta) => (
            <li key={faceta.valor}>
              <Link
                href={conFiltro(clave, faceta.valor === activo ? undefined : faceta.valor)}
                className={faceta.valor === activo ? estilos.opcionActiva : estilos.opcion}
                aria-current={faceta.valor === activo ? 'true' : undefined}
                style={{ '--proporcion': escala(faceta.cantidad) } as CSSProperties}
              >
                <span className={estilos.opcionTexto}>
                  {etiquetar?.(faceta.valor) ?? faceta.etiqueta}
                </span>
                {/* PS-022: las facetas muestran conteos por valor. */}
                <span className={estilos.cuenta}>{faceta.cantidad}</span>
              </Link>
            </li>
          ))}
        </ul>

        {/*
          ⚠️ EL RECORTE SE DICE. El repositorio corta cada faceta en doce valores
          y hay 38 clubes sembrados: sin este renglón la lista miente por omisión
          y nada avisa que faltan valores. No se puede decir CUÁNTOS faltan —la
          consulta no los cuenta— así que no se inventa un número.
        */}
        {facetas.length === TOPE_DE_FACETA && (
          <p className={estilos.recorte}>
            Se muestran los {TOPE_DE_FACETA} más elegidos. Buscá por nombre para llegar al resto.
          </p>
        )}
      </section>
    );
  };

  return (
    <>
      {/*
        ⚠️ `seccion` MARCA "Explorar" EN LA BARRA, y esta pantalla es su destino.
        La barra crecio la prop —pone `aria-current="page"` y de ahi cuelga el
        subrayado— y nadie se la pasaba: quien navega por la barra no tenia
        forma de saber donde esta parado. Es una prop, no un `usePathname`,
        porque la barra lee la sesion en el servidor.
      */}
      <Header seccion="explorar" {...(q === undefined ? {} : { consulta: q })} />

      <Pantalla>
        <main id="contenido" className={estilos.pagina}>
          {/*
            ⚠️ LA BANDA VA A SANGRE Y ES OSCURA. La barra superior ya es Verde
            Cancha: una banda verde pegada abajo se leería como una barra de
            200px. `sup-noche` trae además el filo de luz, el remapeo de los
            neutros y el anillo de foco en Amarillo Cambio, que es lo único que
            se ve sobre este fondo.

            ⚠️ LOS ROMBOS VAN EN UN DIV PROPIO: `sup-noche` y `patron-vivo` usan
            las dos el `::before` del elemento y se lo pelean. `con-grano` usa
            `::after`, así que ese sí puede ir en la banda.
          */}
          <div className={`${estilos.franja} sup-noche con-grano`}>
            <div className={`${estilos.rombos} patron-vivo`} aria-hidden="true" />

            <div className={estilos.franjaCuerpo}>
              <p className={`${estilos.kicker} entra-suave`}>Catálogo</p>

              <div className={estilos.encabezado}>
                <h1 className={`${estilos.titulo} display display-3 entra-lineas`}>
                  {lineasTitulo.map((linea) => (
                    <span key={linea}>
                      <span>{linea}</span>
                    </span>
                  ))}
                </h1>

                {/*
                  ⚠️ NO ES UN CONTADOR QUE GIRA. Cada faceta es una navegación
                  completa, así que un `counter()` animado subiría de 0 a N en
                  CADA click sobre el único número que la persona está mirando
                  para decidir si sigue filtrando. `cifra-entra` muestra el
                  valor final desde el primer cuadro, se desplaza una vez y
                  termina quieto — y es texto real, así que se copia y se lee.
                */}
                <p
                  className={`${estilos.marcador} entra`}
                  style={{ '--retraso': '180ms' } as CSSProperties}
                >
                  <span className={`${estilos.marcadorCifra} display display-2 cifra-entra`}>
                    <span>{resultado.total}</span>
                  </span>
                  <span className={estilos.marcadorPalabra}>
                    {resultado.total === 1 ? 'publicación' : 'publicaciones'}
                  </span>
                </p>
              </div>

              {/*
                ⚠️ EL BUSCADOR VIVE ACÁ, EN LA PANTALLA DE BUSCAR. Antes, para
                corregir la consulta había que subir a la barra verde: en
                teléfono, a la segunda fila del header. Es el control más usado
                del sitio y estaba fuera de la pantalla que existe para él.

                Los filtros activos viajan como ocultos: buscar otra cosa no
                tiene por qué tirar abajo el talle que ya se eligió. `pagina` no
                viaja, por el mismo motivo que en `conFiltro`.
              */}
              <form
                action="/buscar"
                method="get"
                className={estilos.buscadorBanda}
                role="search"
                /*
                  ⚠️ SON DOS LANDMARKS `search` EN LA MISMA PANTALLA: este y el de
                  la barra verde, que `Header` ya declara con `role="search"`. Dos
                  regiones del mismo rol y sin nombre se anuncian identicas
                  ("busqueda", "busqueda") y quien navega por landmarks no puede
                  elegir. El nombre va aca porque `header.tsx` no es de esta ola.
                */
                aria-label="Buscar en el catálogo"
              >
                {ocultos(['q', 'pagina'])}
                <label htmlFor="busqueda-pantalla" className="solo-lectores">
                  Buscar publicaciones
                </label>
                <input
                  id="busqueda-pantalla"
                  className={estilos.buscadorCampo}
                  type="search"
                  name="q"
                  defaultValue={q}
                  placeholder="Camiseta, club, temporada…"
                />
                <button type="submit" className={`${estilos.buscadorEnviar} destello presiona`}>
                  Buscar
                </button>
              </form>

              {/*
                ⚠️ CINTA DE CLUBES, SOLO CUANDO LA BÚSQUEDA ESTÁ EN BLANCO.
                `/buscar` sin texto ni filtros era una grilla muda, y la
                migración 0007 sembró 38 clubes que nadie ve hasta abrir el
                panel. Cada nombre es un enlace a `?club=<id>`.

                ⚠️ LA SEGUNDA COPIA LLEVA `aria-hidden`: sin eso un lector de
                pantalla lee la lista dos veces. La pausa con `:hover` y con
                `:focus-within` la trae la clase global, y hace falta la de foco
                porque acá el contenido es interactivo (WCAG 2.2.2).
              */}
              {!hayFiltros && resultado.facetas.club.length >= 6 && (
                <div className={`${estilos.cinta} marquesina`}>
                  <div className="marquesina-pista">
                    <ul className="marquesina-grupo">
                      {resultado.facetas.club.map((club) => (
                        <li key={club.valor}>
                          <Link
                            href={conFiltro('club', club.valor)}
                            className={estilos.cintaEnlace}
                          >
                            {club.etiqueta}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <ul className="marquesina-grupo" aria-hidden="true">
                      {resultado.facetas.club.map((club) => (
                        <li key={club.valor}>
                          <span className={estilos.cintaEnlace}>{club.etiqueta}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/*
                ⚠️ PASTILLAS DE FILTRO ACTIVO. Cada una se saca tocándola y
                "Limpiar todo" vuelve a cero. Sin esto, la única forma de sacar
                un filtro era encontrarlo de nuevo en la lista.

                `escalona` es el ÚNICO escalonado de la pantalla y está acá a
                propósito: esta fila es lo que efectivamente cambia al tocar un
                filtro. El panel de filtros NO lo lleva —ver el CSS—.
              */}
              {hayFiltros && (
                <div className={`${estilos.activos} escalona`}>
                  <span className={estilos.activosTitulo}>Filtros</span>

                  {q !== undefined && pastilla('q', `Texto: ${q}`, 'Quitar el filtro de texto')}

                  {activos.map((filtro) =>
                    pastilla(
                      filtro.clave,
                      `${filtro.titulo}: ${filtro.etiqueta}`,
                      `Quitar el filtro ${filtro.titulo} ${filtro.etiqueta}`,
                    ),
                  )}

                  <Link href="/buscar" className={estilos.limpiar}>
                    Limpiar todo
                  </Link>
                </div>
              )}
            </div>
          </div>

          <div className={estilos.cuerpo}>
            <div className={estilos.columnas}>
              {/*
                ⚠️ EN TELÉFONO LOS FILTROS SE PLIEGAN, Y NO ES UN LUJO. A 900px
                la columna pasa ARRIBA de los resultados: diez grupos de hasta
                doce valores empujaban la primera camiseta fuera de la pantalla.

                Es un `<details>`: sin JavaScript, abierto en escritorio por
                CSS, y en escritorio además pegado al scroll con scroll propio.
                En teléfono NO se pega: la barra superior ya ocupa dos filas.
              */}
              <details className={`${estilos.filtros} sup-ficha`}>
                <summary className={estilos.filtrosBoton}>
                  <IconoFiltro tamanio={18} />
                  Filtrar
                  {activos.length > 0 && (
                    <span className={estilos.contadorFiltros}>
                      {activos.length}
                      <span className="solo-lectores"> filtros aplicados</span>
                    </span>
                  )}
                  <span className={estilos.chevron} aria-hidden="true" />
                </summary>

                <div className={estilos.filtrosCuerpo}>
                  <div className={estilos.filtrosLista}>
                    {/*
                      ⚠️ EL PRECIO VA PRIMERO Y ES EL FILTRO QUE FALTABA.
                      `SearchQuery` ya lo acepta y el repositorio ya lo baja al
                      SQL: son dos inputs y un submit, cero backend, cero JS. Lo
                      único imposible es el histograma de precios, porque
                      `SearchResponse` no devuelve mínimo, máximo ni
                      distribución.

                      ⚠️ ES UN `<form>` HERMANO, NO ANIDADO: anidar formularios
                      es HTML inválido y el navegador lo desarma en silencio.
                    */}
                    <section className={estilos.grupo}>
                      <h2 className={estilos.grupoTitulo}>Precio</h2>
                      <form method="get" action="/buscar" className={estilos.precio}>
                        {ocultos(['precioMin', 'precioMax', 'pagina'])}

                        <span className={estilos.precioCampo}>
                          <label className={estilos.precioEtiqueta} htmlFor="precio-min">
                            Desde
                          </label>
                          <input
                            id="precio-min"
                            className={estilos.precioInput}
                            type="number"
                            name="precioMin"
                            min="0"
                            step="1000"
                            inputMode="numeric"
                            placeholder="$"
                            defaultValue={uno('precioMin')}
                          />
                        </span>

                        <span className={estilos.precioCampo}>
                          <label className={estilos.precioEtiqueta} htmlFor="precio-max">
                            Hasta
                          </label>
                          <input
                            id="precio-max"
                            className={estilos.precioInput}
                            type="number"
                            name="precioMax"
                            min="0"
                            step="1000"
                            inputMode="numeric"
                            placeholder="$"
                            defaultValue={uno('precioMax')}
                          />
                        </span>

                        <button type="submit" className={estilos.precioBoton}>
                          Aplicar
                        </button>
                      </form>

                      {/*
                        ⚠️ EL RANGO ES EL DE TODO EL RESULTADO, NO EL DE LA
                        PÁGINA. `SearchResponse.precios` lo calcula el Service
                        sobre el resultado entero: sacarlo de los 24 que se
                        muestran diría "de $8.000 a $140.000" mientras hay una de
                        $300.000 en la página tres, y el filtro mentiría justo
                        sobre el número que la persona está por escribir.

                        ⚠️ SIN RESULTADOS NO SE DIBUJA. El Service devuelve
                        `null` en los dos extremos; "de $0 a $0" se leería como
                        un precio real.

                        ⚠️ SE DICE LA UNIDAD PORQUE LA BASE GUARDA CENTAVOS Y LA
                        URL LLEVA PESOS. Sin el renglón, alguien que escribe
                        "150000" pensando en centavos filtra por ciento cincuenta
                        mil pesos y cree que la búsqueda está rota.
                      */}
                      <p className={estilos.precioNota}>
                        {rangoDePrecios === null
                          ? 'En pesos enteros, sin centavos.'
                          : `De ${rangoDePrecios.desde} a ${rangoDePrecios.hasta}. En pesos enteros, sin centavos.`}
                      </p>
                    </section>

                    {GRUPOS.map((g) => grupo(g.titulo, g.clave, facetasDe(g.faceta), g.etiquetar))}

                    {/*
                      ⚠️ Una faceta VACÍA no se muestra: los campos de catálogo
                      son opcionales al publicar. Ofrecer un filtro que no
                      filtra nada es peor que no ofrecerlo.
                    */}
                    <p className={estilos.nota}>
                      Los filtros muestran sólo lo que hay publicado. Si un club o una marca no
                      aparecen, es porque todavía nadie publicó una camiseta así.
                    </p>
                  </div>

                  {hayFiltros && (
                    <div className={estilos.filtrosPie}>
                      <Link href="/buscar" className={estilos.filtrosPieEnlace}>
                        Limpiar todo
                      </Link>
                    </div>
                  )}
                </div>
              </details>

              <div className={estilos.resultados} id="resultados">
                {/*
                  ⚠️ EL AVISO DEL CORAZÓN VIVE ACÁ Y NO ARRIBA DE TODO. La acción
                  devuelve a `#resultados`, o sea a esta columna: un cartel en la
                  banda oscura quedaría fuera de pantalla justo cuando hay algo
                  que leer.
                */}
                {avisoDeFavorito && (
                  <div className={estilos.avisoFavorito}>
                    <Aviso tono="error">
                      No pudimos guardar la publicación. Probá de nuevo en un momento.
                    </Aviso>
                  </div>
                )}

                <div className={estilos.barraOrden}>
                  {resultado.resultados.length > 0 && (
                    <p className={estilos.rango}>
                      <span className={estilos.rangoFuerte}>
                        {desde}–{hasta}
                      </span>{' '}
                      de {resultado.total}
                    </p>
                  )}

                  {/*
                    ⚠️ EL ORDEN SON CUATRO ENLACES, NO UN `<select>` CON UN
                    BOTÓN "APLICAR". El argumento viejo era correcto —sin JS un
                    `<select>` no envía el form— pero la salida obvia era no
                    usar un `<select>`: con enlaces desaparecen el botón que no
                    dice nada, el `appearance: none` con la flecha dibujada a
                    mano y los ocultos que arrastraban los filtros. Y es el
                    mismo lenguaje visual que las pastillas de arriba.
                  */}
                  <nav className={estilos.ordenFila} aria-label="Ordenar resultados">
                    <span className={estilos.ordenEtiqueta}>Ordenar</span>
                    {ORDENES.filter((o) => o.soloConTexto !== true || q !== undefined).map((o) => {
                      const activo = orden === o.valor;

                      return (
                        <Link
                          key={o.valor ?? 'default'}
                          href={conFiltro('orden', o.valor)}
                          className={activo ? estilos.ordenOpcionActiva : estilos.ordenOpcion}
                          aria-current={activo ? 'true' : undefined}
                        >
                          {/* Sin texto no hay relevancia: el orden por defecto ya es por fecha. */}
                          {o.valor === undefined && q === undefined ? 'Más recientes' : o.texto}
                        </Link>
                      );
                    })}
                  </nav>
                </div>

                {resultado.resultados.length === 0 ? (
                  /*
                    ⚠️ UN ESTADO VACÍO TIENE QUE SER UNA SALIDA, NO UN CARTEL.
                    Antes ofrecía limpiar TODO: quien había puesto cuatro
                    filtros perdía los cuatro para sacar el que sobraba.
                  */
                  <div className={`${estilos.vacio} sup-2 patron-vivo con-grano`}>
                    <span className={estilos.vacioMarca} aria-hidden="true">
                      <IconoBuscar tamanio={40} />
                    </span>

                    {/*
                      ⚠️ ES UN `<h2>` Y NO UN `<p>`. La columna de resultados se
                      quedaba sin ningún encabezado en el árbol de
                      accesibilidad —los `<h2>` que hay están dentro del panel
                      de filtros—, así que quien navega por encabezados no
                      encontraba el resultado de su propia búsqueda.
                    */}
                    <h2 className={`${estilos.vacioTitulo} display display-3 titular-degradado`}>
                      {fueraDeRango ? 'Esa página no existe' : 'No encontramos nada'}
                    </h2>

                    <p className={estilos.vacioTexto}>
                      {fueraDeRango
                        ? `Hay ${resultado.total} publicaciones, pero no tantas páginas.`
                        : hayFiltros
                          ? 'Ninguna publicación coincide con todo lo que pediste al mismo tiempo. Sacá un filtro y probá de nuevo.'
                          : 'Todavía no hay publicaciones para mostrar.'}
                    </p>

                    {!fueraDeRango && activos.length > 0 && (
                      <div className={estilos.vacioSalidas}>
                        <span className={estilos.vacioEtiqueta}>Sacá un filtro</span>
                        {activos.map((filtro) =>
                          pastilla(
                            filtro.clave,
                            `${filtro.titulo}: ${filtro.etiqueta}`,
                            `Quitar el filtro ${filtro.titulo} ${filtro.etiqueta}`,
                          ),
                        )}
                      </div>
                    )}

                    <div className={estilos.vacioAcciones}>
                      {fueraDeRango && (
                        <BotonEnlace href={conFiltro('pagina', undefined)} variante="secundario">
                          Volver a la primera página
                        </BotonEnlace>
                      )}

                      {/*
                        ⚠️ LA SALIDA CONCRETA: el mismo texto sin ningún filtro,
                        CON el número que eso daría. Es una consulta extra y
                        sólo se hace acá; decir "probá sin filtros" sin decir
                        cuántos hay es pedirle a la persona que adivine.
                      */}
                      {sinFiltros !== null && sinFiltros.total > 0 && q !== undefined && (
                        <BotonEnlace
                          href={`/buscar?${new URLSearchParams({ q }).toString()}`}
                          variante="secundario"
                        >
                          Ver las {sinFiltros.total} sin filtros
                        </BotonEnlace>
                      )}

                      <BotonEnlace href="/buscar" variante="secundario">
                        Ver todas las camisetas
                      </BotonEnlace>
                    </div>
                  </div>
                ) : (
                  <>
                    {/*
                      `revela-grilla-materia` es la versión con materia de
                      `revela-grilla`: la ficha viene desde atrás del plano en
                      vez de sólo aparecer. `enfoca-hermanos` apaga las FOTOS de
                      las demás al apuntar una —nunca el texto: el precio y el
                      título no pueden perder contraste ni por un instante—.
                    */}
                    <ul className={`${estilos.grilla} revela-grilla-materia enfoca-hermanos`}>
                      {resultado.resultados.map((item) => (
                        <li key={item.id}>
                          {/*
                            ⚠️ LAS PROMOCIONADAS YA VIENEN PRIMERAS DEL SERVICE
                            (`promoted_first_in_search` ⚙️ + el boost del
                            ranking). Lo único que agrega la pantalla es DECIRLO:
                            una publicación que figura arriba porque alguien pagó
                            y no lo declara es exactamente lo que un buscador no
                            puede hacer.
                          */}
                          <ListingCard
                            listing={{
                              id: item.id,
                              title: item.title,
                              priceAmount: item.priceAmount,
                              currency: item.currency,
                              sizeValue: item.sizeValue,
                              condition: item.condition,
                              stock: item.stock,
                              sellerDisplayName: item.sellerDisplayName,
                              coverUrl: item.coverUrl,
                            }}
                            promocionada={item.promocionada}
                            favorito={favoritoDe(item.id)}
                          />
                        </li>
                      ))}
                    </ul>

                    {/*
                      ⚠️ SON DOS ENLACES, NO UN LISTADO DE NÚMEROS. Una búsqueda
                      amplia puede dar decenas de páginas y una fila de números
                      obliga a elipsis y ventana deslizante.

                      ⚠️ SIN `tamanio`, o sea el `medio` por defecto, que son
                      44px: `chico` son 36 y estos son los dos controles más
                      importantes de la pantalla en teléfono. WCAG 2.5.5 pide 44.

                      El riel dice lo mismo que "Página 3 de 47", pero se SIENTE.
                    */}
                    {paginas > 1 && (
                      <>
                        <nav className={estilos.paginacion} aria-label="Paginación">
                          {paginaSegura > 1 ? (
                            <BotonEnlace
                              href={conFiltro('pagina', String(paginaSegura - 1))}
                              variante="secundario"
                            >
                              ← Anterior
                            </BotonEnlace>
                          ) : (
                            <span className={estilos.paginacionInactiva}>← Anterior</span>
                          )}

                          <div className={estilos.paginacionCentro}>
                            <p className={estilos.paginacionCuenta}>
                              Página {paginaSegura} de {paginas}
                            </p>
                            <span className={estilos.riel} aria-hidden="true">
                              <span
                                className={estilos.rielRelleno}
                                style={
                                  {
                                    '--progreso': (paginaSegura / paginas).toFixed(3),
                                  } as CSSProperties
                                }
                              />
                            </span>
                          </div>

                          {paginaSegura < paginas ? (
                            <BotonEnlace
                              href={conFiltro('pagina', String(paginaSegura + 1))}
                              variante="secundario"
                            >
                              Siguiente →
                            </BotonEnlace>
                          ) : (
                            <span className={estilos.paginacionInactiva}>Siguiente →</span>
                          )}
                        </nav>

                        <a href="#contenido" className={estilos.volverArriba}>
                          Volver arriba
                        </a>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </main>
      </Pantalla>

      <Footer />
    </>
  );
}
