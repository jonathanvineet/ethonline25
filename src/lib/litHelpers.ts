// Centralized Lit helper utilities with proper SIWE message formatting
/* eslint-disable no-console */
let litNodeClient: any | null = null;

export const initLit = async () => {
  if (litNodeClient) return litNodeClient;
  try {
    // polyfill global & Buffer for some SDKs
    // @ts-ignore
    (window as any).global = window;
  } catch (e) {}
  try {
    const bufferModule = await import('buffer');
    // @ts-ignore
    (window as any).Buffer = (bufferModule as any).Buffer;
  } catch (e) {
    console.warn('Could not polyfill Buffer for Lit client', e);
  }

  const LitJsSdk = await import('@lit-protocol/lit-node-client');
  const LitNodeClient = LitJsSdk.LitNodeClient || (LitJsSdk as any).default?.LitNodeClient || (LitJsSdk as any).default;
  // Use datil-dev which is suitable for current Lit setups (adjust as needed)
  litNodeClient = new (LitNodeClient as any)({ litNetwork: 'datil-dev' });
  await litNodeClient.connect();
  return litNodeClient;
};

// Helper to normalize addresses for consistency
const normalizeAddress = (addr: string): string => String(addr || '').toLowerCase();

// Generate a SIWE-formatted message suitable for Lit nodes to parse
const generateSiweMessage = async (address: string, domain = window.location.host): Promise<string> => {
  const { ethers } = await import('ethers');
  const checksumAddress = ethers.getAddress(String(address));
  const uri = window.location.origin;
  const version = '1';
  // use chainId of current provider if available, otherwise default to 1
  let chainId = 1;
  try {
    if ((window as any).ethereum && (window as any).ethereum.request) {
      const chainHex = await (window as any).ethereum.request({ method: 'eth_chainId' });
      chainId = Number(chainHex ? parseInt(chainHex as string, 16) : 1) || 1;
    }
  } catch (e) {
    // ignore and default to 1
  }

  const nonce = Math.random().toString(36).substring(2, 15);
  const issuedAt = new Date().toISOString();

  const siweParts = [
    `${domain} wants you to sign in with your Ethereum account:`,
    checksumAddress,
    '',
    'Sign in with Ethereum to access Lit Protocol services.',
    '',
    `URI: ${uri}`,
    `Version: ${version}`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`
  ];

  const siweMessage = siweParts.join('\n');
  return siweMessage;
};

// Create a properly formatted authSig for Lit Protocol operations
export const createLitAuthSig = async (signerOrProvider: any, address?: string) => {
  const { ethers } = await import('ethers');
  let signer = signerOrProvider;
  if (!signer) throw new Error('No signer/provider provided to createLitAuthSig');
  if (signerOrProvider.getSigner) signer = await signerOrProvider.getSigner();

  const signerAddress = address ? ethers.getAddress(String(address)) : await signer.getAddress();
  const siweMessage = await generateSiweMessage(signerAddress);

  // Normalize line endings (LF) and trim
  const normalizedMessage = String(siweMessage).replace(/\r\n/g, '\n').trim();

  const signature = await signer.signMessage(normalizedMessage);

  const recovered = ethers.verifyMessage(normalizedMessage, signature);
  if (normalizeAddress(recovered) !== normalizeAddress(signerAddress)) {
    throw new Error(`Signature verification failed: expected ${signerAddress} recovered ${recovered}`);
  }

  // Lit expects an object like { sig, derivedVia, signedMessage, address }
  return {
    sig: signature,
    derivedVia: 'web3',
    signedMessage: normalizedMessage,
    address: signerAddress
  };
};

// validate ACCs match the authSig address
const validateACCAndAuthSig = (accessControlConditions: any[], authSig: any) => {
  const authSigAddress = normalizeAddress(authSig.address);
  if (!Array.isArray(accessControlConditions) || accessControlConditions.length === 0) return;
  
  // For permissive access control (anyone can decrypt), we don't need strict validation
  const isPermissive = accessControlConditions.some(acc => {
    const comparator = acc?.returnValueTest?.comparator;
    const value = acc?.returnValueTest?.value;
    return comparator === 'contains' && value === '0x';
  });
  
  if (isPermissive) {
    console.debug('[litHelpers] Using permissive access control - anyone can decrypt');
    return;
  }
  
  // For restrictive access control, validate that the user is authorized
  const hasMatch = accessControlConditions.some(acc => {
    const v = acc?.returnValueTest?.value;
    if (!v) return false;
    return normalizeAddress(v) === authSigAddress;
  });
  if (!hasMatch) {
    throw new Error(`ACC/authSig mismatch: ${authSigAddress} not found in ACC values`);
  }
};

export const saveKeyToLitWithRetry = async (lit: any, symmetricKey: string, accessControlConditions: any, authSig: any, attempts = 3) => {
  if (!authSig || !authSig.sig || !authSig.signedMessage || !authSig.address) throw new Error('Invalid authSig');
  const normalizedACC = Array.isArray(accessControlConditions) ? accessControlConditions.map((acc: any) => ({
    ...acc,
    returnValueTest: acc.returnValueTest ? { ...acc.returnValueTest, value: String(acc.returnValueTest.value || '').toLowerCase() } : acc.returnValueTest
  })) : accessControlConditions;

  validateACCAndAuthSig(normalizedACC, authSig);

  let lastErr: any = null;
  for (let i = 0; i < attempts; i++) {
    try {
      console.debug('[litHelpers] saveKeyToLitWithRetry attempt', { attempt: i + 1 });
      const data = new TextEncoder().encode(symmetricKey);
      // Ensure a session expiration is set so Lit nodes accept the encryption request.
      // Use a 24h expiration by default (seconds since epoch).
      const expirationSeconds = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
      const encRes = await lit.encrypt({
        dataToEncrypt: data,
        accessControlConditions: normalizedACC,
        authSig,
        chain: 'ethereum',
        // The Lit SDK accepts different names in different versions; include common ones.
        sessionKeyExpiration: expirationSeconds,
        sessionKeyExpiry: expirationSeconds,
        expiration: expirationSeconds,
      });
      const cipherBuf = encRes.ciphertext instanceof Uint8Array ? encRes.ciphertext : new Uint8Array(encRes.ciphertext);
      let binary = '';
      for (let j = 0; j < cipherBuf.length; j++) binary += String.fromCharCode(cipherBuf[j]);
      const cipherBase64 = typeof window !== 'undefined' && window.btoa ? window.btoa(binary) : Buffer.from(cipherBuf).toString('base64');
      // Persist session expiration in the payload so decrypt calls can include it.
      const payload = JSON.stringify({ cipher: cipherBase64, dataToEncryptHash: encRes.dataToEncryptHash, sessionKeyExpiration: expirationSeconds });
      return payload;
    } catch (e: any) {
      lastErr = e;
      console.warn('[litHelpers] saveKeyToLit attempt failed', { attempt: i + 1, err: e?.message || String(e) });
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr;
};

export const saveKeyToLit = async (symmetricKey: string, accessControlConditions: any, authSig: any, attempts = 3) => {
  const lit = await initLit();
  return saveKeyToLitWithRetry(lit, symmetricKey, accessControlConditions, authSig, attempts);
};

export const getKeyFromLit = async (encryptedSymmetricKey: string, accessControlConditions: any | null, authSig: any) => {
  const lit = await initLit();

  // ensure authSig has SIWE signedMessage normalized
  if (authSig && typeof authSig.signedMessage === 'string') {
    authSig.signedMessage = authSig.signedMessage.replace(/\r\n/g, '\n').trim();
  }

  console.debug('[litHelpers] getKeyFromLit start', { authSigAddress: authSig?.address });

  let parsed: { cipher: string; dataToEncryptHash: string };
  try { parsed = typeof encryptedSymmetricKey === 'string' ? JSON.parse(encryptedSymmetricKey) : encryptedSymmetricKey; } catch (e) { throw new Error('Invalid encrypted symmetric key payload'); }
  const { cipher, dataToEncryptHash } = parsed;

  // Try multiple approaches for session expiration
  const possibleExp = (parsed as any)?.sessionKeyExpiration || (parsed as any)?.sessionKeyExpiry || (parsed as any)?.expiration;
  
  // If no expiration found in the payload, use a default 24h from now
  const defaultExpiration = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  const sessionExpiration = possibleExp || defaultExpiration;

  try {
    const decryptParams: any = { 
      ciphertext: cipher, 
      dataToEncryptHash, 
      authSig, 
      chain: 'ethereum',
      // Always include session expiration to avoid Lit node errors
      sessionKeyExpiration: sessionExpiration,
      sessionKeyExpiry: sessionExpiration,
      expiration: sessionExpiration
    };
    if (accessControlConditions) decryptParams.accessControlConditions = accessControlConditions;

    // DEV: log small preview
    try {
      console.debug('[litHelpers] getKeyFromLit decryptParams (dev-only)', {
        authSig: { address: authSig?.address, sigPrefix: typeof authSig?.sig === 'string' ? authSig.sig.slice(0, 12) + '...' : authSig?.sig, signedMessagePreview: typeof authSig?.signedMessage === 'string' ? authSig.signedMessage.slice(0, 120) : undefined },
        accessControlConditions: decryptParams.accessControlConditions,
        ciphertextPreview: typeof cipher === 'string' ? cipher.slice(0, 48) + '...' : undefined,
        dataToEncryptHash,
        sessionExpiration
      });
    } catch (_) {}

    const decRes = await lit.decrypt(decryptParams);
    const decryptedBuf = decRes.decryptedData instanceof Uint8Array ? decRes.decryptedData : new Uint8Array(decRes.decryptedData);
    const symmetricKey = new TextDecoder().decode(decryptedBuf);
    console.debug('[litHelpers] getKeyFromLit success ✓');
    return symmetricKey;
  } catch (e: any) {
    let nodeInfo: any = null;
    try { if (e?.response) nodeInfo = e.response; else if (e?.cause?.response) nodeInfo = e.cause.response; } catch (_) {}
    console.error('[litHelpers] getKeyFromLit failed', { error: e?.message || String(e), authSigAddress: authSig?.address, nodeInfo });
    try { (e as any)._litDebug = { nodeInfo }; } catch (_) {}

    // Detect common Lit node complaint about missing session expiration used when encrypting.
    const msg = String(e?.message || (nodeInfo && JSON.stringify(nodeInfo)) || '').toLowerCase();
    if (msg.includes('expiration') && msg.includes('not set')) {
      const friendly = new Error('Missing session expiration on the encrypted key. The uploader must re-persist the symmetric key to Lit (so it includes a session expiration).');
      try { (friendly as any).code = 'MISSING_SESSION_EXPIRATION'; } catch (_) {}
      throw friendly;
    }

    throw e;
  }
};

export default initLit;