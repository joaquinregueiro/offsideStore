import * as controller from '@/modules/listings/controllers/listing.controller';

/**
 * POST /api/sellers/listings — publica una prenda.
 * GET  /api/sellers/listings — publicaciones propias del vendedor.
 */
export const POST = controller.publishListing;
export const GET = controller.listMyListings;
