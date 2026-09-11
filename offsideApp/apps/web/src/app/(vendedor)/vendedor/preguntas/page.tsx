import type { Metadata } from 'next';
import Link from 'next/link';

import { AreaDeTexto, CampoOculto, Formulario } from '@/components/form';
import { IconoPregunta } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import { Confirmar, EstadoVacio, Seccion } from '@/components/ui';
import { cantidad, fechaRelativa } from '@/lib/formato';
import { requireSellerSessionUser } from '@/lib/session';
import { PanelDeCuenta, SolapasDeCuenta } from '../../../(cuenta)/panel';
import { getQuestionSettings } from '@/modules/config/services/setting-store.service';
import { listPendingForSeller } from '@/modules/questions/services/question.service';

import { ocultarPregunta, responderPregunta } from '../../acciones';
import { Chapa } from '../../chapa';
import estilos from '../../vendedor.module.css';

export const metadata: Metadata = { title: 'Preguntas' };
export const dynamic = 'force-dynamic';

/**
 * Bandeja de preguntas sin responder (PS-031).
 *
 * ⚠️ LA RESPUESTA ES PUBLICA Y LA PANTALLA LO DICE ANTES DE ESCRIBIRLA. Queda en
 * la ficha de la publicación para cualquiera, no es un mensaje privado: alguien
 * que responde "te lo dejo en 80 mil, pasame tu teléfono" creyendo que hablaba
 * en privado ya no lo puede borrar.
 *
 * ⚠️ SOLO LAS PENDIENTES. Las respondidas viven en la publicación, que es donde
 * se leen; repetirlas acá convertiría una bandeja de trabajo en un archivo.
 *
 * ⚠️ EL LARGO MAXIMO SALE DEL CONFIG STORE (`questions_max_length`), no de un
 * número escrito acá: el contador del campo y el límite del Service tienen que
 * ser el mismo, o la persona escribe de más y se entera al enviar.
 */
export default async function PreguntasDelVendedor() {
  const user = await requireSellerSessionUser('/vendedor/preguntas');

  const [pendientes, ajustes] = await Promise.all([
    listPendingForSeller(user),
    getQuestionSettings(),
  ]);

  const ahora = new Date();

  return (
    <Pantalla>
      <PanelDeCuenta user={user} seccion="preguntas">
        <main id="contenido">
          <Chapa
            rotulo="Preguntas"
            titulo="Preguntas"
            chica
            detalle={
              <p className={estilos.chapaDetalle}>
                Lo que te preguntan sobre tus publicaciones, sin responder.
              </p>
            }
            {...(pendientes.length > 0
              ? {
                  estado: {
                    texto: cantidad(pendientes.length, 'pendiente', 'pendientes'),
                    tono: 'alerta' as const,
                  },
                }
              : {})}
          />

          <SolapasDeCuenta user={user} seccion="preguntas" activa="recibidas" />

          {pendientes.length === 0 ? (
            <EstadoVacio
              titulo="No tenés preguntas sin responder"
              icono={<IconoPregunta tamanio={40} />}
            >
              <p>
                Cuando alguien pregunte algo sobre una de tus publicaciones, va a aparecer acá.
                Responder rápido es una de las cosas que se miden en tu reputación.
              </p>
            </EstadoVacio>
          ) : (
            <Seccion titulo="Sin responder" dato={cantidad(pendientes.length, 'pregunta')}>
              <ul className={estilos.listaPreguntas}>
                {pendientes.map((pregunta) => (
                  <li key={pregunta.id} className={estilos.pregunta}>
                    <p className={estilos.celdaMeta}>
                      Sobre{' '}
                      <Link href={`/p/${pregunta.listingId}`} className="subraya">
                        {pregunta.listingTitle}
                      </Link>{' '}
                      · {fechaRelativa(pregunta.createdAt, ahora)}
                    </p>

                    <p className={estilos.preguntaTexto}>{pregunta.question}</p>

                    <Formulario
                      accion={responderPregunta}
                      enviar="Responder"
                      variante="secundario"
                      tamanio="chico"
                      bloque={false}
                    >
                      <CampoOculto nombre="questionId" valor={pregunta.id} />
                      <AreaDeTexto
                        nombre="texto"
                        etiqueta="Tu respuesta"
                        identificador={`texto-${pregunta.id}`}
                        requerido
                        filas={3}
                        maximo={ajustes.maxLength}
                        ayuda="Se publica en la publicación y la ve cualquiera. No pongas datos de contacto."
                      />
                    </Formulario>

                    {/*
                    ⚠️ OCULTAR VA EN SEGUNDO PLANO Y EN DOS PASOS. No es la acción
                    que se vino a hacer: es para insultos y spam. Con un solo clic
                    al lado de "Responder", una pregunta legítima desaparece sin
                    que nadie se entere.
                  */}
                    <div className={estilos.preguntaSecundaria}>
                      <Confirmar
                        etiqueta="Ocultar"
                        pregunta="La sacás de la publicación sin responderla. Quien preguntó no recibe respuesta."
                      >
                        <Formulario
                          accion={ocultarPregunta}
                          enviar="Sí, ocultar"
                          variante="peligro"
                          tamanio="chico"
                          bloque={false}
                        >
                          <CampoOculto nombre="questionId" valor={pregunta.id} />
                        </Formulario>
                      </Confirmar>
                    </div>
                  </li>
                ))}
              </ul>
            </Seccion>
          )}

          <div className={`${estilos.cierre} sup-2 patron-vivo diagonales-vivas`}>
            <p className={estilos.nota}>
              Las respuestas son públicas y no se pueden editar después. Offside no tiene chat
              privado entre comprador y vendedor: todo lo que se acuerde fuera de la plataforma
              queda fuera de la plataforma.
            </p>
          </div>
        </main>
      </PanelDeCuenta>
    </Pantalla>
  );
}
