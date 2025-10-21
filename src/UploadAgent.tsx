import React, { useRef, useState } from 'react';

const UploadAgent: React.FC = () => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('General');
  const [accessType, setAccessType] = useState('wallet');
  const [price, setPrice] = useState('0.05');

  const handleSubmit = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return alert('Select a file');
    const meta = { title: name, description, category, accessType, price };
    window.dispatchEvent(new CustomEvent('upload-with-meta', { detail: { file, meta } }));
  };

  return (
    <div style={{ maxWidth: 800, margin: '1rem auto', padding: 12 }}>
      <h2>Upload Agent</h2>
      <div style={{ padding: 12, border: '1px solid #e6edf6', borderRadius: 8 }}>
        <input type='file' ref={fileRef} />
        <div style={{ marginTop: 12 }}>
          <input placeholder='Agent Name' value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', padding: 8, marginBottom: 8 }} />
          <textarea placeholder='Description' value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: '100%', padding: 8, marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option>General</option>
              <option>Legal</option>
              <option>Medical</option>
              <option>Finance</option>
            </select>
            <select value={accessType} onChange={(e) => setAccessType(e.target.value)}>
              <option value='wallet'>Wallet</option>
              <option value='nft'>NFT</option>
              <option value='token'>Token</option>
            </select>
            <input value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 120 }} />
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <button onClick={handleSubmit} style={{ padding: '8px 12px', background: '#06b6d4', color: 'white', border: 'none', borderRadius: 6 }}>Encrypt and Upload</button>
        </div>
      </div>
    </div>
  );
};

export default UploadAgent;
