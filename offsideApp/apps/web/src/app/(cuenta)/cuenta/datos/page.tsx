import type { Metadata } from 'next';

import { Pantalla } from '@/components/movimiento';
import { BotonEnlace, Definiciones, InsigniaDeNivel } from '@/components/ui';
import { nivelDeUsuario } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';

import { ChapaDeCuenta } from '../../chapa';
import { NavDeCuenta } from '../../nav';
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
      <main id="contenido" className={estilos.pagina}>
        <ChapaDeCuenta
          rotulo="Mi cuenta"
          titulo="Mis datos"
          detalle={<p className={`${estilos.chapaDetalle} ${estilos.chapaEmail}`}>{user.email}</p>}
          lateral={<InsigniaDeNivel nombre={nivelDeUsuario(user.userLevel)} />}
        />

        <NavDeCuenta activo="datos" />

        <section className={`${estilos.bloque} sup-ficha entraBloque`}>
          <h2 className={estilos.bloqueTitulo}>La cuenta</h2>
          <Definiciones
            columnas={2}
            items={[
              { termino: 'Nombre visible', valor: user.displayName ?? 'Sin nombre cargado' },
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
            ⚠️ ESTA SECCIÓN EXISTE PARA NO MENTIR POR OMISIÓN. Una pantalla
            llamada "Mis datos" sin un solo campo editable se lee como una
            pantalla rota; decir qué falta y por qué es lo único honesto mientras
            los Services no existan.
          */}
          <p className={estilos.nota}>
            Todavía no se puede cambiar el nombre visible ni el email desde acá. Tampoco se puede
            dar de baja la cuenta: eso toca obligaciones de conservación de las compras y los pagos
            que están pendientes de definición.
          </p>
        </section>
      </main>
    </Pantalla>
  );
}
