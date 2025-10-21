import React, { useState, useRef } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import lighthouse from '@lighthouse-web3/sdk';

const LighthouseUploader: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [cid, setCid] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string>('');
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      
      setCid(output.data[0].Hash);
      
    } catch (err: any) {
      console.error('Upload Error:', err);
      setError(err.message || "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  // Download and decrypt file
  const handleDownload = async () => {
    if (!cid || !address) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const { signedMessage, publicKey } = await getAuthSignature();
      
      console.log('Fetching encryption key for CID:', cid);
      
      // Get decryption key
      const keyRes = await lighthouse.fetchEncryptionKey(
        cid,
        publicKey,
        signedMessage
      );
      
      console.log('Key Response:', keyRes);
      
      const fileKey = keyRes.data.key;
      if (!fileKey) throw new Error('No decryption key returned');
      
      // Decrypt file (returns Blob)
      const decrypted = await lighthouse.decryptFile(cid, fileKey as string);
      
      // Create a download link
      const url = URL.createObjectURL(decrypted);
      const a = document.createElement("a");
      a.href = url;
      a.download = `decrypted_${cid}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      
    } catch (err: any) {
      console.error('Download Error:', err);
      setError(err.message || "Decryption failed");
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
      </div>
      
      {/* Download */}
      {cid && (
        <div style={{ 
          padding: 16, 
          backgroundColor: '#eff6ff', 
          borderRadius: 6,
          marginBottom: 16 
        }}>
          <h3 style={{ fontSize: 16, marginTop: 0, color: '#1e40af' }}>Step 3: Download</h3>
          <div style={{ fontSize: 12, marginBottom: 12, wordBreak: 'break-all', fontFamily: 'monospace' }}>
            <strong>CID:</strong> {cid}
          </div>
          <button 
            onClick={handleDownload} 
            disabled={loading}
            style={{
              width: '100%',
              padding: '10px 16px',
              backgroundColor: loading ? '#9ca3af' : '#8b5cf6',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 14,
              fontWeight: 500
            }}
          >
            {loading ? "Decrypting..." : "🔓 Download & Decrypt"}
          </button>
        </div>
      )}
      
      {/* Error Message */}
      {error && (
        <div style={{ 
          padding: 12, 
          backgroundColor: '#fee2e2', 
          color: '#991b1b', 
          borderRadius: 6,
          fontSize: 14 
        }}>
          ❌ {error}
        </div>
      )}
    </div>
  );
};

export default LighthouseUploader;