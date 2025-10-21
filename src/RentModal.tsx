import React, { useState } from 'react';
import lighthouse from '@lighthouse-web3/sdk';

type Props = {
  cid: string;
  onClose: () => void;
  authAddress?: string | null;
  price?: string; // ETH amount as decimal string
};

const initLitLazy = async () => {
  const LitJsSdk = await import('@lit-protocol/lit-node-client');
  const LitNodeClient = LitJsSdk.LitNodeClient || (LitJsSdk as any).default?.LitNodeClient || (LitJsSdk as any).default;
  const client = new (LitNodeClient as any)({ litNetwork: 'datil' });
  await client.connect();
  return client;
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

const RentModal: React.FC<Props> = ({ cid, onClose, authAddress, price }) => {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePayAndFetch = async () => {
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const stored = JSON.parse(localStorage.getItem('lighthouse_uploads') || '[]') as any[];
      const record = stored.find(r => r.cid === cid);
      if (!record) throw new Error('Record not found');

      const owner = (record.owner || record.accessControlConditions?.[0]?.returnValueTest?.value || '').toLowerCase();
      const requester = (authAddress || '').toLowerCase();

      if (owner && owner === requester) {
        setMessage('Owner detected — skipping payment');
      } else {
        if (!price) throw new Error('This agent requires a rental fee');
        if (!(window as any).ethereum) throw new Error('No Ethereum provider found');
        const valueHex = ethToHex(price);
        setMessage(`Sending payment ${price} ETH to ${owner} via wallet`);
        const txHash = await (window as any).ethereum.request({
          method: 'eth_sendTransaction',
          params: [{ from: requester, to: owner, value: valueHex }],
        });
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
        setMessage('Payment confirmed');
      }

      // attempt Lit retrieval
      const entries: any[] = [];
      if (record.encryptedSymmetricKeys && Array.isArray(record.encryptedSymmetricKeys)) entries.push(...record.encryptedSymmetricKeys);
      else if (record.encryptedSymmetricKey) entries.push({ key: record.encryptedSymmetricKey, accessControlConditions: record.accessControlConditions });

      if (entries.length === 0) throw new Error('No encrypted keys available');

      const lit = await initLitLazy();
      // get auth message and request user signature
      const authMsgResp = await lighthouse.getAuthMessage(requester || '');
      const messageToSign = authMsgResp?.data?.message || String(authMsgResp);
      const signed = await (window as any).ethereum.request({ method: 'personal_sign', params: [messageToSign, requester] });
      const authSig = { sig: signed, derivedVia: 'web3', signedMessage: signed, address: requester };

      let gotKey: string | null = null;
      for (const e of entries) {
        try {
          const k = await lit.getEncryptionKey({ accessControlConditions: e.accessControlConditions, toDecrypt: e.key, authSig, chain: 'ethereum' });
          if (k) { gotKey = k; break; }
        } catch (_) { /* try next */ }
      }

      if (!gotKey) throw new Error('Unable to retrieve symmetric key from Lit');

      const decrypted = await lighthouse.decryptFile(cid, gotKey as string);
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
      <p style={{ marginTop: 0 }}>Pay the uploader's fee for a one-hour rental and receive the decryption key if authorized.</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={handlePayAndFetch} disabled={loading} style={{ padding: '8px 12px', background: '#06b6d4', color: '#fff', border: 'none', borderRadius: 6 }}>{loading ? 'Processing...' : `Pay & Rent${price ? ` (${price} ETH)` : ''}`}</button>
        <button onClick={onClose} style={{ padding: '8px 12px', background: '#9ca3af', color: '#fff', border: 'none', borderRadius: 6 }}>Cancel</button>
      </div>
      {message && <div style={{ marginTop: 8, color: '#065f46' }}>{message}</div>}
      {error && <div style={{ marginTop: 8, color: '#991b1b' }}>{error}</div>}
    </div>
  );
};

export default RentModal;
