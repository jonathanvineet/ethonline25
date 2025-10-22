// Minimal client-side AES-GCM decryption helper
// Assumes symmetric key is a UTF-8 string (from Lit) or a base64/hex encoded key.
// The Lighthouse encrypted file format varies; many gateways return a file whose first
// bytes contain the IV (12 bytes) followed by ciphertext+tag. This helper expects the
// encrypted blob to be formatted as: [IV (12 bytes)] [ciphertext + tag]

export const importAesKey = async (rawKey: string) => {
  // Try as base64, hex, or raw text
  let keyBytes: Uint8Array;
  const tryBase64 = (s: string) => {
    try {
      if (typeof window !== 'undefined' && window.atob) {
        const bin = window.atob(s);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return buf;
      }
      return Uint8Array.from(Buffer.from(s, 'base64'));
    } catch (e) {
      return null;
    }
  };
  const tryHex = (s: string) => {
    try {
      if (/^[0-9a-fA-F]+$/.test(s)) {
        const l = s.length / 2;
        const out = new Uint8Array(l);
        for (let i = 0; i < l; i++) {
          out[i] = parseInt(s.substr(i * 2, 2), 16);
        }
        return out;
      }
      return null;
    } catch (e) { return null; }
  };

  keyBytes = tryBase64(rawKey) || tryHex(rawKey) || new TextEncoder().encode(rawKey);

  // crypto.subtle.importKey expects an ArrayBuffer or ArrayBufferView; ensure we pass an ArrayBuffer
  const keyBuffer = keyBytes.buffer instanceof ArrayBuffer ? keyBytes.buffer : (new Uint8Array(keyBytes)).buffer;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  return cryptoKey;
};

export const fetchIpfsBytes = async (cid: string) => {
  // Try public gateways; prefer ipfs.io
  const urls = [
    `https://ipfs.io/ipfs/${cid}`,
    `https://cloudflare-ipfs.com/ipfs/${cid}`,
    `https://dweb.link/ipfs/${cid}`
  ];

  let lastErr: any = null;
  for (const u of urls) {
    try {
      const res = await fetch(u);
      if (!res.ok) throw new Error(`Gateway ${u} returned ${res.status}`);
      const buf = await res.arrayBuffer();
      return new Uint8Array(buf);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Failed to fetch IPFS file');
};

export const decryptIpfsFile = async (cid: string, symmetricKey: string) => {
  // Fetch encrypted bytes
  const bytes = await fetchIpfsBytes(cid);
  if (bytes.length < 13) throw new Error('Encrypted payload too small');

  // Extract IV (12 bytes) and ciphertext (rest)
  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);

  const cryptoKey = await importAesKey(symmetricKey);

  // Decrypt
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    cryptoKey,
    ciphertext
  );

  const blob = new Blob([plainBuf]);
  return blob;
};
