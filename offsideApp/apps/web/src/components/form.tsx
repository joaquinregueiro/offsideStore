'use client';

<<<<<<< HEAD
import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import type { ChangeEvent, CSSProperties, InputHTMLAttributes, ReactNode } from 'react';

import type { EstadoFormulario } from '@/lib/formulario';

import estilos from './form.module.css';
import { Aviso, Boton, type TamanioBoton, type VarianteBoton } from './ui';

/**
 * El estado devuelto por la Server Action, disponible para todos los campos.
 *
 * ⚠️ ES UN CONTEXTO Y NO UNA PROP POR CAMPO. Pasarle `errores` y `valores` a
 * cada `<Campo>` a mano significa que basta con olvidarse de uno para que ese
 * campo pierda lo tipeado. Con el contexto, un campo puesto dentro de un
 * `<Formulario>` se comporta bien por defecto.
 */
const CtxFormulario = createContext<EstadoFormulario>({});

function useCampo(nombre: string): { error?: string | undefined; valor?: string | undefined } {
  const estado = useContext(CtxFormulario);

  return { error: estado.errores?.[nombre], valor: estado.valores?.[nombre] };
}

/**
 * ¿Ya corrio el JavaScript en el cliente?
 *
 * ⚠️ ES LA PIEZA QUE HACE HONESTA A TODA LA CAPA DE MEJORAS. Un control
 * renderizado en el servidor que necesita JavaScript queda MUERTO si el bundle
 * no carga: la persona lo aprieta y no pasa nada, que es peor que no tenerlo.
 *
 * ⚠️ EL PRIMER RENDER DEL CLIENTE DEVUELVE `false` IGUAL QUE EL DEL SERVIDOR:
 * el HTML coincide y no hay error de hidratacion.
 */
function useHidratado(): boolean {
  const [hidratado, setHidratado] = useState(false);

  useEffect(() => {
    setHidratado(true);
  }, []);

  return hidratado;
}

function clases(...valores: (string | false | undefined)[]): string {
  return valores.filter(Boolean).join(' ');
}

/**
 * ⚠️ CUANDO HAY ERROR, LA AYUDA NO SE DESCRIBE, Y ESO ARREGLA UN IDREF
 * COLGANDO. `PieDeCampo` renderiza la ayuda solo cuando no hay error; si
 * `aria-describedby` siguiera nombrandola, apuntaria a un `id` que no esta en
 * el DOM. Pasaba en `Campo` y se habria propagado a los otros tres al unificar
 * el pie.
 */
function describe(
  idAyuda: string | undefined,
  idError: string,
  error: string | undefined,
): string | undefined {
  const partes = error === undefined ? [idAyuda] : [idError];

  return partes.filter(Boolean).join(' ') || undefined;
}

/**
 * El pie de un campo: el error, o la ayuda, o el contador.
 *
 * ⚠️ ESTABA COPIADO CUATRO VECES CON DIFERENCIAS SILENCIOSAS. En `Campo` la
 * ayuda desaparecia cuando habia error; en `Seleccion` y `AreaDeTexto` NO, asi
 * que quedaban dos lineas de texto chico compitiendo justo cuando hay que leer
 * una sola. Ahora la regla es una y vale para los cuatro.
 */
function PieDeCampo({
  idError,
  idAyuda,
  error,
  ayuda,
  contador,
}: {
  idError: string;
  idAyuda: string | undefined;
  error: string | undefined;
  ayuda: string | undefined;
  contador?: ReactNode;
}) {
  return (
    <>
      {error !== undefined && (
        <span id={idError} className={estilos.error}>
          {error}
        </span>
      )}
      {ayuda !== undefined && error === undefined && idAyuda !== undefined && (
        <span id={idAyuda} className={estilos.ayuda}>
          {ayuda}
        </span>
      )}
      {contador}
    </>
  );
}

/**
 * CONTADOR DE CARACTERES.
 *
 * ⚠️ EL NUMERO VISIBLE ES `aria-hidden` Y EL ANUNCIO VA POR UMBRALES, NO POR
 * TECLA. Una region `aria-live` que cambia en cada letra hace que un lector de
 * pantalla lea "84 de 140, 85 de 140, 86 de 140…" mientras alguien escribe:
 * inusable. Aca el texto anunciado toma TRES valores posibles en todo el campo.
 *
 * ⚠️ EL MEDIDOR NO ES LA INFORMACION: la cifra dice el numero exacto y el color
 * de alerta solo la acompania.
 */
function ContadorDeCaracteres({ usados, maximo }: { usados: number; maximo: number }) {
  const restantes = maximo - usados;
  const llenado = Math.min(usados / maximo, 1);
  // 5% del maximo, con un piso de 20: para un titulo de 140 son 20 caracteres;
  // para una descripcion de 5000, 250.
  const apretado = restantes <= Math.max(20, Math.round(maximo * 0.05));

  const anuncio =
    restantes <= 0
      ? 'Llegaste al máximo de caracteres.'
      : restantes <= 10
        ? 'Te quedan menos de 10 caracteres.'
        : restantes <= 30
          ? 'Te quedan menos de 30 caracteres.'
          : '';

  return (
    <>
      <span
        className={clases(estilos.contador, apretado && estilos.contadorApretado)}
        aria-hidden="true"
      >
        <span className={estilos.medidor}>
          <span
            className={estilos.medidorLleno}
            /* Una variable CSS en `style` necesita el cast: el tipo de React no
               contempla propiedades personalizadas. */
            style={{ '--llenado': llenado.toFixed(3) } as CSSProperties}
          />
        </span>
        <span className={estilos.contadorCifra}>
          {usados}/{maximo}
        </span>
      </span>
      <span className="solo-lectores" aria-live="polite">
        {anuncio}
      </span>
    </>
  );
}

/**
 * Estado del contador que se REINICIA cuando cambia el valor que vino del
 * servidor.
 *
 * ⚠️ ES UN `useEffect` Y NO UNA `key` EN EL `<input>`, Y LA DIFERENCIA IMPORTA.
 * Una `key` sobre el input lo vuelve a montar —que es lo que hace falta para
 * que el DOM tome el valor restaurado— pero **no toca el estado del componente
 * padre**, que es donde vive el contador: sin esto, despues de un error de
 * validacion el medidor se quedaba con el largo viejo hasta la primera tecla.
 * Van los dos: la `key` para el DOM, el efecto para el contador.
 */
function useLargoDeCampo(inicial: string): [number, (largo: number) => void] {
  const [usados, setUsados] = useState(inicial.length);

  useEffect(() => {
    setUsados(inicial.length);
  }, [inicial]);

  return [usados, setUsados];
}

/**
 * LA LISTA DE ERRORES CON ANCLAS.
 *
 * ⚠️ ES LA SALIDA SIN JAVASCRIPT DE "LLEVAME AL CAMPO QUE FALLO". En
 * `/publicar` son quince campos y hay que scrollear buscando el simbolo. Con
 * JavaScript el foco se mueve solo; sin el, `href="#nombre"` apunta al `id` del
 * control, y saltar a un ancla que es un control lo ENFOCA.
 *
 * ⚠️ VA FUERA DEL `<Aviso>`: `Aviso` renderiza un `<p>` y meterle una lista
 * adentro es HTML invalido.
 *
 * ⚠️ SIN `role="alert"`: el aviso general de arriba ya interrumpe. Dos alertas
 * para el mismo hecho es ruido.
 *
 * ⚠️ DESDE DOS ERRORES. Con uno solo, el aviso general mas el campo marcado
 * alcanzan, y una lista de un item al lado de un formulario de dos campos
 * —`/ingresar`— es puro ruido.
 *
 * ⚠️ EL ANCLA ASUME `id === nombre`. Es cierto salvo cuando la pantalla pasa
 * `identificador`, que hoy solo hace la consola de reembolsos —un formulario
 * por pago, con UN campo cada uno—, o sea que nunca llega a los dos errores que
 * hacen falta para que esta lista exista.
 */
function ResumenDeErrores({ errores }: { errores: Record<string, string> }) {
  const entradas = Object.entries(errores);
  if (entradas.length < 2) return null;

  return (
    <div className={estilos.resumen}>
      <p className={estilos.resumenTitulo}>Revisá estos campos</p>
      <ul className={estilos.resumenLista}>
        {entradas.map(([nombre, mensaje]) => (
          <li key={nombre}>
            <a href={`#${nombre}`}>{mensaje}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
=======
import { useActionState } from 'react';
import type { ReactNode } from 'react';

import type { EstadoFormulario } from '@/app/(auth)/acciones';

import estilos from './form.module.css';
import { Aviso, Boton } from './ui';
>>>>>>> origin/main

/**
 * Formulario con Server Action.
 *
 * ⚠️ ES CLIENT COMPONENT, y es la excepcion necesaria: `useActionState` es un
 * hook. Pero el formulario **sigue funcionando sin JavaScript**: sin JS el
 * navegador hace el POST nativo y el servidor responde con la pagina; con JS,
<<<<<<< HEAD
 * React se queda en la pagina y muestra el error sin recargar.
=======
 * React se queda en la pagina y muestra el error sin recargar. Es progressive
 * enhancement de verdad, no una promesa.
>>>>>>> origin/main
 *
 * ⚠️ El estado `pending` deshabilita el boton: sin eso, un doble clic manda dos
 * altas o dos logins.
 */
export function Formulario({
  accion,
  enviar,
<<<<<<< HEAD
  variante = 'primario',
  tamanio = 'grande',
  bloque = true,
  pie,
  clasePie,
=======
>>>>>>> origin/main
  children,
}: {
  accion: (estado: EstadoFormulario, formData: FormData) => Promise<EstadoFormulario>;
  enviar: string;
<<<<<<< HEAD
  /**
   * ⚠️ ESTABA CLAVADO EN `primario` Y ERA UN PROBLEMA REAL. Veinte de las
   * veintidos acciones del sitio pasan por aca, incluidas **Eliminar
   * publicacion, Borrar foto y Emitir reembolso**: las tres salian con el mismo
   * verde macizo que "Publicar".
   */
  variante?: VarianteBoton;
  /**
   * ⚠️ TAMBIEN ESTABA CLAVADO, en `grande` + `bloque`. En el inventario del
   * vendedor eso convertia "Pausar" y "Borrar" en botones de ancho completo
   * dentro de una fila de lista.
   */
  tamanio?: TamanioBoton;
  bloque?: boolean;
  /**
   * Contenido que se pega AL BOTON DE ENVIAR, adentro del `<form>`.
   *
   * ⚠️ NACE DE UN HUECO REAL DE `/comprar`. Ahi el total tiene que quedar
   * pegado abajo junto al boton que lo cobra, y como este componente pintaba el
   * submit SIEMPRE al final, la barra entraba como ultimo hijo del cuerpo y el
   * boton caia afuera, separado por el `gap` del formulario. La pantalla lo
   * dejo anotado como hueco de aca.
   *
   * ⚠️ NO CAMBIA NADA PARA QUIEN NO LO PASA: sin `pie`, el boton se pinta
   * exactamente donde se pintaba, sin ningun envoltorio de mas.
   *
   * ⚠️ EL POST NATIVO SIGUE INTACTO: el pie va DENTRO del `<form>`, asi que sin
   * JavaScript el submit envia el mismo formulario de siempre.
   */
  pie?: ReactNode | undefined;
  /**
   * Clase de la pantalla para el envoltorio del pie —el `sticky`, el fondo, el
   * redondeo—. `| undefined` explicito: con `exactOptionalPropertyTypes` un
   * opcional NO acepta que le pasen `undefined` a proposito, y una pantalla
   * puede querer el pie sin decorarlo.
   */
  clasePie?: string | undefined;
  /**
   * ⚠️ OPCIONAL. Hay acciones que no piden ningun dato —desvincular Mercado
   * Pago, reenviar un email— y son un formulario igual: van por POST porque
   * MUTAN.
   */
  children?: ReactNode;
}) {
  const [estado, action, pending] = useActionState(accion, {});
  const formRef = useRef<HTMLFormElement>(null);
  const ultimoAtendido = useRef<EstadoFormulario | null>(null);

  /**
   * ⚠️ EL FOCO VA AL PRIMER CAMPO INVALIDO, Y ES LA MEJORA DE USABILIDAD MAS
   * GRANDE DE ESTA SUPERFICIE. Sin esto la persona queda parada en el boton, a
   * quince campos del error. Al enfocarlo, el lector de pantalla anuncia la
   * etiqueta Y el mensaje, porque `aria-describedby` ya apunta al error.
   *
   * ⚠️ SE COMPARA LA IDENTIDAD DEL ESTADO, NO SU CONTENIDO. `useActionState`
   * devuelve un objeto nuevo por cada respuesta, asi que dos envios con el
   * mismo error vuelven a mover el foco —que es lo correcto— y un re-render
   * cualquiera no lo mueve —que tambien lo es—.
   *
   * ⚠️ SIN JAVASCRIPT NO PASA NADA Y NO FALTA NADA: ahi el navegador rehace la
   * pagina y la salida es `ResumenDeErrores`, que son anclas de HTML.
   */
  useEffect(() => {
    if (estado.errores === undefined) return;
    if (ultimoAtendido.current === estado) return;
    ultimoAtendido.current = estado;

    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [estado]);

  /**
   * EL RIEL Y EL BOTON, QUE VIAJAN JUNTOS.
   *
   * ⚠️ SE EXTRAJO A UNA CONSTANTE PARA NO ESCRIBIR EL SUBMIT DOS VECES. Con el
   * marcado duplicado en las dos ramas del `pie`, cualquier arreglo futuro
   * —otra variante, otro `aria`— se hace en una sola y la otra queda vieja sin
   * que nada avise.
   *
   * ⚠️ EL RIEL SOLO SE MONTA MIENTRAS SE ENVIA, y eso es lo que hace que la
   * animacion arranque siempre desde cero. Sin JavaScript `pending` no llega
   * nunca a true —el navegador ya se fue de la pagina haciendo el POST— asi que
   * en el modo degradado no sobra ningun elemento.
   *
   * Es `aria-hidden` a proposito: el estado lo anuncia el `aria-busy` del boton.
   *
   * ⚠️ `cargando` Y NO `disabled`. Los dos apagan el boton, pero `cargando`
   * agrega ademas `aria-busy` y el girador: sin eso, quien no ve la pantalla
   * aprieta "Crear cuenta", no escucha nada y vuelve a apretar.
   *
   * ⚠️ LA LUZ SOLO EN EL PRIMARIO. `.luz-filo` corre una banda de luz por el
   * borde superior del boton al cargar y en cada hover —cumple AA por
   * construccion: en el filo no hay texto— y `.respira` le hace latir el halo
   * verde. Sobre un boton `peligro` —el reembolso— un halo de marca diria
   * exactamente lo contrario de lo que la accion hace.
   *
   * ⚠️ `.respira` SOLO EN LOS FORMULARIOS DE BLOQUE, y es la regla de la
   * fundacion: "un CTA que respira por pantalla". Los formularios en linea
   * —pausar, borrar foto, desvincular— pasan `bloque={false}` y hay hasta tres
   * en la misma pantalla: tres halos latiendo a la vez y ninguno seria el
   * principal. Verificado: ninguna pantalla monta dos `<Formulario>` de bloque.
   *
   * ⚠️ YA NO SE PASA `.barrido-diagonal`. `.botonPrimario` dibuja su propio
   * barrido en `::before` con el mismo sesgo; la clase global pintaba OTRO
   * `::before` sobre el mismo elemento y el que ganaba dependia del orden de
   * importacion de los CSS. `.luz-filo` usa `::after`, asi que no compite.
   */
  const acciones = (
    <>
      {pending && <div className={estilos.riel} aria-hidden="true" />}
      <Boton
        type="submit"
        variante={variante}
        tamanio={tamanio}
        bloque={bloque}
        cargando={pending}
        className={variante === 'primario' ? clases('luz-filo', bloque && 'respira') : undefined}
      >
        {pending ? 'Enviando…' : enviar}
      </Boton>
    </>
  );

  return (
    <form
      ref={formRef}
=======
  children: ReactNode;
}) {
  const [estado, action, pending] = useActionState(accion, {});

  return (
    <form
>>>>>>> origin/main
      action={action}
      className={estilos.formulario}
      noValidate
      /**
<<<<<<< HEAD
       * ⚠️ SEPARA EL FORMULARIO-PANTALLA DEL FORMULARIO-ACCION, Y SALE DE
       * `bloque` PORQUE ES EXACTAMENTE ESA DISTINCION. Verificado: los
       * formularios en linea del sitio —pausar, reactivar, eliminar, borrar
       * foto, desvincular Mercado Pago— pasan `bloque={false}`. Sin esto, el
       * filete editorial de 4px aparece flotando arriba de un boton "Pausar"
       * dentro de una fila de lista.
       */
      data-forma={bloque ? 'panel' : 'accion'}
      /*
       * ⚠️ SOLO ESTILA: NO ES `aria-busy`. El `aria-busy` ya lo pone el boton.
       * Ponerlo tambien aca haria que un lector de pantalla anuncie dos veces
       * el mismo hecho.
       */
      data-enviando={pending ? 'true' : undefined}
      /**
=======
>>>>>>> origin/main
       * ⚠️ `multipart/form-data` HACE FALTA PARA LOS ARCHIVOS SIN JAVASCRIPT.
       * Con JS, React serializa el FormData por su cuenta y lo ignora; sin JS,
       * el navegador hace el POST nativo y el `enctype` por defecto
       * (`urlencoded`) mandaria solo el NOMBRE del archivo, no su contenido.
<<<<<<< HEAD
       */
      encType="multipart/form-data"
    >
      {estado.error !== undefined && (
        <Aviso tono="error">
          {estado.error}
          {/*
            ⚠️ EL ENLACE VA DENTRO DEL AVISO, no debajo. Es la salida de ESE
            error: separarlo lo convierte en un enlace suelto que no se sabe a
            que responde.
          */}
          {estado.enlace !== undefined && (
            <>
              {' '}
              <a href={estado.enlace.href}>{estado.enlace.texto}</a>
            </>
          )}
        </Aviso>
      )}

      {estado.errores !== undefined && <ResumenDeErrores errores={estado.errores} />}

      {estado.ok !== undefined && (
        <div className={estilos.exito}>
          <Aviso tono="exito">{estado.ok}</Aviso>
        </div>
      )}

      <CtxFormulario.Provider value={estado}>
        {/*
          ⚠️ ESTE `<div>` EXISTE PARA QUE EL ESCALONADO NO SE REINICIE. Los
          hijos directos del `<form>` cambian de cantidad cuando aparecen el
          aviso y el resumen, y con `nth-child` eso corre el `animation-delay`
          de todos los campos — y cambiar el delay de una animacion terminada la
          REINICIA. Cada error de validacion volveria a esconder el formulario
          entero medio segundo, justo cuando hay que arreglar un campo.

          El CSS lo esconde cuando adentro solo hay campos ocultos; un
          `<input type="hidden">` dentro de un `display: none` se envia igual.
        */}
        <div className={estilos.cuerpo}>{children}</div>

        {/*
          ⚠️ EL PIE SE ENVUELVE SOLO CUANDO EXISTE. Sin `pie`, esto rinde el
          riel y el boton como hijos directos del `<form>`, que es exactamente
          el marcado de antes: los veinte formularios que no lo usan no cambian
          ni un pixel.

          ⚠️ VA ADENTRO DEL PROVIDER Y ESO NO AGREGA NI UN NODO —un Provider no
          pinta marcado—. Es la garantia de que un `<Campo>` puesto en el pie se
          comporte igual que uno del cuerpo: afuera perderia en silencio el
          error y lo tipeado, que es justo el agujero que el contexto vino a
          tapar.
        */}
        {pie === undefined ? (
          acciones
        ) : (
          <div className={clases(estilos.pieAccion, clasePie)}>
            {pie}
            {acciones}
          </div>
        )}
      </CtxFormulario.Provider>
=======
       * Ponerlo siempre no cuesta nada y evita que un formulario con archivos
       * se rompa en silencio justamente en el modo degradado.
       */
      encType="multipart/form-data"
    >
      {estado.error !== undefined && <Aviso error>{estado.error}</Aviso>}
      {estado.ok !== undefined && <Aviso>{estado.ok}</Aviso>}

      {children}

      <Boton type="submit" bloque disabled={pending}>
        {pending ? 'Enviando…' : enviar}
      </Boton>
>>>>>>> origin/main
    </form>
  );
}

/**
<<<<<<< HEAD
 * Dos campos por fila.
 *
 * ⚠️ REEMPLAZA A `.par`, QUE ESTA DUPLICADO EN DOS MODULOS —`vendedor.module.css`
 * y `resumen.module.css`, identicos, cada uno con su propia media query—. Al
 * ser un componente, las pantallas no tienen que importar `form.module.css`
 * para usarlo, que es lo que hoy las obliga a definirlo por su cuenta.
 */
export function Fila({ children }: { children: ReactNode }) {
  return <div className={estilos.fila}>{children}</div>;
}

/**
=======
>>>>>>> origin/main
 * Campo con etiqueta.
 *
 * ⚠️ La etiqueta usa `htmlFor` contra el `id` del control: sin esa asociacion,
 * un lector de pantalla no sabe que texto corresponde a que campo, y hacer clic
 * en la etiqueta no enfoca el campo.
 */
export function Campo({
  nombre,
  etiqueta,
  tipo = 'text',
  ayuda,
  requerido = true,
  autoComplete,
  defaultValue,
<<<<<<< HEAD
  identificador,
  maximo,
  placeholder,
  ...props
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  | 'id'
  | 'name'
  | 'type'
  | 'required'
  /*
   * ⚠️ LOS CUATRO ULTIMOS SE SACAN DEL SPREAD A PROPOSITO. `onChange` y
   * `maxLength` los maneja el contador; `aria-invalid` y `aria-describedby` los
   * calcula el componente. Dejarlos pasar significa que un consumidor los pisa
   * en silencio y rompe el contador o la accesibilidad sin ningun error.
   */
  | 'onChange'
  | 'maxLength'
  | 'aria-invalid'
  | 'aria-describedby'
> & {
=======
}: {
>>>>>>> origin/main
  nombre: string;
  etiqueta: string;
  tipo?: string;
  ayuda?: string;
  requerido?: boolean;
<<<<<<< HEAD
  /**
   * `id` del control, cuando `nombre` no alcanza para ser unico.
   *
   * ⚠️ HACE FALTA DENTRO DE UN `.map()`. La consola de pagos dibuja un
   * formulario de reembolso POR PAGO, todos con `nombre="montoPesos"`: sin
   * esto, dos pagos producen dos `id="montoPesos"` en la misma pagina, y las
   * dos etiquetas enfocan el campo del PRIMERO.
   */
  identificador?: string;
  /**
   * Largo maximo REAL del servidor. Pone `maxLength` en el control —que ya
   * funciona sin JavaScript, truncando— y ademas dibuja el contador.
   *
   * ⚠️ NO SE ESCRIBE A MANO EN LA PANTALLA: tiene que salir de la misma
   * constante que usa el schema, igual que `largoMinimo` en `CampoPassword`.
   * Hoy ese numero esta duplicado como literal en dos bordes del Service y
   * consolidarlo toca archivos fuera de esta superficie.
   */
  maximo?: number;
}) {
  const id = identificador ?? nombre;
  const idAyuda = ayuda === undefined ? undefined : `${id}-ayuda`;
  const idError = `${id}-error`;
  const { error, valor } = useCampo(nombre);
  const hidratado = useHidratado();

  /*
   * ⚠️ EL ORDEN IMPORTA: primero lo que la persona escribio, despues lo que
   * traia el formulario. Si `defaultValue` ganara, un error de validacion
   * pisaria lo tipeado con el valor viejo.
   */
  const inicial = valor ?? defaultValue;
  const textoInicial = inicial === undefined ? '' : String(inicial);
  const [usados, setUsados] = useLargoDeCampo(textoInicial);

  return (
    <div className={estilos.campo}>
      <label htmlFor={id} className={estilos.etiqueta}>
        {etiqueta}
      </label>
      {/*
        ⚠️ EL SPREAD VA PRIMERO. Con el spread al final, un `onChange` de quien
        llama pisaba al del contador y el medidor dejaba de moverse sin ningun
        error. Ahora lo que declara el componente siempre gana.

        ⚠️ SIGUE ACEPTANDO `min`, `max`, `step` e `inputMode`: la lista de props
        era cerrada y no los incluia, asi que el campo de comision rechazaba
        6,5 y el importe de un reembolso admitia numeros negativos.
      */}
      <input
        {...props}
        id={id}
        name={nombre}
        type={tipo}
        /*
          ⚠️ `placeholder=" "` CUANDO NO HAY UNO, Y NO ES UN CAPRICHO: es lo que
          vuelve usable a `:user-invalid`. Sin un `placeholder`,
          `:placeholder-shown` no matchea NUNCA, asi que la validacion en vivo
          no puede distinguir "vacio y obligatorio" de "escrito y mal", y
          tabular por los seis campos de direccion para mirarlos dejaria seis
          bordes marcados. No se ve —es un espacio— y la etiqueta sigue siendo
          el nombre accesible del campo.
        */
        placeholder={placeholder ?? ' '}
        className={clases(estilos.control, error !== undefined && estilos.controlError)}
        required={requerido}
        autoComplete={autoComplete}
        /*
          ⚠️ `key` VUELVE A MONTAR EL CONTROL CUANDO CAMBIA EL VALOR QUE VINO
          DEL SERVIDOR. Sin esto, un `<input>` no controlado ya "sucio" ignora
          el `defaultValue` nuevo y la persona no ve lo que el servidor le
          devolvio. El contador lo reinicia `useLargoDeCampo`, que vive en este
          componente y no se entera de un remount del hijo.
        */
        key={textoInicial}
        defaultValue={inicial}
        maxLength={maximo}
        /*
          ⚠️ EL `onChange` SOLO EXISTE PARA EL CONTADOR. El campo sigue siendo
          NO CONTROLADO —`defaultValue`, no `value`—, asi que React no toca el
          cursor y escribir en el medio de un texto largo no lo manda al final.
        */
        onChange={
          maximo === undefined
            ? undefined
            : (evento: ChangeEvent<HTMLInputElement>) => {
                setUsados(evento.target.value.length);
              }
        }
        /*
          ⚠️ `aria-invalid` Y `aria-describedby` APUNTANDO AL ERROR. Sin los
          dos, un lector de pantalla lee el campo como si estuviera bien: el
          borde de alerta no existe para quien no ve la pantalla.
        */
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describe(idAyuda, idError, error)}
      />
      <PieDeCampo
        idError={idError}
        idAyuda={idAyuda}
        error={error}
        ayuda={ayuda}
        contador={
          maximo !== undefined && hidratado ? (
            <ContadorDeCaracteres usados={usados} maximo={maximo} />
          ) : undefined
        }
      />
    </div>
  );
}

/**
 * CAMPO DE PLATA, EN LA TIPOGRAFIA DE LA MARCA.
 *
 * ⚠️ ES EL UNICO INPUT DEL SITIO DONDE SE ESCRIBE UN IMPORTE y estaba en Inter
 * 16px, identico al de telefono, mientras la identidad asigna Big Noodle a
 * "titulares, PRECIOS, numeros de camiseta".
 *
 * ⚠️ EL SIMBOLO ES DECORATIVO (`aria-hidden`): la etiqueta ya dice "Precio en
 * pesos" o "Nueva comision".  Un lector de pantalla que ademas leyera "$" diria
 * "pesos pesos".
 *
 * ⚠️ NO ES UN CAMPO DE MONEDA CON FORMATO EN VIVO. Formatear mientras alguien
 * escribe exige controlar el input, mover el cursor a mano y romper el modo sin
 * JavaScript. Sigue siendo un `type="number"` que el schema valida igual.
 */
export function CampoImporte({
  nombre,
  etiqueta,
  ayuda,
  simbolo = '$',
  simboloAlFinal = false,
  requerido = true,
  defaultValue,
  identificador,
  min,
  max,
  step = 1,
  inputMode = 'numeric',
}: {
  nombre: string;
  etiqueta: string;
  ayuda?: string;
  simbolo?: string;
  simboloAlFinal?: boolean;
  requerido?: boolean;
  // `| undefined` explicito: con `exactOptionalPropertyTypes` un opcional NO
  // acepta que le pasen `undefined` a proposito.
  defaultValue?: string | undefined;
  identificador?: string;
  min?: number;
  max?: number;
  step?: number;
  inputMode?: 'numeric' | 'decimal';
}) {
  const id = identificador ?? nombre;
  const idAyuda = ayuda === undefined ? undefined : `${id}-ayuda`;
  const idError = `${id}-error`;
  const { error, valor } = useCampo(nombre);

  const marca = (
    <span
      className={clases(estilos.signo, simboloAlFinal && estilos.signoFinal)}
      aria-hidden="true"
    >
      {simbolo}
    </span>
  );

  return (
    <div className={estilos.campo}>
      <label htmlFor={id} className={estilos.etiqueta}>
        {etiqueta}
      </label>
      <div
        className={clases(
          estilos.campoConBoton,
          estilos.campoImporte,
          error !== undefined && estilos.campoConBotonError,
        )}
      >
        {!simboloAlFinal && marca}
        <input
          id={id}
          name={nombre}
          type="number"
          className={clases(estilos.control, estilos.controlImporte)}
          required={requerido}
          defaultValue={valor ?? defaultValue}
          min={min}
          max={max}
          step={step}
          inputMode={inputMode}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describe(idAyuda, idError, error)}
        />
        {simboloAlFinal && marca}
      </div>
      <PieDeCampo idError={idError} idAyuda={idAyuda} error={error} ayuda={ayuda} />
=======
  autoComplete?: string;
  defaultValue?: string;
}) {
  const idAyuda = ayuda === undefined ? undefined : `${nombre}-ayuda`;

  return (
    <div className={estilos.campo}>
      <label htmlFor={nombre} className={estilos.etiqueta}>
        {etiqueta}
      </label>
      <input
        id={nombre}
        name={nombre}
        type={tipo}
        className={estilos.control}
        required={requerido}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        aria-describedby={idAyuda}
      />
      {ayuda !== undefined && (
        <span id={idAyuda} className={estilos.ayuda}>
          {ayuda}
        </span>
      )}
>>>>>>> origin/main
    </div>
  );
}

/**
 * Casilla de verificacion.
 *
 * La etiqueta ENVUELVE al control y ademas lo referencia con `htmlFor`.
<<<<<<< HEAD
 * Envolver ya alcanza, pero la asociacion explicita sobrevive a que alguien
 * reordene el marcado mas adelante.
 *
 * ⚠️ AHORA LEE EL CONTEXTO DE ERRORES. No lo hacia, y es un agujero real: en
 * `/crear-cuenta` el schema exige `acceptedTerms`, asi que un alta sin tildar
 * produce `errores.acceptedTerms` — y la casilla no mostraba ni el borde, ni el
 * mensaje, ni `aria-invalid`.
 *
 * ⚠️ EL `name` TIENE QUE COINCIDIR CON LA CLAVE DEL SCHEMA. En
 * `/vendedor/empezar` la casilla se llama `terminos` mientras la Server Action
 * mapea a `acceptedSellerTerms`, asi que esa casilla NUNCA va a poder mostrar
 * su error. Se arregla en la pantalla y en la accion, no aca.
 */
export function Casilla({ nombre, children }: { nombre: string; children: ReactNode }) {
  const idError = `${nombre}-error`;
  const { error } = useCampo(nombre);

  return (
    <div className={estilos.campo}>
      <label
        className={clases(estilos.casilla, error !== undefined && estilos.casillaError)}
        htmlFor={nombre}
      >
        <input
          type="checkbox"
          id={nombre}
          name={nombre}
          className={estilos.tilde}
          required
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined ? undefined : idError}
        />
        <span>{children}</span>
      </label>
      {error !== undefined && (
        <span id={idError} className={estilos.error}>
          {error}
        </span>
      )}
    </div>
=======
 * Envolver ya alcanza —verificado en el navegador: `input.labels` devuelve la
 * etiqueta correcta—, pero la asociacion explicita sobrevive a que alguien
 * reordene el marcado mas adelante.
 */
export function Casilla({ nombre, children }: { nombre: string; children: ReactNode }) {
  return (
    <label className={estilos.casilla} htmlFor={nombre}>
      <input type="checkbox" id={nombre} name={nombre} required />
      <span>{children}</span>
    </label>
>>>>>>> origin/main
  );
}

/** Opcion de un `Seleccion`. `valor` es lo que viaja; `etiqueta` lo que se lee. */
export interface Opcion {
  valor: string;
  etiqueta: string;
}

/**
 * Lista desplegable.
 *
 * ⚠️ SIN OPCION VACIA CUANDO ES REQUERIDA. Un `<select required>` cuyo primer
<<<<<<< HEAD
 * item ya es valido nunca puede quedar sin elegir. Cuando el campo es opcional
 * —`vacio`— la primera opcion vale cadena vacia y el Server Action la trata
 * como ausente.
 *
 * ⚠️ SIGUE SIENDO UN `<select>` NATIVO. El CSS le cambia el dibujo con
 * `appearance: none`, no el comportamiento: en el telefono se abre el selector
 * del sistema operativo y anda sin una linea de JavaScript.
 *
 * ⚠️ NO SE REEMPLAZA POR `<input list>` + `<datalist>`, aunque una lista de 135
 * temporadas pida busqueda a gritos: un datalist manda al servidor el TEXTO
 * visible y el schema de publicar exige un uuid. La unica forma de que mande el
 * uuid es ponerlo en `value`, y entonces la persona ve el uuid escrito en el
 * campo. No hay mapeo etiqueta a valor en HTML sin JavaScript.
=======
 * item ya es valido nunca puede quedar sin elegir, que es lo que queremos para
 * campos como la condicion. Cuando el campo es opcional —`vacio`— la primera
 * opcion vale cadena vacia y el Server Action la trata como ausente.
>>>>>>> origin/main
 */
export function Seleccion({
  nombre,
  etiqueta,
  opciones,
  vacio,
  ayuda,
  defaultValue,
<<<<<<< HEAD
  identificador,
=======
>>>>>>> origin/main
}: {
  nombre: string;
  etiqueta: string;
  opciones: Opcion[];
  vacio?: string;
  ayuda?: string;
  // `| undefined` explicito: con `exactOptionalPropertyTypes` un opcional NO
  // acepta que le pasen `undefined` a proposito, y quien arma la lista puede
  // no tener todavia un valor por defecto.
  defaultValue?: string | undefined;
<<<<<<< HEAD
  /** Mismo motivo que en `Campo`: unicidad del `id` dentro de un `.map()`. */
  identificador?: string;
}) {
  const id = identificador ?? nombre;
  const idAyuda = ayuda === undefined ? undefined : `${id}-ayuda`;
  const idError = `${id}-error`;
  const { error, valor } = useCampo(nombre);

  return (
    <div className={estilos.campo}>
      <label htmlFor={id} className={estilos.etiqueta}>
        {etiqueta}
      </label>
      <select
        id={id}
        name={nombre}
        className={clases(
          estilos.control,
          estilos.controlSeleccion,
          error !== undefined && estilos.controlError,
        )}
        defaultValue={valor ?? defaultValue}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describe(idAyuda, idError, error)}
=======
}) {
  const idAyuda = ayuda === undefined ? undefined : `${nombre}-ayuda`;

  return (
    <div className={estilos.campo}>
      <label htmlFor={nombre} className={estilos.etiqueta}>
        {etiqueta}
      </label>
      <select
        id={nombre}
        name={nombre}
        className={estilos.control}
        defaultValue={defaultValue}
        aria-describedby={idAyuda}
>>>>>>> origin/main
      >
        {vacio !== undefined && <option value="">{vacio}</option>}
        {opciones.map((opcion) => (
          <option key={opcion.valor} value={opcion.valor}>
            {opcion.etiqueta}
          </option>
        ))}
      </select>
<<<<<<< HEAD
      <PieDeCampo idError={idError} idAyuda={idAyuda} error={error} ayuda={ayuda} />
=======
      {ayuda !== undefined && (
        <span id={idAyuda} className={estilos.ayuda}>
          {ayuda}
        </span>
      )}
>>>>>>> origin/main
    </div>
  );
}

/** Campo de texto largo: bio, politica de envios, descripcion. */
export function AreaDeTexto({
  nombre,
  etiqueta,
  ayuda,
  requerido = false,
  filas = 4,
  defaultValue,
<<<<<<< HEAD
  identificador,
  maximo,
=======
>>>>>>> origin/main
}: {
  nombre: string;
  etiqueta: string;
  ayuda?: string;
  requerido?: boolean;
  filas?: number;
  defaultValue?: string;
<<<<<<< HEAD
  /** Mismo motivo que en `Campo`: unicidad del `id` dentro de un `.map()`. */
  identificador?: string;
  /** Largo maximo REAL del servidor. Ver la nota en `Campo`. */
  maximo?: number;
}) {
  const id = identificador ?? nombre;
  const idAyuda = ayuda === undefined ? undefined : `${id}-ayuda`;
  const idError = `${id}-error`;
  const { error, valor } = useCampo(nombre);
  const hidratado = useHidratado();

  const inicial = valor ?? defaultValue;
  const textoInicial = inicial ?? '';
  const [usados, setUsados] = useLargoDeCampo(textoInicial);

  return (
    <div className={estilos.campo}>
      <label htmlFor={id} className={estilos.etiqueta}>
        {etiqueta}
      </label>
      <textarea
        id={id}
        name={nombre}
        rows={filas}
        /* Mismo motivo que en `Campo`: habilita un `:user-invalid` util. */
        placeholder=" "
        className={clases(
          estilos.control,
          estilos.controlArea,
          error !== undefined && estilos.controlError,
        )}
        required={requerido}
        key={textoInicial}
        defaultValue={inicial}
        maxLength={maximo}
        onChange={
          maximo === undefined
            ? undefined
            : (evento: ChangeEvent<HTMLTextAreaElement>) => {
                setUsados(evento.target.value.length);
              }
        }
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describe(idAyuda, idError, error)}
      />
      <PieDeCampo
        idError={idError}
        idAyuda={idAyuda}
        error={error}
        ayuda={ayuda}
        contador={
          maximo !== undefined && hidratado ? (
            <ContadorDeCaracteres usados={usados} maximo={maximo} />
          ) : undefined
        }
      />
=======
}) {
  const idAyuda = ayuda === undefined ? undefined : `${nombre}-ayuda`;

  return (
    <div className={estilos.campo}>
      <label htmlFor={nombre} className={estilos.etiqueta}>
        {etiqueta}
      </label>
      <textarea
        id={nombre}
        name={nombre}
        rows={filas}
        className={estilos.control}
        required={requerido}
        defaultValue={defaultValue}
        aria-describedby={idAyuda}
      />
      {ayuda !== undefined && (
        <span id={idAyuda} className={estilos.ayuda}>
          {ayuda}
        </span>
      )}
>>>>>>> origin/main
    </div>
  );
}

/**
 * Selector de archivos.
 *
<<<<<<< HEAD
 * ⚠️ `accept` es una AYUDA, NO UNA VALIDACION. Le dice al navegador que mostrar
 * en el dialogo; cualquiera puede mandar otra cosa. Quien decide es el Service,
 * que decodifica los bytes.
 *
 * ⚠️ AHORA LEE EL CONTEXTO DE ERRORES, igual que `Casilla`. Es el mismo
 * agujero: un error keyeado al nombre del campo de fotos no se veia en ningun
 * lado y ni siquiera se marcaba con `aria-invalid`.
=======
 * ⚠️ `accept` es una AYUDA, NO UNA VALIDACION. Le dice al navegador que
 * mostrar en el dialogo; cualquiera puede mandar otra cosa. Quien decide es el
 * Service, que decodifica los bytes.
>>>>>>> origin/main
 */
export function CampoArchivos({
  nombre,
  etiqueta,
  ayuda,
  multiple = true,
  requerido = false,
}: {
  nombre: string;
  etiqueta: string;
  ayuda?: string;
  multiple?: boolean;
  requerido?: boolean;
}) {
  const idAyuda = ayuda === undefined ? undefined : `${nombre}-ayuda`;
<<<<<<< HEAD
  const idError = `${nombre}-error`;
  const { error } = useCampo(nombre);
=======
>>>>>>> origin/main

  return (
    <div className={estilos.campo}>
      <label htmlFor={nombre} className={estilos.etiqueta}>
        {etiqueta}
      </label>
      <input
        id={nombre}
        name={nombre}
        type="file"
<<<<<<< HEAD
        className={clases(
          estilos.control,
          estilos.controlArchivos,
          error !== undefined && estilos.controlError,
        )}
        accept="image/jpeg,image/png,image/webp"
        multiple={multiple}
        required={requerido}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describe(idAyuda, idError, error)}
      />
      <PieDeCampo idError={idError} idAyuda={idAyuda} error={error} ayuda={ayuda} />
=======
        className={estilos.control}
        accept="image/jpeg,image/png,image/webp"
        multiple={multiple}
        required={requerido}
        aria-describedby={idAyuda}
      />
      {ayuda !== undefined && (
        <span id={idAyuda} className={estilos.ayuda}>
          {ayuda}
        </span>
      )}
>>>>>>> origin/main
    </div>
  );
}

/** Valor que viaja con el formulario sin que la persona lo vea ni lo edite. */
export function CampoOculto({ nombre, valor }: { nombre: string; valor: string }) {
  return <input type="hidden" name={nombre} value={valor} />;
}
<<<<<<< HEAD

/**
 * Campo de contrasenia con dos ayudas que solo existen si hay JavaScript:
 * mostrar/ocultar, y el requisito que se tilda solo mientras se escribe.
 *
 * ⚠️⚠️ AHORA LEE EL CONTEXTO DE ERRORES, Y ES UN ARREGLO DE UN BUG REAL. Era el
 * UNICO componente que no llamaba a `useCampo`, y `errores.password` SI se
 * produce: `restablecerPassword` parsea `{ token, password }` con Zod y
 * `erroresDeZod` devuelve el issue con `path: ['password']`. Una contrasenia
 * corta dejaba el campo **sin borde de error, sin mensaje y sin
 * `aria-invalid`**: para quien usa un lector de pantalla el campo se leia como
 * valido.
 *
 * ⚠️ LOS DOS CONTROLES APARECEN RECIEN DESPUES DE HIDRATAR, y no es un detalle
 * de implementacion: un boton de "mostrar" renderizado en el servidor queda
 * MUERTO si el JavaScript no carga —la persona lo aprieta y no pasa nada—, que
 * es peor que no tenerlo.
 *
 * ⚠️ NO ES UN MEDIDOR DE FUERZA. Un semaforo "debil / media / fuerte" inventa
 * una politica que el sistema no aplica: el servidor solo exige un largo
 * minimo. Se muestra ESE requisito, el de verdad, y se tilda cuando se cumple.
 */
export function CampoPassword({
  nombre,
  etiqueta,
  largoMinimo,
  autoComplete,
  ayuda,
}: {
  nombre: string;
  etiqueta: string;
  /** El minimo REAL del servidor (`AUTH_PASSWORD_MIN_LENGTH`), no un numero escrito a mano. */
  largoMinimo: number;
  autoComplete?: string;
  ayuda?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [valor, setValor] = useState('');
  const hidratado = useHidratado();
  const idAyuda = useId();
  const idError = `${nombre}-error`;
  const { error } = useCampo(nombre);

  const alcanza = valor.length >= largoMinimo;

  return (
    <div className={estilos.campo}>
      <label htmlFor={nombre} className={estilos.etiqueta}>
        {etiqueta}
      </label>

      <div
        className={clases(estilos.campoConBoton, error !== undefined && estilos.campoConBotonError)}
      >
        <input
          id={nombre}
          name={nombre}
          type={visible ? 'text' : 'password'}
          className={estilos.control}
          required
          autoComplete={autoComplete}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined ? idAyuda : `${idAyuda} ${idError}`}
          onChange={(evento) => {
            setValor(evento.target.value);
          }}
        />

        {hidratado && (
          <button
            type="button"
            className={estilos.revelar}
            onClick={() => {
              setVisible((antes) => !antes);
            }}
            /* El estado lo dice el texto accesible, no un icono que cambia. */
            aria-pressed={visible}
          >
            {visible ? 'Ocultar' : 'Mostrar'}
            <span className="solo-lectores"> la contraseña</span>
          </button>
        )}
      </div>

      {error !== undefined && (
        <span id={idError} className={estilos.error}>
          {error}
        </span>
      )}

      {/*
        ⚠️ `aria-live="polite"` Y NO `assertive`: el requisito cambia con cada
        tecla. Interrumpir al lector de pantalla en cada letra seria inusable;
        "polite" espera a que termine de leer lo que estaba diciendo.
      */}
      <span id={idAyuda} className={estilos.ayuda} aria-live="polite">
        {hidratado && valor.length > 0 ? (
          <span className={alcanza ? estilos.requisitoOk : estilos.requisitoFalta}>
            {alcanza ? '✓' : '○'} Al menos {largoMinimo} caracteres
          </span>
        ) : (
          (ayuda ?? `Al menos ${largoMinimo} caracteres. Cuanto más larga, mejor.`)
        )}
      </span>
    </div>
  );
}

/**
 * Grupo de campos con su titulo.
 *
 * ⚠️ ES UN `<fieldset>` DE VERDAD, NO UN `<div>` CON UN `<h3>`. Un lector de
 * pantalla anuncia la `<legend>` al entrar a cualquier control del grupo: la
 * persona escucha "Fotos — Fotos de la prenda" y sabe en que parte del
 * formulario esta. Con un `<div>` y un titulo suelto, esa relacion no existe.
 *
 * ⚠️ AHORA ES ADEMAS UNA SUPERFICIE (ver `.grupo` en el CSS): es el segundo
 * plano de la pantalla mas larga del sitio. Por eso conviene usarlo tambien en
 * `editar`, que tiene los mismos quince controles y estaba plano — pero esa
 * pantalla es de otra superficie y queda reportado, no tocado.
 */
export function GrupoDeCampos({
  titulo,
  detalle,
  children,
}: {
  titulo: string;
  detalle?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className={estilos.grupo}>
      <legend className={estilos.grupoTitulo}>{titulo}</legend>
      {detalle !== undefined && <p className={estilos.grupoDetalle}>{detalle}</p>}
      <div className={estilos.grupoCampos}>{children}</div>
    </fieldset>
  );
}

/** Subtitulo interno de un grupo. Ver la nota de `.grupoSubtitulo`. */
export function SubtituloDeGrupo({ children }: { children: ReactNode }) {
  return <p className={estilos.grupoSubtitulo}>{children}</p>;
}
=======
>>>>>>> origin/main
