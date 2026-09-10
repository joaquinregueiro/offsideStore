import * as controller from '@/modules/sellers/controllers/seller.controller';

/** POST /api/sellers/tax-profile — declara la identidad fiscal. GET — la vigente. */
export const POST = controller.submitTaxIdentity;
export const GET = controller.getMyTaxProfile;
