import type { Database } from '@offside/database';

import * as catalogRepo from '../repositories/catalog.repository';
import * as errors from '../listings.errors';
import { resolverPorNombre, type ResolucionDeCatalogo } from './catalogo-por-nombre';

/**
 * DE LO QUE LA PERSONA ESCRIBIO A IDS DE CATALOGO, Y PROPUESTAS PARA LO QUE
 * FALTA (DEC-041).
 *
 * ⚠️ DECISION DEL OWNER, 2026-11-10. El formulario dejo de ser una lista
 * cerrada porque "no estan ni todos los clubes ni marcas del mundo". Lo que se
 * escribe y no existe NO se guarda como texto libre: entra como SOLICITUD DE
 * ALTA al catalogo, que es lo que DEC-041 cerro y lo que `catalog_change_requests`
 * ya modelaba sin que nadie la usara.
 *
 * La diferencia importa y es la razon de que esto no sea un campo de texto:
 * `product-specification.md` §11 marca los "datos sucios" como el riesgo que
 * mata la busqueda facetada, que es el diferencial del sitio. Con texto libre
 * conviven "Riber", "river plate" y "C.A.R.P." y ninguno filtra. Con
 * solicitudes, el catalogo solo crece cuando alguien lo aprueba, y mientras
 * tanto la publicacion sale igual —sin club, no sin publicar—.
 *
 * ⚠️ LO QUE SE PARECE A ALGO NO SE PROPONE: SE PREGUNTA. Si "indepediente"
 * creara una solicitud, el catalogo terminaria lleno de typos esperando
 * aprobacion. Solo lo que no se parece a nada llega a ser propuesta.
 */

/** Los catalogos que el formulario deja escribir. */
export type CampoDeCatalogo = 'club' | 'nationalTeam' | 'brand';

const ETIQUETA: Record<CampoDeCatalogo, string> = {
  club: 'club',
  nationalTeam: 'selección',
  brand: 'marca',
};

/** `catalog_target_type` correspondiente (los nombres difieren: snake_case). */
const TARGET: Record<CampoDeCatalogo, catalogRepo.CatalogTargetType> = {
  club: 'club',
  nationalTeam: 'national_team',
  brand: 'brand',
};

/** Lo que el formulario manda: nombres escritos, no ids. */
export interface NombresDeCatalogo {
  club?: string | null | undefined;
  nationalTeam?: string | null | undefined;
  brand?: string | null | undefined;
}

/** Un alta propuesta al catalogo, pendiente de que la publicacion exista. */
export interface PropuestaDeCatalogo {
  campo: CampoDeCatalogo;
  nombre: string;
}

export interface CatalogoResuelto {
  clubId: string | null;
  nationalTeamId: string | null;
  brandId: string | null;
  /** Lo que no existe en el catalogo y se va a proponer (DEC-041). */
  propuestas: PropuestaDeCatalogo[];
}

/**
 * Resuelve los tres campos escribibles.
 *
 * ⚠️ UNA SOLA DUDA ABORTA LA PUBLICACION ENTERA, y es deliberado: la alternativa
 * es publicar a medias y que la persona descubra despues que su camiseta quedo
 * sin club. El error nombra el campo y las opciones, asi que corregir es elegir
 * una de las que se ofrecen.
 */
export async function resolverCatalogos(
  nombres: NombresDeCatalogo,
  db?: Database,
): Promise<CatalogoResuelto> {
  const campos: CampoDeCatalogo[] = ['club', 'nationalTeam', 'brand'];

  const resueltos = await Promise.all(
    campos.map(async (campo) => {
      const texto = nombres[campo];
      if (typeof texto !== 'string' || texto.trim() === '') {
        return { campo, resolucion: { tipo: 'vacio' } as ResolucionDeCatalogo };
      }

      const catalogo = await catalogRepo.findActive(campo, db);

      return { campo, resolucion: resolverPorNombre(texto, catalogo) };
    }),
  );

  const ids: Record<CampoDeCatalogo, string | null> = {
    club: null,
    nationalTeam: null,
    brand: null,
  };
  const propuestas: PropuestaDeCatalogo[] = [];

  for (const { campo, resolucion } of resueltos) {
    switch (resolucion.tipo) {
      case 'vacio':
        break;
      case 'encontrado':
        ids[campo] = resolucion.fila.id;
        break;
      case 'sugerencias':
        throw errors.catalogAmbiguo(
          ETIQUETA[campo],
          resolucion.opciones.map((o) => o.name),
        );
      case 'sin-coincidencias':
        propuestas.push({ campo, nombre: resolucion.texto });
        break;
    }
  }

  return {
    clubId: ids.club,
    nationalTeamId: ids.nationalTeam,
    brandId: ids.brand,
    propuestas,
  };
}

/**
 * Deja asentadas las propuestas, ya con la publicacion creada.
 *
 * ⚠️ EL `listingId` VIAJA EN EL `payload`, que es jsonb libre y la tabla
 * describe como "snapshot inmutable de la propuesta original". No hace falta
 * una columna nueva: al aprobar, enganchar la publicacion es buscar las
 * solicitudes por ese campo. Son pocas y estan filtradas por `status`.
 *
 * ⚠️ SE LLAMA DESPUES DE CREAR LA PUBLICACION, dentro de su misma transaccion:
 * una solicitud que apunta a una publicacion que no existe no la puede enganchar
 * nadie.
 *
 * ⚠️ NO SE DEDUPLICA CONTRA LAS PENDIENTES. Si tres personas proponen "Deportivo
 * Moron", quedan tres solicitudes: cada una pertenece a su publicacion y
 * aprobar una tiene que poder enganchar a las tres. Agruparlas es trabajo de la
 * pantalla de moderacion, no del alta.
 */
export async function registrarPropuestas(
  propuestas: PropuestaDeCatalogo[],
  listingId: string,
  requestedBy: string,
  db?: Database,
): Promise<void> {
  for (const propuesta of propuestas) {
    await catalogRepo.insertChangeRequest(
      {
        targetType: TARGET[propuesta.campo],
        payload: { name: propuesta.nombre, listingId, campo: propuesta.campo },
        requestedBy,
      },
      db,
    );
  }
}
