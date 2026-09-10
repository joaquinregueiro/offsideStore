import propios from './auth.module.css';

/**
 * Carga del grupo (auth).
 *
 * ⚠️ EXISTE PARA NO HEREDAR EL DE LA RAIZ, que dibuja una grilla de camisetas.
 * Ni la barra ni el panel de marca hacen falta acá: los pone el layout del grupo
 * y siguen en pantalla mientras esto se muestra. Por eso tampoco lleva un
 * `<main>` propio.
 *
 * ⚠️ TIENE LA FORMA DE LA HOJA QUE VA A LLEGAR. Antes eran cuatro renglones
 * grises flotando sobre papel y después aparecía de golpe una ficha con filete y
 * sombra: un esqueleto con proporciones distintas produce un salto, que es peor
 * que no poner nada.
 *
 * ⚠️ PERO SÓLO PARA CUATRO DE LAS SEIS, Y CONVIENE DECIRLO EN VEZ DE FINGIR QUE
 * SON SEIS. `/ingresar`, `/crear-cuenta`, `/olvide-password` y
 * `/restablecer-password` con token llegan como esta hoja; `/revisa-tu-email`,
 * `/verificar-email` y el enlace roto de reset llegan como una tarjeta de dos
 * planos, que es más ancha y tiene cabecera de color. Un `loading.tsx` es UNO
 * por segmento y este vive en el grupo: no puede saber a cuál de las dos formas
 * está reemplazando. Se elige la de la mayoría —y la de las dos pantallas que
 * más se cargan—; darle a cada confirmación su propio `loading.tsx` es la
 * salida, y cuesta un esqueleto de tarjeta que hoy no existe.
 *
 * ⚠️ EL ESTADO SE ANUNCIA CON TEXTO, NO DESCRIBIENDO CAJAS GRISES. La región
 * lleva `aria-busy`, el aviso va en un `role="status"` invisible y el esqueleto
 * entero queda `aria-hidden`.
 */
export default function CargandoPantalla() {
  return (
    <div className={propios.hoja} aria-busy="true">
      <p className="solo-lectores" role="status">
        Cargando…
      </p>

      <div aria-hidden="true">
        <span className={`${propios.esqueletoTitulo} esqueleto`} />
        <span className={`${propios.esqueletoLinea} esqueleto`} />
        <span className={`${propios.esqueletoCampo} esqueleto`} />
        <span className={`${propios.esqueletoCampo} esqueleto`} />
        <span className={`${propios.esqueletoBoton} esqueleto`} />
      </div>
    </div>
  );
}
