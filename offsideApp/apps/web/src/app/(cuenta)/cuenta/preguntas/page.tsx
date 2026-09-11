import type { Metadata } from 'next';
import Link from 'next/link';

import { IconoPregunta } from '@/components/iconos';
import { Pantalla } from '@/components/movimiento';
import { BotonEnlace, Etiqueta, EstadoVacio, Seccion } from '@/components/ui';
import { cantidad, fecha } from '@/lib/formato';
import { requireVerifiedSessionUser } from '@/lib/session';
import { listMyQuestions } from '@/modules/questions/services/question.service';

import { ChapaDeCuenta } from '../../chapa';
import { NavDeCuenta } from '../../nav';
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
 */
export default async function MisPreguntas() {
  const user = await requireVerifiedSessionUser('/cuenta/preguntas');
  const preguntas = await listMyQuestions(user);

  const sinResponder = preguntas.filter((pregunta) => pregunta.answer === null).length;

  return (
    <Pantalla>
      <main id="contenido" className={estilos.pagina}>
        <ChapaDeCuenta
          rotulo="Mi cuenta"
          titulo="Mis preguntas"
          detalle={
            <p className={estilos.chapaDetalle}>
              {preguntas.length === 0
                ? 'Todavía no preguntaste nada'
                : sinResponder === 0
                  ? 'Todas respondidas'
                  : `${cantidad(sinResponder, 'sin responder', 'sin responder')}`}
            </p>
          }
        />

        <NavDeCuenta activo="preguntas" />

        {preguntas.length === 0 ? (
          <EstadoVacio titulo="No hiciste ninguna pregunta" icono={<IconoPregunta tamanio={40} />}>
            <p>
              En cada publicación podés preguntarle al vendedor lo que no esté en la descripción.
              Las respuestas las vas a ver acá.
            </p>
            <BotonEnlace href="/">Ver el catálogo</BotonEnlace>
          </EstadoVacio>
        ) : (
          <Seccion titulo="Preguntas" dato={cantidad(preguntas.length, 'pregunta')}>
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
                    <p className={estilos.pendiente}>
                      El vendedor todavía no respondió.{' '}
                      {pregunta.status === 'hidden' && (
                        <Etiqueta tono="neutro">La pregunta se ocultó</Etiqueta>
                      )}
                    </p>
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
          </Seccion>
        )}
      </main>
    </Pantalla>
  );
}
