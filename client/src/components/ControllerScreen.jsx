import React, { useState, useEffect } from 'react';

export default function ControllerScreen({ socket }) {
  const [deviceStatus, setDeviceStatus] = useState({
    phoneAConnected: false,
    phoneBConnected: false,
    controllerConnected: false
  });
  const [score, setScore] = useState({
    home_score: 0,
    away_score: 0,
    clock: '00:00',
    quarter: 1,
    fouls_home: 0,
    fouls_away: 0,
    timeouts_home: 0,
    timeouts_away: 0
  });
  const [isStreaming, setIsStreaming] = useState(false);
  const [setup, setSetup] = useState({
    home_team: 'HOME',
    away_team: 'AWAY',
    stream_key: ''
  });

  const [hasRecorded, setHasRecorded] = useState(false);

  useEffect(() => {
    // Notify server of registration
    socket.emit('DEVICE_CONNECTED', { role: 'controller' });

    // Listeners
    socket.on('DEVICE_STATUS', (status) => {
      setDeviceStatus(status);
    });

    socket.on('INITIAL_STATE', (state) => {
      if (state.setup) setSetup(state.setup);
      if (state.score) setScore(state.score);
      setIsStreaming(state.isStreaming);
    });

    socket.on('SETUP_UPDATE', (newSetup) => {
      setSetup(newSetup);
    });

    socket.on('SCORE_UPDATE', (newScore) => {
      setScore(newScore);
    });

    socket.on('GAME_START', () => {
      setIsStreaming(true);
      setHasRecorded(true);
    });

    socket.on('GAME_STOP', () => {
      setIsStreaming(false);
    });

    return () => {
      socket.off('DEVICE_STATUS');
      socket.off('INITIAL_STATE');
      socket.off('SETUP_UPDATE');
      socket.off('SCORE_UPDATE');
      socket.off('GAME_START');
      socket.off('GAME_STOP');
    };
  }, [socket]);

  const handleStart = () => {
    socket.emit('START_GAME');
  };

  const handleStop = () => {
    socket.emit('STOP_GAME');
  };

  // YouTube live video watch link
  // The actual link on YouTube Live depends on channel, but a general link to the channel live stream or using stream key is:
  // Usually channel's dashboard live or just a placeholder link if we don't know the channel ID.
  // We can show: "https://www.youtube.com/live" or "https://youtube.com/live"
  const youtubeLiveUrl = "https://youtube.com/live";

  return (
    <div className="container">
      <div className="header">
        <h1 className="logo">🏀 CourtCast</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>Broadcast Controller</p>
      </div>

      {/* Device Connection Panel */}
      <div className="glass-panel" style={{ marginBottom: '24px' }}>
        <h2 className="card-title" style={{ marginBottom: '16px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px' }}>Camera Connection Status</h2>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.95rem' }}>Phone A (Scoreboard Reader)</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className={`status-dot ${deviceStatus.phoneAConnected ? 'active' : 'inactive'}`} />
              <span style={{ fontSize: '0.85rem', color: deviceStatus.phoneAConnected ? 'var(--success-color)' : 'var(--text-secondary)' }}>
                {deviceStatus.phoneAConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.95rem' }}>Phone B (Game Video Streamer)</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className={`status-dot ${deviceStatus.phoneBConnected ? 'active' : 'inactive'}`} />
              <span style={{ fontSize: '0.85rem', color: deviceStatus.phoneBConnected ? 'var(--success-color)' : 'var(--text-secondary)' }}>
                {deviceStatus.phoneBConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Broadcast Controls */}
      <div style={{ marginBottom: '24px', textAlign: 'center' }} className={`glass-panel ${isStreaming ? 'glass-panel-glow' : ''}`}>
        <div className="card-header" style={{ justifyContent: 'center', gap: '10px' }}>
          {isStreaming ? (
            <div className="live-indicator">
              <span className="dot" /> Live Broadcasting
            </div>
          ) : (
            <h2 className="card-title">Broadcast Standby</h2>
          )}
        </div>

        <div style={{ margin: '20px 0' }}>
          {!isStreaming ? (
            <button 
              className="btn btn-primary" 
              onClick={handleStart} 
              style={{ width: '100%', padding: '16px 0', fontSize: '1.2rem' }}
              disabled={!deviceStatus.phoneBConnected}
            >
              Start Game Broadcast
            </button>
          ) : (
            <button 
              className="btn btn-danger" 
              onClick={handleStop} 
              style={{ width: '100%', padding: '16px 0', fontSize: '1.2rem' }}
            >
              Stop Broadcast
            </button>
          )}

          {!deviceStatus.phoneBConnected && !isStreaming && (
            <p style={{ fontSize: '0.8rem', color: 'var(--danger-color)', marginTop: '8px' }}>
              ⚠️ Phone B must be connected to start streaming.
            </p>
          )}
        </div>

        {isStreaming && setup.stream_key && (
          <div style={{ marginTop: '16px', padding: '12px', background: 'rgba(255, 107, 0, 0.1)', borderRadius: '8px', border: '1px solid rgba(255, 107, 0, 0.2)' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>YouTube Live Stream Link:</p>
            <a 
              href={youtubeLiveUrl} 
              target="_blank" 
              rel="noopener noreferrer" 
              style={{ color: 'var(--accent-color)', fontWeight: 'bold', fontSize: '0.9rem', wordBreak: 'break-all' }}
            >
              {youtubeLiveUrl}
            </a>
          </div>
        )}
      </div>

      {/* Scoreboard Monitor */}
      <div className="glass-panel" style={{ marginBottom: '24px' }}>
        <h2 className="card-title" style={{ marginBottom: '16px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px', textAlign: 'center' }}>Live Scoreboard Monitor</h2>

        <div className="giant-clock">
          {score.clock}
        </div>
        <p style={{ textAlign: 'center', fontSize: '1rem', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '2px', marginBottom: '20px' }}>
          Quarter {score.quarter}
        </p>

        <div className="giant-number-display">
          <div className="giant-number-box">
            <div className="giant-number-value" style={{ color: 'var(--accent-color)' }}>{score.home_score}</div>
            <div className="giant-number-label">{setup.home_team || 'HOME'}</div>
            <div style={{ marginTop: '10px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Fouls: {score.fouls_home} | T.O: {score.timeouts_home}
            </div>
          </div>

          <div style={{ fontSize: '2.5rem', fontWeight: '900', color: 'var(--text-muted)' }}>vs</div>

          <div className="giant-number-box">
            <div className="giant-number-value">{score.away_score}</div>
            <div className="giant-number-label">{setup.away_team || 'AWAY'}</div>
            <div style={{ marginTop: '10px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Fouls: {score.fouls_away} | T.O: {score.timeouts_away}
            </div>
          </div>
        </div>
      </div>

      {/* Post-Game Downloads */}
      {(!isStreaming && hasRecorded) && (
        <div className="glass-panel" style={{ textAlign: 'center' }}>
          <h2 className="card-title" style={{ marginBottom: '12px' }}>Download Recorded Match</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>The broadcast has finished. You can now download the MP4 file containing the burned-in score banner overlay.</p>
          <a 
            href="/download/latest" 
            className="btn btn-primary" 
            style={{ width: '100%' }}
            download
          >
            Download MP4 Video
          </a>
        </div>
      )}

      <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
        <a href="/setup" className="btn btn-secondary" style={{ flex: 1, fontSize: '0.8rem' }}>
          Back to Setup
        </a>
      </div>
    </div>
  );
}
