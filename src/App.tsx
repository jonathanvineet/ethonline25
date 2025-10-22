import './App.css';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import LighthouseUploader from './LighthouseUploader';
import AgentDashboard from './AgentDashboard';
import Home from './Home';
import UploadAgent from './UploadAgent';
import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';

function App() {
  const [view, setView] = useState<'home'|'dashboard'|'upload'|'my'>('home');
  const { address, isConnected } = useAccount();
  // Listen for global navigate events so other components can trigger view changes
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as any;
      if (detail?.view && (detail.view === 'home' || detail.view === 'dashboard' || detail.view === 'upload' || detail.view === 'my')) {
        setView(detail.view);
      }
    };
    window.addEventListener('navigate', handler as EventListener);
    return () => window.removeEventListener('navigate', handler as EventListener);
  }, []);
  return (
    <div style={{ minHeight: '100vh', background: '#0b1220', color: 'white' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: 12, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>ANNOL</h2>
          <nav style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setView('home')}>Home</button>
            <button onClick={() => setView('dashboard')}>Explore</button>
            <button onClick={() => setView('upload')}>Upload</button>
            <button onClick={() => setView('my')}>My Agents</button>
          </nav>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button 
            onClick={() => setView('upload')} 
            style={{ 
              padding: '12px 20px', 
              borderRadius: 999, 
              background: 'linear-gradient(90deg,#06b6d4,#8b5cf6)', 
              color: 'white', 
              border: 'none', 
              fontWeight: 600,
              fontSize: '14px'
            }}
          >
            Upload Agent
          </button>
          <ConnectButton />
        </div>
      </div>
      {view === 'home' && <Home navigate={(v)=>setView(v)} connected={isConnected} walletName={address} />}
      {view === 'dashboard' && <AgentDashboard />}
      {view === 'upload' && <UploadAgent />}
      {view === 'my' && (
        <div style={{ padding: 12 }}>
          <h2>My Agents</h2>
          <AgentDashboard />
        </div>
      )}
      <LighthouseUploader />
    </div>
  );
}

export default App;

