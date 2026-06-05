import React, { useState, useEffect, useRef } from 'react';

export default function PhoneBScreen({ socket }) {
  const [cameraStatus, setCameraStatus] = useState('Initializing camera...');
  const [streamStatus, setStreamStatus] = useState('Standby');
  const [isRecording, setIsRecording] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const mediaRecorderRef = useRef(null);

  useEffect(() => {
    // Notify server of registration
    socket.emit('DEVICE_CONNECTED', { role: 'phone-b' });

    // Start video camera preview
    // Requesting audio: true is crucial so FFmpeg receives a valid audio stream
    navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      },
      audio: true
    })
    .then((stream) => {
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraStatus('Camera Active');
    })
    .catch((err) => {
      console.error('Error opening game camera:', err);
      // Fallback: try without audio in case microphone permission was denied
      navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
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
        setCameraStatus('Camera Active (No Audio)');
      })
      .catch((fallbackErr) => {
        console.error('Error opening camera without audio:', fallbackErr);
        setCameraStatus('Camera Error: Denied access');
      });
    });

    // Handle game events
    socket.on('GAME_START', () => {
      startRecording();
    });

    socket.on('GAME_STOP', () => {
      stopRecording();
    });

    socket.on('INITIAL_STATE', (state) => {
      if (state.isStreaming && !isRecording) {
        startRecording();
      }
    });

    return () => {
      socket.off('GAME_START');
      socket.off('GAME_STOP');
      socket.off('INITIAL_STATE');
      stopRecording();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [socket]);

  const startRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      return; // Already recording
    }

    if (!streamRef.current) {
      console.error('[Phone B] No video stream available to record.');
      setStreamStatus('Failed: No Camera Stream');
      return;
    }

    console.log('[Phone B] Starting MediaRecorder...');
    
    // Choose appropriate MIME type based on device support
    let mimeType = 'video/webm;codecs=vp8,opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp9,opus';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/mp4;codecs=h264'; // iOS Safari
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/mp4';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = ''; // Let browser choose default
    }

    console.log(`[Phone B] Selected MIME type: ${mimeType}`);

    try {
      const options = { videoBitsPerSecond: 2000000 }; // 2 Mbps
      if (mimeType) options.mimeType = mimeType;

      const recorder = new MediaRecorder(streamRef.current, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          // Stream raw blob binary chunk via socket
          socket.emit('VIDEO_CHUNK', e.data);
        }
      };

      // Collect video slices every 250ms
      recorder.start(250);
      setIsRecording(true);
      setStreamStatus('STREAMING LIVE');
    } catch (err) {
      console.error('[Phone B] Error initializing MediaRecorder:', err);
      setStreamStatus(`Error: ${err.message}`);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      console.log('[Phone B] Stopping MediaRecorder...');
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setStreamStatus('Standby');
    }
  };

  return (
    <div className="container">
      <div className="header">
        <h1 className="logo">🏀 CourtCast</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>Phone B — Game Broadcast Camera</p>
      </div>

      <div className="glass-panel" className={`glass-panel ${isRecording ? 'glass-panel-glow' : ''}`}>
        <div className="card-header">
          <h2 className="card-title">Live Game Capture</h2>
          <span className="live-indicator">
            <span className="dot" style={{ backgroundColor: cameraStatus.includes('Active') ? 'var(--success-color)' : 'var(--danger-color)' }} />
            {cameraStatus}
          </span>
        </div>

        {/* Video Preview */}
        <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000000', borderRadius: '8px', overflow: 'hidden', marginBottom: '16px' }}>
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted 
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />

          {isRecording && (
            <div style={{ position: 'absolute', top: '12px', left: '12px', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(0,0,0,0.6)', padding: '6px 12px', borderRadius: '20px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--danger-color)', animation: 'pulse 1.5s infinite' }} />
              <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--danger-color)', textTransform: 'uppercase' }}>
                ON AIR
              </span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            Broadcasting Status:
          </span>
          <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: isRecording ? 'var(--success-color)' : 'var(--text-secondary)' }}>
            {streamStatus}
          </span>
        </div>
      </div>
    </div>
  );
}
