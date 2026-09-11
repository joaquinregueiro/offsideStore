import type { Metadata } from 'next';

import { Campo, Formulario, Seleccion } from '@/components/form';
import { Pantalla } from '@/components/movimiento';
import {
  Aviso,
  BotonEnlace,
  CeldaNumero,
  Confirmar,
  EncabezadoNumero,
  EstadoVacio,
  Etiqueta,
  Tabla,
} from '@/components/ui';
import { cantidad, porcentajeDeComision } from '@/lib/formato';
import { CAPABILITIES } from '@/lib/permissions';
import { requireCapabilitySessionUser } from '@/lib/session';
import { AuthError } from '@/modules/auth/auth.errors';
import { getSellerTierSettings } from '@/modules/config/services/setting-store.service';
import { getCommissionRateBasisPoints } from '@/modules/config/services/settings.service';
import { listTiers, type TierSummary } from '@/modules/sellers/services/seller-tier.service';

import { asignarNivel } from '../../acciones';
import { Consola } from '../../consola';
import estilos from '../../admin.module.css';

export const metadata: Metadata = { title: 'Niveles de vendedor' };
export const dynamic = 'force-dynamic';

/**
 * Niveles de vendedor (seller tiers, DEC-037 / BR-051).
 *
 * ⚠️ UN NIVEL PUEDE CAMBIAR LA COMISION DE UNA PERSONA. Por eso pide
 * `system_config:manage`: es el mismo tipo de decisión que cambiar la tasa
 * global, sólo que aplicada a un vendedor.
 *
 * ⚠️ LOS NIVELES NO SE CREAN NI SE EDITAN DESDE ACA, Y NO ES UNA OMISION. La
 * fila de `seller_tiers` —su código, su tasa, su umbral— la carga una
 * migración; `sellers` sólo expone `listTiers()`, que es de sólo lectura. Crear
 * un nivel sería crear una categoría comercial de la plataforma, que es una
 * decisión de negocio antes que una pantalla. Lo que sí se opera acá es a quién
 * se le asigna cuál.
 *
 * ⚠️ `listTiers()` DEVUELVE SOLO LOS ACTIVOS. Un nivel desactivado existe en la
 * base, sigue explicando la comisión de las órdenes viejas y acá no se ve. La
 * columna "Estado" dice "Activo" en todas las filas por ese motivo, y no porque
 * se haya verificado una por una. Reportado.
 */

/**
 * Asignar un nivel a mano.
 *
 * ⚠️ NO SE PIDE UN MOTIVO, Y NO ES UN OLVIDO: `assignTierManually` no acepta
 * ninguno. Audita el cambio con `metadata: { kind: 'manual' }` y el id del
 * administrador, y nada más. Un campo "motivo" sería un texto que se tira, que
 * es peor que no pedirlo. Queda reportado como pendiente del Service.
 */
function FormularioDeAsignacion({
  tiers,
  vendedor,
}: {
  tiers: TierSummary[];
  vendedor: string | undefined;
}) {
  return (
    <section className={estilos.tarjeta} aria-labelledby="asignar-nivel">
      <div className={estilos.tarjetaCabecera}>
        <h2 id="asignar-nivel" className={estilos.tituloDeFicha}>
          Asignar un nivel a mano
        </h2>
      </div>

      <Confirmar
        etiqueta="Asignar nivel"
        pregunta="El nivel decide la comisión que ese vendedor va a pagar en sus PRÓXIMAS ventas. Las órdenes que ya existen conservan la tasa con la que se crearon. Se puede bajar de nivel: queda auditado con tu usuario."
      >
        <Formulario accion={asignarNivel} enviar="Confirmar asignación" tamanio="medio">
          <Campo
            nombre="sellerId"
            etiqueta="Id del vendedor"
            ayuda="Se copia de la ficha del vendedor, en Vendedores."
            defaultValue={vendedor ?? ''}
            autoComplete="off"
            spellCheck={false}
          />
          <Seleccion
            nombre="tierCode"
            etiqueta="Nivel"
            opciones={tiers.map((tier) => ({
              valor: tier.code,
              etiqueta: `${tier.name} — ${tier.usesGlobalRate ? 'usa la comisión global' : tier.rateLabel}`,
            }))}
          />
          <Campo
            nombre="motivo"
            etiqueta="Motivo"
            ayuda="Por qué se cambia a mano. Queda en el log de auditoría."
            autoComplete="off"
          />
        </Formulario>
      </Confirmar>

      <p className={estilos.nota}>
        <span>Queda en el log de auditoría con tu usuario y con el motivo que escribas.</span>
      </p>
    </section>
  );
}

export default async function Niveles({
  searchParams,
}: {
  searchParams: Promise<{ vendedor?: string }>;
}) {
  const [{ vendedor }, admin] = await Promise.all([
    searchParams,
    requireCapabilitySessionUser(CAPABILITIES.SYSTEM_CONFIG_MANAGE, '/admin/niveles'),
  ]);

  const [global, settings] = await Promise.all([
    getCommissionRateBasisPoints(),
    getSellerTierSettings(),
  ]);

  /*
   * ⚠️ EL CASO "NO HAY NIVELES CARGADOS" SE ATIENDE, NO SE DEJA EXPLOTAR.
   * `listTiers()` LANZA cuando `seller_tiers` está vacía —que es el estado real
   * de la base hoy— y sin esto la pantalla entera caería en el `error.tsx` del
   * grupo, diciendo "tuvimos un problema" cuando en realidad no hay nada que
   * mostrar todavía. Se atrapa SOLO ese código y cualquier otro error se relanza.
   */
  let tiers: TierSummary[] = [];
  let sinNiveles = false;

  try {
    tiers = await listTiers();
  } catch (error) {
    if (!(error instanceof AuthError) || error.code !== 'SETTING_NOT_CONFIGURED') throw error;
    sinNiveles = true;
  }

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Consola
          rol={admin.adminRole}
          email={admin.email}
          activo="niveles"
          titulo="Niveles de vendedor"
        />

        <div className={estilos.hoja}>
          <p className={estilos.bajada}>
            El nivel de un vendedor decide su comisión. Un nivel sin tasa propia usa la global, que
            hoy es <strong>{porcentajeDeComision(global)}</strong>.
          </p>

          <div className={estilos.datos}>
            <div className={estilos.datoAjuste}>
              <span className={estilos.rotuloEstado}>Asignación automática</span>
              <span>{settings.autoAssign ? 'Encendida' : 'Apagada'}</span>
            </div>
            <div className={estilos.datoAjuste}>
              <span className={estilos.rotuloEstado}>Baja automática</span>
              <span>{settings.autoDowngrade ? 'Encendida' : 'Apagada'}</span>
            </div>
            <div className={estilos.datoAjuste}>
              <span className={estilos.rotuloEstado}>Ventana de ventas</span>
              <span>{cantidad(settings.salesWindowDays, 'día', 'días')}</span>
            </div>
            <div className={estilos.datoAjuste}>
              <span className={estilos.rotuloEstado}>Qué cuenta como venta</span>
              {/*
                ⚠️ SE TRADUCE EN VEZ DE IMPRIMIR EL JSON. El valor es
                `{ countsOnly: 'COMPLETED', excludesRefunded: true }` y el
                schema del registro lo fija con dos `literal`: no hay otra
                combinación posible hoy, así que la frase es exacta y no una
                interpretación. Si alguna vez el schema se amplía, este texto
                deja de alcanzar y hay que volver acá.
              */}
              <span>
                {settings.evaluation.countsOnly === 'COMPLETED' &&
                settings.evaluation.excludesRefunded
                  ? 'Sólo las completadas, sin las reembolsadas'
                  : JSON.stringify(settings.evaluation)}
              </span>
            </div>
          </div>

          <p className={estilos.nota}>
            <span>
              Los cuatro valores salen del Config Store y se cambian en Configuración, no acá.
            </span>
          </p>

          {sinNiveles ? (
            <EstadoVacio titulo="Todavía no hay niveles cargados">
              <code>seller_tiers</code> está vacía, así que todos los vendedores pagan la comisión
              global. Los niveles los carga una migración: no se crean desde el back-office.
            </EstadoVacio>
          ) : (
            <>
              <div className={estilos.historial}>
                <Tabla titulo="Niveles activos" tituloVisible>
                  <thead>
                    <tr>
                      <th scope="col">Nivel</th>
                      <th scope="col">Código</th>
                      <EncabezadoNumero>Comisión</EncabezadoNumero>
                      <EncabezadoNumero>Ventas mínimas</EncabezadoNumero>
                      <th scope="col">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tiers.map((tier) => (
                      <tr key={tier.code}>
                        <td>
                          {tier.name}
                          {tier.description !== null && (
                            <span className={estilos.metaFila}>{tier.description}</span>
                          )}
                        </td>
                        <td>
                          <code className={estilos.crudo}>{tier.code}</code>
                        </td>
                        {/*
                          ⚠️ UNA TASA NULA NO SE MUESTRA COMO CERO. `commission_rate`
                          en NULL significa "usa la global", no "no cobra": mostrar
                          el número resuelto sin decir de dónde salió haría creer
                          que el nivel fija esa tasa, y cambiar la global después
                          cambiaría esta fila sin que nadie toque el nivel.
                        */}
                        <CeldaNumero>
                          {tier.usesGlobalRate ? `${tier.rateLabel} (global)` : tier.rateLabel}
                        </CeldaNumero>
                        <CeldaNumero>{tier.minCompletedSales}</CeldaNumero>
                        <td>
                          <Etiqueta tono="exito">Activo</Etiqueta>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Tabla>
              </div>

              <div className={estilos.avisoDeConsola}>
                <Aviso>
                  La tabla lista sólo los niveles <strong>activos</strong>. Uno desactivado sigue
                  existiendo en la base y sigue explicando la comisión de las órdenes viejas, pero
                  desde acá no se ve.
                </Aviso>
              </div>

              <FormularioDeAsignacion tiers={tiers} vendedor={vendedor} />
            </>
          )}

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
