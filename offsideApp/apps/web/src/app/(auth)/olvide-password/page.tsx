import type { Metadata } from 'next';

import { Campo, Formulario } from '@/components/form';
import estilos from '@/components/form.module.css';

import { pedirResetDePassword } from '../acciones';

export const metadata: Metadata = { title: 'Recuperar contraseña — Offside Store' };

export default function OlvidePassword() {
  return (
    <main className={estilos.pagina}>
      <h1 className={estilos.titulo}>Recuperar contraseña</h1>
      <p className={estilos.bajada}>
        Te mandamos un enlace para elegir una nueva. Si el email está registrado, va a llegar en
        unos minutos.
      </p>

      <Formulario accion={pedirResetDePassword} enviar="Enviar enlace">
        <Campo nombre="email" etiqueta="Email" tipo="email" autoComplete="email" />
      </Formulario>

      <p className={estilos.pie}>
        <a href="/ingresar">Volver a ingresar</a>
      </p>
    </main>
  );
}
