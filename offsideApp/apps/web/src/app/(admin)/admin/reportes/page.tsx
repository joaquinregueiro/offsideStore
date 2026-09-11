import type { Metadata } from 'next';
import Link from 'next/link';

import { AreaDeTexto, CampoOculto, Formulario } from '@/components/form';
import { Pantalla } from '@/components/movimiento';
import {
  Aviso,
  BotonEnlace,
  Confirmar,
  Definiciones,
  EstadoVacio,
  Etiqueta,
} from '@/components/ui';
import { estadoDePublicacion, fechaYHora, tonoDePublicacion } from '@/lib/formato';
import { CAPABILITIES } from '@/lib/permissions';
import { requireCapabilitySessionUser } from '@/lib/session';
import { REPORT_REASONS, listOpenReports } from '@/modules/reports/services/report.service';

import { revisarReporte } from '../../acciones';
import { Consola } from '../../consola';
import estilos from '../../admin.module.css';

export const metadata: Metadata = { title: 'Reportes' };
export const dynamic = 'force-dynamic';

/**
 * Cola de denuncias sobre publicaciones (`trust:moderate`).
 *
 * ⚠️ CERRAR UNA DENUNCIA NO BAJA LA PUBLICACION, y hay que decirlo en la
 * pantalla. `reviewReport` sólo marca la denuncia como atendida o descartada y
 * deja la decisión en `audit_log`; moderar la publicación
 * (`listings.moderation_status`) es otra cosa y todavía no existe. Prometer lo
 * contrario dejaría a alguien creyendo que sacó una réplica de la vitrina.
 *
 * ⚠️ LA NOTA DE QUIEN DENUNCIO NO SE PISA. `listing_reports.note` es lo que
 * escribió esa persona; la nota del moderador va al log, aparte.
 *
 * ⚠️ EL ENLACE A LA PUBLICACION ES LO PRIMERO QUE SE NECESITA: no se puede
 * decidir sobre una denuncia sin mirar lo denunciado. Va a la ficha pública,
 * que es lo que ve quien compra.
 */

/** Los motivos, en la redacción que eligió quien denunció. */
const MOTIVOS: Record<string, string> = Object.fromEntries(
  REPORT_REASONS.map((motivo) => [motivo.codigo, motivo.etiqueta]),
);

export default async function Reportes() {
  const admin = await requireCapabilitySessionUser(CAPABILITIES.TRUST_MODERATE, '/admin/reportes');

  const denuncias = await listOpenReports(admin);

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Consola rol={admin.adminRole} email={admin.email} activo="reportes" titulo="Reportes" />

        <div className={estilos.hoja}>
          <div className={estilos.avisoDeConsola}>
            <Aviso>
              Cerrar una denuncia <strong>no baja la publicación</strong>: sólo la saca de esta cola
              y deja la decisión en el log de auditoría. Bajar una publicación todavía no se puede
              hacer desde el back-office.
            </Aviso>
          </div>

          {denuncias.length === 0 ? (
            <EstadoVacio titulo="No hay denuncias sin revisar">
              Cuando alguien denuncie una publicación, va a aparecer acá.
            </EstadoVacio>
          ) : (
            denuncias.map((denuncia) => (
              <article key={denuncia.id} className={`${estilos.tarjeta} ${estilos.fichaAlerta}`}>
                <div className={estilos.tarjetaCabecera}>
                  <h2 className={estilos.tituloDeFicha}>{denuncia.listingTitle}</h2>
                  <span className={estilos.estadoGrupo}>
                    <span className={estilos.rotuloEstado}>Estado de la publicación</span>
                    <Etiqueta tono={tonoDePublicacion(denuncia.listingStatus)}>
                      {estadoDePublicacion(denuncia.listingStatus)}
                    </Etiqueta>
                  </span>
                </div>

                <Definiciones
                  items={[
                    { termino: 'Motivo', valor: MOTIVOS[denuncia.reason] ?? denuncia.reason },
                    { termino: 'Denunciada el', valor: fechaYHora(denuncia.createdAt) },
                    {
                      termino: 'Vendedor',
                      valor: (
                        <Link href={`/admin/vendedores/${denuncia.sellerId}`}>
                          {denuncia.sellerDisplayName}
                        </Link>
                      ),
                    },
                    {
                      termino: 'Publicación',
                      valor: <Link href={`/p/${denuncia.listingId}`}>Ver la ficha pública</Link>,
                    },
                  ]}
                />

                {/*
                  ⚠️ EL TEXTO DE LA DENUNCIA ES DE QUIEN LA ESCRIBIO y se muestra
                  tal cual, sin interpretarlo. React escapa el contenido, así que
                  no hace falta nada más para que sea seguro mostrarlo.
                */}
                {denuncia.note !== null && denuncia.note !== '' && (
                  <blockquote className={estilos.cita}>{denuncia.note}</blockquote>
                )}

                <div className={estilos.zonaAccion}>
                  <Confirmar
                    etiqueta="Atender la denuncia"
                    pregunta="Marca la denuncia como atendida: sale de la cola y tu decisión queda en el log de auditoría con tu usuario. La publicación NO se baja."
                  >
                    <Formulario
                      accion={revisarReporte}
                      enviar="Confirmar"
                      tamanio="medio"
                      bloque={false}
                    >
                      <CampoOculto nombre="reporteId" valor={denuncia.id} />
                      <CampoOculto nombre="decision" valor="reviewed" />
                      <AreaDeTexto
                        nombre="nota"
                        identificador={`nota-atender-${denuncia.id}`}
                        etiqueta="Nota del moderador"
                        filas={2}
                        maximo={1000}
                        ayuda="Opcional. Va al log de auditoría, no a la denuncia."
                      />
                    </Formulario>
                  </Confirmar>

                  <Confirmar
                    etiqueta="Descartar la denuncia"
                    pregunta="Marca la denuncia como descartada: sale de la cola sin que se haya hecho nada con la publicación. Queda en el log de auditoría con tu usuario."
                  >
                    <Formulario
                      accion={revisarReporte}
                      enviar="Confirmar"
                      variante="peligro"
                      tamanio="medio"
                      bloque={false}
                    >
                      <CampoOculto nombre="reporteId" valor={denuncia.id} />
                      <CampoOculto nombre="decision" valor="dismissed" />
                      <AreaDeTexto
                        nombre="nota"
                        identificador={`nota-descartar-${denuncia.id}`}
                        etiqueta="Nota del moderador"
                        filas={2}
                        maximo={1000}
                        ayuda="Opcional. Va al log de auditoría, no a la denuncia."
                      />
                    </Formulario>
                  </Confirmar>
                </div>
              </article>
            ))
          )}

          <p className={estilos.nota}>
            <span>La cola trae hasta 100 denuncias abiertas, de la más vieja a la más nueva.</span>
          </p>

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
