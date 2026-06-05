import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';

export default function SetupScreen({ socket }) {
  const [homeTeam, setHomeTeam] = useState('Bulls');
  const [awayTeam, setAwayTeam] = useState('Lakers');
  const [streamKey, setStreamKey] = useState('');
  const [streamVisibility, setStreamVisibility] = useState('unlisted');
  
  // Live camera preview from Phone A
  const [previewFrame, setPreviewFrame] = useState(null);
  
  // Crop state in percentages (0-100)
  const [crop, setCrop] = useState(null);
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
          setCrop(data.crop || null);
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
    setCrop({ x, y, width: 0, height: 0 });
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
    
    setCrop({ x, y, width, height });
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
      crop
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
    setCrop(null);
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
                ? "Drag a box over the scoreboard region from Phone A's live feed below." 
                : "Waiting for Phone A to connect to show camera preview..."}
            </p>

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

              {crop && (
                <div 
                  className="crop-overlay-rect"
                  style={{
                    left: `${crop.x}%`,
                    top: `${crop.y}%`,
                    width: `${crop.width}%`,
                    height: `${crop.height}%`
                  }}
                />
              )}

              {previewFrame && (
                <div className="crop-instruction">
                  {crop ? `Selected: ${crop.width.toFixed(0)}x${crop.height.toFixed(0)}%` : "Drag to crop scoreboard"}
                </div>
              )}
            </div>

            {crop && (
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={handleResetCrop} 
                style={{ marginTop: '10px', fontSize: '0.8rem', padding: '6px 12px' }}
              >
                Reset Crop
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
