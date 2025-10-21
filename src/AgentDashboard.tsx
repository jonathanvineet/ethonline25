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

const AgentCard: React.FC<{ agent: UploadRecord; owner?: string; isMine?: boolean; onView?: (cid: string) => void; onDownload?: (cid: string) => void; focused?: boolean }> = ({ agent, owner, isMine, onView, onDownload, focused }) => {
  const handleCopy = () => navigator.clipboard.writeText(agent.cid);
  const handleDownload = () => {
    if (onDownload) onDownload(agent.cid);
    else window.dispatchEvent(new CustomEvent('dashboard-download', { detail: { cid: agent.cid } }));
  };

  return (
  <div style={{ padding: 12, border: '1px solid #e6edf6', borderRadius: 8, marginBottom: 8, background: '#fff', boxShadow: focused ? '0 0 0 4px rgba(139,92,246,0.12)' : undefined }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 700 }}>{agent.title || agent.cid}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>{agent.description || 'No description'}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{agent.price || ''}</div>
          {isMine && <div style={{ marginTop: 6, padding: '4px 8px', background: '#d1fae5', color: '#065f46', borderRadius: 6, fontSize: 12 }}>You</div>}
        </div>
      </div>

      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
  <button onClick={handleDownload} style={{ padding: '8px 12px', background: '#06b6d4', color: 'white', border: 'none', borderRadius: 6 }}>Download</button>
        <button onClick={handleCopy} style={{ padding: '8px 12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: 6 }}>Copy CID</button>
  <button onClick={() => { onView && onView(agent.cid); window.dispatchEvent(new CustomEvent('focus-agent', { detail: { cid: agent.cid } })); }} style={{ padding: '8px 12px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: 6 }}>View Details</button>
      </div>

      <div style={{ marginTop: 8, fontSize: 12, color: '#374151' }}><strong>CID:</strong> <span style={{ fontFamily: 'monospace' }}>{agent.cid}</span></div>
      {owner && <div style={{ marginTop: 4, fontSize: 12, color: '#6b7280' }}><strong>Owner:</strong> <span style={{ fontFamily: 'monospace' }}>{owner}</span></div>}
    </div>
  );
};

const AgentDashboard: React.FC = () => {
  const { address } = useAccount();
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [drawerCid, setDrawerCid] = useState<string | null>(null);
  const [focusedCid, setFocusedCid] = useState<string | null>(null);
  const [rentOpenCid, setRentOpenCid] = useState<string | null>(null);

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

  const myAgents = withOwners.filter(u => {
    const ownerNorm = normalizeAddr((u as any).owner);
    return ownerNorm && normAddress && ownerNorm === normAddress;
  });

  const otherAgents = withOwners.filter(u => {
    const ownerNorm = normalizeAddr((u as any).owner);
    return !(ownerNorm && normAddress && ownerNorm === normAddress);
  });

  return (
    <div style={{ width: '100%', maxWidth: 900, margin: '1rem auto', padding: 12 }}>
      <h2 style={{ marginTop: 0 }}>Agent Dashboard</h2>

      <h3>Your Agents</h3>
      {myAgents.length === 0 && <div style={{ color: '#6b7280', marginBottom: 8 }}>You have no uploaded agents yet.</div>}
      {myAgents.map((a, i) => (
        <AgentCard key={i} agent={a} owner={(a as any).owner} isMine={true} onView={(cid) => setDrawerCid(cid)} onDownload={(cid) => window.dispatchEvent(new CustomEvent('dashboard-download', { detail: { cid } }))} focused={focusedCid === a.cid} />
      ))}

      <h3 style={{ marginTop: 18 }}>Other Agents</h3>
      {/* show mocked agents first */}
      {mockOtherAgents.map((m, i) => (
        <AgentCard key={`mock-${i}`} agent={m} owner={`0xMockOwner${i}`} onView={(cid) => setDrawerCid(cid)} onDownload={(cid) => setRentOpenCid(cid)} focused={focusedCid === m.cid} />
      ))}

      {/* then show other uploaded agents (not owned by you) */}
      {otherAgents.map((a, i) => (
        <AgentCard key={`other-${i}`} agent={a} owner={(a as any).owner} onView={(cid) => setDrawerCid(cid)} onDownload={(cid) => setRentOpenCid(cid)} focused={focusedCid === a.cid} />
      ))}

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
    </div>
  );
};

export default AgentDashboard;
