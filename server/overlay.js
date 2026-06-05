const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ffmpegStatic = require('ffmpeg-static');

let ffmpegProcess = null;
let currentOutputFile = null;

/**
 * Searches for a suitable font and copies it locally to simplify FFmpeg paths.
 */
function getFontPath() {
  const localFont = path.join(__dirname, 'arial.ttf');
  if (fs.existsSync(localFont)) {
    return localFont;
  }

  // Windows system fonts
  const winFont = 'C:\\Windows\\Fonts\\arial.ttf';
  if (fs.existsSync(winFont)) {
    try {
      fs.copyFileSync(winFont, localFont);
      console.log('[Overlay] Copied Windows Arial font locally.');
      return localFont;
    } catch (err) {
      console.warn('[Overlay] Failed to copy Windows font, referencing directly:', err.message);
      return winFont;
    }
  }

  // Linux system fonts
  const linuxFonts = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSans.ttf'
  ];
  for (const f of linuxFonts) {
    if (fs.existsSync(f)) {
      return f;
    }
  }

  // Fallback to Arial (FFmpeg will search system font config)
  return 'Arial';
}

/**
 * Writes scoreboard updates to text files read by FFmpeg drawtext filters.
 */
function updateOverlayFiles(score, setup) {
  const tempDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const homeName = (setup.home_team || 'HOME').toUpperCase();
  const awayName = (setup.away_team || 'AWAY').toUpperCase();

  // Write text files
  fs.writeFileSync(path.join(tempDir, 'home.txt'), `${homeName}   ${score.home_score}`);
  fs.writeFileSync(path.join(tempDir, 'away.txt'), `${score.away_score}   ${awayName}`);
  fs.writeFileSync(path.join(tempDir, 'center.txt'), `${score.clock}   ${score.quarter}° Q`);
  fs.writeFileSync(path.join(tempDir, 'home_stats.txt'), `Falli: ${score.fouls_home}   Timeout: ${score.timeouts_home}`);
  fs.writeFileSync(path.join(tempDir, 'away_stats.txt'), `Timeout: ${score.timeouts_away}   Falli: ${score.fouls_away}`);
  fs.writeFileSync(path.join(tempDir, 'live.txt'), `LIVE`);
}

/**
 * Starts the FFmpeg process to merge incoming chunks, overlay scoreboard, and stream/save.
 */
function startLiveStream(streamKey, setup, initialScore) {
  if (ffmpegProcess) {
    console.warn('[Overlay] Stream already running. Stopping previous stream first...');
    stopLiveStream();
  }

  // Initialize the text files
  updateOverlayFiles(initialScore, setup);

  const fontPath = getFontPath();
  // Build a path that FFmpeg drawtext filter can read without colon issues
  // If it's local in Cwd (server/), we just pass the filename.
  let fontParam = '';
  if (fontPath === 'Arial') {
    fontParam = `font='Arial'`;
  } else if (path.dirname(fontPath) === __dirname) {
    // If copied locally, just reference 'arial.ttf' relative to Cwd
    fontParam = `fontfile='arial.ttf'`;
  } else {
    // Escape colon/backslashes if referencing absolute path
    fontParam = `fontfile='${fontPath.replace(/\\/g, '/')}'`;
  }

  // Output folder
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const timestamp = Date.now();
  currentOutputFile = path.join(outputDir, `match_${timestamp}.mp4`);

  // FFmpeg drawbox and drawtext filters
  const vf = [
    `drawbox=y=ih-80:h=80:color=black@0.6:t=fill`,
    
    // Home Name & Score (Left)
    `drawtext=${fontParam}:textfile='temp/home.txt':reload=1:fontcolor=white:fontsize=24:fontstyle=bold:x=50:y=ih-68`,
    
    // Clock & Quarter (Center)
    `drawtext=${fontParam}:textfile='temp/center.txt':reload=1:fontcolor=white:fontsize=24:fontstyle=bold:x=(w-tw)/2:y=ih-68`,
    
    // Away Score & Name (Right)
    `drawtext=${fontParam}:textfile='temp/away.txt':reload=1:fontcolor=white:fontsize=24:fontstyle=bold:x=w-tw-50:y=ih-68`,
    
    // Home Stats (Left)
    `drawtext=${fontParam}:textfile='temp/home_stats.txt':reload=1:fontcolor=lightgray:fontsize=16:x=50:y=ih-32`,
    
    // LIVE indicator text (Center)
    `drawtext=${fontParam}:textfile='temp/live.txt':reload=1:fontcolor=red:fontsize=16:fontstyle=bold:x=(w-tw)/2:y=ih-32`,
    
    // Away Stats (Right)
    `drawtext=${fontParam}:textfile='temp/away_stats.txt':reload=1:fontcolor=lightgray:fontsize=16:x=w-tw-50:y=ih-32`
  ].join(',');

  const args = [
    '-loglevel', 'info',
    '-probesize', '5M',
    '-analyzeduration', '5M',
    '-i', 'pipe:0', // Input from stdin
    '-vf', vf,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ac', '2'
  ];

  if (streamKey) {
    const rtmpUrl = `rtmp://a.rtmp.youtube.com/live2/${streamKey}`;
    const safeOutputPath = currentOutputFile.replace(/\\/g, '/');
    
    // Tee muxer configuration
    args.push(
      '-f', 'tee',
      '-map', '0:v',
      '-map', '0:a?',
      `[f=flv]${rtmpUrl}|[f=mp4]${safeOutputPath}`
    );
  } else {
    args.push(currentOutputFile);
  }

  console.log('[Overlay] Spawning FFmpeg with args:', args.join(' '));

  ffmpegProcess = spawn(ffmpegStatic, args, {
    cwd: __dirname, // Set Cwd to server directory so relative paths work
    stdio: ['pipe', 'pipe', 'pipe']
  });

  ffmpegProcess.stderr.on('data', (data) => {
    // Log FFmpeg output to console for debugging
    const msg = data.toString().trim();
    if (msg) console.log(`[FFmpeg] ${msg}`);
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`[Overlay] FFmpeg process closed with code ${code}`);
    ffmpegProcess = null;
  });

  ffmpegProcess.on('error', (err) => {
    console.error('[Overlay] FFmpeg process error:', err);
  });
}

/**
 * Feeds a binary chunk of video into FFmpeg's stdin.
 */
function feedVideoChunk(chunk) {
  if (ffmpegProcess && ffmpegProcess.stdin && ffmpegProcess.stdin.writable) {
    ffmpegProcess.stdin.write(chunk);
  }
}

/**
 * Gracefully stops the FFmpeg stream by sending SIGINT.
 */
function stopLiveStream() {
  if (!ffmpegProcess) {
    console.log('[Overlay] No stream running.');
    return;
  }

  console.log('[Overlay] Stopping FFmpeg process gracefully (SIGINT)...');
  
  // Send SIGINT to let FFmpeg write the MP4 file trailer properly
  ffmpegProcess.kill('SIGINT');
  
  // Set a timeout to force kill if it doesn't close
  const proc = ffmpegProcess;
  setTimeout(() => {
    if (proc && proc.exitCode === null) {
      console.warn('[Overlay] FFmpeg did not exit gracefully, force killing...');
      proc.kill('SIGKILL');
    }
  }, 3000);

  ffmpegProcess = null;
}

/**
 * Returns the path to the latest generated MP4 file.
 */
function getLatestOutputFile() {
  return currentOutputFile;
}

module.exports = {
  startLiveStream,
  feedVideoChunk,
  stopLiveStream,
  updateOverlayFiles,
  getLatestOutputFile
};
