import type { Metadata } from 'next';

import { CampoOculto, CampoPassword, Formulario } from '@/components/form';
import estilos from '@/components/form.module.css';
import { IconoLlave } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import { BotonEnlace } from '@/components/ui';
import { largoMinimoDePassword } from '@/lib/politica-password';

import { restablecerPassword } from '../acciones';
import propios from '../auth.module.css';

export const metadata: Metadata = { title: 'Nueva contraseña' };

/**
 * Destino del enlace del email de recuperación.
 *
 * ⚠️ El token NO se valida acá. Validarlo al mostrar la pantalla lo consumiría
 * antes de que la persona escriba nada, y además convertiría esta página en un
 * oráculo para saber si un token es válido. Lo valida el Service al enviar.
 *
 * ⚠️ ESTA PANTALLA SIEMPRE LLEGA POR UN ENLACE DE EMAIL, o sea que es SIEMPRE
 * una carga dura: no hay ninguna View Transition que anime la llegada. Por eso
 * la tarjeta y la hoja sí llevan entrada propia, al revés que `/ingresar`.
 */
export default async function RestablecerPassword({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (token === undefined || token === '') {
    return (
      <Pantalla>
        {/*
          ⚠️ NO USA `Panel` DE `ui.tsx`. No es desconfianza de ese componente: es
          que acá hacen falta DOS PLANOS —una cabecera de superficie y un cuerpo
          claro—, y `Panel` es una caja de un solo tono. Componerlo acá no edita
          un solo byte de `ui.module.css`.
        */}
        <div className={`${propios.tarjeta} entra-acerca`}>
          <div className={`${propios.tarjetaCabecera} ${propios.tarjetaCabeceraAlerta} sup-calida`}>
            <span className={`${propios.sello} ${propios.selloAlerta}`} aria-hidden="true">
              <IconoLlave tamanio={34} />
            </span>
            <h1 className={`${propios.tarjetaTitulo} display display-3`}>
              Ese enlace está incompleto
            </h1>
          </div>

          <div className={propios.tarjetaCuerpo}>
            <p>
              No trae el código de recuperación. Pedí uno nuevo y abrilo directo desde el email.
            </p>
            <BotonEnlace href="/olvide-password">Pedir otro enlace</BotonEnlace>
          </div>
        </div>
      </Pantalla>
    );
  }

  return (
    <Pantalla>
      <div className={`${propios.hoja} entra-acerca`}>
        <div className={`${propios.encabezado} escalona`}>
          <p className={propios.antetitulo}>Recuperar acceso</p>
          <h1 className={`${estilos.titulo} ${propios.titulo} display`}>
            Elegí una contraseña nueva
          </h1>
        </div>

        <div className={`${propios.cuerpo} entra-suave`}>
          <Formulario accion={restablecerPassword} enviar="Cambiar contraseña">
            <CampoOculto nombre="token" valor={token} />
            <CampoPassword
              nombre="password"
              etiqueta="Nueva contraseña"
              largoMinimo={largoMinimoDePassword()}
              autoComplete="new-password"
            />
          </Formulario>
        </div>

        {/*
          ⚠️ EL AVISO DE CONSECUENCIA VA DEBAJO DEL BOTON QUE LA PROVOCA. Como
          bajada se lee antes de escribir la contraseña y se olvida antes de
          apretar.
          ⚠️ `sup-calida` NO ES SOLO UN FONDO: sobre #f7f4cf,
          `--color-neutro-tenue` da 4.39:1 y `--color-alerta` 4.36:1 —los dos
          DEBAJO de AA—. La clase cablea `--color-neutro-texto` (5.49:1) y
          `--color-alerta-hondo` (5.05:1). Pintar el fondo a mano sin ese remapeo
          es un fallo de contraste que no avisa.
        */}
        <p className={`${propios.nota} sup-calida`}>
          <IconoLlave tamanio={16} />
          <span>Al cambiarla se cierran todas tus sesiones abiertas, incluida ésta.</span>
        </p>
      </div>
    </Pantalla>
  );
}
