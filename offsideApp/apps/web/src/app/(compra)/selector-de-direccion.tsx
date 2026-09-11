import { Campo, Fila, Seleccion } from '@/components/form';
import { IconoUbicacion } from '@/components/iconos';
import { PROVINCIAS, type PublicAddress } from '@/modules/addresses/services/address.service';

import estilos from './resumen.module.css';

/**
 * Elegir a donde va el envio: la libreta primero, el formulario despues.
 *
 * ⚠️ VIVE EN `(compra)` Y LO USA TAMBIEN `/carrito`. Es la MISMA decision en
 * las dos pantallas —y el mismo snapshot en la orden—: tener dos formularios de
 * direccion es tener dos ideas distintas de que es una direccion valida.
 *
 * ⚠️ ANDA SIN JAVASCRIPT Y SIN UN RADIO ESCONDIDO. Los campos nuevos viven
 * adentro de un `<details>`; el servidor decide asi: si vinieron completados,
 * GANAN sobre el radio elegido arriba (ver `resolverDireccion`). Un radio
 * "usar otra" que hay que acordarse de tocar despacha al lugar equivocado a
 * quien completo el formulario entero y no lo toco.
 */
export function SelectorDeDireccion({
  direcciones,
  predeterminada,
}: {
  direcciones: PublicAddress[];
  /** La que viene marcada. `null` si la persona todavia no guardo ninguna. */
  predeterminada: PublicAddress | null;
}) {
  const hayGuardadas = direcciones.length > 0;

  const campos = (
    <>
      <Campo
        nombre="nombre"
        etiqueta="Nombre y apellido de quien recibe"
        autoComplete="name"
        requerido={!hayGuardadas}
      />

      <Fila>
        <Campo
          nombre="calle"
          etiqueta="Calle"
          autoComplete="address-line1"
          requerido={!hayGuardadas}
        />
        <Campo nombre="numero" etiqueta="Número" requerido={false} />
      </Fila>

      <Fila>
        <Campo nombre="departamento" etiqueta="Piso y depto" ayuda="Opcional" requerido={false} />
        <Campo
          nombre="ciudad"
          etiqueta="Localidad"
          autoComplete="address-level2"
          requerido={!hayGuardadas}
        />
      </Fila>

      <Fila>
        {/*
          ⚠️ ES UNA LISTA CERRADA DE 24, NO UN CAMPO DE TEXTO. La provincia es
          parte de la clave con la que se despacha: "Bs As", "BSAS" y "pcia de
          bs as" son tres filas distintas para cualquier sistema de envios.
        */}
        <Seleccion
          nombre="provincia"
          etiqueta="Provincia"
          /*
            ⚠️ SIEMPRE CON OPCION VACIA. Sin ella el `<select>` arranca en la
            primera de la lista —CABA—, asi que quien no lo toca despacha a la
            Ciudad de Buenos Aires sin haberla elegido nunca.
          */
          vacio="Elegí una provincia"
          opciones={PROVINCIAS.map((provincia) => ({
            valor: provincia.codigo,
            etiqueta: provincia.nombre,
          }))}
        />
        <Campo
          nombre="codigoPostal"
          etiqueta="Código postal"
          autoComplete="postal-code"
          ayuda="4 cifras o CPA (C1425ABC)"
          requerido={!hayGuardadas}
        />
      </Fila>

      <Fila>
        <Campo
          nombre="telefono"
          etiqueta="Teléfono"
          tipo="tel"
          autoComplete="tel"
          ayuda="Para que el vendedor pueda coordinar la entrega"
          requerido={!hayGuardadas}
        />
        <Campo
          nombre="etiqueta"
          etiqueta="Nombre de la dirección"
          ayuda="Opcional: Casa, Trabajo"
          requerido={false}
        />
      </Fila>

      {/*
        ⚠️ GUARDARLA ES UNA ELECCION, NO UN EFECTO SECUNDARIO. La libreta es del
        usuario: llenarla sola con cada compra convierte una lista de tres
        direcciones utiles en diez que nadie reconoce.

        ⚠️ NO USA `<Casilla>` Y NO ES UN OLVIDO: ese componente pone `required`
        fijo —nacio para la aceptacion de terminos— y un lector de pantalla
        anunciaria "obligatorio" sobre una casilla que no lo es.
      */}
      <label className={estilos.guardar} htmlFor="guardarDireccion">
        <input type="checkbox" id="guardarDireccion" name="guardarDireccion" value="si" />
        <span>Guardarla en mi libreta para la próxima</span>
      </label>
    </>
  );

  if (!hayGuardadas) {
    /*
     * Sin libreta no hay nada que elegir: los campos van a la vista. Meterlos
     * adentro de un `<details>` cerrado seria esconder el unico camino que hay.
     */
    return <div className={estilos.direcciones}>{campos}</div>;
  }

  return (
    <div className={estilos.direcciones}>
      <ul className={estilos.libreta}>
        {direcciones.map((direccion) => (
          <li key={direccion.id}>
            <label className={`${estilos.direccion} sup-ficha`}>
              <input
                type="radio"
                name="direccionId"
                value={direccion.id}
                defaultChecked={direccion.id === predeterminada?.id}
                className={estilos.direccionRadio}
              />
              <span className={estilos.direccionCuerpo}>
                <span className={estilos.direccionTitulo}>
                  <IconoUbicacion tamanio={16} />
                  {direccion.etiqueta ?? direccion.nombre}
                  {direccion.esPredeterminada && (
                    <span className={estilos.direccionChip}>Predeterminada</span>
                  )}
                </span>
                <span className={estilos.direccionTexto}>
                  {direccion.calle}
                  {direccion.numero === null ? '' : ` ${direccion.numero}`}
                  {direccion.departamento === null ? '' : `, ${direccion.departamento}`} ·{' '}
                  {direccion.ciudad}, {direccion.provincia} · CP {direccion.codigoPostal}
                </span>
                <span className={estilos.direccionTexto}>
                  A nombre de {direccion.nombre}
                  {direccion.telefono === null ? '' : ` · ${direccion.telefono}`}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      {/*
        ⚠️ `desplegable` ANIMA LA ALTURA DESDE LA HOJA GLOBAL, igual que
        `<Confirmar>`. Sin soporte del navegador abre de golpe, que es lo que un
        `<details>` hace por defecto: nada queda inalcanzable.
      */}
      <details className={`${estilos.otraDireccion} desplegable`}>
        <summary className={estilos.otraDireccionDisparador}>Enviar a otra dirección</summary>
        <div className={estilos.otraDireccionPanel}>
          <p className={estilos.otraDireccionNota}>
            Si completás estos datos, el envío va acá y no a la dirección elegida arriba.
          </p>
          {campos}
        </div>
      </details>
    </div>
  );
}
