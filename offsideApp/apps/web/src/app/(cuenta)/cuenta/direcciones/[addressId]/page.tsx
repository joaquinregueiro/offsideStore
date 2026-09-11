import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CampoOculto, Formulario } from '@/components/form';
import { Pantalla } from '@/components/movimiento';
import { Confirmar, Etiqueta, Migas } from '@/components/ui';
import { requireVerifiedSessionUser } from '@/lib/session';
import { listAddresses, type PublicAddress } from '@/modules/addresses/services/address.service';

import { borrarDireccion, editarDireccion } from '../../../acciones';
import { ChapaDeCuenta } from '../../../chapa';
import { NavDeCuenta } from '../../../nav';
import estilos from '../../../cuenta.module.css';
import { FormularioDeDireccion } from '../formulario';

export const metadata: Metadata = { title: 'Editar dirección' };
export const dynamic = 'force-dynamic';

/**
 * Lee la dirección tratando "ajena" e "inexistente" como lo mismo.
 *
 * ⚠️ SE BUSCA DENTRO DE `listAddresses` Y NO CON `getAddress`, Y ES DELIBERADO.
 * `getAddress` lanza `VALIDATION_FAILED` para una dirección que no existe o que
 * es de otro —está pensado para un id que llega desde un formulario, donde ese
 * id ES un dato inválido—, y ese error no trae ningún `reason` con el que
 * distinguirlo de un fallo real. Filtrar la lista del propio usuario da el mismo
 * resultado de seguridad —lo ajeno no está—, en una sola consulta, y deja que
 * cualquier otro error llegue al límite de error del grupo en vez de disfrazarse
 * de 404.
 *
 * ⚠️ EL 404 ES LO CORRECTO ACÁ, no un 403: un 403 confirmaría que la dirección
 * existe y permitiría enumerar las de otras personas probando ids. El cupo son
 * diez, así que traer la lista entera no es un costo.
 */
async function leerDireccion(addressId: string, volverA: string): Promise<PublicAddress> {
  const user = await requireVerifiedSessionUser(volverA);

  const direccion = (await listAddresses(user)).find((item) => item.id === addressId);
  if (direccion === undefined) notFound();

  return direccion;
}

/**
 * EDITAR UNA DIRECCIÓN DE LA LIBRETA.
 *
 * ⚠️ ES UN FORMULARIO COMPLETO, NO UN PARCHE: `updateAddress` reemplaza los
 * nueve campos. Por eso todos vienen precargados; mandar sólo lo que cambió
 * dejaría el resto en blanco.
 *
 * ⚠️ BORRAR ES FÍSICO Y VA EN DOS PASOS. La libreta es efímera (ERD §20.10) y
 * cada orden ya tiene su snapshot, así que no hay nada que preservar — pero
 * tampoco hay forma de deshacerlo, y un clic único sobre "Borrar" al lado de un
 * formulario es un accidente esperando.
 */
export default async function EditarDireccion({
  params,
}: {
  params: Promise<{ addressId: string }>;
}) {
  const { addressId } = await params;
  const direccion = await leerDireccion(addressId, `/cuenta/direcciones/${addressId}`);

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <ChapaDeCuenta
          rotulo="Direcciones"
          titulo={direccion.etiqueta ?? direccion.nombre}
          detalle={
            <p className={estilos.chapaDetalle}>
              {direccion.calle}
              {direccion.numero === null ? '' : ` ${direccion.numero}`}, {direccion.ciudad}
            </p>
          }
          lateral={
            direccion.esPredeterminada ? (
              <Etiqueta tono="marca">Predeterminada</Etiqueta>
            ) : undefined
          }
        />

        <NavDeCuenta activo="direcciones" />

        <Migas
          items={[
            { texto: 'Mi cuenta', href: '/cuenta' },
            { texto: 'Direcciones', href: '/cuenta/direcciones' },
            { texto: 'Editar' },
          ]}
        />

        <section className={`${estilos.bloque} sup-ficha entraBloque`}>
          <h2 className={estilos.bloqueTitulo}>Datos del envío</h2>
          <FormularioDeDireccion
            accion={editarDireccion}
            enviar="Guardar los cambios"
            direccion={direccion}
          />
        </section>

        <div className={estilos.separador}>
          <Confirmar
            etiqueta="Borrar esta dirección"
            pregunta={
              direccion.esPredeterminada
                ? 'Se borra de tu libreta y no se puede deshacer. Como era la predeterminada, pasa a serlo la más nueva de las que queden. Tus compras anteriores no cambian.'
                : 'Se borra de tu libreta y no se puede deshacer. Tus compras anteriores no cambian: cada orden guarda por su cuenta a dónde se despachó.'
            }
          >
            <Formulario
              accion={borrarDireccion}
              enviar="Sí, borrarla"
              variante="peligro"
              tamanio="medio"
              bloque={false}
            >
              <CampoOculto nombre="addressId" valor={direccion.id} />
            </Formulario>
          </Confirmar>
        </div>
      </main>
    </Pantalla>
  );
}
