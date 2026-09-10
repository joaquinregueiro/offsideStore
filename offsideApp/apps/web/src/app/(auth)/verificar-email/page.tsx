import type { Metadata } from 'next';

<<<<<<< HEAD
import { IconoSobre, IconoTilde } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import { BotonEnlace, FilaDeAcciones, PasosBreves } from '@/components/ui';
import { verifyEmail } from '@/modules/auth/services/auth.service';

import propios from '../auth.module.css';

export const metadata: Metadata = { title: 'Verificar email' };
=======
import estilos from '@/components/form.module.css';
import { BotonEnlace, EstadoVacio } from '@/components/ui';
import { verifyEmail } from '@/modules/auth/services/auth.service';

export const metadata: Metadata = { title: 'Verificar email — Offside Store' };
>>>>>>> origin/main

/**
 * Destino del enlace del email de verificación.
 *
 * ⚠️ ACÁ SÍ SE CONSUME EL TOKEN AL CARGAR, a diferencia del reset. Verificar no
 * pide ningún dato más a la persona, así que un formulario intermedio sólo
 * agregaría un clic sin aportar nada.
<<<<<<< HEAD
 *
 * ⚠️ ES SIEMPRE UNA CARGA DURA —se llega desde el email—, o sea que no hay
 * ninguna View Transition que anime la llegada. Por eso la tarjeta lleva su
 * propia entrada.
=======
>>>>>>> origin/main
 */
export default async function VerificarEmail({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (token === undefined || token === '') {
    return (
<<<<<<< HEAD
      <Pantalla>
        <div className={`${propios.tarjeta} entra-acerca`}>
          <div className={`${propios.tarjetaCabecera} ${propios.tarjetaCabeceraAlerta} sup-calida`}>
            <span className={`${propios.sello} ${propios.selloAlerta}`} aria-hidden="true">
              <IconoSobre tamanio={34} />
            </span>
            <h1 className={`${propios.tarjetaTitulo} display display-3`}>Revisá tu email</h1>
          </div>

          <div className={propios.tarjetaCuerpo}>
            <PasosBreves pasos={['Crear cuenta', 'Verificar el email', 'Listo']} actual={2} />
            <p>Te mandamos un enlace para confirmar tu dirección. Abrilo desde tu casilla.</p>
            <BotonEnlace href="/revisa-tu-email" variante="secundario">
              No me llegó
            </BotonEnlace>
          </div>
        </div>
      </Pantalla>
=======
      <main className={estilos.pagina}>
        <EstadoVacio titulo="Revisá tu email">
          <p style={{ marginBottom: 24 }}>
            Te mandamos un enlace para confirmar tu dirección. Abrilo desde tu casilla.
          </p>
          <BotonEnlace href="/revisa-tu-email" variante="secundario">
            No me llegó
          </BotonEnlace>
        </EstadoVacio>
      </main>
>>>>>>> origin/main
    );
  }

  try {
    await verifyEmail(token);
  } catch {
    // ⚠️ No se distingue "vencido" de "inexistente" ni se muestra el error
    // crudo: sería información sobre tokens ajenos.
    return (
<<<<<<< HEAD
      <Pantalla>
        <div className={`${propios.tarjeta} entra-acerca`}>
          <div className={`${propios.tarjetaCabecera} ${propios.tarjetaCabeceraAlerta} sup-calida`}>
            <span className={`${propios.sello} ${propios.selloAlerta}`} aria-hidden="true">
              <IconoSobre tamanio={34} />
            </span>
            <h1 className={`${propios.tarjetaTitulo} display display-3`}>Ese enlace ya no sirve</h1>
          </div>

          <div className={propios.tarjetaCuerpo}>
            <PasosBreves pasos={['Crear cuenta', 'Verificar el email', 'Listo']} actual={2} />
            {/*
              ⚠️ EL TEXTO NO CULPA A NADIE. Un enlace de verificación se quema
              solo: lo abre un escáner de correo, se usa dos veces, vence. Decir
              "puede que ya lo hayas usado" en tono neutro y ofrecer la salida es
              todo lo que hace falta.
            */}
            <p>Puede que ya lo hayas usado o que haya vencido. Pedí uno nuevo y listo.</p>
            <BotonEnlace href="/revisa-tu-email">Reenviar el email</BotonEnlace>
          </div>
        </div>
      </Pantalla>
=======
      <main className={estilos.pagina}>
        <EstadoVacio titulo="El enlace no sirve">
          {/*
            ⚠️ ESTE TEXTO DECIA "Ingresá y te mandamos otro" Y ERA FALSO: no
            existia ningun reenvio, y quien llegaba acá con un token vencido no
            tenia salida —ingresar esta bloqueado sin verificar (BR-001)—.
            Ahora manda al reenvio, que si existe.
          */}
          <p style={{ marginBottom: 24 }}>
            Puede que ya lo hayas usado o que haya vencido. Pedinos uno nuevo.
          </p>
          <BotonEnlace href="/revisa-tu-email">Reenviar el email</BotonEnlace>
        </EstadoVacio>
      </main>
>>>>>>> origin/main
    );
  }

  return (
<<<<<<< HEAD
    <Pantalla>
      {/*
        ⚠️ ES EL ÚNICO MOMENTO DEL ALTA QUE MERECE CELEBRARSE. Acá es una cabecera
        de marca con malla y grano, con el tilde como objeto y no como un glifo
        suelto.
      */}
      <div className={`${propios.tarjeta} entra-acerca`}>
        <div className={`${propios.tarjetaCabecera} sup-cancha con-grano`}>
          {/*
            ⚠️ DOS VUELTAS Y PARA (3.9s). No es `infinite` y no puede serlo: WCAG
            2.2.2 exige poder detener cualquier movimiento de más de cinco
            segundos. El anillo vive en un pseudo y anima `transform` + `opacity`
            —compositor puro—, no un `box-shadow`, que es pintura. Y no toca el
            texto: el contraste no cambia en ningún cuadro.
          */}
          <span
            className={`${propios.sello} ${propios.selloClaro} ${propios.selloPulsa}`}
            aria-hidden="true"
          >
            <IconoTilde tamanio={40} />
          </span>
          <h1 className={`${propios.tarjetaTitulo} display display-3`}>
            Listo, tu email está verificado
          </h1>
        </div>

        <div className={propios.tarjetaCuerpo}>
          <PasosBreves pasos={['Crear cuenta', 'Verificar el email', 'Listo']} actual={3} />
          <p>Ya podés comprar y vender en Offside.</p>
          {/*
            ⚠️ LAS DOS SALIDAS VAN EN EL CUERPO CLARO Y NO SOBRE EL VERDE: acá el
            botón primario es Verde Cancha sobre blanco, que es el contraste más
            alto disponible. Y son dos: quien acaba de verificar puede querer
            mirar camisetas antes de ingresar.
          */}
          <FilaDeAcciones>
            <BotonEnlace href="/ingresar">Ingresar</BotonEnlace>
            <BotonEnlace href="/" variante="secundario">
              Ver camisetas
            </BotonEnlace>
          </FilaDeAcciones>
        </div>
      </div>
    </Pantalla>
=======
    <main className={estilos.pagina}>
      <EstadoVacio titulo="¡Listo! Tu email está verificado">
        <p style={{ marginBottom: 24 }}>Ya podés comprar y vender en Offside.</p>
        <BotonEnlace href="/ingresar">Ingresar</BotonEnlace>
      </EstadoVacio>
    </main>
>>>>>>> origin/main
  );
}
