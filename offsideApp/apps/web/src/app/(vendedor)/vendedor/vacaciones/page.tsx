import type { Metadata } from 'next';

import { Campo, Formulario } from '@/components/form';
import { Pantalla } from '@/components/movimiento';
import { Aviso, Confirmar, FilaDeDatos, Seccion } from '@/components/ui';
import { fecha } from '@/lib/formato';
import { requireSellerSessionUser } from '@/lib/session';
import { PanelDeCuenta, SolapasDeCuenta } from '../../../(cuenta)/panel';
import { countMyListings } from '@/modules/listings/services/listing.service';
import { getVacation } from '@/modules/sellers/services/vacation.service';

import { activarVacaciones, desactivarVacaciones } from '../../acciones';
import { Chapa } from '../../chapa';
import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Modo vacaciones' };
export const dynamic = 'force-dynamic';

/** `YYYY-MM-DD` de una fecha local, para el `min` del `<input type="date">`. */
function comoInput(fechaLocal: Date): string {
  const mes = String(fechaLocal.getMonth() + 1).padStart(2, '0');
  const dia = String(fechaLocal.getDate()).padStart(2, '0');

  return `${fechaLocal.getFullYear()}-${mes}-${dia}`;
}

/**
 * Modo vacaciones.
 *
 * ⚠️ ES UN PREDICADO DERIVADO, NO UN CAMBIO DE ESTADO DE LAS PUBLICACIONES, y es
 * la decisión de diseño que más importa de esta pantalla. Si activar vacaciones
 * pasara las publicaciones a `paused`, al volver sería imposible distinguir las
 * que el vendedor había pausado a mano (SS-050) de las que apagó el modo
 * vacaciones: se reactivarían publicaciones que su dueño quería abajo. Con un
 * predicado, el estado no se toca y volver no puede romper nada.
 *
 * ⚠️ SE DICE QUE VUELVEN SOLAS, y no es un detalle de redacción. Un vendedor que
 * ve su tienda vacía y no entiende por qué hace lo peor posible: borra las
 * publicaciones y republica, con lo que pierde su historial.
 *
 * ⚠️ LA FECHA ES OBLIGATORIA. Unas vacaciones sin fin son una tienda apagada que
 * nadie se acuerda de encender; el vendedor puede volver antes cuando quiera.
 */
export default async function Vacaciones() {
  const user = await requireSellerSessionUser('/vendedor/vacaciones');

  const [estado, publicaciones] = await Promise.all([getVacation(user), countMyListings(user)]);

  const hoy = new Date();
  const manana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1);

  return (
    <Pantalla>
      <PanelDeCuenta user={user} seccion="cuenta">
        <main id="contenido">
          <Chapa
            rotulo="Mi cuenta"
            titulo="Modo vacaciones"
            chica
            detalle={
              <p className={estilos.chapaDetalle}>
                Apagá la tienda un rato sin perder nada de lo que publicaste.
              </p>
            }
            estado={
              estado.onVacation
                ? { texto: 'Activado', tono: 'alerta' }
                : { texto: 'Apagado', tono: 'marca' }
            }
          />

          <SolapasDeCuenta user={user} seccion="cuenta" activa="vender" />

          {estado.onVacation ? (
            <>
              <Aviso tono="neutro">
                <strong>Estás en modo vacaciones.</strong> Tus{' '}
                {publicaciones.activas === 1
                  ? 'publicación activa no se muestra'
                  : `${publicaciones.activas} publicaciones activas no se muestran`}{' '}
                en la vitrina, en la búsqueda ni en tu tienda, y nadie puede comprarlas.{' '}
                <strong>Vuelven solas</strong>
                {estado.vacationUntil === null ? '' : ` el ${fecha(estado.vacationUntil)}`}: no hace
                falta que republiques ni que toques nada.
              </Aviso>

              <Seccion titulo="Cómo está">
                <div className={estilos.tarjeta}>
                  <FilaDeDatos concepto="Volvés">
                    {estado.vacationUntil === null ? 'Sin fecha' : fecha(estado.vacationUntil)}
                  </FilaDeDatos>
                  <FilaDeDatos concepto="Publicaciones que no se muestran">
                    {String(publicaciones.activas)}
                  </FilaDeDatos>
                </div>
              </Seccion>

              <Seccion titulo="Volver antes">
                <p className={estilos.bajada}>
                  Podés volver cuando quieras: tus publicaciones activas vuelven a la vitrina de
                  inmediato, con el mismo estado que tenían.
                </p>
                <Formulario accion={desactivarVacaciones} enviar="Volver ahora" bloque={false} />
              </Seccion>

              <Seccion titulo="Cambiar la fecha">
                <div className={estilos.formPublicar}>
                  <Formulario accion={activarVacaciones} enviar="Guardar la nueva fecha">
                    <Campo
                      nombre="hasta"
                      etiqueta="Hasta qué día"
                      tipo="date"
                      min={comoInput(manana)}
                      defaultValue={
                        estado.vacationUntil === null
                          ? comoInput(manana)
                          : comoInput(new Date(estado.vacationUntil))
                      }
                      ayuda="Ese día todavía estás afuera: volvés al día siguiente."
                    />
                  </Formulario>
                </div>
              </Seccion>
            </>
          ) : (
            <>
              <Seccion titulo="Qué pasa cuando lo activás">
                <div className={estilos.tarjeta}>
                  <ul className={estilos.listaHonesta}>
                    <li>
                      <strong>Tus publicaciones dejan de mostrarse</strong> en la vitrina, en la
                      búsqueda y en tu tienda, y nadie puede comprarlas.
                    </li>
                    <li>
                      <strong>No se pausan ni se borran.</strong> Su estado no se toca: una pausada
                      sigue pausada y una activa sigue activa, sólo que no se ve.
                    </li>
                    <li>
                      <strong>Vuelven solas el día que elijas</strong>, sin que tengas que hacer
                      nada. También podés volver antes.
                    </li>
                    <li>
                      <strong>Las ventas que ya tenés siguen igual.</strong> Si hay algo por
                      despachar, seguís teniendo que despacharlo: el plazo no se detiene.
                    </li>
                  </ul>
                </div>
              </Seccion>

              <Seccion titulo="Activar">
                <div className={estilos.formPublicar}>
                  {/*
                  ⚠️ EN DOS PASOS. Apaga la tienda entera: no es un interruptor
                  que convenga apretar de paso. El `<details>` funciona sin
                  JavaScript, al revés que `window.confirm`.
                */}
                  <Confirmar
                    etiqueta="Activar el modo vacaciones"
                    pregunta="Mientras esté activo no vas a vender nada. Tus publicaciones no se borran y vuelven solas."
                  >
                    <Formulario accion={activarVacaciones} enviar="Sí, activar">
                      <Campo
                        nombre="hasta"
                        etiqueta="Hasta qué día"
                        tipo="date"
                        min={comoInput(manana)}
                        defaultValue={comoInput(manana)}
                        ayuda="Ese día todavía estás afuera: volvés al día siguiente."
                      />
                    </Formulario>
                  </Confirmar>
                </div>
              </Seccion>
            </>
          )}

          <div className={`${estilos.cierre} sup-2 patron-vivo diagonales-vivas`}>
            <p className={estilos.nota}>
              El modo vacaciones no te exime de las órdenes que ya tenés: lo que se pagó antes hay
              que despacharlo igual, y el plazo de despacho sigue corriendo.
            </p>
          </div>
        </main>
      </PanelDeCuenta>
    </Pantalla>
  );
}
