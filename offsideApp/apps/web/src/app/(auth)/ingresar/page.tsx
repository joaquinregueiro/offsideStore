import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Campo, CampoOculto, Formulario } from '@/components/form';
import estilos from '@/components/form.module.css';
import { Aviso } from '@/components/ui';
import { rutaInternaSegura } from '@/lib/formato';
import { getSessionUser } from '@/lib/session';

import { ingresar } from '../acciones';

export const metadata: Metadata = { title: 'Ingresar — Offside Store' };

/**
 * ⚠️ `next` viene de la URL y se valida ACA con `rutaInternaSegura` antes de
 * ponerlo en el formulario, y OTRA VEZ en la accion. Doble validacion a
 * proposito: la accion es alcanzable por POST directo sin pasar por esta
 * pagina, asi que no puede confiar en que el valor haya sido saneado.
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
  );
}
