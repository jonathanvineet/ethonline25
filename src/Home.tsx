import React from 'react';

const Home: React.FC<{ navigate: (view: 'home'|'dashboard'|'upload'|'my') => void; connected: boolean; walletName?: string }> = ({ navigate, connected, walletName }) => {
  return (
    <div style={{ width: '100%', minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, #0f172a, #031225)', color: 'white', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 900 }}>
        <h1 style={{ fontSize: 38, marginBottom: 8 }}>Your AI Command Center</h1>
        <p style={{ color: '#9ca3af' }}>What would you like to do?</p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 20 }}>
          <button onClick={() => navigate('upload')} style={{ padding: '12px 20px', borderRadius: 999, background: 'linear-gradient(90deg,#06b6d4,#8b5cf6)', color: 'white', border: 'none', fontWeight: 600 }}>Upload an agent</button>
          <button onClick={() => navigate('dashboard')} style={{ padding: '12px 20px', borderRadius: 999, background: 'rgba(255,255,255,0.06)', color: 'white', border: '1px solid rgba(255,255,255,0.04)', fontWeight: 600 }}>Discover agents</button>
          <button onClick={() => navigate('my')} style={{ padding: '12px 20px', borderRadius: 999, background: 'rgba(255,255,255,0.06)', color: 'white', border: '1px solid rgba(255,255,255,0.04)', fontWeight: 600 }}>Access my vault</button>
        </div>

        <div style={{ marginTop: 28, color: '#c7d2fe' }}>
          {!connected ? (
            <div style={{ fontWeight: 600 }}>Connect Wallet to begin — Initializing Neural Identity...</div>
          ) : (
            <div style={{ fontWeight: 600 }}>Welcome back, Commander {walletName || 'Operator'}</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Home;
