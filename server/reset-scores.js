// Clears every entry from the high-score leaderboard.
// Run with: npm run reset-scores
import { DATA_FILE, getTopScores, writeScores } from './leaderboard.js';

const cleared = getTopScores().length;

// Rewrite the file as an empty board rather than deleting it, so data.json is
// always present and valid for the running dev server.
writeScores([]);

console.log(
  `Cleared the leaderboard (${cleared} score${cleared === 1 ? '' : 's'} removed) — ${DATA_FILE}`,
);
