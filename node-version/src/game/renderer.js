/**
 * Canvas rendering layer.
 *
 * The game's art is authored as SVG at a native 8px-per-tile scale (the maze is
 * 224x248 = 28x31 tiles, character sheets are 16px frames, and so on). Drawing
 * SVG directly every frame is slow because the browser re-rasterizes the vector
 * on each `drawImage`, so every asset is rasterized once into an offscreen
 * canvas at the exact size it will be drawn at (times the device pixel ratio)
 * and blitted from there.
 *
 * Rasters are keyed by path + target size, so changing the game's scale simply
 * produces a new set of rasters; `Renderer.resize` drops the old ones.
 */

// Retina displays get a 2x backing store. Capping here rather than using the
// raw ratio keeps the canvas (and every raster) from ballooning on 3x phones
// for a sharpness difference nobody can see at this art scale.
const MAX_DPR = 2;

export class AssetStore {
  constructor() {
    this.images = new Map();
    this.rasters = new Map();
  }

  /**
   * Loads every source into an HTMLImageElement, reporting progress per asset.
   * @param {String[]} sources
   * @param {Function} [onProgress] - Called once per successfully loaded asset
   * @returns {Promise<void>}
   */
  load(sources, onProgress) {
    return Promise.all(sources.map(source => new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => {
        this.images.set(source, image);
        if (onProgress) onProgress();
        resolve();
      };
      image.onerror = () => reject(new Error(`Failed to load ${source}`));
      image.src = source;
    }))).then(() => undefined);
  }

  /**
   * Returns an offscreen canvas holding `path` rasterized at the given CSS size.
   * Repeated calls with the same size return the cached raster.
   * @param {String} path
   * @param {Number} width - Width in CSS pixels
   * @param {Number} height - Height in CSS pixels
   * @param {Number} dpr
   * @param {String} [tint] - Recolors the image's opaque pixels to this color
   * @returns {(HTMLCanvasElement|null)}
   */
  raster(path, width, height, dpr, tint) {
    const key = `${path}|${width}x${height}@${dpr}|${tint || ''}`;
    const cached = this.rasters.get(key);
    if (cached) return cached;

    const image = this.images.get(path);
    if (!image) return null;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));

    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    if (tint) {
      // 'color-dodge' against white blows any non-black pixel out to full
      // brightness while leaving black exactly black. The maze SVG paints an
      // opaque black background behind its walls, so a plain 'source-atop'
      // fill would flood the whole board instead of just the walls.
      ctx.globalCompositeOperation = 'color-dodge';
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    this.rasters.set(key, canvas);
    return canvas;
  }

  /**
   * Drops every cached raster (used when the game's scale changes).
   */
  clearRasters() {
    this.rasters.clear();
  }
}

export class Renderer {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.assets = assets;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
  }

  /**
   * Sizes the backing store to the device pixel ratio while keeping the CSS box
   * at the requested dimensions, then invalidates the raster cache since every
   * sprite now needs to be rasterized at a new size.
   * @param {Number} width - Width in CSS pixels
   * @param {Number} height - Height in CSS pixels
   */
  resize(width, height) {
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.width = width;
    this.height = height;

    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    // Draw in CSS pixels; the transform handles the device-pixel mapping.
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.assets.clearRasters();
  }

  clear() {
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  /**
   * Fills a solid rectangle (used for the maze cover during level transitions).
   */
  fillRect(x, y, width, height, color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, width, height);
  }

  /**
   * Draws a whole image scaled to the given box.
   * @param {String} path
   * @param {String} [tint] - Recolors the image's opaque pixels to this color
   */
  drawImage(path, x, y, width, height, tint) {
    const raster = this.assets.raster(path, width, height, this.dpr, tint);
    if (raster) {
      this.ctx.drawImage(raster, x, y, width, height);
    }
  }

  /**
   * Draws a single square frame out of a horizontal spritesheet.
   * @param {String} path
   * @param {Number} frameIndex - Zero-based frame to draw
   * @param {Number} frames - Total frames in the sheet
   * @param {Number} size - Rendered size of one frame, in CSS pixels
   */
  drawFrame(path, frameIndex, frames, x, y, size) {
    const raster = this.assets.raster(path, size * frames, size, this.dpr);
    if (!raster) return;

    const frameWidth = raster.width / frames;
    this.ctx.drawImage(
      raster,
      frameIndex * frameWidth, 0, frameWidth, raster.height,
      x, y, size, size,
    );
  }
}
