import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { entradaDeCatalogoPorSlug } from '@/modules/listings/services/listing.service';

import { LandingDeCatalogo, contarDeCatalogo, textosDe } from '../../landing';

/**
 * `/marca/[slug]` — la pantalla la arma `LandingDeCatalogo`, que es la misma
 * para club y marca. Acá solo vive lo que cambia: el catálogo que se consulta y
 * la metadata.
 */

export const dynamic = 'force-dynamic';

const TIPO = 'marca' as const;
const CATALOGO = 'brand' as const;

/** La página pedida, tolerante a basura: `?pagina=perro` es la 1, no un error. */
const paginaDe = (valor: string | string[] | undefined): number => {
  const crudo = Array.isArray(valor) ? valor[0] : valor;

  return Math.max(1, Number.parseInt(crudo ?? '1', 10) || 1);
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const entrada = await entradaDeCatalogoPorSlug(CATALOGO, slug);

  if (entrada === null) return { title: 'Catálogo no encontrado' };

  const textos = textosDe(TIPO);
  const total = await contarDeCatalogo(TIPO, entrada.id);

  /*
   * ⚠️ LA DESCRIPCION DICE CUANTAS HAY, y eso la vuelve verdadera hoy y dentro de
   * un mes: es lo que un buscador muestra debajo del titulo. Con cero
   * publicaciones NO se promete catálogo — se dice que todavía no hay.
   */
  const descripcion =
    total === 0
      ? `Todavía no hay camisetas de ${entrada.nombre} publicadas en Offside. Mirá el catálogo completo o publicá la tuya.`
      : textos.bajada(entrada.nombre);

  return {
    title: textos.titulo(entrada.nombre),
    description: descripcion,
    /*
     * ⚠️ CANONICA A SI MISMA. El mismo contenido es alcanzable por
     * `/buscar?marca=<uuid>`, y sin esto los dos compiten por la misma consulta:
     * el buscador elige uno y suele ser el que no queremos.
     */
    alternates: { canonical: `/marca/${entrada.slug}` },
    openGraph: {
      type: 'website',
      title: textos.titulo(entrada.nombre),
      description: descripcion,
    },
  };
}

export default async function PantallaDeCatalogo({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const entrada = await entradaDeCatalogoPorSlug(CATALOGO, slug);

  /*
   * ⚠️ 404 TAMBIEN CUANDO LA ENTRADA ESTA DADA DE BAJA. `findActiveBySlug` filtra
   * por `is_active`: dejar viva la pantalla de un catálogo retirado la mantiene
   * indexada ofreciendo algo que ya no se ofrece.
   */
  if (entrada === null) notFound();

  return <LandingDeCatalogo tipo={TIPO} entrada={entrada} pagina={paginaDe(query.pagina)} />;
}
