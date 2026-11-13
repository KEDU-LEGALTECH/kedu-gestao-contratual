/** Content-addressed Storage path: identical attachments are stored once. */
export const storagePath = (hash: string) => "sha256/" + hash.slice(0, 2) + "/" + hash;
