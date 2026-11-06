/** Content checks supplement Multer's MIME checks; MIME types alone are attacker controlled. */
const startsWith = (buffer: Buffer, bytes: number[]) => buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte);
export const isSupportedImage = (mimeType: string, buffer: Buffer) =>
  (mimeType === "image/jpeg" && startsWith(buffer, [0xff, 0xd8, 0xff])) ||
  (mimeType === "image/png" && startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
  (mimeType === "image/webp" && startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && buffer.subarray(8, 12).toString("ascii") === "WEBP");
export const isSupportedIdentityDocument = (mimeType: string, buffer: Buffer) =>
  isSupportedImage(mimeType, buffer) || (mimeType === "application/pdf" && startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d]));
