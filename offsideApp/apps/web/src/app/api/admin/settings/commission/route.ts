import * as controller from '@/modules/config/controllers/settings.controller';

/**
 * GET /api/admin/settings/commission — comision vigente.
 * PUT /api/admin/settings/commission — cambiarla.
 *
 * ⚠️ Ambas exigen la capacidad `system_config:manage` (DEC-023). La ruta vive
 * bajo `/admin` por claridad, pero eso NO es lo que la protege: no hay
 * middleware por prefijo, cada handler declara su guard.
 */
export const GET = controller.getCommission;
export const PUT = controller.updateCommission;
