import type { Metadata } from 'next';
<<<<<<< HEAD
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Campo, CampoOculto, CampoPassword, Formulario } from '@/components/form';
import estilos from '@/components/form.module.css';
import { Pantalla } from '@/components/movimiento';
import { Aviso } from '@/components/ui';
import { rutaInternaSegura } from '@/lib/formato';
import { largoMinimoDePassword } from '@/lib/politica-password';
import { getSessionUser } from '@/lib/session';

import { ingresar } from '../acciones';
import propios from '../auth.module.css';

export const metadata: Metadata = { title: 'Ingresar' };
=======
import { redirect } from 'next/navigation';

import { Campo, CampoOculto, Formulario } from '@/components/form';
import estilos from '@/components/form.module.css';
import { Aviso } from '@/components/ui';
import { rutaInternaSegura } from '@/lib/formato';
import { getSessionUser } from '@/lib/session';

import { ingresar } from '../acciones';

export const metadata: Metadata = { title: 'Ingresar — Offside Store' };
>>>>>>> origin/main

/**
 * ⚠️ `next` viene de la URL y se valida ACA con `rutaInternaSegura` antes de
 * ponerlo en el formulario, y OTRA VEZ en la accion. Doble validacion a
<<<<<<< HEAD
 * proposito: la accion es alcanzable por POST directo sin pasar por esta pagina,
 * asi que no puede confiar en que el valor haya sido saneado.
 *
 * ⚠️ `<Pantalla>` VA EN EL `page.tsx` Y NUNCA EN EL `layout.tsx`. Un layout
 * persiste entre navegaciones dentro de su grupo, asi que ahi el enter y el exit
 * no se disparan nunca. Las seis pantallas de auth eran las unicas del sitio sin
 * transicion: ir de /ingresar a /crear-cuenta era un corte seco.
 *
 * ⚠️ LA HOJA NO LLEVA ANIMACION DE ENTRADA PROPIA, Y ES A PROPOSITO. Con
 * `<Pantalla>` activa el navegador ya desplaza el subarbol entero: sumarle un
 * `entra-acerca` a la misma caja son dos movimientos para un solo evento. Lo que
 * entra escalonado es el CONTENIDO, que esta a otra escala y no se pisa.
=======
 * proposito: la accion es alcanzable por POST directo sin pasar por esta
 * pagina, asi que no puede confiar en que el valor haya sido saneado.
>>>>>>> origin/main
 */
export default async function Ingresar({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; restablecida?: string }>;
}) {
  const { next, restablecida } = await searchParams;
  const destino = rutaInternaSegura(next);

  if ((await getSessionUser()) !== null) redirect(destino);

  return (
<<<<<<< HEAD
    <Pantalla>
      <div className={propios.hoja}>
        {/*
          ⚠️ `escalona` VA EN EL ENCABEZADO Y NO EN LA HOJA. El aviso queda
          AFUERA a proposito: `ui.tsx` lo hace entrar con `entra-seco` (140ms, sin
          desplazamiento) y `.escalona > *` tiene la misma especificidad, asi que
          adentro perderia su entrada seca y un error se leeria como una alarma.
        */}
        <div className={`${propios.encabezado} escalona`}>
          <p className={propios.antetitulo}>Tu cuenta</p>
          <h1 className={`${estilos.titulo} ${propios.titulo} display`}>Ingresar</h1>
          <p className={`${estilos.bajada} ${propios.bajada}`}>
            Entrá para comprar, publicar y seguir tus operaciones.
          </p>
        </div>

        {restablecida === '1' && (
          <div className={propios.avisoPrevio}>
            <Aviso tono="exito">Tu contraseña se cambió. Ingresá con la nueva.</Aviso>
          </div>
        )}

        <div className={`${propios.cuerpo} entra-suave`}>
          <Formulario accion={ingresar} enviar="Ingresar">
            <CampoOculto nombre="next" valor={destino} />
            <Campo nombre="email" etiqueta="Email" tipo="email" autoComplete="email" />
            <CampoPassword
              nombre="password"
              etiqueta="Contraseña"
              largoMinimo={largoMinimoDePassword()}
              autoComplete="current-password"
              ayuda="La que elegiste al crear la cuenta."
            />
          </Formulario>
        </div>

        {/*
          ⚠️ `subraya` Y NO UN `text-decoration`: el subrayado se dibuja con un
          gradiente de fondo, asi que sigue al texto linea por linea si el enlace
          parte en dos. Y responde tambien a `:focus-visible`, o quien navega con
          teclado no ve lo que ve quien navega con mouse.
          ⚠️ `transitionTypes` MARCA LA DIRECCION. Ir a crear una cuenta es
          avanzar; volver a ingresar, retroceder. Sin esto la transicion existe
          pero no significa nada.
        */}
        <div className={`${propios.pieEnlaces} entra-suave`}>
          <p className={estilos.pie}>
            <Link href="/olvide-password" className="subraya" transitionTypes={['avanza']}>
              Olvidé mi contraseña
            </Link>
          </p>
          <p className={`${estilos.pie} ${estilos.pieSeparado}`}>
            ¿No tenés cuenta?{' '}
            <Link
              href={
                destino === '/'
                  ? '/crear-cuenta'
                  : `/crear-cuenta?next=${encodeURIComponent(destino)}`
              }
              className="subraya"
              transitionTypes={['avanza']}
            >
              Creá una
            </Link>
          </p>
        </div>
      </div>
    </Pantalla>
=======
    <main className={estilos.pagina}>
      <h1 className={estilos.titulo}>Ingresar</h1>

      {restablecida === '1' && (
        <div style={{ marginBottom: 24 }}>
          <Aviso>Tu contraseña se cambió. Ingresá con la nueva.</Aviso>
        </div>
      )}

      <Formulario accion={ingresar} enviar="Ingresar">
        <CampoOculto nombre="next" valor={destino} />
        <Campo nombre="email" etiqueta="Email" tipo="email" autoComplete="email" />
        <Campo
          nombre="password"
          etiqueta="Contraseña"
          tipo="password"
          autoComplete="current-password"
        />
      </Formulario>

      <p className={estilos.pie}>
        <a href="/olvide-password">Olvidé mi contraseña</a>
      </p>
      <p className={`${estilos.pie} ${estilos.pieSeparado}`}>
        ¿No tenés cuenta? <a href="/crear-cuenta">Creá una</a>
      </p>
    </main>
>>>>>>> origin/main
  );
}
