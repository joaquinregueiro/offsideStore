import type { Metadata } from 'next';

import { Campo, CampoOculto, Formulario } from '@/components/form';
import estilos from '@/components/form.module.css';
import { EstadoVacio, BotonEnlace } from '@/components/ui';

import { restablecerPassword } from '../acciones';

export const metadata: Metadata = { title: 'Nueva contraseña — Offside Store' };

/**
 * Destino del enlace del email de recuperación.
 *
 * ⚠️ El token NO se valida acá. Validarlo al mostrar la pantalla lo consumiría
 * antes de que la persona escriba nada, y además convertiría esta página en un
 * oráculo para saber si un token es válido. Lo valida el Service al enviar.
 */
export default async function RestablecerPassword({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (token === undefined || token === '') {
    return (
      <main className={estilos.pagina}>
        <EstadoVacio titulo="Enlace incompleto">
          <p style={{ marginBottom: 24 }}>
            Este enlace no trae el código de recuperación. Pedí uno nuevo.
          </p>
          <BotonEnlace href="/olvide-password">Pedir otro enlace</BotonEnlace>
        </EstadoVacio>
      </main>
    );
  }

  return (
    <main className={estilos.pagina}>
      <h1 className={estilos.titulo}>Nueva contraseña</h1>
      <p className={estilos.bajada}>
        Al cambiarla se cierran todas tus sesiones abiertas, incluida ésta.
      </p>

      <Formulario accion={restablecerPassword} enviar="Cambiar contraseña">
        <CampoOculto nombre="token" valor={token} />
        <Campo
          nombre="password"
          etiqueta="Nueva contraseña"
          tipo="password"
          autoComplete="new-password"
          ayuda="Al menos 12 caracteres."
        />
      </Formulario>
    </main>
  );
}
