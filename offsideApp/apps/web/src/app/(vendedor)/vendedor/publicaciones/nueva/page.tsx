import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  AreaDeTexto,
  Campo,
  CampoArchivos,
  CampoImporte,
  Formulario,
  GrupoDeCampos,
  Seleccion,
  SubtituloDeGrupo,
} from '@/components/form';
import { Pantalla } from '@/components/movimiento';
import { requireSellerSessionUser } from '@/lib/session';
import { getImageSettings } from '@/modules/config/services/image-settings.service';
import { listActiveCategories, listCatalogs } from '@/modules/listings/services/listing.service';
import { getConnectionStatus } from '@/modules/sellers/services/mercadopago-connection.service';

import { publicar } from '../../../acciones';
import { Chapa } from '../../../chapa';
import estilos from '../../../vendedor.module.css';

export const metadata: Metadata = { title: 'Publicar' };
export const dynamic = 'force-dynamic';

/**
 * Formulario de publicación (SS-030 / SS-031).
 *
 * ⚠️ PS-010 EN VIGOR: sin al menos una foto la publicación NACE EN BORRADOR
 * (SS-032) y no sale a la vitrina hasta que se suba una. No se puede validar al
 * crear —las imágenes necesitan que la publicación exista, por la FK—, así que
 * la pantalla lo dice antes y el vendedor la completa desde sus publicaciones.
 *
 * ⚠️ SI UNA FOTO FALLA, LA PUBLICACION SE CREA IGUAL y se avisa cuántas
 * fallaron. Tirar abajo la publicación entera le haría perder al vendedor todo
 * lo que escribió por un problema de una imagen.
 *
 * ⚠️ `kitType` y `sleeve` SE PIDEN SIEMPRE, no sólo para camiseta. El ERD §9.1
 * los hace obligatorios únicamente para esa categoría, y quien conoce la
 * categoría es el Service. Mostrarlos condicionalmente exigiría JavaScript en
 * el cliente para algo que el servidor ya valida; se prefiere pedirlos como
 * opcionales y decir en la ayuda cuándo son obligatorios.
 */
export default async function NuevaPublicacion() {
  const user = await requireSellerSessionUser('/vendedor/publicaciones/nueva');

  const [categorias, conexion, imagenes, catalogos] = await Promise.all([
    listActiveCategories(),
    getConnectionStatus(user),
    getImageSettings(),
    listCatalogs(),
  ]);

  // El Service rechaza igual, pero llevar a alguien a llenar un formulario que
  // no va a poder enviar es maltratarlo.
  if (!conexion.canSell) redirect('/vendedor');

  const categoriaPorDefecto =
    categorias.find((categoria) => categoria.code === 'camiseta')?.id ?? categorias[0]?.id;

  const maxMb = Math.floor(imagenes.maxBytes / (1024 * 1024));

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Chapa
          rotulo="Inventario"
          titulo="Publicar"
          chica
          detalle={
            <p className={estilos.chapaDetalle}>Cuatro decisiones y tu camiseta está a la venta.</p>
          }
        />

        {/*
          ⚠️ EL MARCO ES LO QUE NUMERA LOS GRUPOS, Y LO HACE CON UN `counter()` DE
          CSS. Sin JavaScript, sin tocar `GrupoDeCampos` —que es compartido con el
          alta y con la compra— y renumerándose solo el día que se agregue o se
          saque un grupo.

          ⚠️ ES PROGRESO DE UBICACION, NO DE COMPLETITUD, y la distinción importa:
          saber cuántos campos faltan por llenar exige leer los valores, o sea
          JavaScript. El grupo que se tiñe donde está el foco es información
          verdadera; una barra de "3 de 4 completos" sería una promesa que el CSS
          no puede cumplir.
        */}
        <div className={estilos.formPublicar}>
          <Formulario accion={publicar} enviar="Publicar">
            {/*
              ⚠️ CUATRO GRUPOS, NO QUINCE CAMPOS SUELTOS. Eran quince controles
              uno atrás del otro: alguien que publica su primera camiseta veía
              una pared y no podía estimar cuánto faltaba. Agrupar no saca ni un
              campo, pero convierte quince cosas en cuatro decisiones — y
              `<fieldset>` hace que un lector de pantalla anuncie en qué parte
              del formulario está.
            */}
            <GrupoDeCampos titulo="Qué estás publicando">
              {/*
                Camiseta va PRIMERA y preseleccionada. Las seis categorías se
                ordenan alfabéticamente en el repositorio, y eso dejaba "Buzos"
                como opción por defecto en un marketplace de camisetas: la
                mayoría de las publicaciones habrían nacido en la categoría
                equivocada por inercia.
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
            </GrupoDeCampos>

            <GrupoDeCampos titulo="Precio y stock">
              {/*
                ⚠️ ES `CampoImporte` Y NO UN `Campo tipo="number"`, QUE ES LO QUE
                HABIA. La primitiva de plata ya existe y es la unica que pone el
                importe en Big Noodle con cifras tabulares, que es lo que la
                identidad reserva para "titulares, PRECIOS y números de camiseta".
                El POST no cambia: adentro sigue siendo el mismo
                `<input type="number" name="precioPesos">`.

                ⚠️ VA SOLO EN SU FILA, no apareado con "Unidades". Es el dato que
                decide la venta y el unico del formulario que se dibuja grande:
                al lado de un control de 44px la fila quedaba despareja.

                ⚠️ `min` NO REEMPLAZA AL SCHEMA —un POST directo se lo saltea—,
                pero evita el viaje al servidor para descubrir que el precio no
                puede ser cero. Es la misma regla que valida `publicarSchema`,
                dicha en el borde donde la persona escribe.
              */}
              <CampoImporte
                nombre="precioPesos"
                etiqueta="Precio en pesos"
                min={1}
                step={1}
                ayuda="Lo que cobrás. Offside retiene su comisión de este importe."
              />

              <div className={estilos.par}>
                <Campo
                  nombre="stock"
                  etiqueta="Unidades"
                  tipo="number"
                  defaultValue="1"
                  min={1}
                  step={1}
                  inputMode="numeric"
                />
                <Campo
                  nombre="sizeValue"
                  etiqueta="Talle"
                  ayuda="Como figura en la prenda: S, M, L, XL."
                />
              </div>

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

              {/*
                ⚠️ TODOS OPCIONALES. Son los que alimentan las facetas de la
                búsqueda, pero exigirlos dejaría afuera cualquier camiseta cuyo
                club o marca no esté en el catálogo, y el flujo para proponer
                altas (DEC-041) todavía no existe. Se pide de la forma más fuerte
                que se puede sin bloquear.

                ⚠️ EL SUBTITULO ES LA PRIMITIVA COMPARTIDA, no una clase local:
                el mismo bloque existe en el formulario de editar y tiene que
                verse igual en los dos.
              */}
              <SubtituloDeGrupo>Para que te encuentren</SubtituloDeGrupo>

              <div className={estilos.par}>
                <Seleccion
                  nombre="clubId"
                  etiqueta="Club"
                  vacio="No corresponde"
                  ayuda="Si es de un club, elegílo: es el filtro que más se usa."
                  opciones={catalogos.clubes.map((c) => ({ valor: c.id, etiqueta: c.name }))}
                />
                <Seleccion
                  nombre="nationalTeamId"
                  etiqueta="Selección"
                  vacio="No corresponde"
                  opciones={catalogos.selecciones.map((c) => ({ valor: c.id, etiqueta: c.name }))}
                />
              </div>

              <div className={estilos.par}>
                <Seleccion
                  nombre="brandId"
                  etiqueta="Marca"
                  vacio="No la sé"
                  opciones={catalogos.marcas.map((c) => ({ valor: c.id, etiqueta: c.name }))}
                />
                <Seleccion
                  nombre="seasonId"
                  etiqueta="Temporada"
                  vacio="No la sé"
                  ayuda="El año o la temporada de la camiseta."
                  opciones={catalogos.temporadas.map((c) => ({ valor: c.id, etiqueta: c.name }))}
                />
              </div>

              <Seleccion
                nombre="competitionId"
                etiqueta="Competencia"
                vacio="No corresponde"
                ayuda="Si es una camiseta de una copa o torneo puntual."
                opciones={catalogos.competiciones.map((c) => ({ valor: c.id, etiqueta: c.name }))}
              />
            </GrupoDeCampos>

            <GrupoDeCampos
              titulo="Detalles de la prenda"
              detalle="El talle y el estado son obligatorios. Si es una camiseta, también el tipo y las mangas."
            >
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
            </GrupoDeCampos>

            <GrupoDeCampos
              titulo="Fotos"
              detalle="Hace falta al menos una para que la publicación salga a la venta. Sin fotos queda en borrador y la completás después."
            >
              <CampoArchivos
                nombre="fotos"
                etiqueta="Fotos"
                ayuda={`Hasta ${imagenes.maxImages} fotos, ${maxMb} MB cada una. La primera es la portada. Si es usada o retro, sumá una de la etiqueta: es la mejor señal de autenticidad.`}
              />
            </GrupoDeCampos>
          </Formulario>
        </div>

        {/*
          ⚠️ La publicación sale visible de inmediato porque la moderación previa
          todavía no está decidida. No se promete una revisión que no existe.
        */}
        <div className={`${estilos.cierre} sup-2 patron-vivo diagonales-vivas`}>
          <p className={estilos.nota}>
            Tu publicación queda visible apenas la publicás: no hay nadie revisando del otro lado.
            El stock se descuenta cuando el pago del comprador se aprueba, no antes.
          </p>
        </div>
      </main>
    </Pantalla>
  );
}
