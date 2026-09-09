import type { Metadata } from 'next';

import { Header } from '@/components/header';
import { ListingCard } from '@/components/listing-card';
import { EstadoVacio } from '@/components/ui';
import { condicion } from '@/lib/formato';
import { searchListings, type Faceta } from '@/modules/listings/services/search.service';

import estilos from './page.module.css';

export const metadata: Metadata = { title: 'Buscar — Offside Store' };

/**
 * ⚠️ SIN CACHE, igual que la vitrina. Los resultados dependen del stock y del
 * estado de cada publicación: mostrar algo que ya se vendió lleva a un checkout
 * que falla.
 */
export const dynamic = 'force-dynamic';

/** Etiquetas legibles de las facetas técnicas. */
const MANGA: Record<string, string> = { short: 'Cortas', long: 'Largas' };
const KIT: Record<string, string> = {
  home: 'Titular',
  away: 'Suplente',
  third: 'Tercera',
  goalkeeper: 'Arquero',
  special: 'Especial',
};

/**
 * Búsqueda (PS-020 … PS-022).
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

  const resultado = await searchListings({
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
    ...(uno('orden') === undefined
      ? {}
      : { orden: uno('orden') as 'relevancia' | 'precio_asc' | 'precio_desc' | 'recientes' }),
  });

  /** Conserva los demás filtros al tocar uno: las facetas se combinan (PS-020). */
  const conFiltro = (clave: string, valor: string | undefined): string => {
    const siguientes = new URLSearchParams();

    for (const [k, v] of Object.entries(params)) {
      const texto = Array.isArray(v) ? v[0] : v;
      if (texto !== undefined && texto !== '' && k !== clave) siguientes.set(k, texto);
    }

    if (valor !== undefined) siguientes.set(clave, valor);

    const query = siguientes.toString();

    return query === '' ? '/buscar' : `/buscar?${query}`;
  };

  const grupo = (
    titulo: string,
    clave: string,
    facetas: Faceta[],
    etiquetar?: (valor: string) => string,
  ) => {
    if (facetas.length === 0) return null;

    const activo = uno(clave);

    return (
      <section className={estilos.grupo}>
        <h2 className={estilos.grupoTitulo}>{titulo}</h2>
        <ul className={estilos.opciones}>
          {facetas.map((faceta) => (
            <li key={faceta.valor}>
              <a
                href={conFiltro(clave, faceta.valor === activo ? undefined : faceta.valor)}
                className={faceta.valor === activo ? estilos.opcionActiva : estilos.opcion}
              >
                {etiquetar?.(faceta.valor) ?? faceta.etiqueta}
                {/* PS-022: las facetas muestran conteos por valor. */}
                <span className={estilos.cuenta}>{faceta.cantidad}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    );
  };

  return (
    <div className={estilos.pagina}>
      <Header />

      <main className={estilos.contenido}>
        <div className={estilos.encabezado}>
          <h1 className={estilos.titulo}>
            {q === undefined ? 'Todas las camisetas' : `Resultados para “${q}”`}
          </h1>
          <p className={estilos.total}>
            {resultado.total === 1 ? '1 publicación' : `${resultado.total} publicaciones`}
          </p>
        </div>

        <div className={estilos.columnas}>
          <aside className={estilos.filtros}>
            {/*
              El catalogo va PRIMERO: club y marca son lo que la gente busca de
              verdad en una camiseta. Categoria y talle son secundarios.
            */}
            {grupo('Club', 'club', resultado.facetas.club)}
            {grupo('Selección', 'seleccion', resultado.facetas.seleccion)}
            {grupo('Marca', 'marca', resultado.facetas.marca)}
            {grupo('Temporada', 'temporada', resultado.facetas.temporada)}
            {grupo('Competencia', 'competicion', resultado.facetas.competicion)}
            {grupo('Categoría', 'categoria', resultado.facetas.categoria)}
            {grupo('Talle', 'talle', resultado.facetas.talle)}
            {grupo('Estado', 'condicion', resultado.facetas.condicion, condicion)}
            {grupo('Tipo', 'kit', resultado.facetas.tipoDeCamiseta, (valor) => KIT[valor] ?? valor)}
            {grupo('Mangas', 'manga', resultado.facetas.manga, (valor) => MANGA[valor] ?? valor)}

            {/*
              ⚠️ Una faceta VACIA no se muestra: los campos de catalogo son
              opcionales al publicar. Ofrecer un filtro que no filtra nada es
              peor que no ofrecerlo.
            */}
            <p className={estilos.nota}>
              Los filtros muestran sólo lo que hay publicado. Si un club o una marca no aparecen, es
              porque todavía nadie publicó una camiseta así.
            </p>
          </aside>

          <div>
            <form method="get" className={estilos.orden}>
              {q !== undefined && <input type="hidden" name="q" value={q} />}
              <label htmlFor="orden">Ordenar por</label>
              <select id="orden" name="orden" defaultValue={uno('orden') ?? ''}>
                <option value="">{q === undefined ? 'Más recientes' : 'Relevancia'}</option>
                <option value="precio_asc">Precio: menor primero</option>
                <option value="precio_desc">Precio: mayor primero</option>
                <option value="recientes">Más recientes</option>
              </select>
              <button type="submit">Aplicar</button>
            </form>

            {resultado.resultados.length === 0 ? (
              <EstadoVacio titulo="No encontramos nada">
                Probá con menos palabras, o sacá algún filtro.
              </EstadoVacio>
            ) : (
              <ul className={estilos.grilla}>
                {resultado.resultados.map((item) => (
                  <li key={item.id}>
                    <ListingCard
                      listing={{
                        id: item.id,
                        title: item.title,
                        priceAmount: item.priceAmount,
                        currency: item.currency,
                        sizeValue: item.sizeValue,
                        condition: item.condition,
                        sellerDisplayName: item.sellerDisplayName,
                        coverUrl: item.coverUrl,
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
