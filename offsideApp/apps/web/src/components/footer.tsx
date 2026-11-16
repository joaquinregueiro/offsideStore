import Link from 'next/link';

import estilos from './footer.module.css';

/**
 * Pie del sitio.
 *
 * ⚠️ NO HAY UN SOLO ENLACE A UNA PANTALLA QUE NO EXISTA. "Ayuda", "Sobre
 * nosotros" y "Prensa" serian un 404 con aspecto de promesa.
 *
 * ⚠️ FALTAN TERMINOS Y POLITICA DE PRIVACIDAD, Y NO ES UN OLVIDO. El alta pide
 * aceptarlos y hoy son texto plano. Redactarlos es 🔴 (requiere asesoramiento
 * profesional, `docs/01-business/legal.md`): no se inventan, queda reportado.
 *
 * ⚠️ "COMO FUNCIONA" VA EN "CUENTA" por decision del dueño (2026-09-15): explica
 * las reglas del sitio, y eso se busca antes de tener cuenta.
 */
export function Footer() {
  return (
    <footer className={estilos.pie}>
      <div className={estilos.columnas}>
        <nav className={estilos.columna} aria-label="Comprar">
          <h2 className={estilos.titulo}>Comprar</h2>
          <Link href="/">Catálogo</Link>
          <Link href="/buscar">Buscar por club o marca</Link>
          <Link href="/carrito">Mi carrito</Link>
          <Link href="/mis-compras">Mis compras</Link>
        </nav>

        <nav className={estilos.columna} aria-label="Vender">
          <h2 className={estilos.titulo}>Vender</h2>
          <Link href="/vendedor/empezar">Empezar a vender</Link>
          <Link href="/vendedor/publicaciones">Mis publicaciones</Link>
          <Link href="/vendedor/ventas">Mis ventas</Link>
        </nav>

        <nav className={estilos.columna} aria-label="Cuenta">
          <h2 className={estilos.titulo}>Cuenta</h2>
          <Link href="/ingresar">Ingresar</Link>
          <Link href="/crear-cuenta">Crear cuenta</Link>
          <Link href="/como-funciona">Cómo funciona</Link>
        </nav>
      </div>

      <p className={estilos.legal}>
        Offside Store, marketplace de camisetas de fútbol. Los pagos se procesan con Mercado Pago;
        cada vendedor cobra en su propia cuenta.
      </p>
    </footer>
  );
}
