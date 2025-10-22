import React, { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import RentModal from './RentModal';

type UploadRecord = {
  cid: string;
  owner?: string;
  encryptedSymmetricKey?: string;
  accessControlConditions?: any[];
  title?: string;
  description?: string;
  price?: string;
  category?: string;
};

const mockOtherAgents: UploadRecord[] = [
  { cid: 'QmMock1', title: 'Legal Contract Analyzer', description: 'Extracts clauses and risk scores', price: '0.05 ETH' },
  { cid: 'QmMock2', title: 'Medical Triage Agent', description: 'Suggests next steps based on symptoms', price: '0.12 ETH' },
  { cid: 'QmMock3', title: 'Trading Signal Bot', description: 'Generates trading signals from market data', price: '0.08 ETH' },
  { cid: 'QmMock4', title: 'Personal Assistant Agent', description: 'Schedules and summarizes meetings', price: '0.02 ETH' },
];

const AgentCard: React.FC<{ agent: UploadRecord; owner?: string; isMine?: boolean; onView?: (cid: string) => void; onDownload?: (cid: string) => void; onRent?: (cid: string) => void; onRecoverKey?: (cid: string) => void; onReupload?: (cid: string) => void; focused?: boolean }> = ({ agent, owner, isMine, onView, onDownload, onRent, onRecoverKey, onReupload, focused }) => {
  const handleCopy = () => navigator.clipboard.writeText(agent.cid);
  const handleDownload = () => {
    if (onDownload) onDownload(agent.cid);
    else window.dispatchEvent(new CustomEvent('dashboard-download', { detail: { cid: agent.cid } }));
  };
  const handleRent = () => {
    if (onRent) onRent(agent.cid);
  };
  const handleRecoverKey = () => {
    if (onRecoverKey) onRecoverKey(agent.cid);
  };
  const handleReupload = () => {
    if (onReupload) onReupload(agent.cid);
  };

  // Check if this agent has Lit integration issues
  // An agent has Lit issues if:
  // 1. No encrypted keys at all, OR
  // 2. Has encrypted keys but they were created with broken access control (old uploads)
  const hasLitIssues = !agent.encryptedSymmetricKey && !agent.encryptedSymmetricKeys;
  
  // Additional check: if this agent was uploaded before our fixes, mark it as legacy
  // We can detect this by checking if the agent has a litPersisted flag set to false
  const isLegacyAgent = (agent as any).litPersisted === false;

  // Shorten owner address for display
  const shortenAddress = (addr: string) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <div style={{ padding: 16, border: '1px solid #e6edf6', borderRadius: 12, marginBottom: 12, background: '#fff', boxShadow: focused ? '0 0 0 4px rgba(139,92,246,0.12)' : '0 2px 4px rgba(0,0,0,0.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{agent.title || agent.cid}</div>
          <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 8, lineHeight: 1.4 }}>{agent.description || 'No description provided'}</div>
          {owner && (
            <div style={{ fontSize: 12, color: '#9ca3af' }}>
              <strong>Owner:</strong> <span style={{ fontFamily: 'monospace' }}>{shortenAddress(owner)}</span>
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          {agent.price && (
            <div style={{ fontSize: 16, fontWeight: 600, color: '#059669' }}>
              Ξ {agent.price}
            </div>
          )}
          {isMine && (
            <div style={{ padding: '4px 8px', background: '#d1fae5', color: '#065f46', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
              Your Agent
            </div>
          )}
        </div>
      </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {isMine ? (
                  <>
                    <button 
                      onClick={handleDownload} 
                      style={{ 
                        padding: '10px 16px', 
                        background: '#06b6d4', 
                        color: 'white', 
                        border: 'none', 
                        borderRadius: 8,
                        fontWeight: 600,
                        fontSize: 14
                      }}
                    >
                      Download
                    </button>
                    <button 
                      onClick={handleRecoverKey} 
                      style={{ 
                        padding: '10px 16px', 
                        background: '#f59e0b', 
                        color: 'white', 
                        border: 'none', 
                        borderRadius: 8,
                        fontWeight: 600,
                        fontSize: 14
                      }}
                    >
                      Recover Key
                    </button>
                    {hasLitIssues && (
                      <button 
                        onClick={handleReupload} 
                        style={{ 
                          padding: '10px 16px', 
                          background: '#ef4444', 
                          color: 'white', 
                          border: 'none', 
                          borderRadius: 8,
                          fontWeight: 600,
                          fontSize: 14
                        }}
                      >
                        Re-upload (Fix Lit)
                      </button>
                    )}
                    {isLegacyAgent && !hasLitIssues && (
                      <button 
                        onClick={handleReupload} 
                        style={{ 
                          padding: '10px 16px', 
                          background: '#f59e0b', 
                          color: 'white', 
                          border: 'none', 
                          borderRadius: 8,
                          fontWeight: 600,
                          fontSize: 14
                        }}
                      >
                        Re-upload (Legacy)
                      </button>
                    )}
                  </>
                ) : (
                  <button 
                    onClick={handleRent} 
                    style={{ 
                      padding: '10px 16px', 
                      background: (hasLitIssues || isLegacyAgent) ? '#9ca3af' : '#8b5cf6', 
                      color: 'white', 
                      border: 'none', 
                      borderRadius: 8,
                      fontWeight: 600,
                      fontSize: 14,
                      cursor: (hasLitIssues || isLegacyAgent) ? 'not-allowed' : 'pointer'
                    }}
                    disabled={hasLitIssues || isLegacyAgent}
                    title={(hasLitIssues || isLegacyAgent) ? 'This agent needs to be re-uploaded by the owner for compatibility' : ''}
                  >
                    {(hasLitIssues || isLegacyAgent) ? 'Legacy Agent' : 'Rent / Download'}
                  </button>
                )}
        <button 
          onClick={() => { onView && onView(agent.cid); window.dispatchEvent(new CustomEvent('focus-agent', { detail: { cid: agent.cid } })); }} 
          style={{ 
            padding: '10px 16px', 
            background: '#6b7280', 
            color: 'white', 
            border: 'none', 
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 14
          }}
        >
          View Details
        </button>
        <button 
          onClick={handleCopy} 
          style={{ 
            padding: '10px 16px', 
            background: '#3b82f6', 
            color: 'white', 
            border: 'none', 
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 14
          }}
        >
          Copy CID
        </button>
      </div>
    </div>
  );
};

const AgentDashboard: React.FC = () => {
  const { address } = useAccount();
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [drawerCid, setDrawerCid] = useState<string | null>(null);
  const [focusedCid, setFocusedCid] = useState<string | null>(null);
  const [rentOpenCid, setRentOpenCid] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // listen for focus-agent events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as any;
      if (detail?.cid) {
          setDrawerCid(detail.cid);
          setFocusedCid(detail.cid);
          // clear highlight after 4s
          setTimeout(() => setFocusedCid(null), 4000);
      }
    };
    window.addEventListener('focus-agent', handler as EventListener);
    return () => window.removeEventListener('focus-agent', handler as EventListener);
  }, []);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('lighthouse_uploads') || '[]') as Array<any>;
      setUploads(stored.map(s => ({
        cid: s.cid,
        owner: s.owner ? String(s.owner).toLowerCase() : undefined,
        encryptedSymmetricKeys: s.encryptedSymmetricKeys || s.encryptedSymmetricKey ? (s.encryptedSymmetricKeys || [{ key: s.encryptedSymmetricKey, accessControlConditions: s.accessControlConditions }]) : undefined,
        accessControlConditions: s.accessControlConditions || undefined,
        title: s.title,
        description: s.description,
        price: s.price,
        category: s.category,
      })));
    } catch (e) {
      setUploads([]);
    }
  }, []);

  // Reload uploads when notified (so dashboard updates immediately after uploads)
  useEffect(() => {
    const handler = () => {
      try {
        const stored = JSON.parse(localStorage.getItem('lighthouse_uploads') || '[]') as Array<any>;
        setUploads(stored.map(s => ({
          cid: s.cid,
          owner: s.owner ? String(s.owner).toLowerCase() : undefined,
          encryptedSymmetricKeys: s.encryptedSymmetricKeys || s.encryptedSymmetricKey ? (s.encryptedSymmetricKeys || [{ key: s.encryptedSymmetricKey, accessControlConditions: s.accessControlConditions }]) : undefined,
          accessControlConditions: s.accessControlConditions || undefined,
          title: s.title,
          description: s.description,
          price: s.price,
          category: s.category,
        })));
      } catch (e) {
        setUploads([]);
      }
    };
    window.addEventListener('uploads-updated', handler as EventListener);
    return () => window.removeEventListener('uploads-updated', handler as EventListener);
  }, []);

  // Determine owner: prefer persisted `owner` field, fall back to accessControlConditions
  const withOwners = uploads.map(u => {
    const accOwner = u.accessControlConditions?.[0]?.returnValueTest?.value;
    const owner = (u as any).owner || accOwner;
    return { ...u, owner };
  });

  // Helper: normalize Ethereum addresses (try to extract 0x-prefixed 40 hex chars)
  const normalizeAddr = (v?: any) => {
    if (!v) return null;
    try {
      const s = String(v).trim();
      const m = s.match(/0x[a-fA-F0-9]{40}/);
      if (m) return m[0].toLowerCase();
      const last40 = s.replace(/[^a-fA-F0-9]/g, '').slice(-40);
      return last40 ? `0x${last40.toLowerCase()}` : null;
    } catch (e) {
      return null;
    }
  };

  const normAddress = normalizeAddr(address);

  // Debug: log owners found so you can inspect in DevTools if needed
  // (keep lightweight to avoid noisy logs in production)
  if (typeof window !== 'undefined') {
    // only run in browser
    console.debug('AgentDashboard: loaded uploads', { count: withOwners.length, normAddress, owners: withOwners.map(w => w.owner) });
  }

  // Handle recover key functionality
  const handleRecoverKey = async (cid: string) => {
    try {
      // This would typically fetch the symmetric key from Lighthouse
      // For now, we'll simulate the recovery process
      setToastMessage(`Recovered key for CID: ${cid}`);
      
      // Clear toast after 3 seconds
      setTimeout(() => setToastMessage(null), 3000);
      
      // In a real implementation, you would:
      // 1. Fetch the symmetric key from Lighthouse
      // 2. Save it to localStorage for future renters
      // 3. Show success message
      
    } catch (error) {
      console.error('Recover key error:', error);
      setToastMessage(`Failed to recover key for CID: ${cid}`);
      setTimeout(() => setToastMessage(null), 3000);
    }
  };

  // Handle re-upload functionality
  const handleReupload = (cid: string) => {
    // Navigate to upload page with pre-filled data from the existing agent
    const agent = uploads.find(u => u.cid === cid);
    if (agent) {
      // Store the agent data for pre-filling the upload form
      localStorage.setItem('reupload_agent', JSON.stringify({
        title: agent.title,
        description: agent.description,
        category: agent.category,
        price: agent.price,
        originalCid: cid
      }));
      
      // Navigate to upload page
      window.dispatchEvent(new CustomEvent('navigate', { detail: { view: 'upload' } }));
      
      setToastMessage(`Re-uploading agent "${agent.title || cid}" - please re-upload with the same details`);
      setTimeout(() => setToastMessage(null), 5000);
    }
  };

  const myAgents = withOwners.filter(u => {
    const ownerNorm = normalizeAddr((u as any).owner);
    return ownerNorm && normAddress && ownerNorm === normAddress;
  });

  const otherAgents = withOwners.filter(u => {
    const ownerNorm = normalizeAddr((u as any).owner);
    return !(ownerNorm && normAddress && ownerNorm === normAddress);
  });

  return (
    <div style={{ width: '100%', maxWidth: 1000, margin: '1rem auto', padding: 12 }}>
      <h2 style={{ marginTop: 0, marginBottom: 24 }}>Agent Dashboard</h2>

      {/* Your Agents Section */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16, color: '#1f2937' }}>Your Agents</h3>
        {myAgents.length === 0 && (
          <div style={{ 
            padding: 24, 
            border: '2px dashed #d1d5db', 
            borderRadius: 12, 
            textAlign: 'center', 
            background: '#f9fafb',
            color: '#6b7280'
          }}>
            <p style={{ margin: 0, fontSize: 16 }}>You haven't uploaded any agents yet.</p>
            <p style={{ margin: '8px 0 0 0', fontSize: 14 }}>Click "Upload Agent" to get started!</p>
          </div>
        )}
                {myAgents.map((a, i) => (
                  <AgentCard 
                    key={i} 
                    agent={a} 
                    owner={(a as any).owner} 
                    isMine={true} 
                    onView={(cid) => setDrawerCid(cid)} 
                    onDownload={(cid) => window.dispatchEvent(new CustomEvent('dashboard-download', { detail: { cid } }))} 
                    onRecoverKey={handleRecoverKey}
                    onReupload={handleReupload}
                    focused={focusedCid === a.cid} 
                  />
                ))}
      </div>

      {/* Available Agents Section */}
      <div>
        <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16, color: '#1f2937' }}>Available Agents</h3>
        <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 16 }}>Discover and rent agents created by other users</p>
        
        {/* show mocked agents first */}
        {mockOtherAgents.map((m, i) => (
          <AgentCard 
            key={`mock-${i}`} 
            agent={m} 
            owner={`0xMockOwner${i}`} 
            onView={(cid) => setDrawerCid(cid)} 
            onRent={(cid) => setRentOpenCid(cid)} 
            focused={focusedCid === m.cid} 
          />
        ))}

        {/* then show other uploaded agents (not owned by you) */}
        {otherAgents.map((a, i) => (
          <AgentCard 
            key={`other-${i}`} 
            agent={a} 
            owner={(a as any).owner} 
            onView={(cid) => setDrawerCid(cid)} 
            onRent={(cid) => setRentOpenCid(cid)} 
            focused={focusedCid === a.cid} 
          />
        ))}
        
        {mockOtherAgents.length === 0 && otherAgents.length === 0 && (
          <div style={{ 
            padding: 24, 
            border: '2px dashed #d1d5db', 
            borderRadius: 12, 
            textAlign: 'center', 
            background: '#f9fafb',
            color: '#6b7280'
          }}>
            <p style={{ margin: 0, fontSize: 16 }}>No agents available for rental yet.</p>
            <p style={{ margin: '8px 0 0 0', fontSize: 14 }}>Be the first to upload an agent!</p>
          </div>
        )}
      </div>

      {/* Details Drawer */}
      {drawerCid && (
        <div style={{ position: 'fixed', right: 0, top: 0, height: '100vh', width: 420, background: '#f8fafc', boxShadow: '-12px 0 24px rgba(2,6,23,0.4)', padding: 16 }}>
          <button onClick={() => setDrawerCid(null)} style={{ float: 'right' }}>Close</button>
          <h3>Agent Details</h3>
          <div style={{ wordBreak: 'break-all', fontFamily: 'monospace' }}><strong>CID:</strong> {drawerCid}</div>
          {/* find the record */}
          {uploads.filter(u => u.cid === drawerCid).map((u, i) => (
            <div key={i} style={{ marginTop: 12 }}>
              <div><strong>Title:</strong> {u.title || '—'}</div>
              <div><strong>Description:</strong> {u.description || '—'}</div>
              <div><strong>Category:</strong> {u.category || '—'}</div>
              <div><strong>Price:</strong> {u.price || '—'}</div>
              <div style={{ marginTop: 8 }}>
                {(() => {
                  const ownerNorm = normalizeAddr(u.owner);
                  const isMine = ownerNorm && normAddress && ownerNorm === normAddress;
                  if (isMine) {
                    return (
                      <button onClick={() => window.dispatchEvent(new CustomEvent('dashboard-download', { detail: { cid: drawerCid } }))} style={{ padding: '8px 12px', background: '#06b6d4', color: 'white', border: 'none', borderRadius: 6 }}>Decrypt & Download</button>
                    );
                  }
                  return (
                    <>
                      <button onClick={() => setRentOpenCid(u.cid)} style={{ padding: '8px 12px', background: '#06b6d4', color: 'white', border: 'none', borderRadius: 6 }}>Rent</button>
                    </>
                  );
                })()}
              </div>
            </div>
          ))}
          {rentOpenCid && (
            (() => {
              const rec = uploads.find(u => u.cid === rentOpenCid);
              return <RentModal cid={rentOpenCid} onClose={() => setRentOpenCid(null)} authAddress={address} price={rec?.price} />;
            })()
          )}
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          top: 20,
          right: 20,
          padding: '12px 20px',
          background: '#10b981',
          color: 'white',
          borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 1000,
          fontSize: 14,
          fontWeight: 600
        }}>
          ✅ {toastMessage}
        </div>
      )}
    </div>
  );
};

export default AgentDashboard;
