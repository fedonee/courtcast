const Tesseract = require('tesseract.js');
const os = require('os');
const path = require('path');

let worker = null;

// Initialize the Tesseract worker
async function initOCR() {
  if (worker) return worker;
  
  console.log('[OCR] Initializing Tesseract worker...');
  worker = await Tesseract.createWorker({
    cachePath: path.join(os.tmpdir(), 'tesseract-cache')
  });
  
  // Set parameters: only whitelist numbers and colons, set page seg mode
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789:',
    tessedit_pageseg_mode: '11' // Sparse text, find as much text as possible in no particular order
  });
  
  console.log('[OCR] Tesseract worker initialized successfully.');
  return worker;
}

/**
 * Parses OCR text to extract scoreboard variables.
 * Designed to be layout-agnostic, detecting clock and scores based on values/patterns.
 */
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
    // Quarter is usually 1-4.
    const possibleQuarterIdx = numberTokens.findIndex(n => n.val >= 1 && n.val <= 4);
    if (possibleQuarterIdx !== -1 && numberTokens.filter(n => n.val > 4).length >= 2) {
      parsed.quarter = numberTokens[possibleQuarterIdx].val;
      const scores = numberTokens.filter((_, idx) => idx !== possibleQuarterIdx);
      parsed.home_score = scores[0].val;
      parsed.away_score = scores[1].val;
    } else {
      // Fallback
      parsed.home_score = numberTokens[0].val;
      parsed.away_score = numberTokens[1].val;
      if (numberTokens[2].val >= 1 && numberTokens[2].val <= 4) {
        parsed.quarter = numberTokens[2].val;
      }
    }
  } 
  else if (numberTokens.length >= 4) {
    // Complex layout: scores, quarter, fouls, timeouts
    const sorted = [...numberTokens].sort((a, b) => a.originalIdx - b.originalIdx);

    if (clockIdx !== -1) {
      const beforeClock = sorted.filter(n => n.originalIdx < clockIdx);
      const afterClock = sorted.filter(n => n.originalIdx > clockIdx);

      // Scenario A: [HomeScore] [Clock] [Quarter] [AwayScore] ...
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
      // Scenario B: [Clock] [HomeScore] [AwayScore] ...
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
      // No clock detected: use first two as scores, third as quarter
      parsed.home_score = sorted[0].val;
      parsed.away_score = sorted[1].val;
      if (sorted[2].val >= 1 && sorted[2].val <= 4) {
        parsed.quarter = sorted[2].val;
      }
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
