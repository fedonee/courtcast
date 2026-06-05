import React, { useState, useEffect, useRef } from 'react';

export default function PhoneAScreen({ socket }) {
  const [crop, setCrop] = useState(null);
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

  const [cameraStatus, setCameraStatus] = useState('Initializing camera...');
  const [ocrStatus, setOcrStatus] = useState('Standby');
  const [setup, setSetup] = useState({ home_team: 'HOME', away_team: 'AWAY' });

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);

  // Initialize camera and socket connection
  useEffect(() => {
    // Notify server of registration
    socket.emit('DEVICE_CONNECTED', { role: 'phone-a' });

    // Listeners
    socket.on('INITIAL_STATE', (state) => {
      if (state.setup) {
        setSetup(state.setup);
        setCrop(state.setup.crop || null);
      }
      if (state.score) setScore(state.score);
    });

    socket.on('SETUP_UPDATE', (newSetup) => {
      setSetup(newSetup);
      setCrop(newSetup.crop || null);
    });

    socket.on('SCORE_UPDATE', (newScore) => {
      setScore(newScore);
    });

    // Start rear camera
    navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' }, // Rear camera
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    })
    .then((stream) => {
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraStatus('Camera Active');
    })
    .catch((err) => {
      console.error('Error accessing rear camera:', err);
      setCameraStatus('Camera Error: Access Denied or No Rear Camera');
    });

    return () => {
      socket.off('INITIAL_STATE');
      socket.off('SETUP_UPDATE');
      socket.off('SCORE_UPDATE');
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [socket]);

  // Start the frame processing loop (runs every 2 seconds)
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(() => {
      processFrame();
    }, 2000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [crop]); // Restart interval whenever the crop bounds change

  const postOCRFrame = async (jpegBlob) => {
    setOcrStatus('Reading...');
    try {
      const res = await fetch('/ocr/frame', {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: jpegBlob
      });
      const data = await res.json();
      if (data.success) {
        setOcrStatus('Read Successful');
      } else {
        setOcrStatus('Read Empty/Failed');
      }
    } catch (err) {
      console.error('[OCR] Post failed:', err);
      setOcrStatus('Network Error');
    }
  };

  const processFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (video && video.readyState === video.HAVE_ENOUGH_DATA && canvas) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;

      if (crop && crop.width > 0 && crop.height > 0) {
        // Calculate crop bounds in pixels
        const cx = (crop.x / 100) * vw;
        const cy = (crop.y / 100) * vh;
        const cw = (crop.width / 100) * vw;
        const ch = (crop.height / 100) * vh;

        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        // Crop and draw
        ctx.drawImage(video, cx, cy, cw, ch, 0, 0, cw, ch);

        // Convert canvas to jpeg blob and upload
        canvas.toBlob((blob) => {
          if (blob) {
            postOCRFrame(blob);
          }
        }, 'image/jpeg', 0.85);
      } else {
        // No crop config yet. Capture and downscale to send to setup screen via socket
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, vw, vh, 0, 0, 640, 480);
        
        const base64Frame = canvas.toDataURL('image/jpeg', 0.65);
        socket.emit('PHONE_A_PREVIEW', base64Frame);
        setOcrStatus('Streaming preview...');
      }
    }
  };

  return (
    <div className="container" style={{ paddingBottom: '40px' }}>
      <div className="header">
        <h1 className="logo">🏀 CourtCast</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>Phone A — Scoreboard Reader</p>
      </div>

      {/* Camera Preview */}
      <div className="glass-panel" style={{ marginBottom: '24px', overflow: 'hidden' }}>
        <div className="card-header">
          <h2 className="card-title">Live Scoreboard Camera</h2>
          <span className="live-indicator">
            <span className="dot" style={{ backgroundColor: cameraStatus === 'Camera Active' ? 'var(--success-color)' : 'var(--danger-color)' }} />
            {cameraStatus}
          </span>
        </div>

        <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000000', borderRadius: '8px', overflow: 'hidden' }}>
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted 
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
          {/* Display overlay indicating crop coordinates if they exist */}
          {crop && (
            <div 
              style={{
                position: 'absolute',
                border: '2px solid var(--accent-color)',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
                left: `${crop.x}%`,
                top: `${crop.y}%`,
                width: `${crop.width}%`,
                height: `${crop.height}%`,
                pointerEvents: 'none'
              }}
            />
          )}
        </div>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            OCR Pipeline Status:
          </span>
          <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: ocrStatus.includes('Successful') ? 'var(--success-color)' : 'var(--accent-color)' }}>
            {ocrStatus}
          </span>
        </div>

        {/* Hidden canvas for extracting pixel data */}
        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>

      {/* OCR Result Monitor */}
      <div className="glass-panel">
        <h2 className="card-title" style={{ marginBottom: '16px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px', textAlign: 'center' }}>Last Successfully Read Values</h2>

        <div className="giant-clock">
          {score.clock}
        </div>
        <p style={{ textAlign: 'center', fontSize: '1rem', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '2px', marginBottom: '20px' }}>
          Quarter {score.quarter}
        </p>

        <div className="giant-number-display">
          <div className="giant-number-box">
            <div className="giant-number-value" style={{ color: 'var(--accent-color)' }}>{score.home_score}</div>
            <div className="giant-number-label">{setup.home_team}</div>
            <div style={{ marginTop: '10px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Fouls: {score.fouls_home} | T.O: {score.timeouts_home}
            </div>
          </div>

          <div style={{ fontSize: '2.5rem', fontWeight: '900', color: 'var(--text-muted)' }}>vs</div>

          <div className="giant-number-box">
            <div className="giant-number-value">{score.away_score}</div>
            <div className="giant-number-label">{setup.away_team}</div>
            <div style={{ marginTop: '10px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Fouls: {score.fouls_away} | T.O: {score.timeouts_away}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
