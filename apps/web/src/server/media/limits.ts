/*
 * The limits of a stored image. Browser-safe: the upload component imports them without pulling
 * in the database, so this module has no server imports.
 */

const MEBIBYTE = 1_048_576;
const MAX_IMAGE_BYTES = 2 * MEBIBYTE;
const MAX_IMAGE_WIDTH = 1200;
const MAX_IMAGE_HEIGHT = 4000;

export { MAX_IMAGE_BYTES, MAX_IMAGE_HEIGHT, MAX_IMAGE_WIDTH };
