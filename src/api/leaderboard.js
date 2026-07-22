// Thin client for the JSON-file-backed leaderboard API served by the Vite plugin
// (see server/vite-plugin-leaderboard.js). All calls are same-origin.

/**
 * @returns {Promise<Array<{ name: string, score: number }>>}
 */
export async function fetchTopScores() {
  const res = await fetch('/api/scores');
  if (!res.ok) throw new Error('Failed to load scores');
  const { scores } = await res.json();
  return scores;
}

/**
 * Asks the server whether a score is good enough for a top-three spot.
 * @param {number} score
 * @returns {Promise<boolean>}
 */
export async function scoreQualifies(score) {
  const res = await fetch(`/api/scores/check?score=${encodeURIComponent(score)}`);
  if (!res.ok) return false;
  const { qualifies } = await res.json();
  return qualifies;
}

/**
 * Saves a name + score and returns the refreshed leaderboard.
 * @param {string} name
 * @param {number} score
 * @returns {Promise<Array<{ name: string, score: number }>>}
 */
export async function submitScore(name, score) {
  const res = await fetch('/api/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, score }),
  });
  if (!res.ok) throw new Error('Failed to save score');
  const { scores } = await res.json();
  return scores;
}
