import React, { useState } from 'react';
import { getKeyFromLit, createLitAuthSig } from './lib/litHelpers';
import { ethers } from 'ethers';
import { useAccount, useContractWrite, usePrepareContractWrite, useContractRead } from 'wagmi';
import { parseEther } from 'viem';
import RentAgentABI from './abis/RentAgent.json';

type Props = {
  cid: string;
  onClose: () => void;
  authAddress?: string | null;
  price?: string; // ETH amount as decimal string
};


const ethToHex = (eth: string) => {
  const sanitized = String(eth).replace(/[^0-9.]/g, '') || '0';
  const [whole, frac = ''] = sanitized.split('.');
  const wholeWei = BigInt(whole || '0') * BigInt(10 ** 18);
  const fracPadded = (frac + '0'.repeat(18)).slice(0, 18);
  const fracWei = BigInt(fracPadded);
  const wei = wholeWei + fracWei;
  return '0x' + wei.toString(16);
};

// Try to canonicalize / checksum an address. Prefer ethers if present on window or in imports; otherwise
// perform a lightweight validation (lowercase + 0x check). This is only for UX validation prior to sending
// a transaction - the wallet will ultimately reject invalid addresses.
const normalizeAddress = (addr?: string) => {
  if (!addr) return '';
  const s = String(addr).trim();
  try {
    const ethers = (window as any).ethers;
    if (ethers && typeof ethers.utils?.getAddress === 'function') return ethers.utils.getAddress(s);
  } catch (e) {
    // ignore
  }
  if (/^0x[a-fA-F0-9]{40}$/.test(s)) return s;
  return '';
};

const RentModal: React.FC<Props> = ({ cid, onClose, authAddress, price }) => {
  const { address } = useAccount();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [rentStage, setRentStage] = useState<string | null>(null);
  const [rentSuccess, setRentSuccess] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  // Smart contract configuration
  const RENT_AGENT_CONTRACT = (import.meta.env.VITE_RENT_AGENT_ADDRESS as string) || '';
  
  // Prepare contract write for renting agent
  const { config: rentConfig } = usePrepareContractWrite({
    address: RENT_AGENT_CONTRACT as `0x${string}`,
    abi: RentAgentABI,
    functionName: 'rentAgent',
    args: [cid],
    value: price ? parseEther(price) : undefined,
    enabled: !!price && !!RENT_AGENT_CONTRACT,
  });
  
  const { write: rentAgent, isLoading: isRenting } = useContractWrite({
    ...rentConfig,
    onSuccess: (data) => {
      console.info('[RentModal] Agent rental successful', { txHash: data.hash });
      setTxHash(data.hash);
      setMessage('Payment confirmed on blockchain');
    },
    onError: (error) => {
      console.error('[RentModal] Agent rental failed', error);
      setError(`Rental failed: ${error.message}`);
    }
  });

  // Check if user is already a renter
  const { data: isRenter } = useContractRead({
    address: RENT_AGENT_CONTRACT as `0x${string}`,
    abi: RentAgentABI,
    functionName: 'isRenter',
    args: [cid, address || '0x0'],
    enabled: !!address && !!RENT_AGENT_CONTRACT,
  });

  const handlePayAndFetch = async () => {
    setError(null);
    setMessage(null);
    setLoading(true);
    setRentStage('Initiating payment...');
    
    try {
      const stored = JSON.parse(localStorage.getItem('lighthouse_uploads') || '[]') as any[];
      const record = stored.find(r => r.cid === cid);
      if (!record) throw new Error('Record not found');

      // Check if this is a legacy agent that should not be rented
      if (record.litPersisted === false) {
        throw new Error('This is a legacy agent that was uploaded before the latest fixes. The owner needs to re-upload it for compatibility. Please ask the agent owner to re-upload the agent.');
      }

      const ownerRaw = record.owner || record.accessControlConditions?.[0]?.returnValueTest?.value || '';
      const owner = normalizeAddress(ownerRaw) || String(ownerRaw).toLowerCase();
      const requester = normalizeAddress(authAddress || '') || String(authAddress || '').toLowerCase();
      console.debug('[RentModal] record snapshot', record);
      console.debug('[RentModal] owner/requester', { ownerRaw, owner, requester });

      // Check if user is already a renter (owner or has active rental)
      if (owner && owner === requester) {
        setRentStage('Owner detected — skipping payment');
        setMessage('Owner detected — skipping payment');
      } else if (isRenter) {
        setRentStage('Active rental detected — skipping payment');
        setMessage('You already have an active rental for this agent');
      } else {
        if (!price) throw new Error('This agent requires a rental fee');
        if (!RENT_AGENT_CONTRACT) throw new Error('Smart contract not configured');

        setRentStage('Submitting rental transaction...');
        setMessage(`Renting agent for ${price} ETH`);
        
        // Use wagmi contract write for rental
        await rentAgent?.();
        
        setRentStage('Waiting for confirmation...');
        setMessage('Transaction submitted — waiting for confirmation');
        
        // Wait for transaction confirmation (handled by wagmi onSuccess callback)
        // The txHash and success message will be set by the onSuccess callback
      }

      // Step 3: Retrieving decryption key from Lit
      setRentStage('Retrieving decryption key from Lit...');

  // No local symmetricKey fallbacks allowed. Only Lit-encrypted keys will be used.

  // attempt Lit retrieval
      const entries: any[] = [];
      if (record.encryptedSymmetricKeys && Array.isArray(record.encryptedSymmetricKeys)) entries.push(...record.encryptedSymmetricKeys);
      else if (record.encryptedSymmetricKey) entries.push({ key: record.encryptedSymmetricKey, accessControlConditions: record.accessControlConditions });

      if (entries.length === 0) {
        console.error('No encrypted keys available — record snapshot:', record);
        throw new Error('No encrypted keys available (no Lit entries). The uploader likely failed to persist the key to Lit — ask them to retry publishing.');
      }

  // use centralized lit helper for key retrieval
  // Create a proper Lit authSig (SIWE formatted) for Lit decrypt calls
  const providerForSign = new ethers.BrowserProvider((window as any).ethereum);
  const signerForAuth = await providerForSign.getSigner();
  const signerAddress = await signerForAuth.getAddress();
  const authSig = await createLitAuthSig(signerForAuth, signerAddress);

      // After payment, attempt to retrieve symmetric key from Lighthouse and persist a Lit entry for the renter
      // so they can decrypt. We will try to fetch the symmetric key from Lighthouse (owner should still have it)
      // and then save it to Lit with ACC granting the renter address access for the rental period.

      // Try existing Lit entries first (in case uploader already persisted for this renter)
      let gotKey: string | null = null;
      for (const e of entries) {
        console.debug('[RentModal] trying existing Lit entry', { hasACC: !!e?.accessControlConditions });
        try {
          const k = await getKeyFromLit(e.key, e.accessControlConditions || null, authSig);
          console.debug('[RentModal] getKeyFromLit response for entry', { got: !!k });
          if (k) { gotKey = k; break; }
        } catch (litErr) {
          console.warn('getKeyFromLit failed for one entry:', litErr);
        }
      }

      // If no Lit key available immediately after payment, poll for a short period — this covers the small propagation window after on-chain rent
      if (!gotKey) {
        console.debug('[RentModal] No Lit key available immediately after payment; will poll for up to 30s');
        const start = Date.now();
        const timeoutMs = 30_000;
        while (!gotKey && (Date.now() - start) < timeoutMs) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise(r => setTimeout(r, 3000));
          for (const e of entries) {
            try {
              const k = await getKeyFromLit(e.key, e.accessControlConditions || null, authSig);
              if (k) { gotKey = k; break; }
            } catch (litErr) {
              console.debug('[RentModal] poll getKeyFromLit still failing for one entry', typeof litErr === 'object' ? JSON.stringify(litErr) : String(litErr));
            }
          }
        }
        if (!gotKey) {
          console.debug('[RentModal] No Lit key available for renter after polling');
          // Provide a more helpful error message with recovery options
          throw new Error('Unable to retrieve decryption key from Lit Protocol. This may be due to:\n\n1. Session expiration issues - try asking the owner to re-upload the agent\n2. Network connectivity issues - try again in a few minutes\n3. Access control conditions not met - ensure you have the required permissions\n\nContact the agent owner for assistance or try the "Recover Key" option if available.');
        }
      }

      if (!gotKey) throw new Error('Unable to retrieve symmetric key from Lit after payment/persist attempt');

      // Step 4: Decrypting agent files
      setRentStage('Decrypting agent files...');
      
      const { decryptIpfsFile } = await import('./lib/cryptoHelpers');
      const decrypted = await decryptIpfsFile(cid, gotKey as string);
      const url = URL.createObjectURL(decrypted);
      setDownloadUrl(url);
      
      setRentSuccess(true);
      setMessage('Payment complete. Your agent is ready to download.');
    } catch (err: any) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  // Success state
  if (rentSuccess) {
    return (
      <div style={{ padding: 24, marginTop: 12, background: '#f0fdf4', borderRadius: 12, border: '1px solid #10b981' }}>
        <h4 style={{ color: '#059669', marginTop: 0 }}>✅ Payment complete. Your agent is ready to download.</h4>
        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button 
            onClick={() => {
              if (downloadUrl) {
                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = `rented_${cid}`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(downloadUrl);
              }
            }}
            style={{ 
              padding: '12px 20px', 
              background: '#06b6d4', 
              color: 'white', 
              border: 'none', 
              borderRadius: 8,
              fontWeight: 600
            }}
          >
            Download Agent
          </button>
          <button 
            onClick={() => {
              // Open in workspace functionality could be implemented here
              alert('Open in Workspace feature coming soon!');
            }}
            style={{ 
              padding: '12px 20px', 
              background: '#8b5cf6', 
              color: 'white', 
              border: 'none', 
              borderRadius: 8,
              fontWeight: 600
            }}
          >
            Open in Workspace
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, marginTop: 12, background: '#fff', borderRadius: 12, border: '1px solid #e6edf6' }}>
      <h4 style={{ marginTop: 0, marginBottom: 16 }}>Rent Agent</h4>
      
      {/* Agent Info */}
      {(() => {
        try {
          const stored = JSON.parse(localStorage.getItem('lighthouse_uploads') || '[]') as any[];
          const r = stored.find(s => s.cid === cid) || {};
          return (
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 8 }}>
                <strong>Agent name:</strong> <span style={{ color: '#6b7280' }}>{r.title || cid}</span>
              </div>
              <div style={{ marginBottom: 8 }}>
                <strong>Price:</strong> <span style={{ color: '#059669', fontWeight: 600 }}>{price || '0.05'} ETH</span>
              </div>
              <div>
                <strong>Recipient wallet address:</strong> 
                <div style={{ 
                  marginTop: 4, 
                  padding: 8, 
                  background: '#f3f4f6', 
                  borderRadius: 6, 
                  fontFamily: 'monospace', 
                  fontSize: 14,
                  color: '#374151'
                }}>
                  {authAddress || 'Not connected'}
                </div>
              </div>
            </div>
          );
        } catch (e) {
          return null;
        }
      })()}

      {/* Progress Stages */}
      {loading && rentStage && (
        <div style={{ marginBottom: 16, padding: 12, background: '#f0f9ff', borderRadius: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1e40af' }}>{rentStage}</div>
        </div>
      )}

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 12 }}>
        <button 
          onClick={handlePayAndFetch} 
          disabled={loading}
          style={{ 
            padding: '12px 20px', 
            background: loading ? '#9ca3af' : '#06b6d4', 
            color: '#fff', 
            border: 'none', 
            borderRadius: 8,
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? 'Processing...' : 'Pay & Unlock'}
        </button>
        <button 
          onClick={onClose} 
          style={{ 
            padding: '12px 20px', 
            background: '#9ca3af', 
            color: '#fff', 
            border: 'none', 
            borderRadius: 8,
            fontWeight: 600
          }}
        >
          Cancel
        </button>
      </div>

      {/* Transaction Hash */}
      {txHash && (
        <div style={{ marginTop: 16, padding: 12, background: '#f0f9ff', borderRadius: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Payment Transaction:</div>
          <a 
            href={`https://sepolia.etherscan.io/tx/${txHash}`} 
            target='_blank' 
            rel='noreferrer'
            style={{ 
              fontFamily: 'monospace', 
              fontSize: 12, 
              color: '#3b82f6',
              wordBreak: 'break-all'
            }}
          >
            {txHash}
          </a>
        </div>
      )}

      {/* Messages */}
      {message && (
        <div style={{ marginTop: 12, padding: 12, background: '#f0fdf4', borderRadius: 8, color: '#065f46' }}>
          {message}
        </div>
      )}
      
      {/* Error Fallbacks */}
      {error && (
        <div style={{ marginTop: 12, padding: 12, background: '#fef2f2', borderRadius: 8, color: '#991b1b' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Error:</div>
          <div style={{ fontSize: 14 }}>{error}</div>
          {error.includes('Lit') && (
            <div style={{ marginTop: 8, fontSize: 12 }}>
              <strong>Fallback:</strong> If Lit fails, try using the owner's Lighthouse recovery key.
            </div>
          )}
          {error.includes('Decryption unavailable') && (
            <div style={{ marginTop: 8, fontSize: 12 }}>
              <strong>Note:</strong> Owner may need to recover the key.
            </div>
          )}
          {error.includes('Session expiration') && (
            <div style={{ marginTop: 8, fontSize: 12 }}>
              <strong>Solution:</strong> This agent was uploaded with an older version that has compatibility issues. Ask the agent owner to re-upload the agent with the latest version.
            </div>
          )}
          {error.includes('Missing session expiration') && (
            <div style={{ marginTop: 8, fontSize: 12, padding: 8, background: '#fef3c7', borderRadius: 4 }}>
              <strong>⚠️ Legacy Agent Detected:</strong> This agent was uploaded before the latest fixes. The owner needs to re-upload it for compatibility.
            </div>
          )}
          {error.includes('legacy agent') && (
            <div style={{ marginTop: 8, fontSize: 12, padding: 8, background: '#fef3c7', borderRadius: 4 }}>
              <strong>🚫 Legacy Agent Blocked:</strong> This agent cannot be rented because it was uploaded before the latest fixes. Please ask the agent owner to re-upload it.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RentModal;
