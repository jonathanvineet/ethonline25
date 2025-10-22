import React, { useState } from 'react';
import { getKeyFromLit, createLitAuthSig } from './lib/litHelpers';
import { ethers } from 'ethers';

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
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const handlePayAndFetch = async () => {
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const stored = JSON.parse(localStorage.getItem('lighthouse_uploads') || '[]') as any[];
      const record = stored.find(r => r.cid === cid);
      if (!record) throw new Error('Record not found');

    const ownerRaw = record.owner || record.accessControlConditions?.[0]?.returnValueTest?.value || '';
  const owner = normalizeAddress(ownerRaw) || String(ownerRaw).toLowerCase();
  const requester = normalizeAddress(authAddress || '') || String(authAddress || '').toLowerCase();
  console.debug('[RentModal] record snapshot', record);
      console.debug('[RentModal] owner/requester', { ownerRaw, owner, requester });

      if (owner && owner === requester) {
        setMessage('Owner detected — skipping payment');
      } else {
        if (!price) throw new Error('This agent requires a rental fee');
        if (!(window as any).ethereum) throw new Error('No Ethereum provider found');

        const rentContractAddress = (import.meta.env.VITE_RENT_AGENT_ADDRESS as string) || '';

        if (rentContractAddress) {
          // Use on-chain contract to perform rent; contract must expose rentAgent(cid) payable
          // ethers v6: use BrowserProvider
          const provider = new ethers.BrowserProvider((window as any).ethereum);
          const signer = await provider.getSigner();

          // Minimal ABI for rentAgent and isRenter
          const abi = [
            'function rentAgent(string cid) payable',
            'function isRenter(string cid, address user) view returns (bool)',
          ];

          const contract = new ethers.Contract(rentContractAddress, abi, signer);
          const value = ethToHex(price);
          setMessage(`Submitting rent tx to contract ${rentContractAddress} for ${price} ETH`);
          const tx = await contract.rentAgent(cid, { value });
          setMessage('Transaction submitted — waiting for confirmation');
          const receipt = await tx.wait();
          if (!receipt || receipt.status !== 1) throw new Error('Transaction failed');
          setTxHash(tx.hash);
          setMessage('Payment confirmed on-chain');
        } else {
          // Legacy: direct wallet send to owner
          const valueHex = ethToHex(price);
          if (!owner) {
            throw new Error(`Invalid recipient address for payment: "${ownerRaw}". Upload record may be missing owner or address is malformed`);
          }
          const txParams = { from: requester, to: owner, value: valueHex };
          console.debug('[RentModal] sending transaction with params', txParams);
          setMessage(`Sending payment ${price} ETH to ${owner} via wallet`);
          const txHash = await (window as any).ethereum.request({ method: 'eth_sendTransaction', params: [txParams] });
          setMessage('Payment submitted — waiting for confirmation');
          // poll for receipt
          let receipt = null;
          for (let i = 0; i < 60; i++) {
            // eslint-disable-next-line no-await-in-loop
            receipt = await (window as any).ethereum.request({ method: 'eth_getTransactionReceipt', params: [txHash] });
            if (receipt) break;
            // eslint-disable-next-line no-await-in-loop
            await new Promise(r => setTimeout(r, 2000));
          }
          if (!receipt) throw new Error('Payment not confirmed in time');
          setTxHash(txHash as any || null);
          setMessage('Payment confirmed');
        }
      }

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
          throw new Error('No Lit-encrypted key available for your address. Ask the uploader to persist the key to Lit or use a relayer that can perform the persistence on payment.');
        }
      }

      if (!gotKey) throw new Error('Unable to retrieve symmetric key from Lit after payment/persist attempt');

  const { decryptIpfsFile } = await import('./lib/cryptoHelpers');
  const decrypted = await decryptIpfsFile(cid, gotKey as string);
  const url = URL.createObjectURL(decrypted);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rented_${cid}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setMessage('Downloaded successfully');
    } catch (err: any) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 12, marginTop: 12, background: '#fff', borderRadius: 8 }}>
      <h4>Rent Agent</h4>
      {(() => {
        try {
          const stored = JSON.parse(localStorage.getItem('lighthouse_uploads') || '[]') as any[];
          const r = stored.find(s => s.cid === cid) || {};
          const ownerRaw = r.owner || r.accessControlConditions?.[0]?.returnValueTest?.value || '';
          const ownerNorm = ownerRaw ? ownerRaw : '';
          return (
            <div style={{ marginBottom: 8, fontSize: 13 }}>
              <strong>Owner:</strong> <span style={{ fontFamily: 'monospace' }}>{ownerNorm}</span>
              <button onClick={() => { navigator.clipboard.writeText(ownerNorm); }} style={{ marginLeft: 8, padding: '4px 8px' }}>Copy</button>
              <button onClick={() => window.dispatchEvent(new CustomEvent('retry-persist-key', { detail: { cid } }))} style={{ marginLeft: 8, padding: '4px 8px', background: '#f59e0b', color: '#000', border: 'none', borderRadius: 6 }}>Retry Persist</button>
            </div>
          );
        } catch (e) {
          return null;
        }
      })()}
      <p style={{ marginTop: 0 }}>Pay the uploader's fee for a one-hour rental and receive the decryption key if authorized.</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={handlePayAndFetch} disabled={loading} style={{ padding: '8px 12px', background: '#06b6d4', color: '#fff', border: 'none', borderRadius: 6 }}>{loading ? 'Processing...' : `Pay & Rent${price ? ` (${price} ETH)` : ''}`}</button>
        <button onClick={onClose} style={{ padding: '8px 12px', background: '#9ca3af', color: '#fff', border: 'none', borderRadius: 6 }}>Cancel</button>
      </div>
      {txHash && (
        <div style={{ marginTop: 8, fontSize: 13 }}>
          <strong>Payment Tx:</strong> <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target='_blank' rel='noreferrer'>{txHash}</a>
        </div>
      )}
      {message && <div style={{ marginTop: 8, color: '#065f46' }}>{message}</div>}
      {error && <div style={{ marginTop: 8, color: '#991b1b' }}>{error}</div>}
    </div>
  );
};

export default RentModal;
