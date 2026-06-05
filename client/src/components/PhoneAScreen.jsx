import React, { useState, useEffect, useRef } from 'react';
import Tesseract from 'tesseract.js';

function parseScoreboardText(text) {
  // Normalize whitespace and split by space
  const tokens = text.replace(/[^0-9:]/g, ' ') // Replace non-numeric/non-colon characters with space
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(t => t.length > 0);

  console.log('[OCR] Normalized tokens:', tokens);

  const parsed = {};

  // 1. Extract clock (contains a colon ':')
  let clockToken = null;
  let clockIdx = tokens.findIndex(t => t.includes(':'));

  if (clockIdx === -1) {
    // Look for a 3-4 digit number that could be a clock (e.g., "1234" -> "12:34")
    clockIdx = tokens.findIndex(t => /^\d{3,4}$/.test(t));
    if (clockIdx !== -1) {
      const t = tokens[clockIdx];
      const mid = t.length - 2;
      clockToken = t.slice(0, mid) + ':' + t.slice(mid);
    }
  } else {
    clockToken = tokens[clockIdx];
  }

  if (clockToken && /^\d{1,2}:\d{2}$/.test(clockToken)) {
    parsed.clock = clockToken;
  }

  // 2. Extract all other clean numbers
  const numberTokens = [];
  tokens.forEach((t, idx) => {
    if (idx === clockIdx) return; // Skip clock token
    const val = parseInt(t.replace(/[^0-9]/g, ''), 10);
    if (!isNaN(val)) {
      numberTokens.push({ val, originalIdx: idx });
    }
  });

  console.log('[OCR] Extracted numbers:', numberTokens.map(n => n.val));

  // If no numbers extracted, return what we have (e.g. clock only)
  if (numberTokens.length === 0) {
    return parsed;
  }

  // Helper to assign scores and quarter based on count of numbers
  if (numberTokens.length === 2) {
    // Simple layout: just Home Score and Away Score
    parsed.home_score = numberTokens[0].val;
    parsed.away_score = numberTokens[1].val;
  } 
  else if (numberTokens.length === 3) {
    // Layout with quarter: e.g., [Home, Quarter, Away] or [Home, Away, Quarter]
    const possibleQuarterIdx = numberTokens.findIndex(n => n.val >= 1 && n.val <= 4);
    if (possibleQuarterIdx !== -1 && numberTokens.filter(n => n.val > 4).length >= 2) {
      parsed.quarter = numberTokens[possibleQuarterIdx].val;
      const scores = numberTokens.filter((_, idx) => idx !== possibleQuarterIdx);
      parsed.home_score = scores[0].val;
      parsed.away_score = scores[1].val;
    } else {
      parsed.home_score = numberTokens[0].val;
      parsed.away_score = numberTokens[1].val;
      if (numberTokens[2].val >= 1 && numberTokens[2].val <= 4) {
        parsed.quarter = numberTokens[2].val;
      }
    }
  } 
  else if (numberTokens.length >= 4) {
    const sorted = [...numberTokens].sort((a, b) => a.originalIdx - b.originalIdx);

    if (clockIdx !== -1) {
      const beforeClock = sorted.filter(n => n.originalIdx < clockIdx);
      const afterClock = sorted.filter(n => n.originalIdx > clockIdx);

      if (beforeClock.length >= 1 && afterClock.length >= 2) {
        parsed.home_score = beforeClock[beforeClock.length - 1].val;
        if (afterClock[0].val >= 1 && afterClock[0].val <= 4) {
          parsed.quarter = afterClock[0].val;
          parsed.away_score = afterClock[1].val;
          
          const stats = afterClock.slice(2);
          if (stats.length >= 1) parsed.fouls_home = stats[0].val;
          if (stats.length >= 2) parsed.timeouts_home = stats[1].val;
          if (stats.length >= 3) parsed.timeouts_away = stats[2].val;
          if (stats.length >= 4) parsed.fouls_away = stats[3].val;
        } else {
          parsed.away_score = afterClock[0].val;
          const stats = afterClock.slice(1);
          if (stats.length >= 1) parsed.fouls_home = stats[0].val;
          if (stats.length >= 2) parsed.fouls_away = stats[1].val;
        }
      }
      else if (beforeClock.length === 0 && afterClock.length >= 2) {
        parsed.home_score = afterClock[0].val;
        parsed.away_score = afterClock[1].val;
        
        const stats = afterClock.slice(2);
        if (stats.length >= 1 && stats[0].val >= 1 && stats[0].val <= 4) {
          parsed.quarter = stats[0].val;
          const remainingStats = stats.slice(1);
          if (remainingStats.length >= 1) parsed.fouls_home = remainingStats[0].val;
          if (remainingStats.length >= 2) parsed.fouls_away = remainingStats[1].val;
        } else {
          if (stats.length >= 1) parsed.fouls_home = stats[0].val;
          if (stats.length >= 2) parsed.fouls_away = stats[1].val;
        }
      }
    } else {
      parsed.home_score = sorted[0].val;
      parsed.away_score = sorted[1].val;
      if (sorted[2].val >= 1 && sorted[2].val <= 4) {
        parsed.quarter = sorted[2].val;
      }
    }
  }

  return parsed;
}

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
  const [isPlaying, setIsPlaying] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const isProcessingRef = useRef(false);

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
        videoRef.current.play()
          .then(() => setIsPlaying(true))
          .catch((e) => console.log('Autoplay blocked, waiting for tap:', e));
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
  }, [crop, isPlaying]); // Restart interval whenever the crop bounds or playing status changes

  const processFrame = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (video && video.readyState === video.HAVE_ENOUGH_DATA && canvas && isPlaying) {
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;

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

        setOcrStatus('Reading locally...');
        try {
          // Perform OCR locally in the browser
          const { data: { text } } = await Tesseract.recognize(canvas, 'eng', {
            parameters: {
              tessedit_char_whitelist: '0123456789:',
              tessedit_pageseg_mode: '11' // Sparse text
            }
          });
          
          console.log('[OCR] Raw text:', text);
          const parsed = parseScoreboardText(text);
          console.log('[OCR] Parsed values:', parsed);

          if (Object.keys(parsed).length > 0) {
            socket.emit('SCORE_UPDATE_REQUEST', parsed);
            setOcrStatus('Read Successful');
          } else {
            setOcrStatus('Read Empty/No digits');
          }
        } catch (err) {
          console.error('[OCR] Local recognition failed:', err);
          setOcrStatus('OCR Error');
        } finally {
          isProcessingRef.current = false;
        }
      } else {
        // No crop config yet. Capture and downscale to send to setup screen via socket maintaining correct aspect ratio
        const targetWidth = 640;
        const targetHeight = Math.round((vh / vw) * targetWidth);
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, vw, vh, 0, 0, targetWidth, targetHeight);
        
        const base64Frame = canvas.toDataURL('image/jpeg', 0.65);
        socket.emit('PHONE_A_PREVIEW', base64Frame);
        setOcrStatus('Streaming preview...');
        isProcessingRef.current = false;
      }
    }
  };

  const handlePlayVideo = () => {
    if (videoRef.current) {
      videoRef.current.play()
        .then(() => setIsPlaying(true))
        .catch(err => console.error('Play trigger failed:', err));
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

        <div 
          onClick={handlePlayVideo}
          style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000000', borderRadius: '8px', overflow: 'hidden', cursor: 'pointer' }}
        >
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted 
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />

          {!isPlaying && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.8)', color: '#ffffff', zIndex: 10 }}>
              <span style={{ fontSize: '2.5rem', marginBottom: '12px' }}>📷</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 'bold', fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
                Tap to Start Camera Feed
              </span>
            </div>
          )}

          {/* Display overlay indicating crop coordinates if they exist */}
          {crop && isPlaying && (
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
