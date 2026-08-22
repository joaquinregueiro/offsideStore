/**
 * Placeholder de la home.
 *
 * No es diseno ni UI de producto: existe para que `next build` y `next dev`
 * tengan una ruta que servir. El sistema visual vive en `design/` y todavia no
 * fue implementado.
 */
export default function HomePage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '3rem', lineHeight: 1.6 }}>
      <h1>Offside Store</h1>
      <p>Foundation tecnica lista. Sin funcionalidades de negocio implementadas.</p>
      <p>
        Health check: <a href="/api/health">/api/health</a>
      </p>
    </main>
  );
}
