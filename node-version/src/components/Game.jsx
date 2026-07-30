import { useEffect, useRef } from 'react';
import { GameCoordinator } from '../game/engine.js';
import Leaderboard from './Leaderboard.jsx';
import ScoreEntry from './ScoreEntry.jsx';
import '../styles/layout.css';
import '../styles/game.css';
import '../styles/leaderboard.css';

const IMG = '/app/style/graphics';

// The 19 pac-dots that fill the loading bar, positioned at 5%..95%.
const LOADING_DOTS = Array.from({ length: 19 }, (_, i) => (i + 1) * 5);

/**
 * Renders the DOM structure the vanilla game engine binds to (by element id)
 * and boots a single GameCoordinator once the markup is on the page.
 */
export default function Game() {
  const bootedRef = useRef(false);

  useEffect(() => {
    // Guard against double-invocation (e.g. React StrictMode) so we only ever
    // create one engine instance and one set of event listeners.
    if (bootedRef.current) return;
    bootedRef.current = true;

    // eslint-disable-next-line no-new
    new GameCoordinator();
  }, []);

  // Let the player start a game from the home screen by pressing Enter, in
  // addition to clicking PLAY. We only fire when the start menu is actually on
  // screen and its button is enabled, so Enter does nothing mid-game. (The
  // name-entry modal swallows Enter in the capture phase, so it never reaches
  // here while that modal is open.)
  useEffect(() => {
    function handleEnter(e) {
      if (e.key !== 'Enter') return;

      const button = document.getElementById('game-start');
      const menu = document.getElementById('main-menu-container');
      const menuVisible =
        menu && getComputedStyle(menu).visibility === 'visible';

      if (button && !button.disabled && menuVisible) {
        e.preventDefault();
        button.click();
      }
    }

    window.addEventListener('keydown', handleEnter);
    return () => window.removeEventListener('keydown', handleEnter);
  }, []);

  return (
    <div id="game-container">
      <img id="backdrop" className="backdrop" src={`${IMG}/backdrop.png`} alt="" />

      <div id="fps-display" className="fps-display" />

      <div id="main-menu-container" className="main-menu-container">
        <img id="logo" className="logo" src={`${IMG}/pacman_logo.png`} alt="Pacman" />
        <button id="game-start" className="game-start" type="button">
          PLAY
        </button>
        <Leaderboard />
      </div>

      <ScoreEntry />

      <div className="header-buttons">
        <button type="button">
          <i id="pause-button" className="material-icons">
            pause
          </i>
        </button>
        <button type="button">
          <i id="sound-button" className="material-icons" />
        </button>
      </div>

      <div id="paused-text" className="paused-text">
        PAUSED
      </div>

      <div id="game-ui" className="game-ui">
        <div id="row-top" className="row top">
          <div className="column _25">
            <div className="one-up">1UP</div>
            <div id="points-display" />
          </div>
          <div className="column _50">
            <div>HIGH SCORE</div>
            <div id="high-score-display" />
          </div>
        </div>

        {/*
          * The maze, all 244 pickups and every character are drawn into this
          * single canvas by the engine's renderer. They used to be individual
          * absolutely-positioned DOM nodes whose top/left were rewritten every
          * frame, which forced a layout pass per frame.
          */}
        <div id="maze" className="maze">
          <canvas id="game-canvas" className="game-canvas" />
        </div>

        <div id="bottom-row" className="row bottom">
          <div id="extra-lives" className="extra-lives" />
          <div id="fruit-display" className="fruit-display" />
        </div>
      </div>

      <div id="movement-buttons" className="movement-buttons">
        <div className="row">
          <button id="button-up" className="button-up" type="button">
            <i className="material-icons">keyboard_arrow_up</i>
          </button>
        </div>
        <div className="row">
          <button id="button-left" className="button-left" type="button">
            <i className="material-icons">keyboard_arrow_left</i>
          </button>
          <button id="button-right" className="button-right" type="button">
            <i className="material-icons">keyboard_arrow_right</i>
          </button>
        </div>
        <div className="row">
          <button id="button-down" className="button-down" type="button">
            <i className="material-icons">keyboard_arrow_down</i>
          </button>
        </div>
      </div>

      <div id="left-cover" className="loading-cover left" />
      <div id="right-cover" className="loading-cover right" />
      <div id="loading-container" className="loading-container">
        <div id="loading-pacman" className="loading-pacman" />
        <div id="loading-dot-mask" className="loading-dot-mask" />
        {LOADING_DOTS.map((pct) => (
          <div key={pct} className={`loading-dot _${pct}`} />
        ))}
      </div>

      <div id="error-message" className="error-message">
        <div className="header">
          <div>OOPS!</div>
          <div className="error-pacman" />
        </div>
        <div className="body">
          We were unable to load the images/sounds needed to play the game.
          <br />
          <br />
          This could be due to a poor connection, a strict network policy, or by
          playing on an unsupported browser.
        </div>
      </div>
    </div>
  );
}
