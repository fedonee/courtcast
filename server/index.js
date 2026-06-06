const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const overlay = require('./overlay');

const app = express();
app.use(cors());

// Parse JSON bodies
app.use(express.json({ limit: '10mb' }));

// Raw binary body parser for POST /ocr/frame to achieve low-latency
app.use('/ocr/frame', express.raw({ type: 'image/jpeg', limit: '5mb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 1e7 // Increase buffer size to 10MB for binary video chunks
});

const PORT = process.env.PORT || 3001;

// Load setup config from file or defaults
const setupPath = path.join(__dirname, 'setup.json');
let setupConfig = {
  home_team: 'Bulls',
  away_team: 'Lakers',
  stream_key: '',
  stream_visibility: 'unlisted',
  crop_home: null,
  crop_clock: null,
  crop_away: null
};

if (fs.existsSync(setupPath)) {
  try {
    setupConfig = JSON.parse(fs.readFileSync(setupPath, 'utf8'));
    console.log('[Server] Loaded existing setup configuration.');
  } catch (err) {
    console.error('[Server] Failed to parse setup.json, using defaults.');
  }
}

// Global Game State
let isStreaming = false;
let scoreLog = [];
let currentScore = {
  timestamp_ms: Date.now(),
  home_score: 0,
  away_score: 0,
  clock: '00:00',
  quarter: 1,
  fouls_home: 0,
  fouls_away: 0,
  timeouts_home: 0,
  timeouts_away: 0
};

// Device connections tracking
const connectedDevices = {
  'phone-a': null,
  'phone-b': null,
  'controller': null
};
const socketRoles = {};

// Broadcast updated connected device statuses
function broadcastDeviceStatus() {
  io.emit('DEVICE_STATUS', {
    phoneAConnected: !!connectedDevices['phone-a'],
    phoneBConnected: !!connectedDevices['phone-b'],
    controllerConnected: !!connectedDevices['controller']
  });
}

// Serve client in production
const clientBuildPath = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));
  console.log(`[Server] Serving static client build from ${clientBuildPath}`);
  
  // Catch-all route to support client-side routing (React Router)
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ocr') || req.path.startsWith('/download')) {
      return next();
    }
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
} else {
  console.log('[Server] Client build directory not found. Please run "npm run build" in the client folder.');
}

// HTTP API Routes
app.get('/api/setup', (req, res) => {
  res.json(setupConfig);
});

app.post('/api/setup', (req, res) => {
  setupConfig = { ...setupConfig, ...req.body };
  fs.writeFileSync(setupPath, JSON.stringify(setupConfig, null, 2), 'utf8');
  console.log('[Server] Updated setup configuration saved.');
  
  // Broadcast updated configuration to all connected sockets
  io.emit('SETUP_UPDATE', setupConfig);
  
  // Update overlay files dynamically if we are active
  if (isStreaming) {
    overlay.updateOverlayFiles(currentScore, setupConfig);
  }
  
  res.json({ success: true, setup: setupConfig });
});

// Endpoint to download the latest recorded MP4
app.get('/download/latest', (req, res) => {
  const latestFile = overlay.getLatestOutputFile();
  if (latestFile && fs.existsSync(latestFile)) {
    res.download(latestFile);
  } else {
    // If no stream occurred in this run, try to find the latest MP4 in the output folder
    const outputDir = path.join(__dirname, 'output');
    if (fs.existsSync(outputDir)) {
      const files = fs.readdirSync(outputDir)
        .filter(f => f.endsWith('.mp4'))
        .map(f => ({
          name: f,
          time: fs.statSync(path.join(outputDir, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);
      
      if (files.length > 0) {
        return res.download(path.join(outputDir, files[0].name));
      }
    }
    res.status(404).send('No recordings found.');
  }
});

// POST /ocr/frame - Dummy endpoint for backward compatibility with old client caches
app.post('/ocr/frame', (req, res) => {
  res.json({ success: true, score: currentScore });
});

// Socket.io connection logic
io.on('connection', (socket) => {
  console.log(`[Socket] Device connected: ${socket.id}`);
  
  socket.on('DEVICE_CONNECTED', (data) => {
    const { role } = data;
    if (role === 'phone-a' || role === 'phone-b' || role === 'controller') {
      connectedDevices[role] = socket.id;
      socketRoles[socket.id] = role;
      console.log(`[Socket] Device registered role: ${role}`);
      
      broadcastDeviceStatus();
      
      // Send initial configurations to client
      socket.emit('INITIAL_STATE', {
        setup: setupConfig,
        score: currentScore,
        isStreaming
      });
    }
  });
  
  // Receive live preview frame from Phone A (uncropped, during setup)
  socket.on('PHONE_A_PREVIEW', (base64Frame) => {
    // Forward the preview frame to `/setup` client
    socket.broadcast.emit('PHONE_A_PREVIEW', base64Frame);
  });

  // Receive scoreboard OCR updates computed locally on Phone A
  socket.on('SCORE_UPDATE_REQUEST', (parsed) => {
    if (parsed && Object.keys(parsed).length > 0) {
      currentScore = {
        ...currentScore,
        ...parsed,
        timestamp_ms: Date.now()
      };
      
      scoreLog.push(currentScore);
      console.log('[Socket] Score updated via client OCR:', currentScore);
      
      // Broadcast updated score log entry to all clients
      io.emit('SCORE_UPDATE', currentScore);
      
      // Update live overlay files
      if (isStreaming) {
        overlay.updateOverlayFiles(currentScore, setupConfig);
      }
    }
  });
  
  // Receive video chunks from Phone B
  socket.on('VIDEO_CHUNK', (chunk) => {
    if (isStreaming) {
      overlay.feedVideoChunk(chunk);
    }
  });
  
  // Handle start game action
  socket.on('START_GAME', () => {
    console.log('[Socket] START_GAME received.');
    if (!isStreaming) {
      // Reset scores and logs
      currentScore = {
        timestamp_ms: Date.now(),
        home_score: 0,
        away_score: 0,
        clock: '00:00',
        quarter: 1,
        fouls_home: 0,
        fouls_away: 0,
        timeouts_home: 0,
        timeouts_away: 0
      };
      scoreLog = [currentScore];
      
      // Start FFmpeg process
      overlay.startLiveStream(setupConfig.stream_key, setupConfig, currentScore);
      isStreaming = true;
      
      io.emit('GAME_START', { timestamp_ms: Date.now() });
      io.emit('SCORE_UPDATE', currentScore);
    }
  });
  
  // Handle stop game action
  socket.on('STOP_GAME', () => {
    console.log('[Socket] STOP_GAME received.');
    if (isStreaming) {
      overlay.stopLiveStream();
      isStreaming = false;
      io.emit('GAME_STOP');
    }
  });
  
  socket.on('disconnect', () => {
    const role = socketRoles[socket.id];
    if (role) {
      connectedDevices[role] = null;
      delete socketRoles[socket.id];
      console.log(`[Socket] Device disconnected: ${role} (${socket.id})`);
      broadcastDeviceStatus();
    }
  });
});

server.listen(PORT, () => {
  console.log(`[Server] CourtCast backend running on port ${PORT}`);
});
