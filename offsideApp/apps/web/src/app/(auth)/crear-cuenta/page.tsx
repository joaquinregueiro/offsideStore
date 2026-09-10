import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Campo, CampoOculto, CampoPassword, Casilla, Formulario } from '@/components/form';
import estilos from '@/components/form.module.css';
import { Pantalla } from '@/components/movimiento';
import { PasosBreves } from '@/components/ui';
import { rutaInternaSegura } from '@/lib/formato';
import { largoMinimoDePassword } from '@/lib/politica-password';
import { getSessionUser } from '@/lib/session';

import { crearCuenta } from '../acciones';
import propios from '../auth.module.css';

export const metadata: Metadata = { title: 'Crear cuenta' };

/**
 * ⚠️ MISMA HOJA Y MISMO ENCABEZADO QUE `/ingresar`. Las dos pantallas se cruzan
 * constantemente: si una fuera una ficha con filete y la otra texto sobre papel,
 * el cruce se leeria como un salto a otro sitio. Con la misma superficie y
 * direcciones opuestas, el par se lee como dos caras de lo mismo.
 */
export default async function CrearCuenta({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Con sesion abierta esta pantalla no tiene sentido.
  if ((await getSessionUser()) !== null) redirect('/');

  /*
   * ⚠️ `next` SE CONSERVA AL CRUZAR DESDE `/ingresar`. Quien llega desde la
   * ficha de una camiseta y elige "creá una cuenta" perdia el destino y
   * terminaba en la home, teniendo que volver a buscar la publicacion. Se valida
   * acá y otra vez en la accion: es alcanzable por POST directo.
   */
  const { next } = await searchParams;
  const destino = rutaInternaSegura(next);

  return (
    <Pantalla>
      <div className={propios.hoja}>
        {/*
          ⚠️ FUERA DEL `escalona`. A ≤480px `ui.module.css` esconde el texto de
          cada paso y quedan tres numeros: escalonarlos hace que el primer cuadro
          de la pantalla, en el dispositivo donde llega la mayoria, sean tres
          circulos entrando de a uno.
        */}
        <PasosBreves pasos={['Crear cuenta', 'Verificar el email', 'Listo']} actual={1} />

        <div className={`${propios.encabezado} escalona`}>
          <p className={propios.antetitulo}>Tu cuenta</p>
          <h1 className={`${estilos.titulo} ${propios.titulo} display`}>Crear cuenta</h1>
          <p className={`${estilos.bajada} ${propios.bajada}`}>
            Con una sola cuenta comprás y vendés. Verificar el email es el único paso obligatorio.
          </p>
        </div>

        <div className={`${propios.cuerpo} entra-suave`}>
          <Formulario accion={crearCuenta} enviar="Crear cuenta">
            <CampoOculto nombre="next" valor={destino} />
            <Campo nombre="email" etiqueta="Email" tipo="email" autoComplete="email" />
            {/*
              ⚠️ EL MINIMO SALE DE `AUTH_PASSWORD_MIN_LENGTH`, NO DE UN NUMERO
              ESCRITO ACA. El dia que el minimo suba, la pantalla declararia
              valida una contraseña que el servidor rechaza y la persona no
              tendria forma de entender por que.
            */}
            <CampoPassword
              nombre="password"
              etiqueta="Contraseña"
              largoMinimo={largoMinimoDePassword()}
              autoComplete="new-password"
            />
            <Casilla nombre="acceptedTerms">
              Acepto los términos y condiciones y la política de privacidad.
            </Casilla>
          </Formulario>
        </div>

        <div className={`${propios.pieEnlaces} entra-suave`}>
          <p className={estilos.pie}>
            ¿Ya tenés cuenta?{' '}
            <Link
              href={destino === '/' ? '/ingresar' : `/ingresar?next=${encodeURIComponent(destino)}`}
              className="subraya"
              transitionTypes={['retrocede']}
            >
              Ingresá
            </Link>
          </p>
        </div>
      </div>
    </Pantalla>
  );
}
