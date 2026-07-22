import { useCallback, useEffect, useRef, useState } from 'react';
import { scoreQualifies, submitScore } from '../api/leaderboard.js';

const MAX_NAME_LENGTH = 10;

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// The on-screen keyboard as a grid of rows. Every cell is a key object so the
// same arrow-key navigation works for letters and the special actions. This is
// intentionally driven only by direction + select/delete so a future gamepad
// controller can map straight onto it.
const KEY_ROWS = [
  LETTERS.slice(0, 9).map((label) => ({ label, type: 'char' })),
  LETTERS.slice(9, 18).map((label) => ({ label, type: 'char' })),
  [
    ...LETTERS.slice(18, 26).map((label) => ({ label, type: 'char' })),
    { label: 'SPACE', type: 'space' },
  ],
  [
    { label: 'DEL', type: 'del' },
    { label: 'CONFIRM', type: 'confirm' },
  ],
];

/**
 * Listens for the engine's `gameOver` event. When the score earns a top-three
 * spot, it opens an arcade-style name-entry modal driven entirely by the arrow
 * keys (move the highlight), Enter (select the highlighted key), and Backspace
 * (delete the last character). Saves to the leaderboard on CONFIRM.
 */
export default function ScoreEntry() {
  const [pendingScore, setPendingScore] = useState(null);
  const [name, setName] = useState('');
  const [cursor, setCursor] = useState({ row: 0, col: 0 });
  const [saving, setSaving] = useState(false);

  // Refs mirror state so the single window key handler always sees fresh values
  // without needing to re-bind on every keystroke.
  const nameRef = useRef('');
  const cursorRef = useRef({ row: 0, col: 0 });
  const savingRef = useRef(false);
  useEffect(() => {
    nameRef.current = name;
  }, [name]);
  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);
  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  useEffect(() => {
    async function handleGameOver(e) {
      const score = e.detail?.score ?? 0;
      if (score > 0 && (await scoreQualifies(score))) {
        setName('');
        setCursor({ row: 0, col: 0 });
        setPendingScore(score);
      }
    }
    window.addEventListener('gameOver', handleGameOver);
    return () => window.removeEventListener('gameOver', handleGameOver);
  }, []);

  const closeAndSave = useCallback(async () => {
    if (savingRef.current) return;
    setSaving(true);
    try {
      await submitScore(nameRef.current, pendingScore);
      window.dispatchEvent(new CustomEvent('leaderboardUpdated'));
    } catch {
      /* If the save fails we still close so play can continue. */
    } finally {
      setSaving(false);
      setPendingScore(null);
    }
  }, [pendingScore]);

  // Perform the action for a given key (also used by mouse clicks).
  const activateKey = useCallback(
    (key) => {
      switch (key.type) {
        case 'char':
          setName((n) => (n.length < MAX_NAME_LENGTH ? n + key.label : n));
          break;
        case 'space':
          setName((n) => (n.length < MAX_NAME_LENGTH ? `${n} ` : n));
          break;
        case 'del':
          setName((n) => n.slice(0, -1));
          break;
        case 'confirm':
          closeAndSave();
          break;
        default:
          break;
      }
    },
    [closeAndSave],
  );

  // Global key handling while the modal is open. Registered in the capture
  // phase so the game engine's own window keydown listener never sees these
  // keys (otherwise arrows would steer Pac-Man and Esc would pause).
  useEffect(() => {
    if (pendingScore === null) return undefined;

    function onKeyDown(e) {
      // Fully isolate the modal from the rest of the game while it is open.
      e.stopImmediatePropagation();

      const move = (dir) => {
        e.preventDefault();
        setCursor(({ row, col }) => {
          let r = row;
          let c = col;
          if (dir === 'up') r = Math.max(0, row - 1);
          if (dir === 'down') r = Math.min(KEY_ROWS.length - 1, row + 1);
          if (dir === 'left') c = Math.max(0, col - 1);
          if (dir === 'right') c = Math.min(KEY_ROWS[row].length - 1, col + 1);
          // Clamp the column so it stays valid on a shorter row.
          c = Math.min(c, KEY_ROWS[r].length - 1);
          return { row: r, col: c };
        });
      };

      switch (e.key) {
        case 'ArrowUp':
          move('up');
          break;
        case 'ArrowDown':
          move('down');
          break;
        case 'ArrowLeft':
          move('left');
          break;
        case 'ArrowRight':
          move('right');
          break;
        case 'Enter':
          e.preventDefault();
          {
            const { row, col } = cursorRef.current;
            activateKey(KEY_ROWS[row][col]);
          }
          break;
        case 'Backspace':
          e.preventDefault();
          setName((n) => n.slice(0, -1));
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () =>
      window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [pendingScore, activateKey]);

  if (pendingScore === null) return null;

  const slots = Array.from({ length: MAX_NAME_LENGTH });

  return (
    <div className="score-entry-overlay">
      <div className="score-entry-modal">
        <div className="score-entry-heading">NEW HIGH SCORE!</div>
        <div className="score-entry-score">{pendingScore}</div>
        <div className="score-entry-label">ENTER YOUR NAME</div>

        <div className="name-slots">
          {slots.map((_, i) => {
            const ch = name[i];
            const isCaret = i === name.length && name.length < MAX_NAME_LENGTH;
            return (
              <span
                // eslint-disable-next-line react/no-array-index-key
                key={i}
                className={`name-slot${isCaret ? ' caret' : ''}`}
              >
                {ch === ' ' ? '␣' : ch || ''}
              </span>
            );
          })}
        </div>

        <div className="keyboard">
          {KEY_ROWS.map((row, r) => (
            // eslint-disable-next-line react/no-array-index-key
            <div key={r} className="keyboard-row">
              {row.map((key, c) => {
                const selected = cursor.row === r && cursor.col === c;
                const wide = key.type === 'space' || key.type === 'confirm';
                return (
                  <button
                    key={key.label}
                    type="button"
                    className={`key${selected ? ' selected' : ''}${
                      wide ? ' wide' : ''
                    } key-${key.type}`}
                    onMouseEnter={() => setCursor({ row: r, col: c })}
                    onClick={() => activateKey(key)}
                    disabled={saving}
                  >
                    {key.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="score-entry-hint">
          ARROWS&nbsp;=&nbsp;MOVE&nbsp;&nbsp;·&nbsp;&nbsp;ENTER&nbsp;=&nbsp;SELECT&nbsp;&nbsp;·&nbsp;&nbsp;BACKSPACE&nbsp;=&nbsp;DELETE
        </div>
      </div>
    </div>
  );
}
