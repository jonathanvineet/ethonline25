import React, { useState, useRef } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import lighthouse from '@lighthouse-web3/sdk';
import { saveKeyToLit, getKeyFromLit, createLitAuthSig } from './lib/litHelpers';
import { ethers } from 'ethers';

const LighthouseUploader: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  // walletClient intentionally not used; we derive signer from window.ethereum when needed
  const [cid, setCid] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string>('');
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const contractFileRef = useRef<HTMLInputElement>(null);
  const agentFileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number>(0);
  const [stageMessage, setStageMessage] = useState<string | null>(null);
  
  const [uploads, setUploads] = useState<Array<any>>([]);
  const [expandedUploads, setExpandedUploads] = useState<Record<string, boolean>>({});
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const [shareInputs, setShareInputs] = useState<Record<string, string>>({});
  const [shareLoading, setShareLoading] = useState<Record<string, boolean>>({});
  const [shareError, setShareError] = useState<Record<string, string>>({});
  const [devTarget, setDevTarget] = useState<string>('');
  const [devRunning, setDevRunning] = useState(false);

  // Normalize address to lowercase for consistency
  const normalizeAddress = (addr: string) => String(addr).toLowerCase();

  // Load stored uploads from localStorage on mount
  React.useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('lighthouse_uploads') || '[]');
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

  React.useEffect(() => {
    const handler = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail as any;
        if (detail?.cid) {
          handleRetryPersist(detail.cid);
        }
      } catch (err) {
        console.warn('retry-persist-key handler error', err);
      }
    };
    window.addEventListener('retry-persist-key', handler as EventListener);
    return () => window.removeEventListener('retry-persist-key', handler as EventListener);
  }, [apiKey]);

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
    console.debug('[LighthouseUploader] getVerificationMessage start', { publicKey });
    const response = await fetch(`https://api.lighthouse.storage/api/auth/get_message?publicKey=${publicKey}`);
    if (!response.ok) {
      console.error('[LighthouseUploader] getVerificationMessage HTTP error', { status: response.status });
      throw new Error(`Failed to get verification message: ${response.status}`);
    }
    const data = await response.json();
    // Lighthouse may return { data: { message } } or { message } or string
    if (data?.data?.message) return data.data.message;
    if (data?.message) return data.message;
    if (typeof data === 'string') return data;
    console.error('[LighthouseUploader] getVerificationMessage unexpected format', { data });
    throw new Error('Unexpected verification message format');
  };

  // Helper to fetch encryption key with retry logic
  const fetchEncryptionKeyWithRetry = async (
    cid: string,
    publicKey: string,
    signedMessage: string,
    authMessage?: string,
    maxAttempts = 5,
    delayMs = 2000
  ) => {
    let lastError: any = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.debug('[LighthouseUploader] fetchEncryptionKey attempt start', { attempt, maxAttempts, cid });
        // Pre-flight: if we have the authMessage, verify the signedMessage recovers to the provided publicKey
        try {
          if (authMessage) {
            console.debug('[LighthouseUploader] pre-flight verify signature', { authMessagePresent: !!authMessage, publicKey });
            const recovered = String(ethers.verifyMessage(authMessage, signedMessage) || '');
            console.debug('[LighthouseUploader] pre-flight recovered address', { recovered });
            if (!recovered || normalizeAddress(recovered) !== normalizeAddress(publicKey)) {
              throw new Error(`Local signature verification mismatch: expected ${publicKey} but recovered ${recovered}`);
            }
            console.debug('[LighthouseUploader] pre-flight signature verified OK');
          }
        } catch (localVErr) {
          console.warn('[LighthouseUploader] Local pre-flight signature verification failed, will attempt to refresh signature before calling Lighthouse', (localVErr as any)?.message || localVErr);
          // Try to refresh signature immediately
          if (attempt < maxAttempts) {
            try {
              const fresh = await getAuthSignature();
              publicKey = fresh.publicKey;
              signedMessage = fresh.signedMessage;
              authMessage = fresh.authMessage;
              console.debug('[LighthouseUploader] refreshed auth signature during pre-flight', { publicKey });
            } catch (sigErr) {
              console.warn('[LighthouseUploader] Failed to refresh signature during pre-flight', sigErr);
            }
            const waitTime = delayMs * attempt;
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }
        console.debug('[LighthouseUploader] calling lighthouse.fetchEncryptionKey', { cid, publicKey });
        const keyResp = await lighthouse.fetchEncryptionKey(cid, publicKey, signedMessage);
        if (keyResp?.data?.key) {
          console.info('[LighthouseUploader] fetchEncryptionKey success', { attempt, cid });
          return keyResp;
        }
        console.warn('[LighthouseUploader] fetchEncryptionKey returned no key', { keyResp });
        throw new Error('No key in response');
      } catch (err: any) {
  lastError = err;
  console.warn('[LighthouseUploader] fetchEncryptionKey attempt failed', { attempt, err: (err && err.message) || err });
        // If it's a 406 or contains address mismatch marker, try to refresh the auth signature
        const msg = String(err?.message || '');
        if (msg.includes('===') || err?.statusCode === 406 || msg.toLowerCase().includes('address mismatch')) {
          console.debug('[LighthouseUploader] Detected address/signature mismatch from Lighthouse. Will attempt to refresh signature and retry.');
          if (attempt < maxAttempts) {
            try {
              // Re-acquire a fresh signature & publicKey from the wallet
              const fresh = await getAuthSignature();
              // update the publicKey and signedMessage used for subsequent retries
              publicKey = fresh.publicKey;
              signedMessage = fresh.signedMessage;
              console.debug('[LighthouseUploader] Obtained fresh auth signature for retry', { publicKey });
            } catch (sigErr) {
              console.warn('[LighthouseUploader] Failed to obtain fresh signature during retry flow', (sigErr as any)?.message || sigErr);
            }

            const waitTime = delayMs * attempt; // backoff
            console.debug(`[LighthouseUploader] Waiting ${waitTime}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
        }
        if (attempt === maxAttempts) throw err;
      }
    }
    throw lastError || new Error('Failed to fetch encryption key after retries');
  };

  // Rent contract address may be configured via VITE_RENT_AGENT_ADDRESS

  // CRITICAL FIX: Use wallet client's account to ensure consistency
  const getAuthSignature = async () => {
    console.debug('[LighthouseUploader] getAuthSignature start');
    if (!address) throw new Error("Wallet not connected");
    if (!(window as any).ethereum) throw new Error('Wallet provider not available (window.ethereum missing)');

    const provider = new ethers.BrowserProvider((window as any).ethereum);
    const signer = await provider.getSigner();
    const signerAddress = await signer.getAddress();

    console.debug('[LighthouseUploader] Wallet check', {
      useAccountAddress: address,
      signerAddress,
      match: normalizeAddress(address) === normalizeAddress(signerAddress)
    });

    if (normalizeAddress(address) !== normalizeAddress(signerAddress)) {
      throw new Error(
        `Address mismatch: useAccount reports ${address} but wallet will sign with ${signerAddress}. ` +
        `Please ensure only one account is connected in your wallet.`
      );
    }

    // Create a Lit SIWE authSig (used for Lit operations)
     const litAuthSig = await createLitAuthSig(signer, signerAddress); // Include litAuthSig

    // Also fetch Lighthouse-specific auth message + signature for Lighthouse API calls
    const authMessageResponse = await lighthouse.getAuthMessage(signerAddress);
    if (!authMessageResponse?.data?.message) throw new Error('Failed to get auth message from Lighthouse');
    const lighthouseMessage = authMessageResponse.data.message;
    const lighthouseSigned = await signer.signMessage(lighthouseMessage);

    // return both lighthouse and lit auth pieces; keep signedMessage/authMessage keys for
    // backwards compatibility with earlier code paths that expect them (signedMessage -> lighthouseSigned)
    return {
      lighthouseSignedMessage: lighthouseSigned,
      signedMessage: lighthouseSigned,
      publicKey: signerAddress,
      lighthouseAuthMessage: lighthouseMessage,
      authMessage: lighthouseMessage,
      litAuthSig
    };
  };

  const handleGenerateApiKey = async () => {
    console.debug('[LighthouseUploader] handleGenerateApiKey start');
    setApiKeyLoading(true);
    setError(null);
    
    try {
      if (!address) throw new Error("Wallet not connected");
      // Derive signer address from injected provider (avoid relying on useWalletClient)
      if (!(window as any).ethereum) throw new Error('Wallet provider not available (window.ethereum missing)');
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();
      
  const verificationMessage = await getVerificationMessage(signerAddress);
  console.debug('[LighthouseUploader] verificationMessage fetched', { snippet: String(verificationMessage).slice(0, 120) });
      
      const signedMessage = await signMessageAsync({ 
        message: verificationMessage
      });
      
      console.log('Public Key (signer):', signerAddress);
      console.log('Signed Message:', signedMessage);
      
  console.debug('[LighthouseUploader] calling lighthouse.getApiKey', { signerAddress });
  const response = await lighthouse.getApiKey(signerAddress, signedMessage);
      
      console.log('API Key Response:', response);
      
      if (!response?.data?.apiKey) {
        throw new Error("Failed to generate API key - no key returned");
      }
      
  setApiKey(response.data.apiKey);
  console.info('[LighthouseUploader] API key generated', { keySnippet: response.data.apiKey?.slice?.(0, 12) + '...' });
      
    } catch (err: any) {
      console.error('API Key Generation Error:', err);
      setError(err.message || "API key generation failed");
    } finally {
      setApiKeyLoading(false);
    }
  };

  

  const handleUploadWithMeta = async (file: File, meta: any) => {
    setError(null);
    setCid(null);
    setLoading(true);
    setPublishMessage(null);
    setStageMessage('Preparing upload...');
    setProgress(5);

    try {
      if (!file) throw new Error('No file provided');
      if (!apiKey) throw new Error('Lighthouse API key required. Generate one above.');

      const { lighthouseSignedMessage, publicKey, lighthouseAuthMessage, litAuthSig } = await getAuthSignature();
      setStageMessage('Encrypting files...');
      setProgress(15);
      console.info('[LighthouseUploader] handleUploadWithMeta start', { 
        file: file.name, 
        meta, 
        address: publicKey,
        addressNormalized: normalizeAddress(publicKey)
      });
      setStageMessage('Uploading to Lighthouse...');
      setProgress(40);
      const output = await lighthouse.uploadEncrypted([file], apiKey, publicKey, lighthouseSignedMessage);
      console.debug('[LighthouseUploader] uploadWithMeta response', output);
      if (!output?.data?.[0]?.Hash) throw new Error('Upload succeeded but no CID returned');
  const cidResult = output.data[0].Hash;
  setCid(cidResult);
  console.info('[LighthouseUploader] uploadWithMeta got CID', { cidResult });

    setStageMessage('Retrieving symmetric key from Lighthouse...');
    setProgress(60);

      window.dispatchEvent(new CustomEvent('navigate', { detail: { view: 'dashboard' } }));
      window.dispatchEvent(new CustomEvent('focus-agent', { detail: { cid: cidResult } }));

      // If the uploader provided a price and a RentAgent contract is configured,
      // register this CID on-chain so renters can call rentAgent(cid) successfully.
      try {
        const rentContractAddress = (import.meta.env.VITE_RENT_AGENT_ADDRESS as string) || '';
        const rawPrice = meta?.price || meta?.price === 0 ? String(meta.price) : '';
        if (rentContractAddress && rawPrice) {
          try {
            const provider = new ethers.BrowserProvider((window as any).ethereum);
            const signer = await provider.getSigner();
            const abi = ['function uploadAgent(string cid, uint256 price)'];
            const contract = new ethers.Contract(rentContractAddress, abi, signer);
            const priceWei = ethers.parseEther(rawPrice);
            console.debug('[LighthouseUploader] registering agent on-chain', { rentContractAddress, cid: cidResult, price: rawPrice });
            const tx = await contract.uploadAgent(cidResult, priceWei);
              const receipt = await tx.wait();
              console.info('[LighthouseUploader] uploadAgent registered on-chain', { cid: cidResult, txHash: tx.hash, receipt });
              setPublishMessage(`Agent registered on-chain ✓`);
              // persist tx hash into local record for UI
              try {
                // Will persist later when record is saved; for now attach a pendingTxHash marker
                // (owner's subsequent reload will show it once record is saved)
                (window as any).__lastUploadAgentTx = tx.hash;
              } catch (e) { console.warn('failed to persist uploadAgent tx marker', e); }
            setTimeout(() => setPublishMessage(null), 4000);
          } catch (onchainErr) {
            console.warn('[LighthouseUploader] failed to register agent on-chain (non-fatal)', onchainErr);
            // proceed — Lit persistence and local metadata should still be saved
          }
        }
      } catch (e) {
        // swallow any unexpected errors here to avoid breaking the upload flow
        console.warn('[LighthouseUploader] unexpected error while attempting on-chain registration', e);
      }

      try {
        const publicKeyLower = normalizeAddress(publicKey);
        const rentContractAddress = (import.meta.env.VITE_RENT_AGENT_ADDRESS as string) || '';
        let accessControlConditions: any[];
        if (rentContractAddress) {
          accessControlConditions = [
            {
              contractAddress: '',
              standardContractType: '',
              chain: 'ethereum',
              method: '',
              parameters: [':userAddress'],
              returnValueTest: { comparator: '=', value: publicKeyLower },
            },
            {
              contractAddress: rentContractAddress,
              standardContractType: '',
              chain: 'ethereum',
              method: 'isRenter',
              parameters: [cidResult, ':userAddress'],
              returnValueTest: { comparator: '=', value: 'true' },
            },
          ];
        } else {
          accessControlConditions = [
            {
              contractAddress: '',
              standardContractType: '',
              chain: 'ethereum',
              method: '',
              parameters: [':userAddress'],
              returnValueTest: { comparator: '=', value: publicKeyLower },
            },
          ];
        }
    const keyResp = await fetchEncryptionKeyWithRetry(cidResult, publicKey, lighthouseSignedMessage, lighthouseAuthMessage);
        console.debug('[LighthouseUploader] uploadWithMeta fetchEncryptionKey response', keyResp);
        const symmetricKey = keyResp?.data?.key;
        console.debug('[LighthouseUploader] uploadWithMeta fetched symmetric key present?', !!symmetricKey);
        if (!symmetricKey) throw new Error('No symmetric key returned from Lighthouse to store in Lit');


        const authSig = litAuthSig;
        console.debug('[LighthouseUploader] uploadWithMeta saveKeyToLit authSig.address', authSig.address);

        setStageMessage('Saving key to Lit Protocol...');
        setProgress(75);
        let encryptedSymmetricKey: string | null = null;
        let lastLitError: string | null = null;
        try {
          encryptedSymmetricKey = await saveKeyToLit(symmetricKey, accessControlConditions, authSig, 3);
          console.debug('[LighthouseUploader] uploadWithMeta lit.saveEncryptionKey hasKey?', !!encryptedSymmetricKey);
        } catch (e: any) {
          lastLitError = e?.message || String(e);
          console.warn('[LighthouseUploader] uploadWithMeta saveKeyToLit failed; persisting metadata with litPersisted=false', lastLitError);
        }

        const pendingTxHash = (window as any).__lastUploadAgentTx || null;
        if ((window as any).__lastUploadAgentTx) delete (window as any).__lastUploadAgentTx;
        const record: any = {
          cid: cidResult,
          owner: publicKeyLower,
          title: meta.title || '',
          description: meta.description || '',
          category: meta.category || '',
          accessType: meta.accessType || '',
          price: meta.price || '',
          litPersisted: !!encryptedSymmetricKey,
          txHash: pendingTxHash,
          lastLitError: lastLitError || null
        };
        if (encryptedSymmetricKey) {
          record.encryptedSymmetricKeys = [{ key: encryptedSymmetricKey, accessControlConditions }];
        }

        const storedRaw = JSON.parse(localStorage.getItem('lighthouse_uploads') || '[]') || [];
        storedRaw.push(record);
        localStorage.setItem('lighthouse_uploads', JSON.stringify(storedRaw));
        setUploads(storedRaw);
        console.info('[LighthouseUploader] persisted record (meta)', { cid: cidResult, owner: record.owner, title: record.title });
        window.dispatchEvent(new CustomEvent('uploads-updated'));

        setStageMessage('Finalizing...');
        setProgress(95);
        setPublishMessage(`Agent "${record.title || cidResult}" published ✓`);
        setTimeout(() => setPublishMessage(null), 5000);
      } catch (litErr: any) {
        console.warn('Lit integration failed for upload-with-meta:', litErr);
        const record = { 
          cid: cidResult, 
          owner: normalizeAddress(publicKey), 
          title: meta.title || '', 
          description: meta.description || '', 
          category: meta.category || '', 
          accessType: meta.accessType || '', 
          price: meta.price || '',
          litPersisted: false,
          lastLitError: litErr?.message || String(litErr)
        };
        const storedRaw = JSON.parse(localStorage.getItem('lighthouse_uploads') || '[]') || [];
        storedRaw.push(record);
        localStorage.setItem('lighthouse_uploads', JSON.stringify(storedRaw));
        setUploads(storedRaw);
        window.dispatchEvent(new CustomEvent('uploads-updated'));
        setPublishMessage(`Agent "${record.title || cidResult}" published (no Lit key persisted) ✓`);
        setError(`Lit integration failed: ${litErr?.message || String(litErr)} — key not persisted`);
        setTimeout(() => setPublishMessage(null), 5000);
      }
    } catch (err: any) {
      console.error('Upload (meta) Error:', err);
      setError(err.message || 'Upload failed');
    } finally {
      setLoading(false);
      setStageMessage(null);
      setProgress(0);
    }
  };

  const handleDownloadCid = async (cidToDownload?: string) => {
    const targetCid = cidToDownload || cid;
    if (!targetCid || !address) return;

    setLoading(true);
    setError(null);

    try {
  const { signedMessage, publicKey, authMessage, litAuthSig } = await getAuthSignature();
      console.info('[LighthouseUploader] handleDownloadCid start', { 
        targetCid, 
        requester: publicKey,
        requesterNormalized: normalizeAddress(publicKey)
      });

      const stored = JSON.parse(localStorage.getItem('lighthouse_uploads') || '[]') as Array<any>;
      const record = stored.find(r => r.cid === targetCid);
      console.debug('[LighthouseUploader] download record snapshot', record);

      const encryptedEntries: Array<any> = [];
      if (record?.encryptedSymmetricKeys && Array.isArray(record.encryptedSymmetricKeys)) {
        for (const e of record.encryptedSymmetricKeys) encryptedEntries.push(e);
      } else if (record?.encryptedSymmetricKey) {
        encryptedEntries.push({ key: record.encryptedSymmetricKey, accessControlConditions: record.accessControlConditions });
      }

      for (const entry of encryptedEntries) {
          try {
          const authSig = litAuthSig || { 
            sig: signedMessage, 
            derivedVia: 'web3', 
            signedMessage: authMessage, 
            address: normalizeAddress(publicKey) 
          };
          console.debug('[LighthouseUploader] attempting getKeyFromLit for entry', { 
            hasAccessControl: !!entry?.accessControlConditions,
            authSigAddress: authSig.address
          });
          const decryptedSymmetricKey = await getKeyFromLit(entry.key, entry.accessControlConditions || null, authSig);
          console.debug('[LighthouseUploader] getKeyFromLit result present?', !!decryptedSymmetricKey);
          if (decryptedSymmetricKey) {
            // client-side decrypt
            const { decryptIpfsFile } = await import('./lib/cryptoHelpers');
            const decrypted = await decryptIpfsFile(targetCid, decryptedSymmetricKey as any);
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
          try {
            // persist diagnostic info for this upload so owner can inspect node error
            const storedRaw = JSON.parse(localStorage.getItem('lighthouse_uploads') || '[]') || [];
            const updated = storedRaw.map((r: any) => {
              if (r.cid !== targetCid) return r;
              const diag = litErr?.response?.data || litErr?.message || String(litErr);
              return { ...r, lastLitError: typeof diag === 'string' ? diag : JSON.stringify(diag) };
            });
            localStorage.setItem('lighthouse_uploads', JSON.stringify(updated));
            setUploads(updated);
          } catch (persistErr) {
            console.warn('Failed to persist Lit diagnostic info to localStorage', persistErr);
          }
        }
      }

      throw new Error('No Lit-encrypted symmetric keys available or decryption failed. The uploader needs to persist the key to Lit.');

    } catch (err: any) {
      console.error('Download Error:', err);
      setError(err.message || 'Decryption failed');
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async (cidToShare: string, targetAddress: string) => {
    setShareError(prev => ({ ...prev, [cidToShare]: '' }));
    setShareLoading(prev => ({ ...prev, [cidToShare]: true }));

    try {
      if (!targetAddress || !/^0x[a-fA-F0-9]{40}$/.test(targetAddress)) {
        throw new Error('Invalid target address');
      }

  const { signedMessage, publicKey, authMessage, litAuthSig } = await getAuthSignature();
      console.info('[LighthouseUploader] handleShare start', { 
        cidToShare, 
        targetAddress, 
        owner: publicKey,
        ownerNormalized: normalizeAddress(publicKey)
      });

  const keyResp = await fetchEncryptionKeyWithRetry(cidToShare, publicKey, signedMessage, authMessage);
      const symmetricKey = keyResp?.data?.key;
      console.debug('[LighthouseUploader] handleShare fetched symmetricKey present?', !!symmetricKey);
      if (!symmetricKey) throw new Error('No symmetric key returned from Lighthouse');

      const targetLower = normalizeAddress(targetAddress);
      const accessControlConditions = [
        {
          contractAddress: '',
          standardContractType: '',
          chain: 'ethereum',
          method: '',
          parameters: [':userAddress'],
          returnValueTest: {
            comparator: '=',
            value: targetLower,
          },
        },
      ];

      const authSig = litAuthSig || { 
        sig: signedMessage, 
        derivedVia: 'web3', 
        signedMessage: authMessage, 
        address: normalizeAddress(publicKey) 
      };
      const encryptedSymmetricKey = await saveKeyToLit(symmetricKey, accessControlConditions, authSig, 3);

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

  const handleRetryPersist = async (cidToRetry: string) => {
    setError(null);
    setLoading(true);
    try {
      if (!apiKey) throw new Error('Lighthouse API key required to fetch encryption key');
  const { signedMessage, publicKey, authMessage, litAuthSig } = await getAuthSignature();
      const publicKeyLower = normalizeAddress(publicKey);
      console.info('[LighthouseUploader] retryPersist start', { cidToRetry, owner: publicKeyLower });
  const keyResp = await fetchEncryptionKeyWithRetry(cidToRetry, publicKey, signedMessage, authMessage);
      console.debug('[LighthouseUploader] retryPersist fetchEncryptionKey', keyResp);
      const symmetricKey = keyResp?.data?.key;
      if (!symmetricKey) throw new Error('No symmetric key returned from Lighthouse when retrying');

      // Build accessControlConditions: owner OR RentAgent.isRenter(cid, user) when rent contract configured
      const rentContractAddress = (import.meta.env.VITE_RENT_AGENT_ADDRESS as string) || '';
      let accessControlConditions: any[];
      if (rentContractAddress) {
        accessControlConditions = [
          {
            contractAddress: '',
            standardContractType: '',
            chain: 'ethereum',
            method: '',
            parameters: [':userAddress'],
            returnValueTest: { comparator: '=', value: publicKeyLower },
          },
          {
            contractAddress: rentContractAddress,
            standardContractType: '',
            chain: 'ethereum',
            method: 'isRenter',
            parameters: [cidToRetry, ':userAddress'],
            returnValueTest: { comparator: '=', value: 'true' },
          },
        ];
      } else {
        accessControlConditions = [
          {
            contractAddress: '',
            standardContractType: '',
            chain: 'ethereum',
            method: '',
            parameters: [':userAddress'],
            returnValueTest: { comparator: '=', value: publicKeyLower },
          },
        ];
      }

  const authSig = litAuthSig || { sig: signedMessage, derivedVia: 'web3', signedMessage: authMessage, address: publicKeyLower };
      const encryptedSymmetricKey = await saveKeyToLit(symmetricKey, accessControlConditions, authSig, 3);
      console.debug('[LighthouseUploader] retryPersist saveKeyToLit result present?', !!encryptedSymmetricKey);

      const storedRaw = JSON.parse(localStorage.getItem('lighthouse_uploads') || '[]') || [];
      const updated = storedRaw.map((r: any) => {
        if (r.cid !== cidToRetry) return r;
        const existing = r.encryptedSymmetricKeys || [];
        if (encryptedSymmetricKey) existing.push({ key: encryptedSymmetricKey, accessControlConditions });
        return { ...r, encryptedSymmetricKeys: existing, litPersisted: !!encryptedSymmetricKey };
      });
      localStorage.setItem('lighthouse_uploads', JSON.stringify(updated));
      setUploads(updated);
      window.dispatchEvent(new CustomEvent('uploads-updated'));
      setPublishMessage('Key persisted to Lit ✓');
      setTimeout(() => setPublishMessage(null), 5000);
    } catch (err: any) {
      console.error('Retry Persist Error:', err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
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
      
      {isConnected && !(window as any).ethereum && (
        <div style={{ 
          padding: 12, 
          backgroundColor: '#dbeafe', 
          color: '#1e40af', 
          borderRadius: 6,
          marginBottom: 16 
        }}>
          🔄 Loading wallet client...
        </div>
      )}
      
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
          {apiKeyLoading ? 'Generating...' : 'Generate API Key'}
        </button>

        {apiKey && (
          <div style={{ marginTop: 12, padding: 12, backgroundColor: '#f0fdf4', borderRadius: 6, wordBreak: 'break-all', fontSize: 12 }}>
            <strong style={{ color: '#15803d' }}>✓ API Key Generated</strong>
            <div style={{ marginTop: 4, color: '#166534', fontFamily: 'monospace' }}>{apiKey}</div>
          </div>
        )}

        <h3 style={{ fontSize: 16, marginTop: 20, marginBottom: 8 }}>Step 2: Upload Agent</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          <input placeholder='Agent Name' value={agentName} onChange={e => setAgentName(e.target.value)} style={{ padding: 8, border: '1px solid #d1d5db', borderRadius: 6 }} />
          <textarea placeholder='Description' value={description} onChange={e => setDescription(e.target.value)} style={{ padding: 8, border: '1px solid #d1d5db', borderRadius: 6 }} />
          <select value={category} onChange={e => setCategory(e.target.value)} style={{ padding: 8, border: '1px solid #d1d5db', borderRadius: 6 }}>
            <option value=''>Select category</option>
            <option value='AI'>AI</option>
            <option value='Analytics'>Analytics</option>
            <option value='Tools'>Tools</option>
            <option value='Other'>Other</option>
          </select>
          <input placeholder='Price (ETH)' value={price} onChange={e => setPrice(e.target.value)} style={{ padding: 8, border: '1px solid #d1d5db', borderRadius: 6 }} />

          <label style={{ fontSize: 13, color: '#374151' }}>Smart Contract File (.sol/.json)</label>
          <input type='file' ref={contractFileRef} disabled={!isConnected || loading || !apiKey} style={{ padding: 8 }} />

          <label style={{ fontSize: 13, color: '#374151' }}>Agent File (.zip, .py, .js, etc.)</label>
          <input type='file' ref={agentFileRef} disabled={!isConnected || loading || !apiKey} style={{ padding: 8 }} />

          <div style={{ fontSize: 13, color: '#6b7280' }}>
            {agentFileRef.current?.files?.[0] && <div>Agent: {agentFileRef.current.files[0].name} — {(agentFileRef.current.files[0].size / 1024).toFixed(1)} KB</div>}
            {contractFileRef.current?.files?.[0] && <div>Contract: {contractFileRef.current.files[0].name} — {(contractFileRef.current.files[0].size / 1024).toFixed(1)} KB</div>}
          </div>

          {stageMessage && <div style={{ padding: 8, background: '#eef2ff', borderRadius: 6 }}>{stageMessage}</div>}

          {progress > 0 && (
            <div style={{ height: 8, width: '100%', background: '#e6e6e6', borderRadius: 4 }}>
              <div style={{ width: `${progress}%`, height: '100%', background: '#4f46e5', borderRadius: 4 }} />
            </div>
          )}

          <button
            onClick={async () => {
              const meta: any = { title: agentName, description, category, price };
              const file = agentFileRef.current?.files?.[0];
              await handleUploadWithMeta(file as File, meta);
            }}
            disabled={!isConnected || loading || !apiKey}
            style={{ width: '100%', padding: '10px 16px', backgroundColor: isConnected && !loading && apiKey ? '#10b981' : '#9ca3af', color: 'white', border: 'none', borderRadius: 6, cursor: isConnected && !loading && apiKey ? 'pointer' : 'not-allowed', fontSize: 14, fontWeight: 500 }}
          >
            {loading ? (stageMessage || 'Processing...') : '🔒 Encrypt, Upload & Publish'}
          </button>
        </div>

        {publishMessage && (
          <div style={{ marginTop: 12, padding: 12, backgroundColor: '#ecfeff', color: '#075985', borderRadius: 6 }}>
            {publishMessage}
            <button style={{ marginLeft: 12, padding: '6px 8px' }} onClick={() => { if (cid) { window.dispatchEvent(new CustomEvent('navigate', { detail: { view: 'dashboard' } })); window.dispatchEvent(new CustomEvent('focus-agent', { detail: { cid } })); } }}>
              View on Dashboard
            </button>
          </div>
        )}
      </div>
      
      {uploads.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 16, marginBottom: 8 }}>Saved Uploads</h3>
          {isConnected ? (
            uploads.filter((u: any) => normalizeAddress(u.owner || '') === normalizeAddress(address || '')).map((u: any, i: number) => (
              <div key={i} style={{ padding: 12, border: '1px solid #e6edf6', borderRadius: 8, marginBottom: 8 }}>
                <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', fontSize: 12 }}><strong>CID:</strong> {u.cid}</div>
                {u.txHash && (
                  <div style={{ marginTop: 6, fontSize: 12 }}>
                    <strong>Upload Tx:</strong> <a href={`https://sepolia.etherscan.io/tx/${u.txHash}`} target='_blank' rel='noreferrer' style={{ color: '#3b82f6' }}>{u.txHash}</a>
                  </div>
                )}
                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                  <button onClick={() => handleDownloadCid(u.cid)} disabled={loading} style={{ padding: '8px 12px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: 6 }}>Decrypt & Download</button>
                  <button onClick={() => { navigator.clipboard.writeText(u.cid); }} style={{ padding: '8px 12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: 6 }}>Copy CID</button>
                </div>
                
                <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input value={shareInputs[u.cid] || ''} onChange={(e) => setShareInputs(prev => ({ ...prev, [u.cid]: e.target.value }))} placeholder='0xAddress to share with' style={{ padding: 8, border: '1px solid #d1d5db', borderRadius: 6, width: '60%' }} />
                  <button onClick={() => handleShare(u.cid, shareInputs[u.cid] || '')} disabled={!!shareLoading[u.cid]} style={{ padding: '8px 12px', background: '#10b981', color: 'white', border: 'none', borderRadius: 6 }}>{shareLoading[u.cid] ? 'Sharing...' : 'Share'}</button>
                  <button onClick={() => setExpandedUploads(prev => ({ ...prev, [u.cid]: !prev[u.cid] }))} style={{ padding: '8px 12px', background: '#94a3b8', color: 'white', border: 'none', borderRadius: 6 }}>{expandedUploads[u.cid] ? 'Hide Details' : 'Details'}</button>
                </div>
                {shareError[u.cid] && <div style={{ marginTop: 8, color: '#991b1b' }}>{shareError[u.cid]}</div>}
                {(!u.litPersisted) && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ marginBottom: 6, color: '#92400e', fontSize: 13 }}>Warning: key not yet persisted to Lit. Decryption will fail for others until you persist the key.</div>
                    <button onClick={() => handleRetryPersist(u.cid)} disabled={loading} style={{ padding: '6px 10px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: 6 }}>Retry Persist Key to Lit</button>
                  </div>
                )}
                {expandedUploads[u.cid] && (
                  <div style={{ marginTop: 8, padding: 8, background: '#f8fafc', borderRadius: 6 }}>
                    <div style={{ marginBottom: 6 }}><strong>Encrypted Symmetric Keys:</strong></div>
                    <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto', background: '#fff', padding: 8, borderRadius: 6 }}>{JSON.stringify(u.encryptedSymmetricKeys || u.encryptedSymmetricKey || [], null, 2)}</pre>
                    {u.txHash && (
                      <div style={{ marginTop: 6 }}><strong>Upload Tx:</strong> <a href={`https://sepolia.etherscan.io/tx/${u.txHash}`} target='_blank' rel='noreferrer'>{u.txHash}</a></div>
                    )}
                    {u.lastLitError && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontWeight: 600 }}>Last Lit Error (full):</div>
                        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto', background: '#fff7ed', padding: 8, borderRadius: 6 }}>{String(u.lastLitError)}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div style={{ color: '#6b7280' }}>Connect wallet to view your saved uploads.</div>
          )}
        </div>
      )}

      {/* Developer helper: persist all uploads for a target address (dev only) */}
      <div style={{ marginTop: 12, padding: 12, border: '1px dashed #e5e7eb', borderRadius: 8 }}>
        <h4 style={{ marginTop: 0, fontSize: 14 }}>Dev: Persist All For Address</h4>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={devTarget} onChange={(e) => setDevTarget(e.target.value)} placeholder='0xAddress to persist for (dev only)' style={{ padding: 8, border: '1px solid #d1d5db', borderRadius: 6, width: '60%' }} />
          <button onClick={async () => {
            if (!devTarget || !/^0x[a-fA-F0-9]{40}$/.test(devTarget)) { setError('Invalid dev target address'); return; }
            if (!apiKey) { setError('API key required'); return; }
            setDevRunning(true); setError(null);
            try {
              const { signedMessage, publicKey, authMessage, litAuthSig } = await getAuthSignature();
              for (const r of uploads) {
                try {
                  // fetch symmetric key from Lighthouse
                  const keyResp = await fetchEncryptionKeyWithRetry(r.cid, publicKey, signedMessage, authMessage);
                  const symmetricKey = keyResp?.data?.key;
                  if (!symmetricKey) { console.warn('No key for', r.cid); continue; }

                  const targetLower = devTarget.toLowerCase();
                  const accessControlConditions = [
                    {
                      contractAddress: '',
                      standardContractType: '',
                      chain: 'ethereum',
                      method: '',
                      parameters: [':userAddress'],
                      returnValueTest: { comparator: '=', value: targetLower },
                    },
                  ];
                  const authSig = litAuthSig || { sig: signedMessage, derivedVia: 'web3', signedMessage, address: normalizeAddress(publicKey) };
                  const encryptedSymmetricKey = await saveKeyToLit(symmetricKey, accessControlConditions, authSig, 3);
                  // persist into localStorage
                  const raw = JSON.parse(localStorage.getItem('lighthouse_uploads') || '[]') || [];
                  const updated = raw.map((item: any) => {
                    if (item.cid !== r.cid) return item;
                    const existing = item.encryptedSymmetricKeys || [];
                    existing.push({ key: encryptedSymmetricKey, accessControlConditions });
                    return { ...item, encryptedSymmetricKeys: existing, litPersisted: true };
                  });
                  localStorage.setItem('lighthouse_uploads', JSON.stringify(updated));
                } catch (e) { console.warn('dev persist failed for', r.cid, e); }
              }
              setPublishMessage('Dev persist complete');
              setTimeout(() => setPublishMessage(null), 4000);
            } catch (e: any) {
              setError(e?.message || String(e));
            } finally { setDevRunning(false); }
          }} disabled={devRunning} style={{ padding: '8px 12px', background: devRunning ? '#9ca3af' : '#f97316', color: 'white', border: 'none', borderRadius: 6 }}>{devRunning ? 'Running...' : 'Persist All For Address'}</button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>Developer helper: persists Lit-encrypted keys granting access to the provided address. Use only for testing.</div>
      </div>
      
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

      {cid && (
        <div style={{ marginTop: 8, fontSize: 13, color: '#374151', wordBreak: 'break-all' }}>
          <strong>Last CID:</strong> {cid}
          <div style={{ marginTop: 8 }}>
            <button onClick={() => handleDownloadCid(cid ?? undefined)} disabled={loading} style={{ padding: '8px 12px', background: '#06b6d4', color: 'white', border: 'none', borderRadius: 6 }}>Download Last</button>
          </div>
        </div>
      )}

    </div>
  );
};

export default LighthouseUploader;