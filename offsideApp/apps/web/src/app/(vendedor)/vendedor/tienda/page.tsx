import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AreaDeTexto, Campo, Formulario, GrupoDeCampos } from '@/components/form';
import { Pantalla } from '@/components/movimiento';
import { Aviso, Seccion } from '@/components/ui';
import { fecha } from '@/lib/formato';
import { requireSellerSessionUser } from '@/lib/session';
import { PanelDeCuenta, SolapasDeCuenta } from '../../../(cuenta)/panel';
import { getMySellerProfile } from '@/modules/sellers/services/seller.service';

import { guardarTienda } from '../../acciones';
import { Chapa } from '../../chapa';
import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Mi tienda' };
export const dynamic = 'force-dynamic';

/**
 * Datos visibles de la tienda (SS-020).
 *
 * ⚠️ ESTO NO TOCA LA HABILITACION NI EL NIVEL. `updateMySellerProfile` cambia el
 * nombre visible, la bio y la política de envíos, y nada más: el estado de la
 * cuenta y el tier no se editan desde un formulario del vendedor.
 *
 * ⚠️ LA POLITICA DE ENVIOS ES UNA PROMESA TUYA, NO DEL SISTEMA. Offside no
 * despacha ni hace seguimiento automático —no hay integración con Correo
 * Argentino—, así que lo que se escriba acá lo cumple quien vende. Decirlo evita
 * que el comprador lo lea como una garantía de la plataforma.
 *
 * ⚠️ EL NOMBRE VISIBLE ES EL QUE VE EL COMPRADOR EN TODAS SUS ORDENES, incluidas
 * las viejas: no es un apodo descartable. Se dice antes de que lo cambie.
 */
export default async function MiTienda() {
  const user = await requireSellerSessionUser('/vendedor/tienda');

  const perfil = await getMySellerProfile(user.id);
  if (perfil === null) redirect('/vendedor/empezar');

  return (
    <Pantalla>
      <PanelDeCuenta user={user} seccion="cuenta">
        <main id="contenido">
          <Chapa
            rotulo="Tu tienda"
            titulo={perfil.displayName}
            chica
            detalle={
              <p className={estilos.chapaDetalle}>
                Vendés en Offside desde {fecha(perfil.createdAt)}
              </p>
            }
          />

          <SolapasDeCuenta user={user} seccion="cuenta" activa="vender" />

          {/*
          ⚠️ NO HAY ENLACE AL PERFIL PUBLICO, Y NO ES UN OLVIDO. El perfil
          público del vendedor se direcciona por `username` (`/tienda/…`), y ni
          `PublicSellerProfile` ni `PublicUser` lo exponen hoy: armar la URL sin
          ese dato daría un enlace roto. Queda reportado como faltante en vez de
          prometer una pantalla a la que no se puede llegar.
        */}
          <Aviso tono="neutro">
            Esto es lo que ve quien entra a una de tus publicaciones. Tu nombre visible aparece
            también en las órdenes que ya hiciste.
          </Aviso>

          <Seccion titulo="Cómo te presentás">
            <div className={estilos.formPublicar}>
              <Formulario accion={guardarTienda} enviar="Guardar cambios">
                <GrupoDeCampos titulo="Tu tienda">
                  <Campo
                    nombre="displayName"
                    etiqueta="Nombre visible"
                    defaultValue={perfil.displayName}
                    maximo={80}
                    ayuda="Es el nombre con el que te ven los compradores, acá y en sus compras."
                  />

                  <AreaDeTexto
                    nombre="bio"
                    etiqueta="Sobre vos"
                    defaultValue={perfil.bio ?? ''}
                    filas={4}
                    maximo={1000}
                    ayuda="Opcional. Qué vendés, desde cuándo, cómo conseguís las camisetas."
                  />
                </GrupoDeCampos>

                <GrupoDeCampos
                  titulo="Cómo enviás"
                  detalle="Lo que escribas acá lo cumplís vos: Offside no despacha ni hace seguimiento automático."
                >
                  <AreaDeTexto
                    nombre="shippingPolicy"
                    etiqueta="Política de envíos"
                    defaultValue={perfil.shippingPolicy ?? ''}
                    filas={4}
                    maximo={1000}
                    ayuda="Opcional. En cuántos días despachás, con qué correo, si hacés retiro en persona."
                  />
                </GrupoDeCampos>
              </Formulario>
            </div>
          </Seccion>

          <div className={`${estilos.cierre} sup-2 patron-vivo diagonales-vivas`}>
            <p className={estilos.nota}>
              No prometas plazos que no vas a poder cumplir: el plazo de despacho de cada orden lo
              fija Offside y despachar tarde cuenta en tu reputación.
            </p>
          </div>
        </main>
      </PanelDeCuenta>
    </Pantalla>
  );
}
