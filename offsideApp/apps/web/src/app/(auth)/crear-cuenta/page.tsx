import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Campo, Casilla, Formulario } from '@/components/form';
import estilos from '@/components/form.module.css';
import { getSessionUser } from '@/lib/session';

import { crearCuenta } from '../acciones';

export const metadata: Metadata = { title: 'Crear cuenta — Offside Store' };

export default async function CrearCuenta() {
  // Con sesion abierta esta pantalla no tiene sentido.
  if ((await getSessionUser()) !== null) redirect('/');

  return (
    <main className={estilos.pagina}>
      <h1 className={estilos.titulo}>Crear cuenta</h1>
      <p className={estilos.bajada}>
        Para comprar o vender camisetas necesitás una cuenta y verificar tu email.
      </p>

      <Formulario accion={crearCuenta} enviar="Crear cuenta">
        <Campo nombre="email" etiqueta="Email" tipo="email" autoComplete="email" />
        <Campo
          nombre="password"
          etiqueta="Contraseña"
          tipo="password"
          autoComplete="new-password"
          ayuda="Al menos 12 caracteres."
        />
        <Casilla nombre="acceptedTerms">
          Acepto los términos y condiciones y la política de privacidad.
        </Casilla>
      </Formulario>

      <p className={estilos.pie}>
        ¿Ya tenés cuenta? <a href="/ingresar">Ingresá</a>
      </p>
    </main>
  );
}
