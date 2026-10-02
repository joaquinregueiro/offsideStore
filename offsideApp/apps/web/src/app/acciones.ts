'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { mensajeDeError, respuestaDeError } from '@/lib/errores';
import { rutaInternaSegura } from '@/lib/formato';
import type { EstadoFormulario } from '@/lib/formulario';
import { exigirLimitePorUsuario } from '@/lib/rate-limit-actions';
import { requireVerifiedSessionUser } from '@/lib/session';
import { toggleFavorite } from '@/modules/favorites/services/favorite.service';
import { askQuestion } from '@/modules/questions/services/question.service';
import { reportListing } from '@/modules/reports/services/report.service';

/**
 * Server Actions de las pantallas PUBLICAS: la vitrina, la busqueda, la ficha
 * de una publicacion y la tienda de un vendedor.
 *
 * ⚠️ VIVE EN `app/acciones.ts` Y NO EN UN `(grupo)/acciones.ts` PORQUE ESTAS
 * PANTALLAS NO ESTAN EN NINGUN GRUPO. `/`, `/buscar`, `/p/[id]`, `/tienda/…` y
 * `/como-funciona` son rutas de la raiz: no hay un `(publico)` que las envuelva
 * —cada una pone su propio `Header` y su propio `Footer`—, asi que el
 * equivalente de `app/(compra)/acciones.ts` para ellas es este archivo.
 *
 * ⚠️ CADA ACCION VUELVE A EXIGIR SESION VERIFICADA. Son alcanzables por POST
 * directo sin pasar por la pantalla: que la pagina haya decidido mostrar el
 * boton no protege a la accion. Y cada una consume SU familia de rate limit
 * —`favorite-toggle`, `question-ask`, `listing-report`—, porque las tres
 * escriben filas y un bucle desde una sola cuenta las llenaria de basura.
 *
 * ⚠️ NINGUNA DE LAS TRES DECIDE UNA REGLA DE NEGOCIO. Que una publicacion
 * admita preguntas, cuantas abiertas se toleran, que motivos de denuncia
 * existen y si se puede denunciar la propia son decisiones de los Services
 * (`questions`, `reports`): aca solo se valida la FORMA de lo que llega.
 */

/** Lee un campo de texto del formulario. `undefined` si no vino o vino un archivo. */
function texto(formData: FormData, nombre: string): string | undefined {
  const valor = formData.get(nombre);

  return typeof valor === 'string' ? valor : undefined;
}

/**
 * Marca un aviso en la URL de vuelta.
 *
 * ⚠️ VIAJA UN CODIGO FIJO, NUNCA EL MENSAJE DE ERROR. Un `?aviso=<texto>` que la
 * pantalla imprime es contenido controlado por quien arma el enlace: alcanza
 * para escribir "Tu cuenta fue bloqueada, llamá a este teléfono" sobre nuestro
 * dominio. Con un codigo cerrado, el peor caso es un aviso nuestro fuera de
 * lugar.
 */
function conAviso(ruta: string, codigo: string): string {
  /*
    ⚠️ EL FRAGMENTO SE PARTE ANTES DE AGREGAR NADA. `volverA` lleva ancla
    —`/#en-venta`, `/tienda/x#publicaciones`— para que la vuelta caiga en la
    grilla desde la que se toco la estrella y no arriba de todo. Pegar la query
    al final daria `/#en-venta?aviso=favorito`, que es UN fragmento llamado
    "en-venta?aviso=favorito": el ancla no existe y el parametro nunca llega al
    servidor.
  */
  const corte = ruta.indexOf('#');
  const camino = corte === -1 ? ruta : ruta.slice(0, corte);
  const ancla = corte === -1 ? '' : ruta.slice(corte);
  const separador = camino.includes('?') ? '&' : '?';

  return `${camino}${separador}aviso=${codigo}${ancla}`;
}

/**
 * Guarda o saca de favoritos (BS-050).
 *
 * ⚠️ ES UNA ACCION SIN ESTADO (`FormData` -> `void`) Y NO UN `EstadoFormulario`,
 * al reves que las otras dos. El corazon vive DENTRO de una grilla de hasta 60
 * fichas: `useActionState` obligaria a un componente cliente por ficha, que es
 * exactamente lo que este frontend no hace. Con un `<form>` pelado el navegador
 * hace el POST nativo, la accion redirige y la grilla vuelve pintada — sin una
 * linea de JavaScript.
 *
 * ⚠️ EL ERROR NO SE TRAGA: se registra con `mensajeDeError` —que ademas re-lanza
 * el `redirect()` del guard de sesion, que es una excepcion de control— y la
 * vuelta lleva `?aviso=favorito` para que la pantalla lo diga. Perder el plazo
 * exacto de un rate limit es el precio de no tener estado acá, y esta anotado.
 *
 * ⚠️ `volverA` SE VALIDA CON `rutaInternaSegura`. Sin eso, un formulario
 * fabricado con `volverA=https://sitio-falso` convertiria esta accion en un
 * redirector abierto.
 */
export async function alternarFavorito(formData: FormData): Promise<void> {
  const volverA = rutaInternaSegura(texto(formData, 'volverA'), '/');
  let destino = volverA;

  try {
    const user = await requireVerifiedSessionUser(volverA);
    await exigirLimitePorUsuario('favorite-toggle', user.id);

    const listingId = z.string().uuid().parse(texto(formData, 'listingId'));

    await toggleFavorite(user, listingId);
  } catch (error) {
    // No se muestra el texto: se registra acá y la pantalla dice lo suyo.
    console.error('[favoritos] no se pudo alternar:', mensajeDeError(error, 'favoritos'));
    destino = conAviso(volverA, 'favorito');
  }

  redirect(destino);
}

const preguntaSchema = z.object({
  listingId: z.string().uuid(),
  /*
    El techo REAL es `questions_max_length` del Config Store y lo aplica el
    Service. Acá sólo se corta lo absurdo —un POST con un megabyte de texto— y
    se exige que haya algo escrito, que es lo que produce un error por campo.
  */
  texto: z
    .string()
    .trim()
    .min(1, 'Escribí tu pregunta')
    .max(5_000, 'La pregunta es demasiado larga'),
});

/**
 * Pregunta sobre una publicacion (BS-040).
 *
 * ⚠️ NO SE COMPRUEBA ACÁ QUE LA PUBLICACION ADMITA PREGUNTAS, NI QUE NO SEA
 * PROPIA, NI CUANTAS ABIERTAS TIENE LA CUENTA. Todo eso lo decide `askQuestion`
 * y repetirlo sería tener la regla en dos lados: el día que cambie, uno de los
 * dos queda viejo sin que nada avise.
 */
export async function preguntar(
  _estado: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('question-ask', user.id);

    const input = preguntaSchema.parse({
      listingId: texto(formData, 'listingId'),
      texto: texto(formData, 'texto'),
    });

    await askQuestion(user, input.listingId, input.texto);
  } catch (error) {
    // ⚠️ SE CONSERVA LO ESCRITO. Una pregunta larga tipeada en un teléfono no se
    // vuelve a escribir: quien pierde el texto no pregunta de nuevo, se va.
    return respuestaDeError(error, { ambito: 'preguntas', formData, preservar: ['texto'] });
  }

  return { ok: 'Listo, tu pregunta quedó publicada. Te avisamos cuando el vendedor responda.' };
}

const denunciaSchema = z.object({
  listingId: z.string().uuid(),
  motivo: z.string().min(1, 'Elegí un motivo'),
  nota: z.string().trim().max(1_000, 'La nota no puede superar los 1000 caracteres').optional(),
});

/**
 * Denuncia una publicacion (TS-030).
 *
 * ⚠️ EL MOTIVO NO SE VALIDA CONTRA LA LISTA ACÁ. `reportListing` tiene
 * `isReportReason` y esa es la lista cerrada: duplicarla en la pantalla
 * significaría que agregar un motivo hay que hacerlo dos veces.
 *
 * ⚠️ LA RESPUESTA NO DICE SI YA ESTABA DENUNCIADA POR OTRA PERSONA. El Service
 * hace un upsert por (publicacion, denunciante): quien denuncia dos veces edita
 * la suya. Decir "ya hay tres denuncias" convertiría el formulario en un oráculo
 * de qué publicaciones están bajo revisión.
 */
export async function reportarPublicacion(
  _estado: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  try {
    const user = await requireVerifiedSessionUser();
    await exigirLimitePorUsuario('listing-report', user.id);

    const input = denunciaSchema.parse({
      listingId: texto(formData, 'listingId'),
      motivo: texto(formData, 'motivo'),
      nota: texto(formData, 'nota'),
    });

    await reportListing(user, input.listingId, input.motivo, input.nota ?? null);
  } catch (error) {
    return respuestaDeError(error, {
      ambito: 'denuncias',
      formData,
      preservar: ['motivo', 'nota'],
    });
  }

  return { ok: 'Recibimos tu reporte. Lo revisa el equipo de moderación.' };
}
