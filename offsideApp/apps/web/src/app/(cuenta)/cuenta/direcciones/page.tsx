import type { Metadata } from 'next';

import { CampoOculto, Formulario } from '@/components/form';
import { IconoUbicacion } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import { Aviso, BotonEnlace, Etiqueta, EstadoVacio, Seccion } from '@/components/ui';
import { cantidad } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import {
  listAddresses,
  MAX_ADDRESSES_PER_USER,
} from '@/modules/addresses/services/address.service';

import { guardarDireccion, usarPorDefecto } from '../../acciones';
import { ChapaDeCuenta } from '../../chapa';
import { PanelDeCuenta, SolapasDeCuenta } from '../../panel';
import estilos from '../../cuenta.module.css';
import { FormularioDeDireccion } from './formulario';

export const metadata: Metadata = { title: 'Mis direcciones' };
export const dynamic = 'force-dynamic';

/**
 * LA LIBRETA DE DIRECCIONES (BS-020, ERD §6.1).
 *
 * ⚠️ CAMBIAR UNA DIRECCIÓN NO CAMBIA NINGUNA COMPRA. La orden congela su
 * `shipping_address` como snapshot al crearse (DEC-030) y el snapshot no lleva
 * el `id` de la libreta justamente para que no pueda volver: una compra sigue
 * diciendo a dónde se despachó. La pantalla lo dice con todas las letras, porque
 * es lo primero que alguien teme al editar.
 *
 * ⚠️ EL ALTA VIVE EN ESTA MISMA PANTALLA, DENTRO DE UN `<details>`. Sin
 * JavaScript el navegador lo abre y lo cierra solo; con una ruta aparte habría
 * una pantalla más para agregar la segunda dirección, que es una operación de
 * treinta segundos.
 *
 * ⚠️ EL `<details>` ARRANCA ABIERTO CUANDO NO HAY NINGUNA DIRECCIÓN. Un
 * formulario plegado detrás de un resumen, en una pantalla vacía, es un estado
 * vacío sin salida.
 */
export default async function MisDirecciones() {
  const user = await requireVerifiedSessionUser('/cuenta/direcciones');
  const direcciones = await listAddresses(user);

  const lleno = direcciones.length >= MAX_ADDRESSES_PER_USER;

  return (
    <Pantalla>
      <PanelDeCuenta user={user} seccion="cuenta">
        <main id="contenido">
          <ChapaDeCuenta
            rotulo="Mi cuenta"
            titulo="Direcciones"
            detalle={
              <p className={estilos.chapaDetalle}>
                {direcciones.length === 0
                  ? 'Todavía no guardaste ninguna'
                  : cantidad(direcciones.length, 'dirección', 'direcciones')}
              </p>
            }
          />

          <SolapasDeCuenta user={user} seccion="cuenta" activa="direcciones" />

          {direcciones.length === 0 ? (
            <EstadoVacio titulo="Sin direcciones guardadas" icono={<IconoUbicacion tamanio={40} />}>
              <p>Guardá una y no vas a tener que escribirla de nuevo en cada compra.</p>
            </EstadoVacio>
          ) : (
            <Seccion titulo="Guardadas" dato={`${direcciones.length} de ${MAX_ADDRESSES_PER_USER}`}>
              <ul className={`${estilos.direcciones} ${estilos.revela}`}>
                {direcciones.map((direccion) => (
                  <li key={direccion.id} className={`${estilos.direccion} sup-ficha eleva`}>
                    <div className={estilos.direccionCabecera}>
                      <p className={estilos.direccionEtiqueta}>
                        {direccion.etiqueta ?? direccion.nombre}
                      </p>
                      {direccion.esPredeterminada && (
                        <Etiqueta tono="marca">Predeterminada</Etiqueta>
                      )}
                    </div>

                    {/*
                    ⚠️ ES UN `<address>` DE VERDAD y se dibuja como una etiqueta
                    de envío, una línea por renglón: así se lee igual que lo que
                    va a ir pegado en el paquete, y un lector de pantalla anuncia
                    que es una dirección.
                  */}
                    <address className={estilos.domicilio}>
                      <span className={estilos.domicilioNombre}>{direccion.nombre}</span>
                      {direccion.calle}
                      {direccion.numero !== null && ` ${direccion.numero}`}
                      {direccion.departamento !== null && `, ${direccion.departamento}`}
                      <br />
                      {direccion.codigoPostal} {direccion.ciudad}
                      <br />
                      {direccion.provincia}
                      {direccion.telefono !== null && (
                        <>
                          <br />
                          Tel. {direccion.telefono}
                        </>
                      )}
                    </address>

                    <div className={estilos.direccionAcciones}>
                      <BotonEnlace
                        href={`/cuenta/direcciones/${direccion.id}`}
                        variante="secundario"
                        tamanio="chico"
                      >
                        Editar
                      </BotonEnlace>

                      {!direccion.esPredeterminada && (
                        /*
                        ⚠️ ES UN `<form>` POR POST Y NO UN ENLACE: cambia estado.
                        Un GET que muta lo dispara solo cualquier prefetch.
                      */
                        <Formulario
                          accion={usarPorDefecto}
                          enviar="Usar por defecto"
                          variante="fantasma"
                          tamanio="chico"
                          bloque={false}
                        >
                          <CampoOculto nombre="addressId" valor={direccion.id} />
                        </Formulario>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Seccion>
          )}

          {lleno ? (
            <Aviso tono="neutro">
              Llegaste al máximo de {MAX_ADDRESSES_PER_USER} direcciones guardadas. Borrá una para
              poder agregar otra.
            </Aviso>
          ) : (
            <details
              className={`${estilos.bloque} sup-ficha desplegable`}
              open={direcciones.length === 0}
            >
              <summary className={estilos.direccionEtiqueta}>Agregar una dirección</summary>
              <div className={estilos.separador}>
                <FormularioDeDireccion accion={guardarDireccion} enviar="Guardar la dirección" />
              </div>
            </details>
          )}

          <p className={estilos.nota}>
            Editar o borrar una dirección no cambia ninguna compra que ya hiciste: cada orden guarda
            por su cuenta a dónde se despachó.
          </p>
        </main>
      </PanelDeCuenta>
    </Pantalla>
  );
}
