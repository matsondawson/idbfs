/** git's blob object hash: sha1("blob " + byteLength + "\0" + content) */
export async function computeBlobSha1(data: ArrayBuffer): Promise<string> {
  const header = new TextEncoder().encode(`blob ${data.byteLength}\0`);
  const combined = new Uint8Array(header.byteLength + data.byteLength);
  combined.set(header, 0);
  combined.set(new Uint8Array(data), header.byteLength);
  const digest = await crypto.subtle.digest("SHA-1", combined);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const CHUNK_SIZE = 8192;

export function arrayBufferToBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
