import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { Aviso, BotonEnlace, Etiqueta } from '@/components/ui';
import { estadoDeVendedor } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import { getStatus } from '@/modules/sellers/services/seller-approval.service';
import { getConnectionStatus } from '@/modules/sellers/services/mercadopago-connection.service';
import { getMySellerProfile } from '@/modules/sellers/services/seller.service';

import estilos from '../vendedor.module.css';

export const metadata: Metadata = { title: 'Panel de vendedor — Offside Store' };
export const dynamic = 'force-dynamic';

/**
 * Un paso del alta.
 *
 * ⚠️ EL ESTADO SE COMUNICA CON TEXTO Y CON UN SIMBOLO, no solo con color. Quien
 * no distingue verde de gris tiene que poder saber igual que le falta.
 */
function Paso({
  hecho,
  titulo,
  detalle,
  children,
}: {
  hecho: boolean;
  titulo: string;
  detalle: string;
  children?: ReactNode;
}) {
  return (
    <li className={estilos.paso}>
      <span
        className={`${estilos.marca} ${hecho ? estilos.marcaHecha : estilos.marcaPendiente}`}
        aria-hidden="true"
      >
        {hecho ? '✓' : '○'}
      </span>
      <div className={estilos.pasoCuerpo}>
        <p className={estilos.pasoTitulo}>
          {titulo} — {hecho ? 'listo' : 'pendiente'}
        </p>
        <p className={estilos.pasoDetalle}>{detalle}</p>
        {!hecho && children}
      </div>
    </li>
  );
}

function Acceso({
  href,
  titulo,
  detalle,
}: {
  href: string;
  titulo: string;
  detalle: string;
}): ReactNode {
  return (
    <Link href={href} className={estilos.acceso}>
      <span className={estilos.accesoTitulo}>{titulo}</span>
      <span className={estilos.accesoDetalle}>{detalle}</span>
    </Link>
  );
}

/**
 * Panel del vendedor.
 *
 * Es la pantalla que responde "¿por que todavia no puedo vender?". La respuesta
 * son las tres señales de TS-001 (DEC-044): email verificado + identidad fiscal
 * declarada + Mercado Pago conectado. Con las tres, la aprobacion es automatica.
 *
 * ⚠️ SE USA `getStatus`, NO `evaluate`. `evaluate` aprueba y escribe una fila de
 * verificacion; hacer eso cada vez que alguien refresca una pantalla llenaria
 * la tabla de ruido. La aprobacion se dispara donde cambia una señal —al
 * declarar el CUIT y al conectar Mercado Pago—, que es donde importa.
 */
export default async function PanelDeVendedor() {
  const user = await requireVerifiedSessionUser('/vendedor');

  const perfil = await getMySellerProfile(user.id);
  if (perfil === null) redirect('/vendedor/empezar');

  const [estado, conexion] = await Promise.all([getStatus(user), getConnectionStatus(user)]);

  const { signals } = estado;
  const puedeVender = conexion.canSell;

  return (
    <main className={estilos.pagina}>
      <div className={estilos.encabezado}>
        <h1 className={estilos.titulo}>{perfil.displayName}</h1>
        <Etiqueta aviso={perfil.status !== 'approved'}>{estadoDeVendedor(perfil.status)}</Etiqueta>
      </div>

      {puedeVender ? (
        <Aviso>Tu cuenta está habilitada. Podés publicar y cobrar.</Aviso>
      ) : (
        <Aviso error>
          Todavía no podés vender. Completá los pasos que quedan y la habilitación es automática.
        </Aviso>
      )}

      <h2 className={estilos.subtitulo}>Habilitación</h2>

      <ul className={estilos.tarjeta}>
        <Paso
          hecho={signals.emailVerified}
          titulo="Email verificado"
          detalle="Es el requisito para operar en Offside, no sólo para vender."
        >
          <BotonEnlace href="/verificar-email" variante="secundario">
            Verificar email
          </BotonEnlace>
        </Paso>

        <Paso
          hecho={signals.fiscalIdentityDeclared}
          titulo="Identidad fiscal"
          detalle="Tu CUIT, CUIL o CDI. Se valida el formato y el dígito verificador."
        >
          <BotonEnlace href="/vendedor/fiscal" variante="secundario">
            Cargar identificación
          </BotonEnlace>
        </Paso>

        <Paso
          hecho={signals.mercadoPagoConnected}
          titulo="Mercado Pago conectado"
          detalle="Cobrás en tu propia cuenta. Offside sólo retiene su comisión del pago."
        >
          <BotonEnlace href="/vendedor/mercadopago" variante="secundario">
            Conectar Mercado Pago
          </BotonEnlace>
        </Paso>
      </ul>

      {/*
        ⚠️ Conectar Mercado Pago NO da confianza ni reputacion (BR-003 / SS-012).
        Es un requisito para poder cobrar, y decirlo evita que el vendedor lo
        lea como un sello de calidad.
      */}
      <p className={estilos.nota}>
        Estar habilitado significa que podés operar. No es un distintivo de confianza: la reputación
        se construye vendiendo.
      </p>

      <h2 className={estilos.subtitulo}>Tu tienda</h2>

      <div className={estilos.accesos}>
        <Acceso
          href="/vendedor/publicaciones"
          titulo="Publicaciones"
          detalle="Lo que tenés a la venta, con su stock."
        />
        <Acceso
          href="/vendedor/ventas"
          titulo="Ventas"
          detalle="Órdenes recibidas, comisión y neto."
        />
        <Acceso
          href="/vendedor/mercadopago"
          titulo="Mercado Pago"
          detalle={conexion.status === 'connected' ? 'Cuenta conectada.' : 'Sin conectar.'}
        />
      </div>
    </main>
  );
}
