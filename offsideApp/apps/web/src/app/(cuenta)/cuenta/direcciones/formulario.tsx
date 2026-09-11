import { Campo, CampoOculto, Casilla, Fila, Formulario, Seleccion } from '@/components/form';
import { PROVINCIAS, resolverProvincia } from '@/modules/addresses/services/address-validation';
import type { PublicAddress } from '@/modules/addresses/services/address.service';

import type { EstadoCuenta } from '../../acciones';

/**
 * El formulario de una dirección, compartido por el alta y la edición.
 *
 * ⚠️ EXISTE PORQUE SON NUEVE CAMPOS Y SERÍAN DOS COPIAS. Con el marcado
 * duplicado, agregar un campo o corregir un `autoComplete` se hace en una sola
 * de las dos y la otra queda vieja sin que nada avise. Es el mismo criterio con
 * el que `form.tsx` extrajo `Fila` de los dos módulos que lo tenían copiado.
 *
 * ⚠️ EL `<select>` DE PROVINCIA SALE DE LA LISTA CERRADA DE
 * `address-validation.ts`, que son las 24 jurisdicciones con su letra de ISO
 * 3166-2:AR. No se tipea a mano: el código es lo que viaja, el nombre es lo que
 * se guarda, y quien traduce uno en otro es el Service. Una lista escrita en la
 * pantalla sería una segunda definición de qué provincias existen.
 *
 * ⚠️ LOS `autoComplete` NO SON DECORACIÓN. Sin ellos el navegador no ofrece la
 * dirección que ya tiene guardada y hay que tipear seis líneas en un teléfono.
 * Los valores son los del estándar (`address-line1`, `postal-code`, …), no
 * inventados.
 *
 * ⚠️ LA CASILLA DE "PREDETERMINADA" SÓLO APARECE EN EL ALTA, y `obligatoria=
 * {false}` no es decoración: `Casilla` pone `required` por defecto —la primera
 * del sistema es aceptar los términos— y sin apagarlo no se podría guardar una
 * dirección sin tildarla.
 *
 * ⚠️ NO APARECE AL EDITAR, y es deliberado: cambiar cuál es la predeterminada
 * tiene su propia transacción (`setDefaultAddress`, que desmarca la anterior en
 * el mismo acto) y su propio botón en la lista. Una casilla acá que sólo pudiera
 * MARCAR y nunca desmarcar —desmarcarla dejaría a la libreta sin ninguna
 * predeterminada— sería un control que miente sobre lo que hace.
 */
export function FormularioDeDireccion({
  accion,
  enviar,
  direccion,
}: {
  accion: (estado: EstadoCuenta, formData: FormData) => Promise<EstadoCuenta>;
  enviar: string;
  /** La dirección a editar. Sin ella es un alta. */
  direccion?: PublicAddress;
}) {
  /*
   * ⚠️ SE GUARDA EL NOMBRE Y SE ELIGE EL CÓDIGO, así que al editar hay que
   * volver del uno al otro. `resolverProvincia` ya acepta nombre, código y los
   * alias de CABA: usarlo evita una segunda tabla de equivalencias acá.
   */
  const codigoDeProvincia =
    direccion === undefined ? undefined : resolverProvincia(direccion.provincia)?.codigo;

  return (
    <Formulario accion={accion} enviar={enviar}>
      {direccion !== undefined && <CampoOculto nombre="addressId" valor={direccion.id} />}

      <Campo
        nombre="etiqueta"
        etiqueta="Etiqueta (opcional)"
        ayuda="Para reconocerla: Casa, Trabajo, Lo de mi vieja."
        requerido={false}
        maximo={40}
        defaultValue={direccion?.etiqueta ?? undefined}
      />

      <Fila>
        <Campo
          nombre="nombre"
          etiqueta="Quién recibe"
          autoComplete="name"
          maximo={120}
          defaultValue={direccion?.nombre}
        />
        <Campo
          nombre="telefono"
          etiqueta="Teléfono"
          tipo="tel"
          ayuda="Para que el transportista pueda avisar."
          autoComplete="tel"
          requerido={false}
          defaultValue={direccion?.telefono ?? undefined}
        />
      </Fila>

      <Fila>
        <Campo
          nombre="calle"
          etiqueta="Calle"
          autoComplete="address-line1"
          maximo={200}
          defaultValue={direccion?.calle}
        />
        <Campo
          nombre="numero"
          etiqueta="Número"
          autoComplete="address-line2"
          requerido={false}
          maximo={20}
          defaultValue={direccion?.numero ?? undefined}
        />
      </Fila>

      <Campo
        nombre="departamento"
        etiqueta="Piso / departamento (opcional)"
        requerido={false}
        maximo={50}
        defaultValue={direccion?.departamento ?? undefined}
      />

      <Fila>
        <Campo
          nombre="ciudad"
          etiqueta="Localidad"
          autoComplete="address-level2"
          maximo={120}
          defaultValue={direccion?.ciudad}
        />
        <Seleccion
          nombre="provincia"
          etiqueta="Provincia"
          vacio="Elegí una provincia"
          opciones={PROVINCIAS.map((provincia) => ({
            valor: provincia.codigo,
            etiqueta: provincia.nombre,
          }))}
          defaultValue={codigoDeProvincia}
        />
      </Fila>

      <Campo
        nombre="codigoPostal"
        etiqueta="Código postal"
        ayuda="Las 4 cifras de siempre o el CPA de 8 caracteres (por ejemplo C1425ABC)."
        autoComplete="postal-code"
        maximo={10}
        defaultValue={direccion?.codigoPostal}
      />

      {direccion === undefined && (
        <Casilla nombre="predeterminada" obligatoria={false}>
          Usar esta dirección por defecto en mis compras
        </Casilla>
      )}
    </Formulario>
  );
}
