const Tesseract = require('tesseract.js');

let worker = null;

// Initialize the Tesseract worker
async function initOCR() {
  if (worker) return worker;
  
  console.log('[OCR] Initializing Tesseract worker...');
  worker = await Tesseract.createWorker();
  
  // Set parameters: only whitelist numbers and colons, set page seg mode
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789:',
    tessedit_pageseg_mode: '7' // Raw line (or treat as single uniform text line)
  });
  
  console.log('[OCR] Tesseract worker initialized successfully.');
  return worker;
}

/**
 * Parses OCR text to extract scoreboard variables.
 * Scoreboard expected layout (values):
 * [HomeScore] [Clock(MM:SS)] [Quarter] [AwayScore] [FoulsHome] [TimeoutsHome] [TimeoutsAway] [FoulsAway]
 */
function parseScoreboardText(text) {
  // Normalize whitespace and split by space
  const tokens = text.replace(/[\r\n]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(t => t.length > 0);

  console.log('[OCR] Normalized tokens:', tokens);

  const parsed = {};

  // 1. Try to find the clock token (contains a colon ':')
  let clockIdx = tokens.findIndex(t => t.includes(':'));

  // Fallback: if no colon but we have a token of length 3-5 that looks like time (e.g. "0842")
  if (clockIdx === -1) {
    clockIdx = tokens.findIndex(t => /^\d{3,4}$/.test(t) && t.length >= 3 && t.length <= 4);
    if (clockIdx !== -1) {
      // Re-format to include colon
      const t = tokens[clockIdx];
      const mid = t.length - 2;
      tokens[clockIdx] = t.slice(0, mid) + ':' + t.slice(mid);
    }
  }

  if (clockIdx !== -1) {
    const clockVal = tokens[clockIdx];
    // Validate clock format (e.g. MM:SS)
    if (/^\d{1,2}:\d{2}$/.test(clockVal)) {
      parsed.clock = clockVal;
    }

    // Home score: token immediately preceding the clock
    if (clockIdx > 0) {
      const score = parseInt(tokens[clockIdx - 1], 10);
      if (!isNaN(score) && score >= 0) parsed.home_score = score;
    }

    // Quarter: token immediately following the clock
    if (clockIdx < tokens.length - 1) {
      const q = parseInt(tokens[clockIdx + 1], 10);
      if (!isNaN(q) && q >= 1 && q <= 5) parsed.quarter = q;
    }

    // Away score: token following the quarter
    if (clockIdx < tokens.length - 2) {
      const score = parseInt(tokens[clockIdx + 2], 10);
      if (!isNaN(score) && score >= 0) parsed.away_score = score;
    }

    // Stats: fouls_home, timeouts_home, timeouts_away, fouls_away
    // Usually follow after away score
    const statsStartIdx = clockIdx + 3;
    if (statsStartIdx < tokens.length) {
      const fh = parseInt(tokens[statsStartIdx], 10);
      if (!isNaN(fh) && fh >= 0 && fh <= 10) parsed.fouls_home = fh;
    }
    if (statsStartIdx + 1 < tokens.length) {
      const th = parseInt(tokens[statsStartIdx + 1], 10);
      if (!isNaN(th) && th >= 0 && th <= 5) parsed.timeouts_home = th;
    }
    if (statsStartIdx + 2 < tokens.length) {
      const ta = parseInt(tokens[statsStartIdx + 2], 10);
      if (!isNaN(ta) && ta >= 0 && ta <= 5) parsed.timeouts_away = ta;
    }
    if (statsStartIdx + 3 < tokens.length) {
      const fa = parseInt(tokens[statsStartIdx + 3], 10);
      if (!isNaN(fa) && fa >= 0 && fa <= 10) parsed.fouls_away = fa;
    }
  } else {
    // Alternate parsing if no clock token found (assume order: Home, Away, etc.)
    const numbers = tokens.map(t => parseInt(t, 10)).filter(n => !isNaN(n));
    if (numbers.length >= 2) {
      parsed.home_score = numbers[0];
      parsed.away_score = numbers[1];
    }
  }

  return parsed;
}

/**
 * Performs OCR on the provided image buffer.
 */
async function processFrame(imageBuffer) {
  try {
    const w = await initOCR();
    const { data: { text } } = await w.recognize(imageBuffer);
    console.log('[OCR] Raw OCR Output:', JSON.stringify(text));
    return parseScoreboardText(text);
  } catch (error) {
    console.error('[OCR] Error during recognition:', error);
    return {};
  }
}

// Gracefully terminate worker on process exit
process.on('SIGINT', async () => {
  if (worker) {
    console.log('[OCR] Terminating Tesseract worker...');
    await worker.terminate();
    worker = null;
  }
});

module.exports = {
  processFrame,
  parseScoreboardText // exported for testing
};
