import React from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom';
import { io } from 'socket.io-client';

import SetupScreen from './components/SetupScreen';
import ControllerScreen from './components/ControllerScreen';
import PhoneAScreen from './components/PhoneAScreen';
import PhoneBScreen from './components/PhoneBScreen';

// Determine Socket server URL dynamically
const socketUrl = window.location.hostname === 'localhost' && window.location.port === '3000'
  ? 'http://localhost:3001'
  : window.location.origin;

console.log('[App] Connecting to socket server at:', socketUrl);
const socket = io(socketUrl);

function HomeScreen() {
  return (
    <div className="container">
      <div className="header" style={{ marginBottom: '40px' }}>
        <h1 className="logo">🏀 CourtCast</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>Basketball Live Broadcast System</p>
      </div>

      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h2 className="card-title" style={{ textAlign: 'center', marginBottom: '10px' }}>Select Device Screen</h2>
        
        <Link to="/setup" className="btn btn-primary" style={{ width: '100%' }}>
          1. Setup & Configuration
        </Link>
        
        <Link to="/controller" className="btn btn-secondary" style={{ width: '100%' }}>
          2. Broadcast Controller
        </Link>
        
        <Link to="/phone-a" className="btn btn-secondary" style={{ width: '100%' }}>
          3. Phone A (Scoreboard Reader)
        </Link>
        
        <Link to="/phone-b" className="btn btn-secondary" style={{ width: '100%' }}>
          4. Phone B (Game Camera)
        </Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/setup" element={<SetupScreen socket={socket} />} />
        <Route path="/controller" element={<ControllerScreen socket={socket} />} />
        <Route path="/phone-a" element={<PhoneAScreen socket={socket} />} />
        <Route path="/phone-b" element={<PhoneBScreen socket={socket} />} />
        {/* Catch-all fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
