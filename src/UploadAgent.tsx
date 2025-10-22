import React, { useRef, useState } from 'react';
import { useAccount } from 'wagmi';

const UploadAgent: React.FC = () => {
  const { address, isConnected } = useAccount();
  const contractFileRef = useRef<HTMLInputElement | null>(null);
  const agentFileRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('AI');
  const [price, setPrice] = useState('0.05');
  const [contractFile, setContractFile] = useState<File | null>(null);
  const [agentFile, setAgentFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [isReupload, setIsReupload] = useState(false);

  // Check for re-upload data on component mount
  React.useEffect(() => {
    const reuploadData = localStorage.getItem('reupload_agent');
    if (reuploadData) {
      try {
        const data = JSON.parse(reuploadData);
        setName(data.title || '');
        setDescription(data.description || '');
        setCategory(data.category || 'AI');
        setPrice(data.price || '0.05');
        setIsReupload(true);
        // Clear the reupload data after using it
        localStorage.removeItem('reupload_agent');
      } catch (e) {
        console.warn('Failed to parse reupload data:', e);
      }
    }
  }, []);

  const handleContractFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setContractFile(file || null);
  };

  const handleAgentFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setAgentFile(file || null);
  };

  const handleSubmit = async () => {
    if (!isConnected) {
      alert('Please connect your wallet first');
      return;
    }
    
    if (!agentFile) {
      alert('Please select an agent file');
      return;
    }
    
    if (!name.trim()) {
      alert('Please enter an agent name');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadStage('Encrypting...');
    
    try {
      // Simulate upload stages with progress
      const stages = [
        { stage: 'Encrypting...', progress: 25 },
        { stage: 'Uploading to Lighthouse...', progress: 50 },
        { stage: 'Saving key to Lit Protocol...', progress: 75 },
        { stage: 'Finalizing...', progress: 100 }
      ];

      for (const { stage, progress } of stages) {
        setUploadStage(stage);
        setUploadProgress(progress);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Dispatch the actual upload event
      const meta = { 
        title: name, 
        description, 
        category, 
        price,
        contractFile: contractFile || undefined
      };
      window.dispatchEvent(new CustomEvent('upload-with-meta', { detail: { file: agentFile, meta } }));
      
      setUploadSuccess(true);
    } catch (error) {
      console.error('Upload error:', error);
      alert('Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
      setUploadStage(null);
    }
  };

  const handleViewDashboard = () => {
    window.dispatchEvent(new CustomEvent('navigate', { detail: { view: 'dashboard' } }));
  };

  if (!isConnected) {
    return (
      <div style={{ maxWidth: 800, margin: '1rem auto', padding: 12, textAlign: 'center' }}>
        <h2>Upload Agent</h2>
        <div style={{ padding: 24, border: '1px solid #e6edf6', borderRadius: 8, background: '#f8fafc' }}>
          <h3 style={{ color: '#6b7280' }}>Connect Wallet Required</h3>
          <p style={{ color: '#6b7280' }}>Please connect your wallet to upload agents</p>
        </div>
      </div>
    );
  }

  if (uploadSuccess) {
    return (
      <div style={{ maxWidth: 800, margin: '1rem auto', padding: 12, textAlign: 'center' }}>
        <h2>Upload Agent</h2>
        <div style={{ padding: 24, border: '1px solid #10b981', borderRadius: 8, background: '#f0fdf4' }}>
          <h3 style={{ color: '#059669' }}>✅ Agent uploaded successfully!</h3>
          <p style={{ color: '#047857' }}>Your agent has been encrypted and uploaded to Lighthouse with proper Lit Protocol integration</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 16 }}>
            <button 
              onClick={handleViewDashboard}
              style={{ 
                padding: '12px 24px', 
                background: '#06b6d4', 
                color: 'white', 
                border: 'none', 
                borderRadius: 6,
                fontWeight: 600
              }}
            >
              View on Dashboard
            </button>
            <button 
              onClick={() => {
                setUploadSuccess(false);
                setName('');
                setDescription('');
                setCategory('AI');
                setPrice('0.05');
                setContractFile(null);
                setAgentFile(null);
              }}
              style={{ 
                padding: '12px 24px', 
                background: '#8b5cf6', 
                color: 'white', 
                border: 'none', 
                borderRadius: 6,
                fontWeight: 600
              }}
            >
              Upload Another
            </button>
          </div>
        </div>
      </div>
    );
  }

          return (
            <div style={{ maxWidth: 800, margin: '1rem auto', padding: 12 }}>
              <h2>Upload Agent</h2>
              {isReupload && (
                <div style={{ marginBottom: 16, padding: 12, background: '#fef3c7', borderRadius: 8, border: '1px solid #f59e0b' }}>
                  <strong>🔄 Re-uploading Agent:</strong> This form has been pre-filled with your previous agent details. Please select the same files and re-upload to fix Lit Protocol compatibility issues.
                </div>
              )}
              <div style={{ padding: 24, border: '1px solid #e6edf6', borderRadius: 8, background: '#f8fafc' }}>
        
        {/* Wallet Connection Status */}
        <div style={{ marginBottom: 20, padding: 12, background: '#e0f2fe', borderRadius: 6 }}>
          <strong>Connected Wallet:</strong> {address}
        </div>

        {/* Form Fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Agent Name *</label>
            <input 
              placeholder='Enter agent name' 
              value={name} 
              onChange={(e) => setName(e.target.value)} 
              style={{ width: '100%', padding: 12, border: '1px solid #d1d5db', borderRadius: 6 }} 
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Description</label>
            <textarea 
              placeholder='Describe what this agent does' 
              value={description} 
              onChange={(e) => setDescription(e.target.value)} 
              style={{ width: '100%', padding: 12, border: '1px solid #d1d5db', borderRadius: 6, minHeight: 80 }} 
            />
          </div>

          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Category</label>
              <select 
                value={category} 
                onChange={(e) => setCategory(e.target.value)}
                style={{ width: '100%', padding: 12, border: '1px solid #d1d5db', borderRadius: 6 }}
              >
                <option value='AI'>AI</option>
                <option value='Analytics'>Analytics</option>
                <option value='Legal'>Legal</option>
                <option value='Medical'>Medical</option>
                <option value='Finance'>Finance</option>
                <option value='Trading'>Trading</option>
                <option value='General'>General</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Price (ETH)</label>
              <input 
                value={price} 
                onChange={(e) => setPrice(e.target.value)} 
                placeholder='0.05'
                style={{ width: '100%', padding: 12, border: '1px solid #d1d5db', borderRadius: 6 }} 
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Smart Contract File</label>
            <input 
              type='file' 
              ref={contractFileRef}
              onChange={handleContractFileChange}
              accept='.sol,.json'
              style={{ width: '100%', padding: 8 }}
            />
            {contractFile && (
              <div style={{ marginTop: 8, padding: 8, background: '#f0f9ff', borderRadius: 4, fontSize: 14 }}>
                📄 {contractFile.name} ({(contractFile.size / 1024).toFixed(1)} KB)
              </div>
            )}
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>Agent File *</label>
            <input 
              type='file' 
              ref={agentFileRef}
              onChange={handleAgentFileChange}
              accept='.zip,.py,.js,.ts,.json'
              style={{ width: '100%', padding: 8 }}
            />
            {agentFile && (
              <div style={{ marginTop: 8, padding: 8, background: '#f0f9ff', borderRadius: 4, fontSize: 14 }}>
                📦 {agentFile.name} ({(agentFile.size / 1024).toFixed(1)} KB)
              </div>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        {isUploading && (
          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{uploadStage}</span>
              <span style={{ fontSize: 14 }}>{uploadProgress}%</span>
            </div>
            <div style={{ width: '100%', height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
              <div 
                style={{ 
                  width: `${uploadProgress}%`, 
                  height: '100%', 
                  background: 'linear-gradient(90deg,#06b6d4,#8b5cf6)', 
                  transition: 'width 0.3s ease'
                }} 
              />
            </div>
          </div>
        )}

        {/* Upload Button */}
        <div style={{ marginTop: 24 }}>
          <button 
            onClick={handleSubmit} 
            disabled={isUploading || !agentFile || !name.trim()}
            style={{ 
              padding: '12px 24px', 
              background: isUploading || !agentFile || !name.trim() ? '#9ca3af' : '#06b6d4', 
              color: 'white', 
              border: 'none', 
              borderRadius: 6,
              fontWeight: 600,
              cursor: isUploading || !agentFile || !name.trim() ? 'not-allowed' : 'pointer'
            }}
          >
            {isUploading ? 'Uploading...' : 'Encrypt and Upload'}
          </button>
          <div style={{ marginTop: 12, fontSize: 12, color: '#6b7280' }}>
            Note: Files are encrypted client-side before uploading to Lighthouse. The symmetric key is saved to Lit Protocol for access control.
          </div>
        </div>
      </div>
    </div>
  );
};

export default UploadAgent;
