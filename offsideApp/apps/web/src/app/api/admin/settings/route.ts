import * as controller from '@/modules/config/controllers/settings.controller';

/**
 * GET /api/admin/settings — todas las claves del Config Store con su valor
 * vigente, version y overrides por ambito.
 * PUT /api/admin/settings — cambiar una clave (`{ key, value, scope?, scopeId? }`),
 * versionada y validada contra el registro de claves.
 *
 * ⚠️ Ambas exigen la capacidad `system_config:manage` (DEC-023), igual que la
 * ruta de la comision, que sigue existiendo aparte porque la pantalla
 * `/admin/comision` y su historial la usan tal cual.
 */
export const GET = controller.listSettings;
export const PUT = controller.updateSetting;
