import { useCallback, useEffect, useState } from 'react';
import { fetchTopScores } from '../api/leaderboard.js';

const RANK_LABELS = ['1ST', '2ND', '3RD'];

/**
 * The top-three high-score table shown beneath the PLAY button. It refreshes
 * on mount and whenever a new score is saved (the `leaderboardUpdated` event).
 */
export default function Leaderboard() {
  const [scores, setScores] = useState([]);

  const refresh = useCallback(() => {
    fetchTopScores()
      .then(setScores)
      .catch(() => {
        /* API unavailable (e.g. static build) — just show an empty board. */
      });
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener('leaderboardUpdated', refresh);
    return () => window.removeEventListener('leaderboardUpdated', refresh);
  }, [refresh]);

  return (
    <div className="leaderboard">
      <div className="leaderboard-title">HIGH SCORES</div>
      <ol className="leaderboard-list">
        {RANK_LABELS.map((label, i) => {
          const entry = scores[i];
          return (
            <li key={label} className="leaderboard-row">
              <span className="leaderboard-rank">{label}</span>
              <span className="leaderboard-name">
                {entry ? entry.name : '---'}
              </span>
              <span className="leaderboard-score">
                {entry ? entry.score : '00'}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
