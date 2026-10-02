import type { Metadata } from 'next';
import Link from 'next/link';

import { CampoOculto, Formulario } from '@/components/form';
import { IconoPregunta } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import {
  BotonEnlace,
  Confirmar,
  Etiqueta,
  EstadoVacio,
  Paginacion,
  Seccion,
} from '@/components/ui';
import { cantidad, fecha } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import { listMyQuestions } from '@/modules/questions/services/question.service';

import { retirarPregunta } from '../../acciones';
import { ChapaDeCuenta } from '../../chapa';
import { PanelDeCuenta, SolapasDeCuenta } from '../../panel';
import estilos from '../../cuenta.module.css';

export const metadata: Metadata = { title: 'Mis preguntas' };
export const dynamic = 'force-dynamic';

/**
 * MIS PREGUNTAS — lo que pregunté y lo que me respondieron.
 *
 * ⚠️ NO SE PREGUNTA DESDE ACÁ. Una pregunta es siempre SOBRE una publicación, y
 * elegirla desde una lista de preguntas es al revés: se pregunta en la ficha,
 * que es donde está el contexto y donde `askQuestion` puede validar el cupo de
 * preguntas abiertas.
 *
 * ⚠️ SIN RESPUESTA NO ES UN ERROR, ES UN ESTADO. Se dice en tono normal y no en
 * alerta: el vendedor puede estar durmiendo, y pintar de naranja cada pregunta
 * reciente convertiría la pantalla en una lista de quejas.
 *
 * ⚠️ EL ENLACE VA A LA PUBLICACIÓN ACTUAL Y PUEDE TERMINAR EN 404 si el vendedor
 * la eliminó. El título que se muestra es el que trae `listMyQuestions`, así que
 * la pregunta sigue diciendo sobre qué era aunque la ficha ya no exista.
 *
 * ⚠️ "RETIRAR" ES LA ÚNICA ACCIÓN DE ESTA PANTALLA, Y NO ES DECORATIVA. Es lo
 * que devuelve el cupo: con `questions_max_open_per_user` lleno de preguntas que
 * nadie contestó, esta persona no puede preguntar en NINGUNA publicación, y
 * hasta ahora el único que podía destrabarla era el vendedor que la dejó
 * esperando. Sólo aparece en las que siguen sin responder: una vez que el
 * vendedor contestó, esa respuesta ya es pública y no es de quien preguntó para
 * borrarla.
 */
export default async function MisPreguntas({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireVerifiedSessionUser('/cuenta/preguntas');

  const params = await searchParams;
  const pedida = typeof params.pagina === 'string' ? Number.parseInt(params.pagina, 10) : NaN;
  const pagina = await listMyQuestions(user, Number.isNaN(pedida) ? undefined : pedida);

  const preguntas = pagina.preguntas;
  const totalPaginas = Math.ceil(pagina.total / pagina.porPagina);

  /*
    ⚠️ "SIN RESPONDER" ES `status === 'open'`, NO `answer === null`, y la
    diferencia se ve en pantalla: una pregunta RETIRADA o que el vendedor ocultó
    también tiene `answer` en null, así que contándolas así el encabezado decía
    "1 sin responder" sobre una pregunta que esta misma persona acababa de
    retirar —o sea, reclamándole al vendedor algo que ya nadie le puede
    contestar—.

    ⚠️ ES "EN ESTA PÁGINA", NO EN TOTAL. Contar todas las abiertas de la cuenta
    exigiría otra consulta; el número que de verdad importa —el del cupo— lo
    aplica `askQuestion`, no esta pantalla.
  */
  const sinResponder = preguntas.filter((pregunta) => pregunta.status === 'open').length;

  return (
    <Pantalla>
      <PanelDeCuenta>
        <main id="contenido">
          <ChapaDeCuenta
            rotulo="Preguntas"
            titulo="Mis preguntas"
            detalle={
              <p className={estilos.chapaDetalle}>
                {pagina.total === 0
                  ? 'Todavía no preguntaste nada'
                  : sinResponder === 0
                    ? 'Todas respondidas'
                    : `${cantidad(sinResponder, 'sin responder', 'sin responder')}`}
              </p>
            }
          />

          <SolapasDeCuenta user={user} seccion="preguntas" activa="hechas" />

          {pagina.total === 0 ? (
            <EstadoVacio
              titulo="No hiciste ninguna pregunta"
              icono={<IconoPregunta tamanio={40} />}
            >
              <p>
                En cada publicación podés preguntarle al vendedor lo que no esté en la descripción.
                Las respuestas las vas a ver acá.
              </p>
              <BotonEnlace href="/">Ver el catálogo</BotonEnlace>
            </EstadoVacio>
          ) : (
            <Seccion titulo="Preguntas" dato={cantidad(pagina.total, 'pregunta')}>
              <ul className={`${estilos.lista} ${estilos.revela}`}>
                {preguntas.map((pregunta) => (
                  <li key={pregunta.id} className={`${estilos.tarjetaTexto} sup-ficha eleva`}>
                    <div className={estilos.tarjetaCabecera}>
                      <Link
                        href={`/p/${pregunta.listingId}`}
                        className={`${estilos.tarjetaEnlace} subraya`}
                        transitionTypes={['avanza']}
                      >
                        {pregunta.listingTitle}
                      </Link>
                      <span className={estilos.tarjetaFecha}>{fecha(pregunta.createdAt)}</span>
                    </div>

                    <p className={estilos.texto}>{pregunta.question}</p>

                    {pregunta.answer === null ? (
                      <div className={estilos.pendiente}>
                        {pregunta.status === 'hidden' ? (
                          /*
                            ⚠️ NO DICE QUIÉN LA OCULTÓ, porque la fila no lo
                            guarda: `hidden` lo pone quien preguntó al retirarla
                            o el vendedor al ocultarla, y no hay columna que los
                            distinga. Antes decía "El vendedor todavía no
                            respondió" también acá, que después de retirarla uno
                            mismo se lee como si la acción no hubiera andado.
                          */
                          <Etiqueta tono="neutro">Ya no se ve en la publicación</Etiqueta>
                        ) : (
                          <>
                            <p>El vendedor todavía no respondió.</p>
                            <Confirmar
                              etiqueta="Retirar"
                              pregunta="Deja de verse en la publicación y podés volver a preguntar en otra. No se puede deshacer."
                            >
                              <Formulario
                                accion={retirarPregunta}
                                enviar="Sí, retirar"
                                variante="peligro"
                                tamanio="chico"
                                bloque={false}
                              >
                                <CampoOculto nombre="questionId" valor={pregunta.id} />
                              </Formulario>
                            </Confirmar>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className={estilos.respuesta}>
                        <p className={estilos.respuestaRotulo}>
                          Respuesta del vendedor
                          {pregunta.answeredAt !== null && ` · ${fecha(pregunta.answeredAt)}`}
                        </p>
                        <p className={estilos.texto}>{pregunta.answer}</p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              <Paginacion
                actual={pagina.pagina}
                total={totalPaginas}
                hrefDe={(n) => (n > 1 ? `/cuenta/preguntas?pagina=${n}` : '/cuenta/preguntas')}
              />
            </Seccion>
          )}
        </main>
      </PanelDeCuenta>
    </Pantalla>
  );
}
