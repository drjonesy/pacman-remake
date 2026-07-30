import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The leaderboard is a single JSON file. It is created automatically on first
// use and is safe to delete (or reset with `npm run reset-scores`).
export const DATA_DIR = join(__dirname, '..', 'data');
export const DATA_FILE = join(DATA_DIR, 'data.json');

// Only the top three scores are ever displayed, so that is all we keep.
export const MAX_ENTRIES = 3;
const MAX_NAME_LENGTH = 12;

/**
 * Reads the file and returns a sanitised, already-sorted list of entries.
 * A missing or corrupt file is treated as an empty leaderboard rather than an
 * error — the game should always be playable.
 * @returns {Array<{ name: string, score: number }>}
 */
function readScores() {
  if (!existsSync(DATA_FILE)) return [];

  try {
    const parsed = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
    const entries = Array.isArray(parsed) ? parsed : parsed?.scores;
    if (!Array.isArray(entries)) return [];

    return entries
      .map((entry) => ({
        name: String(entry?.name ?? '').slice(0, MAX_NAME_LENGTH),
        score: Number(entry?.score),
      }))
      .filter((entry) => Number.isFinite(entry.score) && entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

/**
 * Writes the leaderboard back to disk. The write goes to a temp file that is
 * then renamed over the real one, so a crash mid-write can never leave a
 * half-written data.json behind.
 * @param {Array<{ name: string, score: number }>} scores
 */
export function writeScores(scores) {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ scores }, null, 2)}\n`);
  renameSync(tmp, DATA_FILE);
}

/**
 * Returns the current leaderboard, highest score first (up to MAX_ENTRIES).
 * @returns {Array<{ name: string, score: number }>}
 */
export function getTopScores() {
  return readScores();
}

/**
 * True when the given score would earn a place on the leaderboard — either
 * there is an empty slot or it beats the current lowest qualifying score.
 * @param {number} score
 * @returns {boolean}
 */
export function qualifies(score) {
  if (!Number.isFinite(score) || score <= 0) return false;

  const top = readScores();
  if (top.length < MAX_ENTRIES) return true;

  const lowest = top[top.length - 1].score;
  return score > lowest;
}

/**
 * Adds a score and keeps only the top MAX_ENTRIES. This is how a new high
 * score "replaces" the previous 2nd/3rd place holder. Ties keep the existing
 * holder ahead of the newcomer.
 * @param {string} name
 * @param {number} score
 * @returns {Array<{ name: string, score: number }>} the updated leaderboard
 */
export function submitScore(name, score) {
  const cleanName =
    String(name ?? '')
      .trim()
      .slice(0, MAX_NAME_LENGTH) || 'AAA';
  const cleanScore = Number(score);

  if (!Number.isFinite(cleanScore) || cleanScore <= 0) {
    return readScores();
  }

  const updated = [...readScores(), { name: cleanName, score: cleanScore }]
    // A stable sort keeps existing entries above a newcomer with the same score.
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ENTRIES);

  writeScores(updated);
  return updated;
}
