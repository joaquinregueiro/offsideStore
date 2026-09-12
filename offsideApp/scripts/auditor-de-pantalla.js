/**
 * AUDITOR DE PANTALLA — se pega en la consola del navegador, con la app corriendo.
 * =============================================================================
 *
 * ⚠️ EXISTE PORQUE LOS NUMEROS ESCRITOS A MANO SALIERON MAL. Este repo tiene
 * decenas de comentarios con contrastes medidos ("4.93:1 ✅") y varios eran
 * falsos: `--alerta-lavado` decia 4.93 y en pantalla daba 4.50. Un numero
 * escrito con seguridad hace que nadie lo recalcule. Esto lo calcula solo,
 * sobre el DOM de verdad, con los tokens de verdad y el tema de verdad.
 *
 * QUE MIDE, en la pantalla que este abierta:
 *   1. contraste de todo el texto contra su fondo efectivo (AA: 4.5, o 3 si es grande)
 *   2. desborde horizontal
 *   3. contenido trabado en `opacity: 0` sin ninguna animacion que lo suba
 *   4. blancos apuntables por debajo de los 24px de WCAG 2.5.8
 *
 * COMO SE USA:
 *   1. abrir la pantalla, hacer scroll hasta abajo y volver arriba
 *      (los revelados por scroll estan en 0 hasta que entran en pantalla);
 *   2. pegar este archivo entero en la consola;
 *   3. repetir con el sistema en claro Y en oscuro. Son dos temas: un hallazgo
 *      puede existir en uno solo, y de hecho asi aparecieron los dos peores.
 *
 * ⚠️ LOS COLORES SE RESUELVEN EN UN CANVAS DE 1x1, NO CON UNA EXPRESION REGULAR.
 * `getComputedStyle` ya no devuelve siempre `rgb(...)`: un `color-mix()` sale
 * como `color(srgb 0.98 0.98 0.96 / 0.62)`, con canales de 0 a 1. Leyendo
 * numeros a mano, un papel al 62% se media como casi negro y el auditor
 * inventaba defectos. Pintando el color sobre su fondo y leyendo el pixel, el
 * espacio de color y el alfa los resuelve el MISMO motor que pinta la pagina.
 *
 * ⚠️ LO QUE NO MIDE, Y POR QUE. Un elemento que pinta su PROPIO degradado o una
 * foto se saltea: no hay forma de saber sobre que parte cae el texto, y medirlo
 * contra el color del padre da numeros falsos (`.tiraEstado`, un velo sobre una
 * foto, daba 1.07 y esta perfecto). Un ANCESTRO con un degradado del sistema si
 * se mide, contra su color plano: la regla del proyecto es que la luz se resta,
 * asi que ese color es el extremo y por lo tanto el peor caso.
 *
 * ⚠️ Y TAMPOCO MIDE UNA PESTAÑA EN SEGUNDO PLANO. El navegador suspende el
 * layout de lo que no se ve y `getBoundingClientRect()` devuelve ceros: de 340
 * elementos pasaban 2, y el reporte daba "0 hallazgos" con la pagina rota. Si
 * `medidos` vuelve en 0 o en un numero absurdamente bajo, el problema es ese.
 */

(() => {
  /**
   * ⚠️ LOS COLORES SE RESUELVEN EN UN CANVAS, NO CON UNA EXPRESION REGULAR, y no
   * es refinamiento: es correccion. `getComputedStyle` ya no devuelve siempre
   * `rgb(...)`. Un `color-mix()` sale como `color(srgb 0.98 0.98 0.96 / 0.62)`
   * —canales de 0 a 1, no de 0 a 255— y un token con `oklab()` sale en oklab.
   * Leyendo numeros a mano, un papel al 62% se media como si fuera casi negro:
   * el `::placeholder` del buscador daba 1.42:1 cuando en pantalla vale 5.81.
   * O sea que la herramienta inventaba defectos y, peor, podia tapar los reales.
   *
   * Pintar el color sobre el fondo en un canvas de 1x1 y leer el pixel resuelve
   * el espacio de color Y el alfa de una sola vez, y usa el MISMO motor que
   * pinta la pagina. Lo que se mide es exactamente lo que se ve.
   */
  const lienzo = document.createElement('canvas');
  lienzo.width = 1;
  lienzo.height = 1;
  const pincel = lienzo.getContext('2d', { willReadFrequently: true });

  /** Un color compuesto sobre un fondo opaco, ya resuelto a `rgb(r,g,b)`. */
  const resolver = (color, sobre) => {
    pincel.clearRect(0, 0, 1, 1);
    if (sobre) {
      pincel.fillStyle = sobre;
      pincel.fillRect(0, 0, 1, 1);
    }
    pincel.fillStyle = color;
    pincel.fillRect(0, 0, 1, 1);
    const [r, g, b] = pincel.getImageData(0, 0, 1, 1).data;

    return `rgb(${r},${g},${b})`;
  };

  const lum = (c) => {
    const m = c.match(/\d+/g);
    if (!m) return null;
    const [r, g, b] = m
      .slice(0, 3)
      .map(Number)
      .map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const l1 = lum(a),
      l2 = lum(b);
    if (l1 === null || l2 === null) return null;

    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const componer = (fg, bg) => resolver(fg, bg);

  // Si alguna capa de atras se pinta con una imagen, el numero seria mentira.
  const sobreImagen = (el) => {
    let n = el,
      nivel = 0;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      /*
       * `html` y `body` llevan la malla y el grano del sistema en TODO el sitio,
       * asi que contarlas hacia que `sobreImagen` diera true para casi cualquier
       * elemento y el reporte se vaciara: de 101 hallazgos paso a 23 y se llevo
       * puestos los reales. Son texturas al 2-4% sobre papel plano; el color
       * efectivo es el papel.
       */
      /*
       * ⚠️ SOLO UNA FOTO IMPIDE MEDIR. Antes se descartaba CUALQUIER
       * `background-image` y en modo oscuro eso es casi todo el sitio —las
       * superficies del sistema llevan malla y degradado—, asi que el reporte
       * daba 0 hallazgos en una pagina entera, que es lo mismo que no tener
       * reporte.
       *
       * Contra un degradado del sistema SI se puede medir, y ademas se mide el
       * PEOR CASO: la regla del proyecto es que la luz se resta —"el punto mas
       * claro de cualquier malla de marca es el color de marca plano"—, asi que
       * el `background-color` plano es el extremo mas claro del degradado. Un
       * texto claro sobre fondo oscuro tiene ahi su contraste MINIMO: si pasa
       * en ese punto, pasa en todo el resto.
       */
      /*
       * ⚠️ DOS REGLAS DISTINTAS SEGUN QUIEN PINTA, y la diferencia es lo que
       * separa un hallazgo de un falso positivo.
       *
       * EL PROPIO ELEMENTO con una imagen o un degradado: NO SE MIDE. Se esta
       * pintando su propio respaldo y no hay forma de saber sobre que parte cae
       * el texto. Es el caso de `.tiraEstado`: un velo
       * `linear-gradient(transparent, tinta 88%)` encima de una foto, con el
       * texto apoyado en la mitad oscura. Midiendolo contra el color plano del
       * padre daba 1.07:1 y esta perfecto.
       *
       * UN ANCESTRO con un degradado del sistema: SI SE MIDE, contra su color
       * plano. La regla del proyecto es que la luz se resta —"el punto mas claro
       * de cualquier malla de marca es el color de marca plano"—, asi que ese
       * color es el extremo, o sea el peor caso. Solo una FOTO en un ancestro
       * corta la medicion, porque ahi no hay ningun extremo conocido.
       */
      const propio = n === el;
      if (n !== document.body && propio && cs.backgroundImage !== 'none') return true;
      if (n !== document.body && !propio && /url\(/.test(cs.backgroundImage)) return true;
      /*
       * Y el fondo puede vivir en un pseudo-elemento: la pastilla de filtro
       * activa (`navSeccionActivo`) se pinta entera en su `::before` con un
       * degradado verde, asi que el elemento figura transparente.
       *
       * ⚠️ SOLO SE MIRAN LOS DOS PRIMEROS NIVELES, Y NO ES UNA OPTIMIZACION.
       * Mirando TODOS los ancestros, el chequeo llegaba a `body`, que pinta la
       * malla y el grano del sitio en `::before` y `::after`: o sea que
       * CUALQUIER texto tenia "un pseudo con imagen detras" y el auditor
       * descartaba la pagina entera. Medido: de 208 elementos con texto pasaban
       * 3. Un pseudo que de verdad hace de fondo de un texto es el del propio
       * elemento o el de su contenedor inmediato.
       */
      if (nivel <= 1 && n !== document.body) {
        for (const pseudo of ['::before', '::after']) {
          const ps = getComputedStyle(n, pseudo);
          if (ps.content === 'none') continue;
          const pm = ps.backgroundColor.match(/[\d.]+/g);
          if (ps.backgroundImage !== 'none' || (pm && (pm.length < 4 || Number(pm[3]) > 0.5))) {
            return true;
          }
        }
      }
      const m = cs.backgroundColor.match(/[\d.]+/g);
      if (m && (m.length < 4 || Number(m[3]) === 1)) return false;
      n = n.parentElement;
      nivel += 1;
    }
    return false;
  };

  const fondo = (el) => {
    let capas = [],
      n = el;
    while (n && n !== document.documentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      const m = bg.match(/[\d.]+/g);
      if (m && (m.length < 4 || Number(m[3]) > 0)) {
        capas.unshift(bg);
        if (m.length < 4 || Number(m[3]) === 1) break;
      }
      n = n.parentElement;
    }
    if (!capas.length || (capas[0].match(/[\d.]+/g) || []).length > 3)
      capas.unshift(getComputedStyle(document.documentElement).backgroundColor);
    // Se compone de atras hacia adelante con el canvas: alfa y espacio de color resueltos.
    return capas.reduce((acc, c) => resolver(c, acc), 'rgb(255,255,255)');
  };

  const ruta = location.pathname;
  // Texto que existe SOLO para el lector de pantalla: no se pinta, no se mide.
  const paraLectores = (el) => el.closest('.solo-lectores, [class*="solo-lectores"]') !== null;
  /*
   * Un `details` cerrado no esta roto, esta cerrado. Todas las confirmaciones en
   * dos pasos del sitio son `details` y su contenido esta en opacity 0 hasta que
   * alguien lo abre: eran 40 de los 101 hallazgos, todos falsos.
   */
  const plegado = (el) => {
    const d = el.closest('details');
    return d !== null && !d.open;
  };
  const hallazgos = [];
  let medidos = 0;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
  };

  // 1 ─ texto con contraste bajo AA
  for (const el of document.querySelectorAll('body *')) {
    const texto = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(' ')
      .trim();
    if (!texto || texto.length < 2) continue;
    if (!visible(el) || paraLectores(el) || plegado(el)) continue;
    /*
     * Lo decorativo no se mide: la marquesina de la home escribe "Camisetas con
     * historia" al 16% como TEXTURA, dentro de un `aria-hidden`. Da 1.45:1 y
     * esta bien que lo de: no es informacion, y quien la necesita la tiene en
     * el titular de al lado.
     */
    if (el.closest('[aria-hidden="true"]')) continue;
    const cs = getComputedStyle(el);
    /*
     * `color: transparent` es un titular con degradado, no texto invisible: el
     * sistema los pinta con `background-clip: text`, asi que el color propio
     * TIENE que ser transparente. Medirlo da 1:1 siempre.
     */
    const ca = cs.color.match(/[\d.]+/g) || [];
    if (ca.length > 3 && Number(ca[3]) === 0) continue;
    // Sobre una FOTO no hay un color de fondo que medir; sobre un degradado si.
    if (sobreImagen(el)) continue;
    const px = parseFloat(cs.fontSize),
      grande = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
    const r = ratio(componer(cs.color, fondo(el)), fondo(el));
    if (r !== null) medidos += 1;
    if (r === null) continue;
    const min = grande ? 3 : 4.5;
    if (r < min)
      hallazgos.push({
        tipo: 'contraste',
        ruta,
        texto: texto.slice(0, 46),
        ratio: +r.toFixed(2),
        min,
        color: cs.color,
        fondo: fondo(el),
        clase: String(el.className).slice(0, 50),
      });
  }

  // 2 ─ desborde horizontal
  if (document.documentElement.scrollWidth > innerWidth + 1) {
    const culpables = [...document.querySelectorAll('body *')]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.right > innerWidth + 1 || r.left < -1;
      })
      .map((e) => e.tagName + '.' + String(e.className).split(' ')[0])
      .slice(0, 5);
    hallazgos.push({
      tipo: 'desborde',
      ruta,
      scrollW: document.documentElement.scrollWidth,
      vw: innerWidth,
      culpables,
    });
  }

  // 3 ─ contenido trabado en invisible
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (Number(cs.opacity) > 0.01) continue;
    if (el.getAttribute('aria-hidden') === 'true' || el.closest('[hidden]')) continue;
    /*
     * ⚠️ UN REVELADO POR SCROLL ESTA EN 0 A PROPOSITO hasta que entra en
     * pantalla, asi que contarlo como "trabado" llena el reporte de ruido: en
     * la home eran 34 de 34. Se descarta lo que TIENE animacion; lo que queda
     * en 0 sin ninguna animacion que lo suba es el defecto real —la pagina
     * vacia en vez de quieta— que es justo lo que hay que poder ver.
     */
    if (cs.animationName && cs.animationName !== 'none') continue;
    if (paraLectores(el) || plegado(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (!(el.textContent || '').trim()) continue;
    hallazgos.push({
      tipo: 'invisible',
      ruta,
      texto: el.textContent.trim().slice(0, 40),
      clase: String(el.className).slice(0, 50),
    });
  }

  // 4 ─ blancos tactiles chicos
  for (const el of document.querySelectorAll(
    'a[href], button, input[type=checkbox], input[type=radio], summary',
  )) {
    if (!visible(el) || paraLectores(el) || plegado(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height >= 24 && r.width >= 24) continue;
    /*
     * Un enlace dentro de un renglon de texto esta exceptuado por la propia
     * WCAG 2.5.8: exigirle 24px seria marcar como fallo cualquier enlace en una
     * frase. Lo que si se exige es en los controles sueltos.
     */
    if (
      el.tagName === 'A' &&
      getComputedStyle(el).display.startsWith('inline') &&
      el.parentElement &&
      (el.parentElement.textContent || '').trim() !== (el.textContent || '').trim()
    )
      continue;
    if (el.closest('nav[aria-label*="miga" i]')) continue;
    hallazgos.push({
      tipo: 'tactil',
      ruta,
      texto: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 32),
      w: Math.round(r.width),
      h: Math.round(r.height),
      clase: String(el.className).slice(0, 40),
    });
  }

  hallazgos.medidos = medidos;
  return hallazgos;
})();
