import * as controller from '@/modules/sellers/controllers/seller.controller';

/** POST /api/sellers/tax-profile/verify — verificacion contra la fuente fiscal. */
export const POST = controller.verifyTaxIdentity;
