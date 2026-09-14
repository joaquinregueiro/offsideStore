import type { Metadata } from 'next';

import { Campo, Formulario } from '@/components/form';
import { Pantalla } from '@/components/movimiento';
import { BotonEnlace, Definiciones, InsigniaDeNivel } from '@/components/ui';
import { nivelDeUsuario } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import { TOPE_NOMBRE_VISIBLE } from '@/modules/users/services/profile.service';

import { guardarNombreVisible } from '../../acciones';

import { ChapaDeCuenta } from '../../chapa';
import { PanelDeCuenta, SolapasDeCuenta } from '../../panel';
import estilos from '../../cuenta.module.css';

export const metadata: Metadata = { title: 'Mis datos' };
export const dynamic = 'force-dynamic';

/**
 * MIS DATOS — la cuenta.
 *
 * ⚠️ EL NOMBRE VISIBLE YA SE EDITA. Esta pantalla estuvo en solo lectura porque
 * no existía el Service, no porque se hubiera decidido que no se editara:
 * `users` tenía `identity.service.ts` (señales de verificación) y
 * `user-history.service.ts` (hechos), y nada que actualizara
 * `users.display_name`. Ahora ese Service existe (`profile.service.ts`) y
 * AUDITA el cambio, que es lo que faltaba: el nombre visible es lo que ve el
 * vendedor al despachar, así que cambiarlo es identidad, no preferencia.
 *
 * ⚠️ EL EMAIL SIGUE SIN EDITARSE, Y NO ES EL MISMO CASO. Es la credencial de
 * ingreso y el destino de los tokens: cambiarlo pide reverificar la dirección
 * nueva ANTES de soltar la vieja —si no, un typo deja la cuenta muerta, que es
 * exactamente el agujero que cerró el reenvío de verificación— y decidir qué
 * pasa con las sesiones abiertas. Es trabajo de `auth`, no un UPDATE.
 *
 * ⚠️ NO HAY BORRADO DE CUENTA, Y NO ES UN OLVIDO. Borrar una cuenta toca
 * obligaciones legales de conservación —órdenes, pagos, facturación— que
 * dependen de DEC-011 (modelo fiscal, 🔴 REQUIERE ASESORAMIENTO PROFESIONAL) y
 * del régimen de datos personales. No se implementa desde el código.
 *
 * ⚠️ LA CONTRASEÑA NO SE MUESTRA NI SE CAMBIA ACÁ: el cambio pasa por el flujo
 * de restablecimiento, que verifica el email por un token. Un formulario de
 * "cambiar contraseña" adentro de una sesión abierta necesita además pedir la
 * actual, y ese Service no existe.
 */
export default async function MisDatos() {
  const user = await requireVerifiedSessionUser('/cuenta/datos');

  return (
    <Pantalla>
      <PanelDeCuenta user={user} seccion="cuenta">
        <main id="contenido">
          <ChapaDeCuenta
            rotulo="Mi cuenta"
            titulo="Mis datos"
            detalle={
              <p className={`${estilos.chapaDetalle} ${estilos.chapaEmail}`}>{user.email}</p>
            }
            lateral={<InsigniaDeNivel nombre={nivelDeUsuario(user.userLevel)} />}
          />

          <SolapasDeCuenta user={user} seccion="cuenta" activa="datos" />

          <section className={`${estilos.bloque} sup-ficha entraBloque`}>
            <h2 className={estilos.bloqueTitulo}>Tu nombre visible</h2>
            {/*
            ⚠️ SE DICE PARA QUÉ SIRVE, NO SÓLO CÓMO SE LLAMA. «Nombre visible»
            no le dice a nadie dónde aparece; saber que lo lee quien te despacha
            es lo que hace que valga la pena completarlo bien.

            ⚠️ NO ES EL NOMBRE DE LA TIENDA. El del vendedor vive en
            `seller_profiles.display_name` y se edita en su propio panel: son
            dos campos distintos en dos tablas distintas, y confundirlos haría
            que alguien renombre su tienda creyendo que cambia su nombre.
          */}
            <p className={estilos.nota}>
              Es el nombre con el que te ven quienes te venden —lo leen para despachar tu compra— y
              el que figura en tus preguntas. No es el nombre de tu tienda: ese se cambia desde el
              panel de vendedor.
            </p>

            <Formulario accion={guardarNombreVisible} enviar="Guardar" bloque={false}>
              <Campo
                nombre="displayName"
                etiqueta="Nombre visible"
                requerido={false}
                maximo={TOPE_NOMBRE_VISIBLE}
                defaultValue={user.displayName ?? ''}
                autoComplete="name"
                placeholder="Cómo querés que te llamen"
                ayuda="Podés dejarlo vacío. Si lo vaciás, dejamos de mostrarlo."
              />
            </Formulario>
          </section>

          <section className={`${estilos.bloque} sup-ficha`}>
            <h2 className={estilos.bloqueTitulo}>La cuenta</h2>
            <Definiciones
              columnas={2}
              items={[
                { termino: 'Email', valor: user.email },
                {
                  /*
                  ⚠️ SIEMPRE DICE "Verificado" PORQUE ESTA PANTALLA EXIGE
                  `requireVerifiedSessionUser`: sin el email verificado no se
                  llega hasta acá (BR-001), se redirige a verificar. Se muestra
                  igual porque es el dato que la gente viene a comprobar.
                */
                  termino: 'Email verificado',
                  valor: 'Sí',
                },
                { termino: 'Nivel', valor: nivelDeUsuario(user.userLevel) },
              ]}
            />
          </section>

          <section className={`${estilos.bloque} sup-ficha`}>
            <h2 className={estilos.bloqueTitulo}>Contraseña</h2>
            <p className={estilos.nota}>
              Para cambiarla te mandamos un enlace al correo de la cuenta. Es el mismo camino que si
              te la olvidaste, y es a propósito: así el cambio siempre queda confirmado desde tu
              email.
            </p>
            <div className={estilos.acciones}>
              <BotonEnlace href="/olvide-password" variante="secundario">
                Cambiar la contraseña
              </BotonEnlace>
            </div>
          </section>

          <section className={`${estilos.bloque} sup-ficha`}>
            <h2 className={estilos.bloqueTitulo}>Lo que todavía no se puede hacer acá</h2>
            {/*
            ⚠️ ESTA SECCIÓN EXISTE PARA NO MENTIR POR OMISIÓN, y sigue haciendo
            falta AUNQUE el nombre ya se edite: una pantalla con un campo
            editable y dos que no, sin decirlo, se lee como una pantalla a la
            que le faltan botones. Decir qué falta y por qué es lo único honesto
            mientras los Services no existan.
          */}
            <p className={estilos.nota}>
              Todavía no se puede cambiar el email: es con el que entrás y al que te mandamos los
              enlaces, así que cambiarlo tiene que pasar por verificar la dirección nueva antes de
              soltar la vieja. Tampoco se puede dar de baja la cuenta: eso toca obligaciones de
              conservación de las compras y los pagos que están pendientes de definición.
            </p>
          </section>
        </main>
      </PanelDeCuenta>
    </Pantalla>
  );
}
