import type { Metadata } from 'next';
import Link from 'next/link';

import { AreaDeTexto, CampoOculto, Formulario } from '@/components/form';
import { IconoPregunta } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import { Confirmar, EstadoVacio, Paginacion, Seccion } from '@/components/ui';
import { cantidad, fechaRelativa } from '@/lib/formato';
import { requireSellerSessionUser } from '@/lib/session';
import { PanelDeCuenta, SolapasDeCuenta } from '../../../(cuenta)/panel';
import { getQuestionSettings } from '@/modules/config/services/setting-store.service';
import {
  listAnsweredForSeller,
  listPendingForSeller,
} from '@/modules/questions/services/question.service';

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
 * ⚠️ DOS VISTAS EN UNA RUTA, Y NO SE MEZCLAN. Por defecto la COLA DE TRABAJO
 * —sólo las pendientes, la más vieja primero—; con `?estado=respondidas`, el
 * HISTORIAL —las contestadas, la más reciente primero—. Son cosas distintas:
 * mezclarlas convertiría la bandeja en un archivo y las pendientes quedarían
 * sepultadas entre las viejas.
 *
 * ⚠️ EL HISTORIAL EXISTE PORQUE ANTES NO HABÍA NINGUNO. Para ver qué había
 * contestado —y con qué palabras, que es lo que importa cuando otro comprador
 * pregunta lo mismo— había que entrar publicación por publicación.
 *
 * ⚠️ LAS DOS PAGINAN. Ninguna lista de preguntas tenía techo, y acá el volumen
 * no lo controla el vendedor: lo controla cualquiera que pregunte.
 *
 * ⚠️ EL LARGO MAXIMO SALE DEL CONFIG STORE (`questions_max_length`), no de un
 * número escrito acá: el contador del campo y el límite del Service tienen que
 * ser el mismo, o la persona escribe de más y se entera al enviar.
 */
export default async function PreguntasDelVendedor({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSellerSessionUser('/vendedor/preguntas');

  const params = await searchParams;
  const verRespondidas = params.estado === 'respondidas';
  const paginaPedida = typeof params.pagina === 'string' ? Number.parseInt(params.pagina, 10) : NaN;
  const pagina = Number.isNaN(paginaPedida) ? undefined : paginaPedida;

  const [lista, ajustes] = await Promise.all([
    verRespondidas ? listAnsweredForSeller(user, pagina) : listPendingForSeller(user, pagina),
    getQuestionSettings(),
  ]);

  const pendientes = lista.preguntas;
  const totalPaginas = Math.ceil(lista.total / lista.porPagina);
  const hrefDe = (n: number): string =>
    `/vendedor/preguntas?${new URLSearchParams({
      ...(verRespondidas ? { estado: 'respondidas' } : {}),
      ...(n > 1 ? { pagina: String(n) } : {}),
    }).toString()}`;

  const ahora = new Date();

  return (
    <Pantalla>
      <PanelDeCuenta>
        <main id="contenido">
          <Chapa
            rotulo="Preguntas"
            titulo="Preguntas"
            chica
            detalle={
              <p className={estilos.chapaDetalle}>
                {verRespondidas
                  ? 'Lo que ya contestaste, de lo más reciente a lo más viejo.'
                  : 'Lo que te preguntan sobre tus publicaciones, sin responder.'}
              </p>
            }
            {...(lista.total > 0
              ? {
                  estado: {
                    texto: verRespondidas
                      ? cantidad(lista.total, 'respondida', 'respondidas')
                      : cantidad(lista.total, 'pendiente', 'pendientes'),
                    /*
                      ⚠️ EL HISTORIAL NO VA EN 'alerta'. El naranja es para lo que
                      pide una acción: "12 respondidas" no pide nada, y pintarlo
                      igual que una cola sin atender vacía el significado del
                      color en la única pantalla donde sí importa.
                    */
                    tono: verRespondidas ? ('neutro' as const) : ('alerta' as const),
                  },
                }
              : {})}
          />

          <SolapasDeCuenta
            user={user}
            seccion="preguntas"
            activa={verRespondidas ? 'respondidas' : 'recibidas'}
          />

          {pendientes.length === 0 ? (
            <EstadoVacio
              titulo={
                verRespondidas
                  ? 'Todavía no respondiste ninguna'
                  : 'No tenés preguntas sin responder'
              }
              icono={<IconoPregunta tamanio={40} />}
            >
              <p>
                {verRespondidas
                  ? 'Acá vas a ver lo que hayas contestado, con la publicación sobre la que te preguntaron.'
                  : 'Cuando alguien pregunte algo sobre una de tus publicaciones, va a aparecer acá. Responder rápido es una de las cosas que se miden en tu reputación.'}
              </p>
            </EstadoVacio>
          ) : (
            <Seccion
              titulo={verRespondidas ? 'Respondidas' : 'Sin responder'}
              dato={cantidad(lista.total, 'pregunta')}
            >
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

                    {/*
                      ⚠️ EN EL HISTORIAL NO SE OFRECE NI RESPONDER NI OCULTAR, y
                      no es por prolijidad visual: la respuesta es UNA y no se
                      edita —el UPDATE va condicionado a `open`—, así que el
                      formulario fallaría al enviarlo. Un control que siempre
                      termina en error es peor que no tenerlo.
                    */}
                    {verRespondidas ? (
                      <div className={estilos.preguntaRespuesta}>
                        <p className={estilos.celdaMeta}>
                          Respondiste
                          {pregunta.answeredAt !== null &&
                            ` · ${fechaRelativa(pregunta.answeredAt, ahora)}`}
                        </p>
                        <p className={estilos.preguntaTexto}>{pregunta.answer}</p>
                      </div>
                    ) : (
                      <>
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
                      </>
                    )}
                  </li>
                ))}
              </ul>

              <Paginacion actual={lista.pagina} total={totalPaginas} hrefDe={hrefDe} />
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
