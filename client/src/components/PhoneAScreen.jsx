import React, { useState, useEffect, useRef } from 'react';

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

function preprocessCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;

  let min = 255;
  let max = 0;
  const intensity = new Uint8Array(data.length / 4);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i+1];
    const b = data[i+2];
    
    // Scoreboards are red, orange, yellow, green. Max(r, g) highlights these colors
    // and ignores blue-tinted reflections or white glare.
    const val = Math.max(r, g);
    intensity[i/4] = val;
    if (val < min) min = val;
    if (val > max) max = val;
  }

  // Find threshold (midpoint between min and max)
  const threshold = max - min > 35 ? min + (max - min) * 0.45 : 120;

  for (let i = 0; i < data.length; i += 4) {
    const val = intensity[i/4];
    // Bright text (val > threshold) becomes black (0), background becomes white (255)
    const finalVal = val > threshold ? 0 : 255;
    data[i] = finalVal;
    data[i+1] = finalVal;
    data[i+2] = finalVal;
  }
  
  ctx.putImageData(imgData, 0, 0);
}

const isPointActive = (data, imgW, imgH, px, py) => {
  const cx = Math.max(0, Math.min(imgW - 1, Math.round(px)));
  const cy = Math.max(0, Math.min(imgH - 1, Math.round(py)));
  
  let blackCount = 0;
  let total = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx >= 0 && nx < imgW && ny >= 0 && ny < imgH) {
        const idx = (ny * imgW + nx) * 4;
        if (data[idx] === 0) {
          blackCount++;
        }
        total++;
      }
    }
  }
  return (blackCount / total) > 0.4;
};

const classifyDigit = (segments, box) => {
  const aspect = box.w / box.h;
  if (aspect < 0.35) {
    return '1';
  }
  
  const [segA, segB, segC, segD, segE, segF, segG] = segments;
  
  const patterns = {
    '0': [true, true, true, true, true, true, false],
    '1': [false, true, true, false, false, false, false],
    '2': [true, true, false, true, true, false, true],
    '3': [true, true, true, true, false, false, true],
    '4': [false, true, true, false, false, true, true],
    '5': [true, false, true, true, false, true, true],
    '6': [true, false, true, true, true, true, true],
    '7': [true, true, true, false, false, false, false],
    '8': [true, true, true, true, true, true, true],
    '9': [true, true, true, true, false, true, true]
  };
  
  let bestDigit = null;
  let minDiff = 8;
  for (const [digit, pat] of Object.entries(patterns)) {
    let diff = 0;
    for (let i = 0; i < 7; i++) {
      if (segments[i] !== pat[i]) {
        diff++;
      }
    }
    if (diff < minDiff) {
      minDiff = diff;
      bestDigit = digit;
    }
  }
  
  if (minDiff >= 3) {
    return null;
  }
  return bestDigit;
};

function recognizeSevenSegmentText(canvas, isClock) {
  preprocessCanvas(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  const w = canvas.width;
  const h = canvas.height;

  // 1. Column density
  const colDensity = new Array(w).fill(0);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const idx = (y * w + x) * 4;
      if (data[idx] === 0) { // black pixel
        colDensity[x]++;
      }
    }
  }

  // 2. Segment columns into digits
  const digits = [];
  let inDigit = false;
  let startX = 0;
  for (let x = 0; x < w; x++) {
    const hasBlack = colDensity[x] >= 1;
    if (hasBlack && !inDigit) {
      inDigit = true;
      startX = x;
    } else if (!hasBlack && inDigit) {
      inDigit = false;
      if (x - startX >= 2) {
        digits.push({ x: startX, width: x - startX });
      }
    }
  }
  if (inDigit) {
    if (w - startX >= 2) {
      digits.push({ x: startX, width: w - startX });
    }
  }

  // 3. Classify each digit
  const recognized = [];
  for (const digit of digits) {
    let minY = h;
    let maxY = 0;
    let hasAny = false;
    for (let y = 0; y < h; y++) {
      for (let x = digit.x; x < digit.x + digit.width; x++) {
        const idx = (y * w + x) * 4;
        if (data[idx] === 0) {
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          hasAny = true;
        }
      }
    }

    if (!hasAny) continue;

    const box = {
      x: digit.x,
      y: minY,
      w: digit.width,
      h: Math.max(1, maxY - minY + 1)
    };

    if (box.h < 6) continue;

    // Check for colon in Clock
    if (isClock && (box.w / box.h < 0.22)) {
      recognized.push(':');
      continue;
    }

    if (box.w < 2) continue;

    // Sample 7 segments
    const segA = isPointActive(data, w, h, box.x + box.w * 0.5, box.y + box.h * 0.08);
    const segB = isPointActive(data, w, h, box.x + box.w * 0.88, box.y + box.h * 0.28);
    const segC = isPointActive(data, w, h, box.x + box.w * 0.88, box.y + box.h * 0.72);
    const segD = isPointActive(data, w, h, box.x + box.w * 0.5, box.y + box.h * 0.92);
    const segE = isPointActive(data, w, h, box.x + box.w * 0.12, box.y + box.h * 0.72);
    const segF = isPointActive(data, w, h, box.x + box.w * 0.12, box.y + box.h * 0.28);
    const segG = isPointActive(data, w, h, box.x + box.w * 0.5, box.y + box.h * 0.5);

    const segments = [segA, segB, segC, segD, segE, segF, segG];
    const digitChar = classifyDigit(segments, box);
    if (digitChar !== null) {
      recognized.push(digitChar);
    }
  }

  return recognized.join('');
}

export default function PhoneAScreen({ socket }) {
  const [cropHome, setCropHome] = useState(null);
  const [cropClock, setCropClock] = useState(null);
  const [cropAway, setCropAway] = useState(null);
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
  const canvasHomeRef = useRef(null);
  const canvasClockRef = useRef(null);
  const canvasAwayRef = useRef(null);
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
        setCropHome(state.setup.crop_home || null);
        setCropClock(state.setup.crop_clock || null);
        setCropAway(state.setup.crop_away || null);
      }
      if (state.score) setScore(state.score);
    });

    socket.on('SETUP_UPDATE', (newSetup) => {
      setSetup(newSetup);
      setCropHome(newSetup.crop_home || null);
      setCropClock(newSetup.crop_clock || null);
      setCropAway(newSetup.crop_away || null);
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
  }, [cropHome, cropClock, cropAway, isPlaying]); // Restart interval whenever crop bounds or playing status changes

  const processFrame = async () => {
    const video = videoRef.current;
    
    if (video && video.readyState === video.HAVE_ENOUGH_DATA && isPlaying) {
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const hasCrops = (cropHome && cropHome.width > 0) || (cropClock && cropClock.width > 0) || (cropAway && cropAway.width > 0);

      if (hasCrops) {
        setOcrStatus('Reading locally...');
        const parsed = {};

        try {
          // 1. Process Home Score
          if (cropHome && cropHome.width > 0 && cropHome.height > 0 && canvasHomeRef.current) {
            const canvas = canvasHomeRef.current;
            const cx = (cropHome.x / 100) * vw;
            const cy = (cropHome.y / 100) * vh;
            const cw = (cropHome.width / 100) * vw;
            const ch = (cropHome.height / 100) * vh;
            const scale = 3;
            canvas.width = cw * scale;
            canvas.height = ch * scale;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(video, cx, cy, cw, ch, 0, 0, cw * scale, ch * scale);
            
            const cleanText = recognizeSevenSegmentText(canvas, false);
            const val = parseInt(cleanText, 10);
            if (!isNaN(val)) parsed.home_score = val;
          }

          // 2. Process Clock
          if (cropClock && cropClock.width > 0 && cropClock.height > 0 && canvasClockRef.current) {
            const canvas = canvasClockRef.current;
            const cx = (cropClock.x / 100) * vw;
            const cy = (cropClock.y / 100) * vh;
            const cw = (cropClock.width / 100) * vw;
            const ch = (cropClock.height / 100) * vh;
            const scale = 3;
            canvas.width = cw * scale;
            canvas.height = ch * scale;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(video, cx, cy, cw, ch, 0, 0, cw * scale, ch * scale);
            
            const cleanText = recognizeSevenSegmentText(canvas, true);
            if (/^\d{1,2}:\d{2}$/.test(cleanText)) {
              parsed.clock = cleanText;
            } else if (/^\d{3,4}$/.test(cleanText)) {
              const mid = cleanText.length - 2;
              parsed.clock = cleanText.slice(0, mid) + ':' + cleanText.slice(mid);
            }
          }

          // 3. Process Away Score
          if (cropAway && cropAway.width > 0 && cropAway.height > 0 && canvasAwayRef.current) {
            const canvas = canvasAwayRef.current;
            const cx = (cropAway.x / 100) * vw;
            const cy = (cropAway.y / 100) * vh;
            const cw = (cropAway.width / 100) * vw;
            const ch = (cropAway.height / 100) * vh;
            const scale = 3;
            canvas.width = cw * scale;
            canvas.height = ch * scale;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(video, cx, cy, cw, ch, 0, 0, cw * scale, ch * scale);
            
            const cleanText = recognizeSevenSegmentText(canvas, false);
            const val = parseInt(cleanText, 10);
            if (!isNaN(val)) parsed.away_score = val;
          }

          console.log('[OCR] Local 7-Segment OCR Result:', parsed);
          if (Object.keys(parsed).length > 0) {
            socket.emit('SCORE_UPDATE_REQUEST', parsed);
            setOcrStatus('Read Successful');
          } else {
            setOcrStatus('Read Empty');
          }
        } catch (err) {
          console.error('[OCR] Local 7-Segment OCR Error:', err);
          setOcrStatus('OCR Error');
        } finally {
          isProcessingRef.current = false;
        }
      } else {
        // No crop config yet. Capture and downscale to send to setup screen via socket maintaining correct aspect ratio
        if (canvasRef.current) {
          const canvas = canvasRef.current;
          const targetWidth = 640;
          const targetHeight = Math.round((vh / vw) * targetWidth);
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, vw, vh, 0, 0, targetWidth, targetHeight);
          
          const base64Frame = canvas.toDataURL('image/jpeg', 0.65);
          socket.emit('PHONE_A_PREVIEW', base64Frame);
          setOcrStatus('Streaming preview...');
        }
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
          {cropHome && isPlaying && (
            <div 
              style={{
                position: 'absolute',
                border: '2px solid #ef4444',
                left: `${cropHome.x}%`,
                top: `${cropHome.y}%`,
                width: `${cropHome.width}%`,
                height: `${cropHome.height}%`,
                pointerEvents: 'none'
              }}
            />
          )}
          {cropClock && isPlaying && (
            <div 
              style={{
                position: 'absolute',
                border: '2px solid #eab308',
                left: `${cropClock.x}%`,
                top: `${cropClock.y}%`,
                width: `${cropClock.width}%`,
                height: `${cropClock.height}%`,
                pointerEvents: 'none'
              }}
            />
          )}
          {cropAway && isPlaying && (
            <div 
              style={{
                position: 'absolute',
                border: '2px solid #3b82f6',
                left: `${cropAway.x}%`,
                top: `${cropAway.y}%`,
                width: `${cropAway.width}%`,
                height: `${cropAway.height}%`,
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

        {/* OCR Debug Preview (Only shown when cropped and playing) */}
        {((cropHome && cropHome.width > 0) || (cropClock && cropClock.width > 0) || (cropAway && cropAway.width > 0)) && isPlaying && (
          <div style={{ marginTop: '16px', borderTop: '1px solid var(--panel-border)', paddingTop: '16px', textAlign: 'center' }}>
            {setup.gemini_api_key ? (
              <div>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>
                  Cloud AI Scanner Feed (Color scoreboard region):
                </span>
                <div style={{ display: 'inline-block', background: '#000000', padding: '6px', borderRadius: '6px', border: '1px solid var(--accent-color)', maxWidth: '100%' }}>
                  <canvas ref={canvasRef} style={{ display: 'block', maxWidth: '100%', maxHeight: '100px', objectFit: 'contain' }} />
                </div>
              </div>
            ) : (
              <div>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '12px' }}>
                  OCR Scanner Feeds (Binarized Previews):
                </span>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  {cropHome && (
                    <div style={{ background: '#ffffff', padding: '6px', borderRadius: '6px', border: '1px solid #ef4444', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.65rem', color: '#ef4444', fontWeight: 'bold', marginBottom: '4px' }}>HOME</span>
                      <canvas ref={canvasHomeRef} style={{ display: 'block', height: '40px', objectFit: 'contain' }} />
                    </div>
                  )}
                  {cropClock && (
                    <div style={{ background: '#ffffff', padding: '6px', borderRadius: '6px', border: '1px solid #eab308', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.65rem', color: '#eab308', fontWeight: 'bold', marginBottom: '4px' }}>CLOCK</span>
                      <canvas ref={canvasClockRef} style={{ display: 'block', height: '40px', objectFit: 'contain' }} />
                    </div>
                  )}
                  {cropAway && (
                    <div style={{ background: '#ffffff', padding: '6px', borderRadius: '6px', border: '1px solid #3b82f6', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.65rem', color: '#3b82f6', fontWeight: 'bold', marginBottom: '4px' }}>AWAY</span>
                      <canvas ref={canvasAwayRef} style={{ display: 'block', height: '40px', objectFit: 'contain' }} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Hidden canvas fallback when not showing Cloud preview */}
        {(!setup.gemini_api_key || !isPlaying || !((cropHome && cropHome.width > 0) || (cropClock && cropClock.width > 0) || (cropAway && cropAway.width > 0))) && (
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        )}
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
