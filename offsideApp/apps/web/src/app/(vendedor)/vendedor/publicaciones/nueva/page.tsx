import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AreaDeTexto, Campo, Formulario, Seleccion } from '@/components/form';
import { Aviso } from '@/components/ui';
import { requireSellerSessionUser } from '@/lib/session';
import { listActiveCategories } from '@/modules/listings/services/listing.service';
import { getConnectionStatus } from '@/modules/sellers/services/mercadopago-connection.service';

import { publicar } from '../../../acciones';
import estilos from '../../../vendedor.module.css';

export const metadata: Metadata = { title: 'Publicar — Offside Store' };
export const dynamic = 'force-dynamic';

/**
 * Formulario de publicación (SS-030 / SS-031).
 *
 * ⚠️ SIN FOTOS, Y ES LA CARENCIA MAS GRANDE DE ESTA PANTALLA. SS-031 pide al
 * menos una imagen y el almacenamiento S3 no está implementado. Se avisa acá
 * arriba en vez de dejar que el vendedor publique y descubra después que su
 * camiseta se ve vacía en la vitrina.
 *
 * ⚠️ `kitType` y `sleeve` SE PIDEN SIEMPRE, no sólo para camiseta. El ERD §9.1
 * los hace obligatorios únicamente para esa categoría, y quien conoce la
 * categoría es el Service. Mostrarlos condicionalmente exigiría JavaScript en
 * el cliente para algo que el servidor ya valida; se prefiere pedirlos como
 * opcionales y decir en la ayuda cuándo son obligatorios.
 */
export default async function NuevaPublicacion() {
  const user = await requireSellerSessionUser('/vendedor/publicaciones/nueva');

  const [categorias, conexion] = await Promise.all([
    listActiveCategories(),
    getConnectionStatus(user),
  ]);

  // El Service rechaza igual, pero llevar a alguien a llenar un formulario que
  // no va a poder enviar es maltratarlo.
  if (!conexion.canSell) redirect('/vendedor');

  const categoriaPorDefecto =
    categorias.find((categoria) => categoria.code === 'camiseta')?.id ?? categorias[0]?.id;

  return (
    <main className={estilos.pagina}>
      <h1 className={estilos.titulo}>Publicar</h1>

      <Aviso>
        Todavía no se pueden subir fotos. Tu publicación va a salir sin imágenes hasta que
        habilitemos la carga.
      </Aviso>

      <Formulario accion={publicar} enviar="Publicar">
        {/*
          Camiseta va PRIMERA y preseleccionada. Las seis categorias se ordenan
          alfabeticamente en el repositorio, y eso dejaba "Buzos" como opcion por
          defecto en un marketplace de camisetas: la mayoria de las
          publicaciones habrian nacido en la categoria equivocada por inercia.
        */}
        <Seleccion
          nombre="categoryId"
          etiqueta="Categoría"
          defaultValue={categoriaPorDefecto}
          opciones={categorias.map((categoria) => ({
            valor: categoria.id,
            etiqueta: categoria.name,
          }))}
        />

        <Campo
          nombre="title"
          etiqueta="Título"
          ayuda="Club, temporada y si es titular o suplente. Ej: River Plate 1996 titular."
        />

        <AreaDeTexto
          nombre="description"
          etiqueta="Descripción"
          ayuda="Opcional. Estado real, detalles, marcas de uso. Ser preciso evita reclamos."
        />

        <div className={estilos.par}>
          <Campo nombre="precioPesos" etiqueta="Precio en pesos" tipo="number" />
          <Campo nombre="stock" etiqueta="Unidades" tipo="number" defaultValue="1" />
        </div>

        <div className={estilos.par}>
          <Campo
            nombre="sizeValue"
            etiqueta="Talle"
            ayuda="Como figura en la prenda: S, M, L, XL."
          />
          <Seleccion
            nombre="condition"
            etiqueta="Estado"
            opciones={[
              { valor: 'NUEVO', etiqueta: 'Nuevo' },
              { valor: 'COMO_NUEVO', etiqueta: 'Como nuevo' },
              { valor: 'EXCELENTE', etiqueta: 'Excelente' },
              { valor: 'MUY_BUENO', etiqueta: 'Muy bueno' },
              { valor: 'BUENO', etiqueta: 'Bueno' },
              { valor: 'ACEPTABLE', etiqueta: 'Aceptable' },
            ]}
          />
        </div>

        <div className={estilos.par}>
          <Seleccion
            nombre="kitType"
            etiqueta="Tipo de camiseta"
            vacio="No corresponde"
            ayuda="Obligatorio si publicás una camiseta."
            opciones={[
              { valor: 'home', etiqueta: 'Titular' },
              { valor: 'away', etiqueta: 'Suplente' },
              { valor: 'third', etiqueta: 'Tercera' },
              { valor: 'goalkeeper', etiqueta: 'Arquero' },
              { valor: 'special', etiqueta: 'Especial' },
            ]}
          />
          <Seleccion
            nombre="sleeve"
            etiqueta="Mangas"
            vacio="No corresponde"
            ayuda="Obligatorio si publicás una camiseta."
            opciones={[
              { valor: 'short', etiqueta: 'Cortas' },
              { valor: 'long', etiqueta: 'Largas' },
            ]}
          />
        </div>
      </Formulario>

      {/*
        ⚠️ La publicación sale visible de inmediato porque la moderación previa
        todavía no está decidida. No se promete una revisión que no existe.
      */}
      <p className={estilos.nota}>
        Tu publicación queda visible apenas la publicás. El stock se descuenta cuando el pago del
        comprador se aprueba, no antes.
      </p>
    </main>
  );
}
