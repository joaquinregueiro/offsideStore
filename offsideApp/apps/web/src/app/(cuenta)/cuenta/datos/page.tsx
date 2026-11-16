import type { Metadata } from 'next';

import { Pantalla } from '@/components/movimiento';
import { BotonEnlace, Etiqueta, InsigniaDeNivel } from '@/components/ui';
import { nivelDeUsuario } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';

import { ChapaDeCuenta } from '../../chapa';
import { PanelDeCuenta, SolapasDeCuenta } from '../../panel';
import estilos from '../../cuenta.module.css';

export const metadata: Metadata = { title: 'Mis datos' };
export const dynamic = 'force-dynamic';

/**
 * MIS DATOS — la cuenta, en solo lectura.
 *
 * ⚠️ ESTÁ EN SOLO LECTURA PORQUE NO EXISTE LA ACCIÓN PARA EDITARLA, no porque se
 * haya decidido que no se edite. El módulo `users` tiene `identity.service.ts`
 * (señales de verificación) y `user-history.service.ts` (hechos); no hay ningún
 * Service que actualice `users.display_name` ni el email. Escribir esa mutación
 * desde una pantalla sería saltear el dominio y dejar sin auditar un cambio de
 * identidad —el nombre visible es lo que ve el vendedor al despachar—. Queda
 * reportado como faltante.
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
      <PanelDeCuenta>
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

          <div className={estilos.datos}>
            <section className={`${estilos.bloque} sup-ficha entraBloque`}>
              <h2 className={estilos.bloqueTitulo}>La cuenta</h2>
              <dl className={estilos.datosLista}>
                <div className={estilos.datosFila}>
                  <dt className={estilos.datosTermino}>Nombre visible</dt>
                  <dd className={estilos.datosValor}>
                    {user.displayName ?? (
                      <span className={estilos.datosVacio}>Sin nombre cargado</span>
                    )}
                  </dd>
                </div>
                <div className={estilos.datosFila}>
                  <dt className={estilos.datosTermino}>Email</dt>
                  <dd className={estilos.datosValor}>{user.email}</dd>
                </div>
                <div className={estilos.datosFila}>
                  {/*
                    ⚠️ SIEMPRE DICE "Verificado" PORQUE ESTA PANTALLA EXIGE
                    `requireVerifiedSessionUser`: sin el email verificado no se
                    llega hasta acá (BR-001), se redirige a verificar. Se muestra
                    igual porque es el dato que la gente viene a comprobar.
                  */}
                  <dt className={estilos.datosTermino}>Verificación</dt>
                  <dd className={estilos.datosValor}>
                    <Etiqueta tono="exito">Email verificado</Etiqueta>
                  </dd>
                </div>
                <div className={estilos.datosFila}>
                  <dt className={estilos.datosTermino}>Nivel</dt>
                  <dd className={estilos.datosValor}>{nivelDeUsuario(user.userLevel)}</dd>
                </div>
              </dl>
            </section>

            <div className={estilos.columna}>
              <section className={`${estilos.bloque} sup-ficha entraBloque`}>
                <h2 className={estilos.bloqueTitulo}>Contraseña</h2>
                <p className={estilos.datosTexto}>
                  Para cambiarla te mandamos un enlace al correo de la cuenta. Es el mismo camino
                  que si te la olvidaste, y es a propósito: así el cambio siempre queda confirmado
                  desde tu email.
                </p>
                <div className={`${estilos.acciones} ${estilos.datosAcciones}`}>
                  <BotonEnlace href="/olvide-password" variante="secundario">
                    Cambiar la contraseña
                  </BotonEnlace>
                </div>
              </section>

              <section className={estilos.datosPendiente}>
                <h2 className={estilos.bloqueTitulo}>Lo que todavía no se puede hacer acá</h2>
                {/*
                  ⚠️ ESTA SECCIÓN EXISTE PARA NO MENTIR POR OMISIÓN. Una pantalla
                  llamada "Mis datos" sin un solo campo editable se lee como una
                  pantalla rota; decir qué falta y por qué es lo único honesto
                  mientras los Services no existan.
                */}
                <p className={estilos.datosTexto}>
                  Todavía no se puede cambiar el nombre visible ni el email desde acá. Tampoco se
                  puede dar de baja la cuenta: eso toca obligaciones de conservación de las compras
                  y los pagos que están pendientes de definición.
                </p>
              </section>
            </div>
          </div>
        </main>
      </PanelDeCuenta>
    </Pantalla>
  );
}
