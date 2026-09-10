import type { Metadata } from 'next';

import { Campo, Formulario } from '@/components/form';
import { IconoSobre } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import { BotonEnlace, PasosBreves } from '@/components/ui';
import { horasDelEnlaceDeReset, horasDelEnlaceDeVerificacion } from '@/lib/politica-password';

import { reenviarVerificacion } from '../acciones';
import propios from '../auth.module.css';

export const metadata: Metadata = { title: 'Revisá tu email' };

/**
 * Confirmación después de crear cuenta o de pedir recuperar la contraseña.
 *
 * ⚠️ ACÁ VIVE EL REENVÍO, y no es un adorno. Un email se pierde por motivos
 * triviales —spam, un corte de SES, el job agotando sus reintentos— y sin una
 * forma de pedir otro la cuenta queda muerta: no puede ingresar (BR-001) y no
 * hay token nuevo.
 *
 * ⚠️ NO USA `EstadoVacio` NI `Panel`. Es una CONFIRMACIÓN —"salió bien, andá a
 * tu casilla"—, no un hueco ni una caja de un solo tono: cabecera de marca y
 * cuerpo claro, dos planos de verdad.
 */
export default async function RevisaTuEmail({
  searchParams,
}: {
  searchParams: Promise<{ motivo?: string }>;
}) {
  const { motivo } = await searchParams;
  const esReset = motivo === 'reset';

  /*
   * ⚠️ LA DURACIÓN SALE DEL ENTORNO. El email dice cuánto vale el enlace y esta
   * pantalla no lo decía: quien vuelve al día siguiente no tenía forma de saber
   * si el enlace de ayer todavía sirve.
   */
  const horas = esReset ? horasDelEnlaceDeReset() : horasDelEnlaceDeVerificacion();
  const duracion = horas === 1 ? '1 hora' : `${horas} horas`;

  return (
    <Pantalla>
      <div className={`${propios.tarjeta} entra-acerca`}>
        <div className={`${propios.tarjetaCabecera} sup-cancha con-grano`}>
          <span className={`${propios.sello} ${propios.selloClaro}`} aria-hidden="true">
            <IconoSobre tamanio={34} />
          </span>
          <h1 className={`${propios.tarjetaTitulo} display display-3`}>Revisá tu email</h1>
        </div>

        <div className={propios.tarjetaCuerpo}>
          {!esReset && (
            <PasosBreves pasos={['Crear cuenta', 'Verificar el email', 'Listo']} actual={2} />
          )}

          <p>
            {esReset
              ? 'Si esa dirección está registrada, te mandamos un enlace para elegir una nueva contraseña.'
              : 'Te mandamos un enlace para confirmar tu dirección. Hace falta para poder comprar o vender.'}
          </p>
          <p className={propios.duracion}>El enlace vale por {duracion}.</p>

          {esReset ? (
            <BotonEnlace href="/" variante="secundario">
              Ir al catálogo
            </BotonEnlace>
          ) : (
            /*
              ⚠️ EL REENVÍO VA PLEGADO. Es la salida de un caso minoritario —el
              mail no llegó— y desplegado compite con la instrucción principal,
              que es ir a mirar la casilla. `<details>` no necesita JavaScript.

              ⚠️ LA CLASE GLOBAL `desplegable` ANIMA LA ALTURA, que es lo único
              que se nota al abrir esto. Son tres piezas —`interpolate-size`,
              `::details-content` y `transition-behavior: allow-discrete`— y las
              tres degradan solas: sin soporte abre instantáneo, o sea
              exactamente como abría antes. Reemplaza al `aparecerPanel` local,
              que movía 4px de opacidad mientras la altura saltaba de golpe.
            */
            <details className={`${propios.desplegable} desplegable`}>
              <summary className={propios.desplegableTitulo}>No me llegó</summary>
              <div className={propios.desplegablePanel}>
                <p className={propios.desplegableTexto}>
                  Puede tardar unos minutos. Fijate en el correo no deseado; si igual no aparece,
                  pedí que te lo mandemos otra vez.
                </p>
                <Formulario accion={reenviarVerificacion} enviar="Reenviar el email">
                  <Campo nombre="email" etiqueta="Tu email" tipo="email" autoComplete="email" />
                </Formulario>
              </div>
            </details>
          )}
        </div>
      </div>
    </Pantalla>
  );
}
