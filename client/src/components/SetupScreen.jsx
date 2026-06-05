import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';

export default function SetupScreen({ socket }) {
  const [homeTeam, setHomeTeam] = useState('Bulls');
  const [awayTeam, setAwayTeam] = useState('Lakers');
  const [streamKey, setStreamKey] = useState('');
  const [streamVisibility, setStreamVisibility] = useState('unlisted');
  
  // Live camera preview from Phone A
  const [previewFrame, setPreviewFrame] = useState(null);
  
  // Crop states in percentages (0-100)
  const [cropHome, setCropHome] = useState(null);
  const [cropClock, setCropClock] = useState(null);
  const [cropAway, setCropAway] = useState(null);
  const [activeCropTarget, setActiveCropTarget] = useState('home'); // 'home', 'clock', 'away'
  const [dragStart, setDragStart] = useState(null);
  const containerRef = useRef(null);

  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  const baseUrl = window.location.origin;
  const phoneAUrl = `${baseUrl}/phone-a`;
  const phoneBUrl = `${baseUrl}/phone-b`;

  useEffect(() => {
    // Fetch initial setup config
    fetch('/api/setup')
      .then(res => res.json())
      .then(data => {
        if (data) {
          setHomeTeam(data.home_team || 'Bulls');
          setAwayTeam(data.away_team || 'Lakers');
          setStreamKey(data.stream_key || '');
          setStreamVisibility(data.stream_visibility || 'unlisted');
          setCropHome(data.crop_home || null);
          setCropClock(data.crop_clock || null);
          setCropAway(data.crop_away || null);
        }
      })
      .catch(err => console.error('Error fetching setup config:', err));

    // Listen to live preview frames from Phone A
    socket.on('PHONE_A_PREVIEW', (base64Frame) => {
      setPreviewFrame(base64Frame);
    });

    return () => {
      socket.off('PHONE_A_PREVIEW');
    };
  }, [socket]);

  // Crop tool interactions
  const handleStart = (e) => {
    if (!previewFrame) return; // Only allow crop if we have a camera feed
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    
    setDragStart({ x, y });
    const newCrop = { x, y, width: 0, height: 0 };
    if (activeCropTarget === 'home') setCropHome(newCrop);
    else if (activeCropTarget === 'clock') setCropClock(newCrop);
    else if (activeCropTarget === 'away') setCropAway(newCrop);
  };

  const handleMove = (e) => {
    if (!dragStart) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    const currentX = ((clientX - rect.left) / rect.width) * 100;
    const currentY = ((clientY - rect.top) / rect.height) * 100;
    
    const x = Math.max(0, Math.min(100, Math.min(dragStart.x, currentX)));
    const y = Math.max(0, Math.min(100, Math.min(dragStart.y, currentY)));
    const width = Math.max(0, Math.min(100 - x, Math.abs(currentX - dragStart.x)));
    const height = Math.max(0, Math.min(100 - y, Math.abs(currentY - dragStart.y)));
    
    const newCrop = { x, y, width, height };
    if (activeCropTarget === 'home') setCropHome(newCrop);
    else if (activeCropTarget === 'clock') setCropClock(newCrop);
    else if (activeCropTarget === 'away') setCropAway(newCrop);
  };

  const handleEnd = () => {
    setDragStart(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveStatus('Saving...');

    const payload = {
      home_team: homeTeam,
      away_team: awayTeam,
      stream_key: streamKey,
      stream_visibility: streamVisibility,
      crop_home: cropHome,
      crop_clock: cropClock,
      crop_away: cropAway
    };

    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        setSaveStatus('Configuration saved successfully!');
        setTimeout(() => setSaveStatus(''), 3000);
      } else {
        setSaveStatus('Error saving config.');
      }
    } catch (err) {
      console.error(err);
      setSaveStatus('Network error.');
    } finally {
      setSaving(false);
    }
  };

  const handleResetCrop = () => {
    if (activeCropTarget === 'home') setCropHome(null);
    else if (activeCropTarget === 'clock') setCropClock(null);
    else if (activeCropTarget === 'away') setCropAway(null);
  };

  return (
    <div className="container">
      <div className="header">
        <h1 className="logo">🏀 CourtCast</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>Setup & Configuration</p>
      </div>

      <div className="glass-panel" style={{ marginBottom: '24px' }}>
        <h2 className="card-title" style={{ marginBottom: '16px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px' }}>Game Configuration</h2>
        
        <form onSubmit={handleSave}>
          <div className="form-group">
            <label className="form-label">Home Team Name</label>
            <input 
              type="text" 
              className="form-input" 
              value={homeTeam} 
              onChange={e => setHomeTeam(e.target.value)} 
              placeholder="BULLS" 
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Away Team Name</label>
            <input 
              type="text" 
              className="form-input" 
              value={awayTeam} 
              onChange={e => setAwayTeam(e.target.value)} 
              placeholder="LAKERS" 
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">YouTube RTMP Stream Key</label>
            <input 
              type="password" 
              className="form-input" 
              value={streamKey} 
              onChange={e => setStreamKey(e.target.value)} 
              placeholder="Leave empty to record locally only"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Stream Visibility</label>
            <select 
              className="form-select" 
              value={streamVisibility} 
              onChange={e => setStreamVisibility(e.target.value)}
            >
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Scoreboard Crop Selection</label>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '10px' }}>
              {previewFrame 
                ? "Select a target below, then drag a box on the camera feed to crop it." 
                : "Waiting for Phone A to connect to show camera preview..."}
            </p>

            {previewFrame && (
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <button 
                  type="button" 
                  className="btn"
                  onClick={() => setActiveCropTarget('home')}
                  style={{ 
                    flex: 1, 
                    fontSize: '0.8rem', 
                    padding: '8px', 
                    border: activeCropTarget === 'home' ? '2px solid #ef4444' : '1px solid var(--panel-border)',
                    background: activeCropTarget === 'home' ? 'rgba(239, 68, 68, 0.2)' : 'transparent',
                    color: activeCropTarget === 'home' ? '#ef4444' : 'var(--text-primary)',
                    cursor: 'pointer',
                    borderRadius: '6px'
                  }}
                >
                  🔴 Home Score
                </button>
                <button 
                  type="button" 
                  className="btn"
                  onClick={() => setActiveCropTarget('clock')}
                  style={{ 
                    flex: 1, 
                    fontSize: '0.8rem', 
                    padding: '8px', 
                    border: activeCropTarget === 'clock' ? '2px solid #eab308' : '1px solid var(--panel-border)',
                    background: activeCropTarget === 'clock' ? 'rgba(234, 179, 8, 0.2)' : 'transparent',
                    color: activeCropTarget === 'clock' ? '#eab308' : 'var(--text-primary)',
                    cursor: 'pointer',
                    borderRadius: '6px'
                  }}
                >
                  🟡 Game Clock
                </button>
                <button 
                  type="button" 
                  className="btn"
                  onClick={() => setActiveCropTarget('away')}
                  style={{ 
                    flex: 1, 
                    fontSize: '0.8rem', 
                    padding: '8px', 
                    border: activeCropTarget === 'away' ? '2px solid #3b82f6' : '1px solid var(--panel-border)',
                    background: activeCropTarget === 'away' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                    color: activeCropTarget === 'away' ? '#3b82f6' : 'var(--text-primary)',
                    cursor: 'pointer',
                    borderRadius: '6px'
                  }}
                >
                  🔵 Away Score
                </button>
              </div>
            )}

            <div 
              className="crop-container"
              ref={containerRef}
              onMouseDown={handleStart}
              onMouseMove={handleMove}
              onMouseUp={handleEnd}
              onTouchStart={handleStart}
              onTouchMove={handleMove}
              onTouchEnd={handleEnd}
            >
              {previewFrame ? (
                <img 
                  src={previewFrame} 
                  alt="Phone A Preview" 
                  className="crop-preview" 
                  draggable={false}
                />
              ) : (
                <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  No feed active from Phone A
                </div>
              )}

              {cropHome && (
                <div 
                  className="crop-overlay-rect"
                  style={{
                    left: `${cropHome.x}%`,
                    top: `${cropHome.y}%`,
                    width: `${cropHome.width}%`,
                    height: `${cropHome.height}%`,
                    borderColor: '#ef4444',
                    background: 'rgba(239, 68, 68, 0.15)'
                  }}
                >
                  <span style={{ position: 'absolute', top: '-18px', left: '0', fontSize: '0.7rem', color: '#ef4444', fontWeight: 'bold' }}>HOME</span>
                </div>
              )}

              {cropClock && (
                <div 
                  className="crop-overlay-rect"
                  style={{
                    left: `${cropClock.x}%`,
                    top: `${cropClock.y}%`,
                    width: `${cropClock.width}%`,
                    height: `${cropClock.height}%`,
                    borderColor: '#eab308',
                    background: 'rgba(234, 179, 8, 0.15)'
                  }}
                >
                  <span style={{ position: 'absolute', top: '-18px', left: '0', fontSize: '0.7rem', color: '#eab308', fontWeight: 'bold' }}>CLOCK</span>
                </div>
              )}

              {cropAway && (
                <div 
                  className="crop-overlay-rect"
                  style={{
                    left: `${cropAway.x}%`,
                    top: `${cropAway.y}%`,
                    width: `${cropAway.width}%`,
                    height: `${cropAway.height}%`,
                    borderColor: '#3b82f6',
                    background: 'rgba(59, 130, 246, 0.15)'
                  }}
                >
                  <span style={{ position: 'absolute', top: '-18px', left: '0', fontSize: '0.7rem', color: '#3b82f6', fontWeight: 'bold' }}>AWAY</span>
                </div>
              )}

              {previewFrame && (
                <div className="crop-instruction">
                  Drag to crop selected target ({activeCropTarget.toUpperCase()})
                </div>
              )}
            </div>

            {((activeCropTarget === 'home' && cropHome) || 
              (activeCropTarget === 'clock' && cropClock) || 
              (activeCropTarget === 'away' && cropAway)) && (
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={handleResetCrop} 
                style={{ marginTop: '10px', fontSize: '0.8rem', padding: '6px 12px' }}
              >
                Reset Crop {activeCropTarget.toUpperCase()}
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '30px' }}>
            <button 
              type="submit" 
              className="btn btn-primary" 
              disabled={saving}
              style={{ flex: 1 }}
            >
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
          
          {saveStatus && (
            <p style={{ textAlign: 'center', marginTop: '12px', fontSize: '0.9rem', color: saveStatus.includes('Error') ? 'var(--danger-color)' : 'var(--success-color)' }}>
              {saveStatus}
            </p>
          )}
        </form>
      </div>

      <div className="glass-panel">
        <h2 className="card-title" style={{ marginBottom: '16px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px' }}>Device Links & QR Codes</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>Scan these QR codes with your smartphones to open the cameras.</p>
        
        <div className="qr-grid">
          <div className="qr-card">
            <h4>Phone A (Scoreboard Camera)</h4>
            <div className="qr-container">
              <QRCodeSVG value={phoneAUrl} size={120} />
            </div>
            <a href={phoneAUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-color)', fontSize: '0.8rem', textDecoration: 'none' }}>
              Open Phone A Link
            </a>
          </div>

          <div className="qr-card">
            <h4>Phone B (Game Camera)</h4>
            <div className="qr-container">
              <QRCodeSVG value={phoneBUrl} size={120} />
            </div>
            <a href={phoneBUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-color)', fontSize: '0.8rem', textDecoration: 'none' }}>
              Open Phone B Link
            </a>
          </div>
        </div>

        <div style={{ marginTop: '20px', textAlign: 'center', borderTop: '1px solid var(--panel-border)', paddingTop: '16px' }}>
          <a href="/controller" className="btn btn-secondary" style={{ width: '100%' }}>
            Go to Controller Screen
          </a>
        </div>
      </div>
    </div>
  );
}
