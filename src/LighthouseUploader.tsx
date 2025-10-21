import React, { useState, useRef } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import lighthouse from '@lighthouse-web3/sdk';
// Lit client (lazy init) — dynamically import to avoid Node-only code running in browser
let litNodeClient: any | null = null;
const initLit = async () => {
  if (litNodeClient) return litNodeClient;
  // Ensure `global` exists in browser environment for polyfills used by some libs
  try {
    (window as any).global = window;
  } catch (e) {
    // ignore in non-browser environments
  }

  // Polyfill Buffer for modules that expect it (Vite externalizes 'buffer')
  try {
    const bufferModule = await import('buffer');
    (window as any).Buffer = (bufferModule as any).Buffer;
  } catch (e) {
    // if buffer can't be polyfilled, some libraries may still fail — log and continue
    console.warn('Could not polyfill Buffer in the browser:', e);
  }

  // Dynamically import the Lit client so bundlers don't evaluate Node-only entrypoints at module load
  const LitJsSdk = await import('@lit-protocol/lit-node-client');
  const LitNodeClient = LitJsSdk.LitNodeClient || (LitJsSdk as any).default?.LitNodeClient || (LitJsSdk as any).default;
  // constructor typing may require args; cast to any to construct safely
  // Pass a supported litNetwork name. Valid options include: 'datil', 'datil-dev', 'datil-test', or 'custom'.
  // Use 'datil' for production/mainnet-like behavior; change to 'datil-dev' for dev/test if needed.
  litNodeClient = new (LitNodeClient as any)({ litNetwork: 'datil' });
  await litNodeClient.connect();
  return litNodeClient;
};

const LighthouseUploader: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [cid, setCid] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string>('');
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Array<any>>([]);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const [shareInputs, setShareInputs] = useState<Record<string, string>>({});
  const [shareLoading, setShareLoading] = useState<Record<string, boolean>>({});
  const [shareError, setShareError] = useState<Record<string, string>>({});

  // Load stored uploads from localStorage on mount
  React.useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('lighthouse_uploads') || '[]');
      // normalize older single-key records to new format with encryptedSymmetricKeys array
      const stored = (raw || []).map((r: any) => {
        if (r.encryptedSymmetricKeys) return r;
        if (r.encryptedSymmetricKey) {
          return { ...r, encryptedSymmetricKeys: [{ key: r.encryptedSymmetricKey, accessControlConditions: r.accessControlConditions }] };
        }
        return r;
      });
      setUploads(stored);
    } catch (e) {
      setUploads([]);
    }
  }, []);

  // Listen for dashboard download events
  React.useEffect(() => {
    const handler = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail as any;
        if (detail?.cid) {
          handleDownloadCid(detail.cid);
        }
      } catch (err) {
        console.warn('dashboard-download handler error', err);
      }
    };
    window.addEventListener('dashboard-download', handler as EventListener);
    return () => window.removeEventListener('dashboard-download', handler as EventListener);
  }, [address, cid]);

  // Listen for upload-with-meta events (from UploadAgent component)
  React.useEffect(() => {
    const handler = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail as any;
        if (detail?.file) {
          handleUploadWithMeta(detail.file, detail.meta || {});
        }
      } catch (err) {
        console.warn('upload-with-meta handler error', err);
      }
    };
    window.addEventListener('upload-with-meta', handler as EventListener);
    return () => window.removeEventListener('upload-with-meta', handler as EventListener);
  }, [address, apiKey]);

  // Get verification message from Lighthouse API directly
  const getVerificationMessage = async (publicKey: string): Promise<string> => {
    const response = await fetch(
      `https://api.lighthouse.storage/api/auth/get_message?publicKey=${publicKey}`
    );
    
    if (!response.ok) {
      throw new Error(`Failed to get verification message: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
  };

  // Authenticate wallet with Lighthouse using SDK method
  const getAuthSignature = async () => {
    if (!address) throw new Error("Wallet not connected");
    
    // Use SDK's getAuthMessage method for proper formatting
    const authMessageResponse = await lighthouse.getAuthMessage(address);
    
    if (!authMessageResponse?.data?.message) {
      throw new Error('Failed to get auth message from Lighthouse');
    }
    
    const message = authMessageResponse.data.message;
    
    // Sign message with wallet
    const signedMessage = await signMessageAsync({ message });
    
    return { 
      signedMessage, 
      publicKey: address 
    };
  };

  // Generate Lighthouse API key using wallet signature
  const handleGenerateApiKey = async () => {
    setApiKeyLoading(true);
    setError(null);
    
    try {
      if (!address) throw new Error("Wallet not connected");
      
      // Get verification message directly from API
      const verificationMessage = await getVerificationMessage(address);
      
      // Sign the message
      const signedMessage = await signMessageAsync({ 
        message: verificationMessage 
      });
      
      console.log('Public Key:', address);
      console.log('Signed Message:', signedMessage);
      
      // Request API key using the SDK
      const response = await lighthouse.getApiKey(address, signedMessage);
      
      console.log('API Key Response:', response);
      
      if (!response?.data?.apiKey) {
        throw new Error("Failed to generate API key - no key returned");
      }
      
      setApiKey(response.data.apiKey);
      
    } catch (err: any) {
      console.error('API Key Generation Error:', err);
      setError(err.message || "API key generation failed");
    } finally {
      setApiKeyLoading(false);
    }
  };

  // Upload file encrypted
  const handleUpload = async () => {
    setError(null);
    setCid(null);
    setLoading(true);
    
    try {
      if (!fileInputRef.current?.files?.[0]) {
        throw new Error("No file selected");
      }
      
      if (!apiKey) {
        throw new Error("Lighthouse API key required. Generate one above.");
      }
      
      const file = fileInputRef.current.files[0];
      const { signedMessage, publicKey } = await getAuthSignature();

      console.log('Uploading file:', file.name);
      
      // Upload encrypted file
      const output = await lighthouse.uploadEncrypted(
        [file],
        apiKey,
        publicKey,
        signedMessage
      );
      
      console.log('Upload Response:', output);
      
      if (!output?.data?.[0]?.Hash) {
        throw new Error("Upload succeeded but no CID returned");
      }
      
  const cidResult = output.data[0].Hash;
  setCid(cidResult);

      // Dispatch navigation and focus events
      window.dispatchEvent(new CustomEvent('navigate', { detail: { view: 'dashboard' } }));
      window.dispatchEvent(new CustomEvent('focus-agent', { detail: { cid: cidResult } }));
      // --- Lit integration: encrypt the symmetric key (or CID) and store access control ---
      try {
        const lit = await initLit();

        // Build a simple Access Control Condition: only the current wallet address can decrypt
        const accessControlConditions = [
          {
            contractAddress: "",
            standardContractType: "",
            chain: "ethereum",
            method: "",
            parameters: [":userAddress"],
            // use the publicKey returned from getAuthSignature so the
            // authSig/address used by Lit matches the address that signed
            // the message. Using the outer `address` can lead to a mismatch
            // if the signer differs or the closure is stale.
            returnValueTest: {
              comparator: "=",
              value: publicKey,
            },
          },
        ];

        // Fetch the encryption key data for the uploaded CID from Lighthouse
        // NOTE: Lighthouse stores the file encryption key server-side; we need to request it
        const keyResp = await lighthouse.fetchEncryptionKey(
          cidResult,
          publicKey,
          signedMessage
        );

        const symmetricKey = keyResp?.data?.key;
        if (!symmetricKey) throw new Error('No symmetric key returned from Lighthouse to store in Lit');

        // Save the symmetric key to Lit so only the accessControlConditions can retrieve it
  // Ensure authSig.address matches the address that produced `signedMessage`
  const authSig = { sig: signedMessage, derivedVia: 'web3', signedMessage, address: publicKey };

        const encryptedSymmetricKey = await lit.saveEncryptionKey({
          accessControlConditions,
          symmetricKey,
          authSig,
          chain: 'ethereum',
        });

        // Persist metadata locally for demo (replace with backend in production)
  const record = { cid: cidResult, owner: String(publicKey).toLowerCase(), encryptedSymmetricKeys: [{ key: encryptedSymmetricKey, accessControlConditions }] };
    const storedRaw = JSON.parse(localStorage.getItem('lighthouse_uploads') || '[]');
    const stored = storedRaw || [];
    stored.push(record);
    localStorage.setItem('lighthouse_uploads', JSON.stringify(stored));
    setUploads(stored);
  // notify other components in this tab that uploads changed
  window.dispatchEvent(new CustomEvent('uploads-updated'));
      } catch (litErr: any) {
        console.warn('Lit integration failed for upload:', litErr);
      }
      
    } catch (err: any) {
      console.error('Upload Error:', err);
      setError(err.message || "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  // Upload a provided file with metadata (called from UploadAgent via event)
  const handleUploadWithMeta = async (file: File, meta: any) => {
    setError(null);
    setCid(null);
    setLoading(true);
    setPublishMessage(null);

    try {
      if (!file) throw new Error('No file provided');
      if (!apiKey) throw new Error('Lighthouse API key required. Generate one above.');

      const { signedMessage, publicKey } = await getAuthSignature();
      console.log('Uploading file (meta):', file.name, meta);

      const output = await lighthouse.uploadEncrypted(
        [file],
        apiKey,
        publicKey,
        signedMessage
      );
      console.log('Upload Response:', output);
      if (!output?.data?.[0]?.Hash) throw new Error('Upload succeeded but no CID returned');
      const cidResult = output.data[0].Hash;
      setCid(cidResult);

        // Dispatch navigation and focus events
        window.dispatchEvent(new CustomEvent('navigate', { detail: { view: 'dashboard' } }));
        window.dispatchEvent(new CustomEvent('focus-agent', { detail: { cid: cidResult } }));
      // Lit integration
      try {
        const lit = await initLit();
        const accessControlConditions = [
          {
            contractAddress: '',
            standardContractType: '',
            chain: 'ethereum',
            method: '',
            parameters: [':userAddress'],
            returnValueTest: { comparator: '=', value: publicKey },
          },
        ];

        const keyResp = await lighthouse.fetchEncryptionKey(cidResult, publicKey, signedMessage);
        const symmetricKey = keyResp?.data?.key;
        if (!symmetricKey) throw new Error('No symmetric key returned from Lighthouse to store in Lit');

        const authSig = { sig: signedMessage, derivedVia: 'web3', signedMessage, address: publicKey };
        const encryptedSymmetricKey = await lit.saveEncryptionKey({ accessControlConditions, symmetricKey, authSig, chain: 'ethereum' });

        const record = {
          cid: cidResult,
          owner: String(publicKey).toLowerCase(),
          title: meta.title || '',
          description: meta.description || '',
          category: meta.category || '',
          accessType: meta.accessType || '',
          price: meta.price || '',
          encryptedSymmetricKeys: [{ key: encryptedSymmetricKey, accessControlConditions }],
        };

        const storedRaw = JSON.parse(localStorage.getItem('lighthouse_uploads') || '[]') || [];
        storedRaw.push(record);
        localStorage.setItem('lighthouse_uploads', JSON.stringify(storedRaw));
        setUploads(storedRaw);
  // notify other components in this tab that uploads changed
  window.dispatchEvent(new CustomEvent('uploads-updated'));

        setPublishMessage(`Agent "${record.title || cidResult}" published ✓`);
        setTimeout(() => setPublishMessage(null), 5000);
      } catch (litErr: any) {
        console.warn('Lit integration failed for upload-with-meta:', litErr);
        // still persist record without Lit key
  const record = { cid: cidResult, owner: String(publicKey).toLowerCase(), title: meta.title || '', description: meta.description || '', category: meta.category || '', accessType: meta.accessType || '', price: meta.price || '' };
        const storedRaw = JSON.parse(localStorage.getItem('lighthouse_uploads') || '[]') || [];
        storedRaw.push(record);
        localStorage.setItem('lighthouse_uploads', JSON.stringify(storedRaw));
        setUploads(storedRaw);
  // notify other components in this tab that uploads changed
  window.dispatchEvent(new CustomEvent('uploads-updated'));
        setPublishMessage(`Agent "${record.title || cidResult}" published (no Lit key) ✓`);
        setTimeout(() => setPublishMessage(null), 5000);
      }

    } catch (err: any) {
      console.error('Upload (meta) Error:', err);
      setError(err.message || 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  // Download and decrypt file
  // Attempt to decrypt & download a specific cid (prefers Lit-decrypted symmetric key)
  const handleDownloadCid = async (cidToDownload?: string) => {
    const targetCid = cidToDownload || cid;
    if (!targetCid || !address) return;

    setLoading(true);
    setError(null);

    try {
      const { signedMessage, publicKey } = await getAuthSignature();

      // First, try to find stored Lit metadata for this CID
      const stored = JSON.parse(localStorage.getItem('lighthouse_uploads') || '[]') as Array<any>;
      const record = stored.find(r => r.cid === targetCid);

      // If we have Lit metadata, try to get the symmetric key from Lit
      // Try all encryptedSymmetricKeys entries (new format). Each entry may correspond to an ACC.
      const encryptedEntries: Array<any> = [];
      if (record?.encryptedSymmetricKeys && Array.isArray(record.encryptedSymmetricKeys)) {
        for (const e of record.encryptedSymmetricKeys) encryptedEntries.push(e);
      } else if (record?.encryptedSymmetricKey) {
        encryptedEntries.push({ key: record.encryptedSymmetricKey, accessControlConditions: record.accessControlConditions });
      }

      for (const entry of encryptedEntries) {
        try {
          const lit = await initLit();
          const authSig = { sig: signedMessage, derivedVia: 'web3', signedMessage, address: publicKey };
          const decryptedSymmetricKey = await lit.getEncryptionKey({
            accessControlConditions: entry.accessControlConditions,
            toDecrypt: entry.key,
            authSig,
            chain: 'ethereum',
          });
          if (decryptedSymmetricKey) {
            // Use Lighthouse decrypt helper with the symmetric key
            const decrypted = await lighthouse.decryptFile(targetCid, decryptedSymmetricKey as any);
            const url = URL.createObjectURL(decrypted);
            const a = document.createElement('a');
            a.href = url;
            a.download = `decrypted_${targetCid}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            setLoading(false);
            return;
          }
        } catch (litErr: any) {
          console.warn('Lit decryption attempt failed for one key, trying next if any:', litErr);
        }
      }

      // Fallback: use Lighthouse server-side fetchEncryptionKey+decryptFile flow
      const keyRes = await lighthouse.fetchEncryptionKey(targetCid, publicKey, signedMessage);
      const fileKey = keyRes?.data?.key;
      if (!fileKey) throw new Error('No decryption key returned');
      const decrypted = await lighthouse.decryptFile(targetCid, fileKey as string);
      const url = URL.createObjectURL(decrypted);
      const a = document.createElement('a');
      a.href = url;
      a.download = `decrypted_${targetCid}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

    } catch (err: any) {
      console.error('Download Error:', err);
      setError(err.message || 'Decryption failed');
    } finally {
      setLoading(false);
    }
  };

  // Share (grant) access to another wallet address by saving a new encrypted symmetric key for them in Lit
  const handleShare = async (cidToShare: string, targetAddress: string) => {
    setShareError(prev => ({ ...prev, [cidToShare]: '' }));
    setShareLoading(prev => ({ ...prev, [cidToShare]: true }));

    try {
      if (!targetAddress || !/^0x[a-fA-F0-9]{40}$/.test(targetAddress)) {
        throw new Error('Invalid target address');
      }

      const { signedMessage, publicKey } = await getAuthSignature();

      // Fetch symmetric key from Lighthouse (uploader must be the signer)
      const keyResp = await lighthouse.fetchEncryptionKey(cidToShare, publicKey, signedMessage);
      const symmetricKey = keyResp?.data?.key;
      if (!symmetricKey) throw new Error('No symmetric key returned from Lighthouse');

      // Build ACC for the target address
      const accessControlConditions = [
        {
          contractAddress: '',
          standardContractType: '',
          chain: 'ethereum',
          method: '',
          parameters: [':userAddress'],
          returnValueTest: {
            comparator: '=',
            value: targetAddress,
          },
        },
      ];

      const lit = await initLit();
      const authSig = { sig: signedMessage, derivedVia: 'web3', signedMessage, address: publicKey };

      const encryptedSymmetricKey = await lit.saveEncryptionKey({
        accessControlConditions,
        symmetricKey,
        authSig,
        chain: 'ethereum',
      });

      // Update localStorage record: append to encryptedSymmetricKeys
      const raw = JSON.parse(localStorage.getItem('lighthouse_uploads') || '[]') || [];
      const updated = raw.map((r: any) => {
        if (r.cid !== cidToShare) return r;
        const existing = r.encryptedSymmetricKeys || [];
        existing.push({ key: encryptedSymmetricKey, accessControlConditions });
        return { ...r, encryptedSymmetricKeys: existing };
      });
      localStorage.setItem('lighthouse_uploads', JSON.stringify(updated));
      setUploads(updated);
      setShareInputs(prev => ({ ...prev, [cidToShare]: '' }));
    } catch (err: any) {
      console.error('Share Error:', err);
      setShareError(prev => ({ ...prev, [cidToShare]: err.message || String(err) }));
    } finally {
      setShareLoading(prev => ({ ...prev, [cidToShare]: false }));
    }
  };

  return (
    <div style={{ 
      maxWidth: 500, 
      margin: "2rem auto", 
      padding: 24, 
      border: "1px solid #e5e7eb", 
      borderRadius: 12,
      backgroundColor: '#ffffff',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
    }}>
      <h2 style={{ marginTop: 0, color: '#1f2937' }}>Lighthouse Encrypted Upload</h2>
      
      {!isConnected && (
        <div style={{ 
          padding: 12, 
          backgroundColor: '#fef3c7', 
          color: '#92400e', 
          borderRadius: 6,
          marginBottom: 16 
        }}>
          ⚠️ Connect your wallet to use Lighthouse
        </div>
      )}
      
      {/* API Key Generation */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 16, marginBottom: 8 }}>Step 1: Generate API Key</h3>
        <button 
          onClick={handleGenerateApiKey}
          disabled={!isConnected || apiKeyLoading}
          style={{
            width: '100%',
            padding: '10px 16px',
            backgroundColor: isConnected && !apiKeyLoading ? '#3b82f6' : '#9ca3af',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: isConnected && !apiKeyLoading ? 'pointer' : 'not-allowed',
            fontSize: 14,
            fontWeight: 500
          }}
        >
          {apiKeyLoading ? "Generating..." : "Generate API Key"}
        </button>
        
        {apiKey && (
          <div style={{ 
            marginTop: 12, 
            padding: 12, 
            backgroundColor: '#f0fdf4', 
            borderRadius: 6,
            wordBreak: 'break-all',
            fontSize: 12
          }}>
            <strong style={{ color: '#15803d' }}>✓ API Key Generated</strong>
            <div style={{ marginTop: 4, color: '#166534', fontFamily: 'monospace' }}>
              {apiKey}
            </div>
          </div>
        )}
      </div>
      
      {/* File Upload */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 16, marginBottom: 8 }}>Step 2: Upload File</h3>
        <input 
          type="file" 
          ref={fileInputRef} 
          disabled={!isConnected || loading || !apiKey}
          style={{ 
            marginBottom: 12, 
            width: '100%',
            padding: 8,
            border: '1px solid #d1d5db',
            borderRadius: 6
          }}
        />
        <button 
          onClick={handleUpload}
          disabled={!isConnected || loading || !apiKey}
          style={{
            width: '100%',
            padding: '10px 16px',
            backgroundColor: isConnected && !loading && apiKey ? '#10b981' : '#9ca3af',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: isConnected && !loading && apiKey ? 'pointer' : 'not-allowed',
            fontSize: 14,
            fontWeight: 500
          }}
        >
          {loading ? "Uploading..." : "🔒 Encrypt & Upload"}
        </button>
        {publishMessage && (
          <div style={{ marginTop: 12, padding: 12, backgroundColor: '#ecfeff', color: '#075985', borderRadius: 6 }}>
            {publishMessage}
            <button
              style={{ marginLeft: 12, padding: '6px 8px' }}
              onClick={() => {
                if (cid) {
                  window.dispatchEvent(new CustomEvent('navigate', { detail: { view: 'dashboard' } }));
                  window.dispatchEvent(new CustomEvent('focus-agent', { detail: { cid } }));
                }
              }}
            >
              View on Dashboard
            </button>
          </div>
        )}
      </div>
      
      {/* Download */}
      {uploads.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 16, marginBottom: 8 }}>Saved Uploads</h3>
          {isConnected ? (
            // show only uploads owned by connected wallet
            uploads.filter((u: any) => String(u.owner || '').toLowerCase() === String(address || '').toLowerCase()).map((u: any, i: number) => (
              <div key={i} style={{ padding: 12, border: '1px solid #e6edf6', borderRadius: 8, marginBottom: 8 }}>
                <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', fontSize: 12 }}><strong>CID:</strong> {u.cid}</div>
                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                  <button onClick={() => handleDownloadCid(u.cid)} disabled={loading} style={{ padding: '8px 12px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: 6 }}>Decrypt & Download</button>
                  <button onClick={() => { navigator.clipboard.writeText(u.cid); }} style={{ padding: '8px 12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: 6 }}>Copy CID</button>
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input value={shareInputs[u.cid] || ''} onChange={(e) => setShareInputs(prev => ({ ...prev, [u.cid]: e.target.value }))} placeholder='0xAddress to share with' style={{ padding: 8, border: '1px solid #d1d5db', borderRadius: 6, width: '60%' }} />
                  <button onClick={() => handleShare(u.cid, shareInputs[u.cid] || '')} disabled={!!shareLoading[u.cid]} style={{ padding: '8px 12px', background: '#10b981', color: 'white', border: 'none', borderRadius: 6 }}>{shareLoading[u.cid] ? 'Sharing...' : 'Share'}</button>
                </div>
                {shareError[u.cid] && <div style={{ marginTop: 8, color: '#991b1b' }}>{shareError[u.cid]}</div>}
              </div>
            ))
          ) : (
            <div style={{ color: '#6b7280' }}>Connect wallet to view your saved uploads.</div>
          )}
        </div>
      )}
      
      {/* Error Message */}
      {error && (
        <div style={{
          padding: 12,
          backgroundColor: '#fee2e2',
          color: '#991b1b',
          borderRadius: 6,
          marginBottom: 12
        }}>
          {error}
        </div>
      )}

      {/* Show last uploaded CID (if any) */}
      {cid && (
        <div style={{ marginTop: 8, fontSize: 13, color: '#374151', wordBreak: 'break-all' }}>
          <strong>Last CID:</strong> {cid}
          <div style={{ marginTop: 8 }}>
            <button onClick={() => handleDownloadCid(cid)} disabled={loading} style={{ padding: '8px 12px', background: '#06b6d4', color: 'white', border: 'none', borderRadius: 6 }}>Download Last</button>
          </div>
        </div>
      )}

    </div>
  );
};

export default LighthouseUploader;