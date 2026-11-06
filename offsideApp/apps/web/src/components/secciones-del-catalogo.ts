/**
 * Los enlaces del catalogo, en la barra y en el menu de telefono.
 *
 * Llevan al filtro correspondiente de `/buscar`, que muestra solo lo que hay
 * publicado: una lista propia ofreceria clubes sin ninguna camiseta.
 */
export const SECCIONES_DEL_CATALOGO = [
  { texto: 'Clubes', href: '/buscar#filtro-club' },
  { texto: 'Selecciones', href: '/buscar#filtro-seleccion' },
  { texto: 'Marcas', href: '/buscar#filtro-marca' },
  { texto: 'Temporadas', href: '/buscar#filtro-temporada' },
  { texto: 'Cómo funciona', href: '/como-funciona' },
] as const;
