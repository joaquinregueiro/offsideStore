import type { Metadata } from 'next';

import { Formulario } from '@/components/form';
<<<<<<< HEAD
import { IconoAutenticado } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import { Aviso, Confirmar, FilaDeDatos, Seccion } from '@/components/ui';
=======
import { Aviso, BotonEnlace, Etiqueta } from '@/components/ui';
>>>>>>> origin/main
import { fecha } from '@/lib/formato';
import { requireSellerSessionUser } from '@/lib/session';
import { getConnectionStatus } from '@/modules/sellers/services/mercadopago-connection.service';

import { conectarMercadoPago, desconectarMercadoPago } from '../../acciones';
<<<<<<< HEAD
import { Chapa, type TonoChapa } from '../../chapa';
import { NavDelVendedor } from '../../nav';
import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Mercado Pago' };
=======
import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Mercado Pago — Offside Store' };
>>>>>>> origin/main
export const dynamic = 'force-dynamic';

/**
 * Conexión del vendedor con Mercado Pago (SS-010).
 *
 * ⚠️ ESTA PANTALLA ES EL RETORNO DEL OAUTH. Es la ruta que
 * `lib/frontend-routes.ts` declara como `SELLER_MERCADOPAGO_PATH`: el callback
<<<<<<< HEAD
 * de Mercado Pago redirige acá con `?status=connected|cancelled|error`.
=======
 * de Mercado Pago redirige acá con `?status=connected|cancelled|error`. Hasta
 * ahora esa ruta no existía y el vendedor terminaba en un 404 después de
 * autorizar correctamente.
>>>>>>> origin/main
 *
 * ⚠️ `reason` ES SIEMPRE GENERICO Y ASI SE MUESTRA. El detalle técnico queda en
 * `audit_log`: decir por qué falló exactamente permitiría descubrir, por
 * ejemplo, qué cuentas de Mercado Pago ya están registradas en Offside.
 */

/** Mensajes del retorno. Se mapean por clave para no imprimir el crudo. */
const MOTIVOS: Record<string, string> = {
  exchange_failed: 'Mercado Pago no aceptó la autorización. Probá de nuevo.',
  invalid_state: 'El pedido de conexión venció o ya se usó. Empezá de nuevo.',
  account_conflict: 'Esa cuenta de Mercado Pago ya está vinculada a otro vendedor de Offside.',
};

<<<<<<< HEAD
/**
 * Los cuatro estados de una conexión, en palabras Y EN SUPERFICIE.
 *
 * ⚠️ ANTES ERAN DOS. La pantalla hacía `status === 'connected'` y todo lo demás
 * caía en "Sin conectar": una conexión **vencida** —que el barrido diario marca
 * `expired` cuando Mercado Pago rechaza la renovación— y una **revocada** desde
 * la cuenta de MP se veían igual que no haber conectado nunca. Y son tres
 * situaciones distintas con tres cosas distintas para hacer, justo en la
 * pantalla que existe para gestionarlas.
 *
 * ⚠️ LA CLASE DE SUPERFICIE VIVE ACA, AL LADO DEL TEXTO QUE DESCRIBE EL ESTADO.
 * Así no se puede agregar un estado nuevo y olvidarse de decidir cómo se ve. El
 * resto de las superficies —riel de alerta, rayas de tercero, pozo punteado— las
 * elige el CSS por `data-estado`, que es donde corresponde: la pantalla no
 * conoce la paleta.
 */
const ESTADOS: Record<string, { etiqueta: string; tono: TonoChapa; que: string; clase: string }> = {
  connected: {
    etiqueta: 'Conectada',
    tono: 'marca',
    que: 'Cobrás en tu propia cuenta. Offside retiene su comisión del mismo pago.',
    // Las dos globales traen el fondo de marca, el grano y el filo de luz.
    clase: 'sup-cancha con-grano',
  },
  expired: {
    etiqueta: 'Vencida',
    tono: 'alerta',
    que: 'Mercado Pago no aceptó renovar el permiso. Tus publicaciones no se muestran hasta que vuelvas a conectar. No perdiste nada: se reconecta en un paso.',
    clase: '',
  },
  revoked: {
    etiqueta: 'Revocada',
    tono: 'alerta',
    que: 'El permiso se revocó desde tu cuenta de Mercado Pago. Volvé a conectar para poder cobrar.',
    clase: '',
  },
  disconnected: {
    etiqueta: 'Desvinculada',
    tono: 'alerta',
    que: 'La desvinculaste vos. Podés volver a conectarla cuando quieras.',
    clase: '',
  },
};

/** Lo que se muestra cuando nunca se conectó nada. */
const SIN_CONECTAR = {
  etiqueta: 'Sin conectar',
  tono: 'alerta' as const,
  que: 'Todavía no conectaste una cuenta. Es el último paso para poder vender.',
  clase: '',
};

=======
>>>>>>> origin/main
export default async function ConexionConMercadoPago({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; reason?: string }>;
}) {
  const [{ status, reason }, user] = await Promise.all([
    searchParams,
    requireSellerSessionUser('/vendedor/mercadopago'),
  ]);

  const conexion = await getConnectionStatus(user);
  const conectada = conexion.status === 'connected';

<<<<<<< HEAD
  /*
   * ⚠️ `'none'` Y NO `null`: `data-estado` es un atributo de HTML y el CSS
   * necesita un valor para poder seleccionarlo. Es la misma clave que usa la
   * hoja para el pozo punteado de "nunca conectó".
   */
  const claveEstado = conexion.status ?? 'none';
  const estado = conexion.status === null ? SIN_CONECTAR : (ESTADOS[claveEstado] ?? SIN_CONECTAR);

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Chapa
          rotulo="Conexión"
          titulo="Mercado Pago"
          chica
          estado={{ texto: estado.etiqueta, tono: estado.tono }}
        />

        <NavDelVendedor activo="mercadopago" />

        {status === 'connected' && conectada && (
          <Aviso tono="exito">Listo. Tu cuenta de Mercado Pago quedó conectada.</Aviso>
        )}

        {status === 'cancelled' && (
          <Aviso tono="error">
            Cancelaste la autorización en Mercado Pago. No se conectó nada.
          </Aviso>
        )}

        {status === 'error' && (
          <Aviso tono="error">
            {reason !== undefined && MOTIVOS[reason] !== undefined
              ? MOTIVOS[reason]
              : 'No pudimos completar la conexión. Probá de nuevo en un momento.'}
          </Aviso>
        )}

        {status === 'disconnected' && !conectada && (
          <Aviso>Desvinculamos tu cuenta. Podés volver a conectarla cuando quieras.</Aviso>
        )}

        <p className={estilos.bajada}>
          Cobrás en tu propia cuenta: el dinero de cada venta entra directo, y Offside retiene su
          comisión del mismo pago. Nunca vemos tu contraseña de Mercado Pago.
        </p>

        <Seccion titulo="Estado de la conexión">
          {/*
            ⚠️ EL ESTADO ES UNA SUPERFICIE, NO UNA PALABRA. Los cuatro se veían
            igual: la misma caja blanca con la misma etiqueta de 12px. Y son
            cuatro situaciones con cuatro cosas distintas para hacer, justo en la
            pantalla que existe para gestionarlas. Conectada es un pliego de
            marca; vencida y revocada llevan riel de alerta —revocada además las
            rayas del eje, porque la cortó un tercero—; y sin conectar es un pozo
            punteado, que está vacío a propósito.

            ⚠️ EL ATRIBUTO Y LA CLASE NO SON REDUNDANTES: `data-estado` es lo que
            el CSS usa para elegir riel, rayas o pozo, y la clase es la única
            forma de traer una superficie GLOBAL (`sup-cancha`), que un módulo no
            puede escribir.
          */}
          <div
            className={[estilos.tarjetaConexion, estado.clase, 'entra-acerca']
              .filter(Boolean)
              .join(' ')}
            data-estado={claveEstado}
          >
            <div className={estilos.estadoConexion}>
              {/*
                ⚠️ LA PALABRA DEL ESTADO ES EL TITULAR DE LA TARJETA, en Big
                Noodle oblicua. El chip de 12px subió a la chapa: repetirlo acá
                era decir dos veces lo mismo con la misma voz.
              */}
              <p className={estilos.estadoPalabra}>{estado.etiqueta}</p>
              <p className={estilos.estadoTexto}>{estado.que}</p>
            </div>

            {conexion.connectedAt !== null && (
              <FilaDeDatos concepto="Conectada el">{fecha(conexion.connectedAt)}</FilaDeDatos>
            )}

            {/*
              ⚠️ `mpUserId` ES EL UNICO DATO QUE PERMITE SABER *CUAL* CUENTA SE
              VINCULO. Quien tiene una cuenta personal y una de su negocio no
              tenía forma de verificar cuál quedó atada a Offside, y el error
              recién aparecía cuando el dinero entraba en la cuenta equivocada.
              Va en monoespaciada para poder cotejarlo dígito a dígito.
            */}
            {conexion.mpUserId !== null && (
              <FilaDeDatos concepto="Cuenta de Mercado Pago">
                <code className={estilos.dato}>{conexion.mpUserId}</code>
              </FilaDeDatos>
            )}

            {/*
              ⚠️ SE MUESTRA CUANDO VENCE Y QUE SE RENUEVA SOLA. Sin eso, una
              fecha de vencimiento parece una cuenta regresiva hacia un problema.
              El barrido diario renueva las conexiones que vencen dentro de 30
              días; el vendedor no tiene que hacer nada.
            */}
            {conexion.expiresAt !== null && conectada && (
              <FilaDeDatos concepto="Permiso vigente hasta">
                {fecha(conexion.expiresAt)} · se renueva sola
              </FilaDeDatos>
            )}

            {/*
              ⚠️ `canSell` es un PREDICADO DERIVADO, no una columna: cruza el
              estado del vendedor con el de la conexión. Puede haber conexión sin
              poder vender —si el vendedor todavía no está aprobado— y por eso se
              muestran las dos cosas por separado en vez de una sola.
            */}
            <FilaDeDatos concepto="Podés vender">
              {conexion.canSell ? 'Sí' : 'Todavía no'}
            </FilaDeDatos>
          </div>
        </Seccion>

        {conectada ? (
          /*
            ⚠️ DESVINCULAR VA EN DOS PASOS. Apaga la venta de todas las
            publicaciones del vendedor de una sola vez; que eso pase con un clic
            en una pantalla que se visita para mirar el estado es demasiado
            fácil. No usa `window.confirm`: sin JavaScript no existe.
          */
          <Confirmar
            etiqueta="Desvincular cuenta"
            pregunta="Tus publicaciones dejan de mostrarse hasta que vuelvas a conectar. No se borra ninguna y vuelven solas al reconectar."
          >
            <Formulario
              accion={desconectarMercadoPago}
              enviar="Sí, desvincular"
              variante="peligro"
              tamanio="chico"
              bloque={false}
            />
          </Confirmar>
        ) : (
          <>
            {/*
              ⚠️ NO INVENTA NADA: describe lo que el botón de abajo hace. "Te
              llevamos a Mercado Pago" en una línea de texto chico no alcanza
              para que alguien entienda que va a salir del sitio y volver — y
              salir del sitio para autorizar un cobro es el momento donde más
              gente abandona.
            */}
            <ol className={estilos.tresPasos}>
              <li>Te llevamos a Mercado Pago para que autorices la conexión.</li>
              <li>Nunca vemos tu contraseña: la autorización la das en su sitio.</li>
              <li>Volvés acá y ya podés cobrar en tu propia cuenta.</li>
            </ol>

            <Formulario accion={conectarMercadoPago} enviar="Conectar con Mercado Pago">
              <p className={estilos.pasoDetalle}>
                <IconoAutenticado tamanio={16} /> Offside retiene su comisión del mismo pago. El
                resto entra directo a tu cuenta.
              </p>
            </Formulario>
          </>
        )}

        {/*
          ⚠️ BR-003 / SS-012 AL FINAL Y EN UN BLOQUE QUE SE LEE. Conectar Mercado
          Pago es un requisito para cobrar, no un sello de confianza, y decirlo
          en gris de 13px al pie es no decirlo.
        */}
        <div className={`${estilos.cierre} sup-2 patron-vivo diagonales-vivas`}>
          <p className={estilos.nota}>
            Conectar Mercado Pago no es un distintivo de confianza: es lo que hace posible que te
            paguen. Podés desvincular cuando quieras y tus publicaciones vuelven solas al
            reconectar.
          </p>
        </div>
      </main>
    </Pantalla>
=======
  return (
    <main className={estilos.pagina}>
      <h1 className={estilos.titulo}>Mercado Pago</h1>

      {status === 'connected' && conectada && (
        <Aviso>Listo. Tu cuenta de Mercado Pago quedó conectada.</Aviso>
      )}

      {status === 'cancelled' && (
        <Aviso error>Cancelaste la autorización en Mercado Pago. No se conectó nada.</Aviso>
      )}

      {status === 'error' && (
        <Aviso error>
          {reason !== undefined && MOTIVOS[reason] !== undefined
            ? MOTIVOS[reason]
            : 'No pudimos completar la conexión. Probá de nuevo en un momento.'}
        </Aviso>
      )}

      {status === 'disconnected' && !conectada && (
        <Aviso>Desvinculamos tu cuenta. Podés volver a conectarla cuando quieras.</Aviso>
      )}

      <p className={estilos.bajada}>
        Cobrás en tu propia cuenta: el dinero de cada venta entra directo, y Offside retiene su
        comisión del mismo pago. Nunca vemos tu contraseña de Mercado Pago.
      </p>

      <div className={estilos.tarjeta}>
        <div className={estilos.linea}>
          <span className={estilos.concepto}>Estado</span>
          <Etiqueta aviso={!conectada}>{conectada ? 'Conectada' : 'Sin conectar'}</Etiqueta>
        </div>

        {conexion.connectedAt !== null && (
          <div className={estilos.linea}>
            <span className={estilos.concepto}>Conectada el</span>
            <span>{fecha(conexion.connectedAt)}</span>
          </div>
        )}

        <div className={estilos.linea}>
          <span className={estilos.concepto}>Podés vender</span>
          <span>{conexion.canSell ? 'Sí' : 'No'}</span>
        </div>
      </div>

      {/*
        ⚠️ `canSell` es un PREDICADO DERIVADO, no una columna: cruza el estado
        del vendedor con el de la conexión. Puede haber conexión sin poder
        vender —si el vendedor todavía no está aprobado— y por eso se muestran
        las dos cosas por separado en vez de una sola.
      */}
      {conectada ? (
        <Formulario accion={desconectarMercadoPago} enviar="Desvincular cuenta">
          <p className={estilos.pasoDetalle}>
            Si desvinculás, tus publicaciones dejan de poder venderse hasta que vuelvas a conectar.
          </p>
        </Formulario>
      ) : (
        <Formulario accion={conectarMercadoPago} enviar="Conectar con Mercado Pago">
          <p className={estilos.pasoDetalle}>
            Te vamos a llevar a Mercado Pago para que autorices la conexión.
          </p>
        </Formulario>
      )}

      <div className={estilos.acciones}>
        <BotonEnlace href="/vendedor" variante="secundario">
          Volver al panel
        </BotonEnlace>
      </div>
    </main>
>>>>>>> origin/main
  );
}
