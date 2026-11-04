import sharp from 'sharp';

/** Fifteen megabytes. Larger originals are refused so one request cannot fill the process. */
export const IMAGE_SOURCE_MAX_BYTES = 15_000_000;
/** Stay under the Lambda response limit after the resize. */
const MAX_RESPONSE_BYTES = 5_500_000;

/** Scales the bytes down to WebP. Does not enlarge or crop. Null when the file is not an image. */
export async function renderWebp(
  bytes: Buffer,
  width: number,
  quality: number,
): Promise<Buffer | null> {
  try {
    const output = await sharp(bytes, {
      failOn: 'none',
      limitInputPixels: 40_000_000,
      animated: false,
    })
      .rotate()
      .resize({ width, withoutEnlargement: true, fit: 'inside' })
      .webp({ quality })
      .toBuffer();
    return output.byteLength > 0 && output.byteLength <= MAX_RESPONSE_BYTES ? output : null;
  } catch {
    return null;
  }
}
