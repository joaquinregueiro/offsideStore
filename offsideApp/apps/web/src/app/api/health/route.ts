import { checkDatabaseConnection } from '@offside/database';
import { checkRedisConnection } from '@offside/jobs';
import { NextResponse } from 'next/server';

/**
 * Health check de infraestructura.
 *
 * Comprueba que PostgreSQL y Redis respondan. Es un endpoint de plataforma
 * (readiness probe para Coolify), no una funcionalidad de negocio.
 *
 * Ejemplo de que un Route Handler SOLO orquesta (tech-stack.md §2): no tiene
 * logica propia, delega en los packages y traduce el resultado a HTTP.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const [database, redis] = await Promise.all([checkDatabaseConnection(), checkRedisConnection()]);

  const healthy = database && redis;

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: database ? 'up' : 'down',
        redis: redis ? 'up' : 'down',
      },
    },
    { status: healthy ? 200 : 503 },
  );
}
