
import './App.css';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import LighthouseUploader from './LighthouseUploader';

function App() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <h1>RainbowKit + Vite + React</h1>
      <ConnectButton />
      <LighthouseUploader />
    </div>
  );
}

export default App;
