import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Campo, CampoOculto, Formulario } from '@/components/form';
import { precio } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import { findPublicListing } from '@/modules/listings/services/listing.service';

import { comprar } from '../../acciones';
import estilos from '../../resumen.module.css';

export const metadata: Metadata = { title: 'Comprar — Offside Store' };
export const dynamic = 'force-dynamic';

/**
 * Confirmacion de compra: resumen + direccion de envio.
 *
 * ⚠️ EXIGE EMAIL VERIFICADO (BR-001): comprar es "operar". Sin verificar, el
 * guard manda a `/verificar-email` en vez de dejar avanzar hasta que el Service
 * rechace la orden.
 *
 * ⚠️ NO SE PIDE LA CANTIDAD. La compra es directa y de una unidad: el carrito
 * (BS-060) no existe y DEC-026 hace que una orden sea siempre de un vendedor.
 */
export default async function Comprar({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // El guard va primero: si no hay sesion, no hace falta consultar nada.
  await requireVerifiedSessionUser(`/comprar/${id}`);

  const listing = await findPublicListing(id);
  if (listing === null) notFound();

  return (
    <main className={estilos.pagina}>
      <h1 className={estilos.titulo}>Confirmar compra</h1>

      <div className={estilos.resumen}>
        <div className={estilos.linea}>
          <span>{listing.title}</span>
          <span>{precio(listing.priceAmount, listing.currency)}</span>
        </div>
        <div className={estilos.linea}>
          <span className={estilos.concepto}>
            Talle {listing.sizeValue} · {listing.sellerDisplayName}
          </span>
        </div>
        <div className={`${estilos.linea} ${estilos.lineaTotal}`}>
          <span className={estilos.concepto}>Total</span>
          <span className={estilos.total}>{precio(listing.priceAmount, listing.currency)}</span>
        </div>
      </div>

      <h2 className={estilos.subtitulo}>¿A dónde lo enviamos?</h2>

      <Formulario accion={comprar} enviar="Confirmar y pagar">
        <CampoOculto nombre="listingId" valor={listing.id} />

        <Campo nombre="nombre" etiqueta="Nombre y apellido" autoComplete="name" />
        <Campo nombre="calle" etiqueta="Calle y número" autoComplete="street-address" />

        <div className={estilos.par}>
          <Campo nombre="ciudad" etiqueta="Localidad" autoComplete="address-level2" />
          <Campo nombre="provincia" etiqueta="Provincia" autoComplete="address-level1" />
        </div>

        <div className={estilos.par}>
          <Campo nombre="codigoPostal" etiqueta="Código postal" autoComplete="postal-code" />
          <Campo nombre="telefono" etiqueta="Teléfono" tipo="tel" autoComplete="tel" />
        </div>
      </Formulario>

      {/*
        ⚠️ La direccion NO se guarda para la proxima compra: `user_addresses`
        existe en el ERD pero esta vacia y sin modulo. Se avisa en vez de
        simular una libreta que no existe.
      */}
      <p className={estilos.nota}>
        Vas a pagar con Mercado Pago. La dirección se guarda sólo en esta orden.
      </p>
    </main>
  );
}
