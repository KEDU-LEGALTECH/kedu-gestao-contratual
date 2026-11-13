/** Content-addressed Storage path: identical attachments are stored once. */
export const storagePath = (hash: string) => "sha256/" + hash.slice(0, 2) + "/" + hash;
/** Stored type, from the bytes themselves, so a large PDF or image opens in the browser from Storage. */
export const contentType = (bytes: Uint8Array) => {
  const head = Buffer.from(bytes.subarray(0, 8));
  if (head.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (head.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (head[0] === 255 && head[1] === 216 && head[2] === 255) return "image/jpeg";
  return "application/octet-stream";
};
