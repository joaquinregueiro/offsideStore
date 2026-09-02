import type { Metadata } from 'next';

import { Formulario } from '@/components/form';
import { Aviso, BotonEnlace, Etiqueta } from '@/components/ui';
import { fecha } from '@/lib/formato';
import { requireSellerSessionUser } from '@/lib/session';
import { getConnectionStatus } from '@/modules/sellers/services/mercadopago-connection.service';

import { conectarMercadoPago, desconectarMercadoPago } from '../../acciones';
import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Mercado Pago — Offside Store' };
export const dynamic = 'force-dynamic';

/**
 * Conexión del vendedor con Mercado Pago (SS-010).
 *
 * ⚠️ ESTA PANTALLA ES EL RETORNO DEL OAUTH. Es la ruta que
 * `lib/frontend-routes.ts` declara como `SELLER_MERCADOPAGO_PATH`: el callback
 * de Mercado Pago redirige acá con `?status=connected|cancelled|error`. Hasta
 * ahora esa ruta no existía y el vendedor terminaba en un 404 después de
 * autorizar correctamente.
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
  );
}
