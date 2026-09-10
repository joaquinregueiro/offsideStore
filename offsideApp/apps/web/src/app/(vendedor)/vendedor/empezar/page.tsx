import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AreaDeTexto, Campo, Casilla, Formulario, GrupoDeCampos } from '@/components/form';
import { Pantalla } from '@/components/movimiento';
import { Seccion } from '@/components/ui';
import { requireVerifiedSessionUser } from '@/lib/session';
import { getMySellerProfile } from '@/modules/sellers/services/seller.service';

import { habilitarVendedor } from '../../acciones';
import { Chapa } from '../../chapa';
import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Vender en Offside' };
export const dynamic = 'force-dynamic';

/**
 * Alta del rol vendedor (SS-001 / SS-002).
 *
 * ⚠️ NO CREA UNA CUENTA NUEVA. BS-021: el mismo usuario es comprador y
 * vendedor. Esta pantalla habilita un rol sobre la cuenta que ya existe, y por
 * eso exige sesión antes de mostrar nada.
 *
 * Es también el destino al que `requireSellerSessionUser` manda a quien todavía
 * no tiene perfil, así que tiene que poder recibir a alguien que llegó sin
 * buscarla.
 *
 * ⚠️ NO LLEVA LA NAVEGACION DEL PANEL, y es a propósito: sus cinco destinos
 * exigen un perfil de vendedor que acá todavía no existe, así que serían cinco
 * enlaces que rebotan a esta misma pantalla.
 */
export default async function EmpezarAVender() {
  const user = await requireVerifiedSessionUser('/vendedor/empezar');

  // Quien ya tiene perfil no tiene nada que hacer acá: el alta es una sola vez.
  if ((await getMySellerProfile(user.id)) !== null) redirect('/vendedor');

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <Chapa
          rotulo="Alta de vendedor"
          titulo="Vendé en Offside"
          detalle={
            <p className={estilos.chapaDetalle}>
              Publicás tus camisetas y cobrás en tu propia cuenta de Mercado Pago. Offside retiene
              su comisión del pago; el resto va directo a vos.
            </p>
          }
        />

        {/*
          ⚠️ LOS TRES PASOS SON LOS DE TS-001 (DEC-044), NO UN RESUMEN INVENTADO:
          email verificado, identidad fiscal declarada y Mercado Pago conectado.
          Con los tres, la habilitación es automática. Decirlo ACÁ —antes de
          pedir el formulario— evita que alguien cree su tienda creyendo que ya
          puede publicar y descubra dos pasos más recién al terminar.

          ⚠️ NO SE PROMETE UNA REVISION: no hay nadie del otro lado.
        */}
        <Seccion titulo="Cómo sigue">
          <ol className={estilos.tresPasos}>
            <li>Creás tu tienda acá: nombre, presentación y política de envíos.</li>
            <li>Cargás tu identificación fiscal: CUIT, CUIL o CDI.</li>
            <li>Conectás Mercado Pago y quedás habilitado solo, sin que nadie revise.</li>
          </ol>
        </Seccion>

        <Formulario accion={habilitarVendedor} enviar="Crear mi tienda">
          <GrupoDeCampos
            titulo="Tu tienda"
            detalle="Sólo el nombre es obligatorio. Lo demás lo podés dejar para después."
          >
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
          </GrupoDeCampos>

          {/*
            ⚠️ La casilla tiene `required`, pero eso solo frena al navegador. La
            Server Action exige `acceptedSellerTerms` de verdad contra el mismo
            schema que valida la API: un POST directo sin la casilla falla igual.

            ⚠️⚠️ EL `name` ES LA CLAVE DEL SCHEMA, Y ANTES NO LO ERA. Se llamaba
            `terminos` mientras el schema produce el issue en `acceptedSellerTerms`:
            `Casilla` busca su error por `name`, así que no encontraba ninguno y
            el alta sin tildar dejaba la casilla **sin borde, sin mensaje y sin
            `aria-invalid`** —con lector de pantalla se leía como válida—. El
            mensaje general salía igual arriba, así que nada fallaba a la vista.
            `/crear-cuenta` ya usaba la clave del schema (`acceptedTerms`); esta
            era la única que no. La acción se ajustó en el mismo movimiento.
          */}
          <Casilla nombre="acceptedSellerTerms">
            Acepto los términos de vendedor: comisión de Offside, obligación de despachar y política
            de disputas y devoluciones.
          </Casilla>
        </Formulario>

        <div className={`${estilos.cierre} sup-2 patron-vivo diagonales-vivas`}>
          <p className={estilos.nota}>
            Crear la tienda no te habilita todavía: faltan la identificación fiscal y Mercado Pago.
            No es una cuenta nueva, es un rol más sobre la que ya tenés — seguís comprando con la
            misma.
          </p>
        </div>
      </main>
    </Pantalla>
  );
}
