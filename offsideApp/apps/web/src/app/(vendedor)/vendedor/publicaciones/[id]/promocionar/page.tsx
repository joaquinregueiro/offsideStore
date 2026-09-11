import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { CampoOculto, Formulario } from '@/components/form';
import { Pantalla } from '@/components/movimiento';
import { Aviso, Confirmar, Definiciones, FilaDeDatos, Migas, Seccion } from '@/components/ui';
import { multiplicador, porcentajeDeComision, precio } from '@/lib/formato';
import { requireSellerSessionUser } from '@/lib/session';
import { arePromotionsEnabled } from '@/modules/listings/services/listing-settings.service';
import { listMyListings } from '@/modules/listings/services/listing.service';
import {
  activePromotionFor,
  getPromotionQuote,
} from '@/modules/listings/services/promotion.service';
import { resolveCommissionBasisPoints } from '@/modules/sellers/services/seller-tier.service';
import { getMySellerProfile } from '@/modules/sellers/services/seller.service';

import { promocionar } from '../../../../acciones';
import { Chapa } from '../../../../chapa';
import estilos from '../../../../vendedor.module.css';

export const metadata: Metadata = { title: 'Promocionar publicación' };
export const dynamic = 'force-dynamic';

/**
 * Promocionar una publicación: figurar primero a cambio de una comisión
 * agravada.
 *
 * ⚠️ LA PANTALLA EXISTE PARA DECIR EL PRECIO ANTES, NO DESPUES. Promocionar
 * multiplica la comisión de la venta y **no se puede cancelar antes de tiempo**:
 * si el vendedor se entera de cualquiera de las dos cosas después de apretar, la
 * promoción se parece a una estafa. Por eso hay una cotización con SU tasa y SU
 * precio, y una confirmación en dos pasos.
 *
 * ⚠️ NINGUNA CIFRA ESTA ESCRITA ACA. El multiplicador, la duración y las dos
 * comisiones salen de `getPromotionQuote`, que las resuelve contra el Config
 * Store y las calcula con la MISMA función que después cobra la orden: si la
 * cotización redondeara distinto, la promesa y el cobro no coincidirían.
 */
export default async function PromocionarPublicacion({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireSellerSessionUser(`/vendedor/publicaciones/${id}/promocionar`);

  // Misma autorización que el resto del inventario: se busca entre las propias.
  const propias = await listMyListings(user);
  const publicacion = propias.find((item) => item.id === id);
  if (publicacion === undefined) notFound();

  const perfil = await getMySellerProfile(user.id);
  if (perfil === null) redirect('/vendedor/empezar');

  const [habilitadas, vigente, base] = await Promise.all([
    arePromotionsEnabled(),
    activePromotionFor(id),
    resolveCommissionBasisPoints(perfil.id),
  ]);

  /*
   * ⚠️ LA TASA BASE SALE DEL NIVEL DEL VENDEDOR, no de la global escrita a mano.
   * `resolveCommissionBasisPoints` devuelve la del tier o la general según
   * corresponda, que es exactamente lo que la orden va a congelar.
   */
  const cotizacion = await getPromotionQuote(id, base.basisPoints);

  const puede = habilitadas && vigente === null && publicacion.status === 'active';

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Migas
          items={[
            { texto: 'Panel', href: '/vendedor' },
            { texto: 'Publicaciones', href: '/vendedor/publicaciones' },
            { texto: 'Promocionar' },
          ]}
        />

        <Chapa
          rotulo="Promoción"
          titulo={publicacion.title}
          chica
          detalle={
            <p className={estilos.chapaDetalle}>
              {precio(publicacion.priceAmount, publicacion.currency)} · aparece primero durante{' '}
              {cotizacion.durationDays === 1 ? '1 día' : `${cotizacion.durationDays} días`}
            </p>
          }
        />

        {!habilitadas && (
          <Aviso tono="error">
            Las promociones están apagadas en este momento. Cuando vuelvan a habilitarse vas a poder
            promocionar desde acá.
          </Aviso>
        )}

        {vigente !== null && (
          <Aviso tono="neutro">
            Esta publicación ya está promocionada. No se puede promocionar dos veces ni cortar la
            promoción antes de tiempo.
          </Aviso>
        )}

        {publicacion.status !== 'active' && (
          <Aviso tono="error">
            Sólo se puede promocionar una publicación que esté a la venta. Esta está{' '}
            {publicacion.status === 'paused'
              ? 'pausada'
              : publicacion.status === 'draft'
                ? 'en borrador'
                : 'sin stock'}
            .
          </Aviso>
        )}

        <Seccion titulo="Qué te cuesta">
          <div className={estilos.tarjeta}>
            {/*
              ⚠️ SE MUESTRAN LAS DOS COMISIONES, NO SOLO LA DIFERENCIA. "Pagás
              $X más" sin decir desde cuánto obliga a confiar en la cuenta; con
              las dos, cualquiera la verifica.
            */}
            <FilaDeDatos
              concepto={`Comisión de hoy (${porcentajeDeComision(cotizacion.baseBasisPoints)})`}
            >
              {precio(cotizacion.baseCommissionAmount, cotizacion.currency)}
            </FilaDeDatos>
            <FilaDeDatos
              concepto={`Comisión promocionada (${porcentajeDeComision(cotizacion.promotedBasisPoints)})`}
            >
              {precio(cotizacion.promotedCommissionAmount, cotizacion.currency)}
            </FilaDeDatos>
            <FilaDeDatos concepto="Diferencia si vendés a este precio" destacada>
              {precio(cotizacion.extraCommissionAmount, cotizacion.currency)}
            </FilaDeDatos>
          </div>

          <Definiciones
            columnas={3}
            items={[
              {
                termino: 'Tu comisión se multiplica',
                valor: multiplicador(cotizacion.multiplier),
              },
              {
                termino: 'Dura',
                valor: cotizacion.durationDays === 1 ? '1 día' : `${cotizacion.durationDays} días`,
              },
              {
                termino: 'Precio de la publicación',
                valor: precio(cotizacion.priceAmount, cotizacion.currency),
              },
            ]}
          />

          {/*
            ⚠️ EL EJEMPLO ES CON SU PRECIO, NO CON UNO INVENTADO. Un ejemplo
            genérico obliga a hacer la regla de tres mental justo en el momento
            de decidir si conviene.
          */}
          <p className={estilos.bajada}>
            Sobre este precio, la venta te dejaría{' '}
            <strong>
              {precio(
                (
                  BigInt(cotizacion.priceAmount) - BigInt(cotizacion.promotedCommissionAmount)
                ).toString(),
                cotizacion.currency,
              )}
            </strong>{' '}
            en lugar de{' '}
            {precio(
              (BigInt(cotizacion.priceAmount) - BigInt(cotizacion.baseCommissionAmount)).toString(),
              cotizacion.currency,
            )}
            , antes del costo de Mercado Pago.
          </p>
        </Seccion>

        <Seccion titulo="Lo que tenés que saber">
          <div className={estilos.tarjeta}>
            <ul className={estilos.listaHonesta}>
              <li>
                <strong>No se puede cancelar antes de tiempo.</strong> La promoción corre los{' '}
                {cotizacion.durationDays === 1 ? 'día' : `${cotizacion.durationDays} días`}{' '}
                completos. Si se pudiera cortar, cualquiera promocionaría para llevarse las visitas
                y apagaría la promoción justo antes de vender.
              </li>
              <li>
                <strong>La comisión agravada se aplica a lo que vendas mientras dure.</strong> Cada
                orden congela su comisión al crearse (DEC-030): las ventas anteriores no cambian.
              </li>
              <li>
                <strong>Aparecer primero no garantiza vender.</strong> Es un lugar en la vitrina y
                en la búsqueda, nada más. Offside no promete resultados.
              </li>
              <li>
                <strong>Se muestra como «Promocionada».</strong> Quien la vea sabe que pagaste por
                ese lugar: no la presentamos como una recomendación nuestra.
              </li>
            </ul>
          </div>
        </Seccion>

        {puede && (
          <Seccion titulo="Confirmar">
            {/*
              ⚠️ EN DOS PASOS Y CON `<details>`, no con `window.confirm` —que sin
              JavaScript no existe—. El primer clic abre; el que cobra vive
              adentro y repite la consecuencia que no se puede deshacer.
            */}
            <Confirmar
              etiqueta="Promocionar esta publicación"
              pregunta={`Durante ${
                cotizacion.durationDays === 1 ? '1 día' : `${cotizacion.durationDays} días`
              } tu comisión pasa de ${porcentajeDeComision(
                cotizacion.baseBasisPoints,
              )} a ${porcentajeDeComision(
                cotizacion.promotedBasisPoints,
              )} en lo que vendas de esta publicación. No se puede cancelar antes de tiempo.`}
            >
              <Formulario accion={promocionar} enviar="Sí, promocionar">
                <CampoOculto nombre="listingId" valor={publicacion.id} />
              </Formulario>
            </Confirmar>
          </Seccion>
        )}

        <div className={`${estilos.cierre} sup-2 patron-vivo diagonales-vivas`}>
          <p className={estilos.nota}>
            El multiplicador y la duración los fija Offside desde su configuración y pueden cambiar.
            Lo que se aplica a tu promoción es lo que estaba vigente cuando la activaste: queda
            congelado en la promoción.
          </p>
        </div>
      </main>
    </Pantalla>
  );
}
