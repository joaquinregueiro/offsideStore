import * as controller from '@/modules/sellers/controllers/seller.controller';

/** POST /api/sellers — SS-001/SS-002. GET — perfil de vendedor propio. */
export const POST = controller.createSellerProfile;
export const GET = controller.getMySellerProfile;
