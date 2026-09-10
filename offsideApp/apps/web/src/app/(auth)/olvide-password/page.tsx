import type { Metadata } from 'next';
<<<<<<< HEAD
import Link from 'next/link';

import { Campo, Formulario } from '@/components/form';
import estilos from '@/components/form.module.css';
import { Pantalla } from '@/components/movimiento';
import { horasDelEnlaceDeReset } from '@/lib/politica-password';

import { pedirResetDePassword } from '../acciones';
import propios from '../auth.module.css';

export const metadata: Metadata = { title: 'Recuperar contraseña' };

/**
 * ⚠️ `horasDelEnlaceDeReset()` SE LLAMA ADENTRO DEL COMPONENTE. Lee el entorno,
 * y subirla al scope del modulo rompe `next build`.
 */
export default function OlvidePassword() {
  const horas = horasDelEnlaceDeReset();

  return (
    <Pantalla>
      <div className={propios.hoja}>
        <div className={`${propios.encabezado} escalona`}>
          <p className={propios.antetitulo}>Recuperar acceso</p>
          <h1 className={`${estilos.titulo} ${propios.titulo} display`}>Recuperar contraseña</h1>
          {/*
            ⚠️ EL FRASEO NO CONFIRMA NI DESMIENTE QUE EL EMAIL EXISTA. "Si el
            email está registrado" es deliberado: decir "no encontramos esa
            cuenta" convertiría esta pantalla en un oráculo para averiguar qué
            direcciones están en el sistema.
          */}
          <p className={`${estilos.bajada} ${propios.bajada}`}>
            Te mandamos un enlace para elegir una nueva. Si el email está registrado, va a llegar en
            unos minutos y vale por {horas === 1 ? 'una hora' : `${horas} horas`}.
          </p>
        </div>

        <div className={`${propios.cuerpo} entra-suave`}>
          <Formulario accion={pedirResetDePassword} enviar="Enviar enlace">
            <Campo nombre="email" etiqueta="Email" tipo="email" autoComplete="email" />
          </Formulario>
        </div>

        <div className={`${propios.pieEnlaces} entra-suave`}>
          <p className={estilos.pie}>
            {/*
              ⚠️ `retrocede` PORQUE ESTA PANTALLA ES UN DESVIO: sale por donde
              entro. La convencion de la pagina de un libro esta tan asentada que
              romperla marea.
            */}
            <Link href="/ingresar" className="subraya" transitionTypes={['retrocede']}>
              Volver a ingresar
            </Link>
          </p>
        </div>
      </div>
    </Pantalla>
=======

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
>>>>>>> origin/main
  );
}
