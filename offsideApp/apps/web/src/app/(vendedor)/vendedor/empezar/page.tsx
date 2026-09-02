import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AreaDeTexto, Campo, Casilla, Formulario } from '@/components/form';
import { requireVerifiedSessionUser } from '@/lib/session';
import { getMySellerProfile } from '@/modules/sellers/services/seller.service';

import { habilitarVendedor } from '../../acciones';
import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Vender en Offside — Offside Store' };
export const dynamic = 'force-dynamic';

/**
 * Alta del rol vendedor (SS-001 / SS-002).
 *
 * ⚠️ NO CREA UNA CUENTA NUEVA. BS-021: el mismo usuario es comprador y
 * vendedor. Esta pantalla habilita un rol sobre la cuenta que ya existe, y por
 * eso exige sesion antes de mostrar nada.
 *
 * Es tambien el destino al que `requireSellerSessionUser` manda a quien todavia
 * no tiene perfil, asi que tiene que poder recibir a alguien que llego sin
 * buscarla.
 */
export default async function EmpezarAVender() {
  const user = await requireVerifiedSessionUser('/vendedor/empezar');

  // Quien ya tiene perfil no tiene nada que hacer aca: el alta es una sola vez.
  if ((await getMySellerProfile(user.id)) !== null) redirect('/vendedor');

  return (
    <main className={estilos.pagina}>
      <h1 className={estilos.titulo}>Vendé en Offside</h1>

      <p className={estilos.bajada}>
        Publicás tus camisetas y cobrás en tu propia cuenta de Mercado Pago. Offside retiene su
        comisión del pago; el resto va directo a vos.
      </p>

      <Formulario accion={habilitarVendedor} enviar="Crear mi tienda">
        <Campo
          nombre="displayName"
          etiqueta="Nombre de tu tienda"
          ayuda="Es el nombre que van a ver los compradores en tus publicaciones."
        />

        <AreaDeTexto
          nombre="bio"
          etiqueta="Contá quién sos"
          ayuda="Opcional. Qué vendés, desde cuándo, de dónde sos."
        />

        <AreaDeTexto
          nombre="shippingPolicy"
          etiqueta="Política de envíos"
          ayuda="Opcional. En cuánto despachás y por dónde."
        />

        {/*
          ⚠️ La casilla tiene `required`, pero eso solo frena al navegador. La
          Server Action exige `acceptedSellerTerms` de verdad contra el mismo
          schema que valida la API: un POST directo sin la casilla falla igual.
        */}
        <Casilla nombre="terminos">
          Acepto los términos de vendedor: comisión de Offside, obligación de despachar y política
          de disputas y devoluciones.
        </Casilla>
      </Formulario>

      <p className={estilos.nota}>
        Crear la tienda no te habilita todavía. Después vas a tener que cargar tu identificación
        fiscal y conectar Mercado Pago.
      </p>
    </main>
  );
}
