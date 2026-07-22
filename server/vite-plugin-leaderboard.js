import { getTopScores, qualifies, submitScore } from './leaderboard.js';

/**
 * Reads and JSON-parses a request body (small payloads only).
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<any>}
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e4) req.destroy(); // guard against abuse
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

/**
 * Connect-style middleware that backs the leaderboard REST API. Shared by the
 * dev server and the preview server so scores work with both `npm run dev`
 * and `npm run preview`.
 *
 *   GET  /api/scores          -> { scores: [...] }
 *   GET  /api/scores/check?score=N -> { qualifies: boolean }
 *   POST /api/scores  {name, score} -> { scores: [...] }
 */
function leaderboardMiddleware(req, res, next) {
  const url = new URL(req.url, 'http://localhost');

  if (!url.pathname.startsWith('/api/scores')) {
    next();
    return;
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/scores') {
      sendJson(res, 200, { scores: getTopScores() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/scores/check') {
      const score = Number(url.searchParams.get('score'));
      sendJson(res, 200, { qualifies: qualifies(score) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/scores') {
      readJsonBody(req)
        .then((body) => {
          const scores = submitScore(body.name, body.score);
          sendJson(res, 200, { scores });
        })
        .catch(() => sendJson(res, 400, { error: 'Invalid request body' }));
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

/**
 * Vite plugin exposing the JSON-file-backed high-score API on the same origin as
 * the game, so the frontend can just fetch('/api/scores').
 * @returns {import('vite').Plugin}
 */
export default function leaderboardPlugin() {
  return {
    name: 'pacman-leaderboard',
    configureServer(server) {
      server.middlewares.use(leaderboardMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(leaderboardMiddleware);
    },
  };
}
