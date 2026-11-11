import type { Metadata } from 'next';
import Link from 'next/link';

import { Campo, CampoOculto, Formulario } from '@/components/form';
import { Pantalla } from '@/components/movimiento';
import { Aviso, Confirmar, Definiciones, EstadoVacio, Etiqueta } from '@/components/ui';
import { fechaYHora } from '@/lib/formato';
import { CAPABILITIES } from '@/lib/permissions';
import { requireCapabilitySessionUser } from '@/lib/session';
import { listPendingCatalogRequests } from '@/modules/listings/services/catalog-moderation.service';

import { aprobarSolicitudDeCatalogo, rechazarSolicitudDeCatalogo } from '../../acciones';
import { Consola } from '../../consola';
import estilos from '../../admin.module.css';

export const metadata: Metadata = { title: 'Catálogo' };
export const dynamic = 'force-dynamic';

/**
 * Cola de altas propuestas al catálogo controlado (`catalog:moderate`, DEC-041).
 *
 * ⚠️ EXISTE PORQUE EL FORMULARIO DE PUBLICAR DEJÓ DE SER UNA LISTA CERRADA
 * (owner, 2026-11-10): "no están ni todos los clubes ni marcas del mundo". Lo
 * que alguien escribe y no existe entra acá como propuesta, y la publicación
 * sale igual —sin club, no sin publicar—.
 *
 * ⚠️ APROBAR NO ES UN TRÁMITE: crea una entidad que después filtra en toda la
 * vitrina. `product-specification.md` §11 marca los datos sucios como el riesgo
 * que mata la búsqueda facetada, así que la pantalla pone el nombre propuesto
 * en un campo EDITABLE: lo que entra al catálogo es lo que escribe quien
 * modera, no el texto crudo. "deportivo moron" se aprueba como "Deportivo
 * Morón".
 *
 * ⚠️ SE MUESTRA LA PUBLICACIÓN QUE LA PIDIÓ, y es lo primero que hace falta: no
 * se puede decidir si "Racing" es Racing Club o Racing de Santander sin mirar
 * la camiseta. Al aprobar, esa publicación queda enganchada sola.
 */

/** Cómo se llama cada destino, para quien modera. */
const DESTINO: Record<string, string> = {
  club: 'Club',
  national_team: 'Selección',
  brand: 'Marca',
  competition: 'Competencia',
  country: 'País',
  season: 'Temporada',
  size_chart: 'Talles',
};

export default async function CatalogoDelAdmin() {
  const admin = await requireCapabilitySessionUser(
    CAPABILITIES.CATALOG_MODERATE,
    '/admin/catalogo',
  );
  const pendientes = await listPendingCatalogRequests(admin);

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Consola
          rol={admin.adminRole}
          email={admin.email}
          activo="catalogo"
          titulo="Catálogo"
          pendientes={{ catalogo: pendientes.length }}
        />

        <div className={estilos.hoja}>
          <div className={estilos.avisoDeConsola}>
            <Aviso>
              Aprobar <strong>crea la entidad</strong> y la deja disponible para filtrar en toda la
              vitrina. El nombre que entra al catálogo es el que escribas acá, no el que escribió
              quien publicó.
            </Aviso>
          </div>

          {pendientes.length === 0 ? (
            <EstadoVacio titulo="No hay propuestas pendientes">
              <p>
                Cuando alguien publique una camiseta de un club o una marca que no está en el
                catálogo, la propuesta va a aparecer acá.
              </p>
            </EstadoVacio>
          ) : (
            pendientes.map((solicitud) => (
              <article key={solicitud.id} className={estilos.tarjeta}>
                <div className={estilos.tarjetaCabecera}>
                  <h2 className={estilos.tituloDeFicha}>{solicitud.nombre}</h2>
                  <span className={estilos.estadoGrupo}>
                    <span className={estilos.rotuloEstado}>Destino</span>
                    <Etiqueta tono="neutro">
                      {DESTINO[solicitud.targetType] ?? solicitud.targetType}
                    </Etiqueta>
                  </span>
                </div>

                <Definiciones
                  items={[
                    { termino: 'Lo pidió', valor: solicitud.requesterEmail },
                    { termino: 'Cuándo', valor: fechaYHora(solicitud.createdAt) },
                  ]}
                />

                {/*
                  ⚠️ EL ENLACE A LA PUBLICACIÓN ES LO QUE PERMITE DECIDIR. Sin
                  mirar la camiseta, "Racing" puede ser dos clubes de países
                  distintos. Va a la ficha pública, que es lo que ve quien compra.
                */}
                {solicitud.listingId !== null && (
                  <p className={estilos.nota}>
                    <Link href={`/p/${solicitud.listingId}`} className="subraya">
                      Ver la publicación que la pidió
                    </Link>
                  </p>
                )}

                <Formulario
                  accion={aprobarSolicitudDeCatalogo}
                  enviar="Aprobar"
                  variante="secundario"
                  tamanio="chico"
                  bloque={false}
                >
                  <CampoOculto nombre="solicitudId" valor={solicitud.id} />
                  <Campo
                    nombre="nombre"
                    etiqueta="Nombre que entra al catálogo"
                    identificador={`nombre-${solicitud.id}`}
                    defaultValue={solicitud.nombre}
                    ayuda="Corregí mayúsculas y tildes antes de aprobar: así queda para siempre."
                    requerido
                  />
                </Formulario>

                {/*
                  ⚠️ RECHAZAR VA EN SEGUNDO PLANO Y EN DOS PASOS, igual que
                  ocultar una pregunta: no es la acción que se vino a hacer, y
                  deja a una publicación sin su club.
                */}
                <div className={estilos.zonaAccion}>
                  <Confirmar
                    etiqueta="Rechazar"
                    pregunta="La publicación que la pidió se queda sin ese dato. El motivo queda registrado."
                  >
                    <Formulario
                      accion={rechazarSolicitudDeCatalogo}
                      enviar="Sí, rechazar"
                      variante="peligro"
                      tamanio="chico"
                      bloque={false}
                    >
                      <CampoOculto nombre="solicitudId" valor={solicitud.id} />
                      <Campo
                        nombre="motivo"
                        etiqueta="Motivo"
                        identificador={`motivo-${solicitud.id}`}
                        ayuda="Obligatorio: un rechazo sin motivo es indistinguible de un error."
                        requerido
                      />
                    </Formulario>
                  </Confirmar>
                </div>
              </article>
            ))
          )}
        </div>
      </main>
    </Pantalla>
  );
}
