/* app.js – Phase 2  (gaze overlay, static heatmap modes, multi-trial) */
'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Action IDs follow the ALE / Atari-HEAD convention: 2 = RIGHT (→), 3 = LEFT (←).
// No reversal applied — mapping matches the dataset exactly.
const ACTION_ICONS = { 0:'∅', 1:'●', 2:'→', 3:'←', 4:'→●', 5:'←●' };
const ACTION_NAMES = { 0:'NOOP', 1:'FIRE', 2:'RIGHT', 3:'LEFT', 4:'RIGHTFIRE', 5:'LEFTFIRE' };

// Pre-reward window used for static heatmap modes (seconds before reward)
const PRE_REWARD_SEC = 2.0;

// Heatmap Gaussian sigma relative to max(img_width, img_height)
// Increased to roughly match the foveated medium-radius so both views feel consistent
const SIGMA_FRAC = 0.075;

// Warm colour ramp: black → deep-red → orange → yellow → white
const HEATMAP_RAMP = [
  [0,0,0], [80,0,0], [200,60,0], [255,200,30], [255,255,255],
];

// Foveated view focus radii (in canvas coords, which are 2× the Atari frame coords)
const FOV_RADII = {
  narrow: { sharp: 32, falloff: 64 },
  medium: { sharp: 48, falloff: 96 },
  wide:   { sharp: 64, falloff: 128 }
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let gameData = null;
let frames   = [];
let bins     = [];
let meta     = {};

// Per-game plot state
let plotManifest  = null;  // loaded once from plot_manifest.json
let plotCategory  = 'visible_clip';
let plotMetric    = 'gaze_path';

// Dropdown game ID → plot folder ID
const GAME_ID_TO_PLOT_ID = {
  breakout_hs:      'breakout',
  spaceinvaders_hs: 'space_invaders',
  montezuma_hs:     'montezuma_revenge',
  mspacman:         'ms_pacman',
  hero:             'hero',
  frostbite:        'frostbite',
};

let currentIdx = 0;
let playing    = false;
let speed      = 1.0;
let heatK        = 10;        // gaze trail length on frame canvas (not exposed as a button)
let heatMode     = 'window';  // kept for legacy; heatmap is always window mode now
let alignedSlice = '0.5-0';  // unused; kept to avoid removing dead state from other paths
let fovMode       = 'medium';   // 'narrow' | 'medium' | 'wide'
let perceptualTab = 'foveated'; // 'foveated' | 'glimpse' | 'heatmap'
let glimpseWindow = 50;         // 50 | 100 frames (shared by glimpse and heatmap)

// Playback timing
let rafId        = null;
let lastRafTime  = null;
let gameMs       = 0;
let renderVersion = 0;       // incremented on each renderFrame to cancel stale image loads

// Image cache (cleared on game switch)
const imgCache = new Map();

// Pre-computed static density grids (set by buildStaticDensities)
let preRewardGrid    = null;   // gaze 0–2 s before any reward
let baselineGrid     = null;   // kept for internal diff calculation
let diffGrid         = null;
let exploreGrid      = null;   // gaze far from rewards (> 2 s from any reward)
let aligned2to1Grid  = null;   // gaze 2.0–1.0 s before reward
let aligned1to05Grid = null;   // gaze 1.0–0.5 s before reward
let aligned05to0Grid = null;   // gaze 0.5–0.0 s before reward

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

let frameCanvas, frameCtx, heatCanvas, heatCtx, tlCanvas, tlCtx;
let fovCanvas, fovCtx, glimpseCanvas, glimpseCtx;

// Persistent offscreen canvases for foveated/glimpse rendering
let _blurCanvas, _blurCtx;
let _sharpCanvas, _sharpCtx;
let _patchCanvas, _patchCtx;   // small patch canvas for glimpse Gaussian-faded blobs

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function fmtTime(ms) {
  const s   = ms / 1000;
  const m   = Math.floor(s / 60);
  const rem = (s - m * 60).toFixed(1).padStart(4, '0');
  return `${m}:${rem}`;
}

function bisectTime(targetMs) {
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].cumulative_time_ms <= targetMs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function rampColor(t) {
  const n   = HEATMAP_RAMP.length - 1;
  const pos = Math.max(0, Math.min(1, t)) * n;
  const lo  = Math.floor(pos), hi = Math.min(lo + 1, n);
  const f   = pos - lo;
  const a   = HEATMAP_RAMP[lo], b = HEATMAP_RAMP[hi];
  return [ a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f, a[2]+(b[2]-a[2])*f ];
}

function diffColor(t) {
  // t in [-1, 1]: negative=blue, zero=dark, positive=warm
  if (t <= 0) {
    const s = -t;
    return [ 15+15*s, 30+40*s, 60+150*s ];
  }
  return [ 30+200*t, 80*t, 20*t ];
}

function gazeToCanvas(gx, gy, W, H) {
  const gxMin = meta.gaze_x_min, gxMax = meta.gaze_x_max;
  const gyMin = meta.gaze_y_min, gyMax = meta.gaze_y_max;
  const cx = ((gx - gxMin) / (gxMax - gxMin || 1)) * W;
  const cy = ((gy - gyMin) / (gyMax - gyMin || 1)) * H;
  return [cx, cy];
}

// ---------------------------------------------------------------------------
// Static density pre-computation
// ---------------------------------------------------------------------------

function accumulateDensity(frameSubset, BW, BH) {
  const density = new Float32Array(BW * BH);
  if (!frameSubset.length) return density;

  const sigma   = Math.max(BW, BH) * SIGMA_FRAC;
  const radius  = Math.ceil(sigma * 2.5);
  const inv2s2  = 1 / (2 * sigma * sigma);
  const gxMin   = meta.gaze_x_min, gxRange = (meta.gaze_x_max - meta.gaze_x_min) || 1;
  const gyMin   = meta.gaze_y_min, gyRange = (meta.gaze_y_max - meta.gaze_y_min) || 1;

  for (const f of frameSubset) {
    const pts = f.gaze_pts;
    if (!pts || pts.length < 2) continue;
    for (let j = 0; j < pts.length - 1; j += 2) {
      const cx = Math.round(((pts[j]   - gxMin) / gxRange) * (BW - 1));
      const cy = Math.round(((pts[j+1] - gyMin) / gyRange) * (BH - 1));
      const x0 = Math.max(0, cx - radius), x1 = Math.min(BW - 1, cx + radius);
      const y0 = Math.max(0, cy - radius), y1 = Math.min(BH - 1, cy + radius);
      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const dx = px - cx, dy = py - cy;
          density[py * BW + px] += Math.exp(-(dx*dx + dy*dy) * inv2s2);
        }
      }
    }
  }
  return density;
}

function buildStaticDensities() {
  const BW = meta.img_width, BH = meta.img_height;

  // All frames 0–2 s before a positive reward
  const preFrames  = frames.filter(f =>
    f.relative_time_to_next_reward_sec !== null &&
    f.relative_time_to_next_reward_sec >= -PRE_REWARD_SEC &&
    f.relative_time_to_next_reward_sec < 0
  );
  // Exploration: far from any reward (> 2 s away)
  const explFrames = frames.filter(f =>
    !f.is_positive_reward &&
    (f.relative_time_to_next_reward_sec === null ||
     f.relative_time_to_next_reward_sec < -PRE_REWARD_SEC)
  );
  // Reward-aligned slices (field value = -(seconds until next reward))
  const slice2to1  = frames.filter(f =>
    f.relative_time_to_next_reward_sec !== null &&
    f.relative_time_to_next_reward_sec >= -2.0 &&
    f.relative_time_to_next_reward_sec  < -1.0
  );
  const slice1to05 = frames.filter(f =>
    f.relative_time_to_next_reward_sec !== null &&
    f.relative_time_to_next_reward_sec >= -1.0 &&
    f.relative_time_to_next_reward_sec  < -0.5
  );
  const slice05to0 = frames.filter(f =>
    f.relative_time_to_next_reward_sec !== null &&
    f.relative_time_to_next_reward_sec >= -0.5 &&
    f.relative_time_to_next_reward_sec  <  0
  );

  preRewardGrid    = accumulateDensity(preFrames,  BW, BH);
  exploreGrid      = accumulateDensity(explFrames, BW, BH);
  aligned2to1Grid  = accumulateDensity(slice2to1,  BW, BH);
  aligned1to05Grid = accumulateDensity(slice1to05, BW, BH);
  aligned05to0Grid = accumulateDensity(slice05to0, BW, BH);

  // Keep baseline/diff for internal reference
  baselineGrid = exploreGrid;
  let maxPre = 0, maxBase = 0;
  for (let i = 0; i < BW * BH; i++) {
    if (preRewardGrid[i] > maxPre)  maxPre  = preRewardGrid[i];
    if (baselineGrid[i]  > maxBase) maxBase = baselineGrid[i];
  }
  maxPre = maxPre || 1; maxBase = maxBase || 1;
  diffGrid = new Float32Array(BW * BH);
  for (let i = 0; i < BW * BH; i++) {
    diffGrid[i] = (preRewardGrid[i] / maxPre) - (baselineGrid[i] / maxBase);
  }
}

// ---------------------------------------------------------------------------
// Rendering: gaze overlay on game frame
// ---------------------------------------------------------------------------

function drawGazeOverlay(idx) {
  const W = frameCanvas.width, H = frameCanvas.height;

  // Trail: last heatK frames preceding current
  const trailStart = Math.max(0, idx - heatK + 1);
  const trailLen   = idx - trailStart;  // number of trail dots

  for (let i = trailStart; i < idx; i++) {
    const f = frames[i];
    if (f.mean_gaze_x === null || f.mean_gaze_y === null) continue;
    const [cx, cy] = gazeToCanvas(f.mean_gaze_x, f.mean_gaze_y, W, H);

    const age   = idx - i;                           // 1 = newest in trail
    const alpha = 0.6 * (1 - age / (trailLen + 1));  // fade older ones out
    const r     = 4;

    frameCtx.save();
    frameCtx.globalAlpha = alpha;
    frameCtx.fillStyle = '#ffaa22';
    frameCtx.beginPath();
    frameCtx.arc(cx, cy, r, 0, Math.PI * 2);
    frameCtx.fill();
    frameCtx.restore();
  }

  // Current frame: all gaze_pts as small dots + mean point as ringed marker
  const f = frames[idx];
  if (!f) return;

  // Individual gaze sample dots for current frame
  const pts = f.gaze_pts;
  if (pts && pts.length >= 2) {
    frameCtx.save();
    frameCtx.globalAlpha = 0.45;
    frameCtx.fillStyle = '#ff6644';
    for (let j = 0; j < pts.length - 1; j += 2) {
      const [cx, cy] = gazeToCanvas(pts[j], pts[j+1], W, H);
      frameCtx.beginPath();
      frameCtx.arc(cx, cy, 3, 0, Math.PI * 2);
      frameCtx.fill();
    }
    frameCtx.restore();
  }

  // Mean gaze: white ring + solid centre
  if (f.mean_gaze_x !== null && f.mean_gaze_y !== null) {
    const [cx, cy] = gazeToCanvas(f.mean_gaze_x, f.mean_gaze_y, W, H);

    frameCtx.save();
    frameCtx.globalAlpha = 0.85;
    frameCtx.strokeStyle = '#ffffff';
    frameCtx.lineWidth = 2;
    frameCtx.beginPath();
    frameCtx.arc(cx, cy, 9, 0, Math.PI * 2);
    frameCtx.stroke();
    frameCtx.restore();

    frameCtx.save();
    frameCtx.globalAlpha = 0.9;
    frameCtx.fillStyle = '#ff3322';
    frameCtx.beginPath();
    frameCtx.arc(cx, cy, 5, 0, Math.PI * 2);
    frameCtx.fill();
    frameCtx.restore();
  }
}

function drawRewardBorder(idx) {
  if (!frames[idx]?.is_positive_reward) return;
  const W = frameCanvas.width, H = frameCanvas.height;
  frameCtx.save();
  frameCtx.strokeStyle = '#33ee77';
  frameCtx.lineWidth = 6;
  frameCtx.strokeRect(3, 3, W - 6, H - 6);
  frameCtx.restore();
}

// ---------------------------------------------------------------------------
// Foveated view: get gaze position and detect saccade/movement
// ---------------------------------------------------------------------------

function getGazeInfo(idx) {
  const f = frames[idx];
  const W = fovCanvas.width, H = fovCanvas.height;

  if (!f || f.mean_gaze_x === null || f.mean_gaze_y === null) {
    return { cx: W / 2, cy: H / 2, stable: true };
  }

  const [cx, cy] = gazeToCanvas(f.mean_gaze_x, f.mean_gaze_y, W, H);

  // Detect gaze velocity from last 2 frames
  // If displacement > threshold → unstable (rapid saccade)
  const VELOCITY_THRESHOLD = 25; // px displacement in canvas coords
  let stable = true;

  for (let back = 1; back <= 2; back++) {
    const pf = frames[idx - back];
    if (!pf || pf.mean_gaze_x === null) continue;
    const [px, py] = gazeToCanvas(pf.mean_gaze_x, pf.mean_gaze_y, W, H);
    const dx = cx - px, dy = cy - py;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist > VELOCITY_THRESHOLD) { stable = false; break; }
  }

  return { cx, cy, stable };
}

// ---------------------------------------------------------------------------
// Foveated view rendering
// ---------------------------------------------------------------------------

function drawFoveatedView(idx, img) {
  const W = fovCanvas.width, H = fovCanvas.height;
  if (!img) {
    fovCtx.fillStyle = '#111';
    fovCtx.fillRect(0, 0, W, H);
    return;
  }

  const gazeInfo = getGazeInfo(idx);
  let radii = FOV_RADII[fovMode];

  // If gaze is moving fast (saccade), reduce the sharp region
  if (!gazeInfo.stable) {
    radii = {
      sharp: Math.round(radii.sharp * 0.4),
      falloff: Math.round(radii.falloff * 0.6)
    };
  }

  // 1. Draw heavily blurred and dimmed background
  //    Downsample to ~W/20 (extreme pixelation = strong blur), then dim with a dark overlay
  const bW = Math.max(2, Math.round(W / 20)), bH = Math.max(2, Math.round(H / 20));
  _blurCtx.drawImage(img, 0, 0, bW, bH);
  fovCtx.imageSmoothingEnabled = true;
  fovCtx.imageSmoothingQuality = 'low';
  fovCtx.drawImage(_blurCanvas, 0, 0, bW, bH, 0, 0, W, H);
  fovCtx.imageSmoothingEnabled = false;
  // Dim the blurred background so it reads as peripheral / unresolvable
  fovCtx.fillStyle = 'rgba(0,0,0,0.55)';
  fovCtx.fillRect(0, 0, W, H);

  // 2. Create sharp patch with radial gradient alpha mask on temp canvas
  _sharpCtx.clearRect(0, 0, W, H);
  _sharpCtx.drawImage(img, 0, 0, W, H);

  // Apply radial gradient as destination-in alpha mask
  const grd = _sharpCtx.createRadialGradient(gazeInfo.cx, gazeInfo.cy, radii.sharp, gazeInfo.cx, gazeInfo.cy, radii.falloff);
  grd.addColorStop(0, 'rgba(0,0,0,1)');     // Fully opaque inside sharp radius
  grd.addColorStop(1, 'rgba(0,0,0,0)');     // Transparent at falloff edge
  _sharpCtx.globalCompositeOperation = 'destination-in';
  _sharpCtx.fillStyle = grd;
  _sharpCtx.fillRect(0, 0, W, H);
  _sharpCtx.globalCompositeOperation = 'source-over';

  // 3. Composite sharp patch onto foveated canvas
  fovCtx.drawImage(_sharpCanvas, 0, 0);

  // 4. Draw gaze indicator ring at the center of the sharp region
  fovCtx.save();
  fovCtx.strokeStyle = 'rgba(255,255,255,0.75)';
  fovCtx.lineWidth = 1.5;
  fovCtx.beginPath();
  fovCtx.arc(gazeInfo.cx, gazeInfo.cy, 10, 0, Math.PI * 2);
  fovCtx.stroke();
  fovCtx.restore();

  // 5. Update status label
  const statusEl = document.getElementById('fov-status');
  if (gazeInfo.stable) {
    statusEl.textContent = 'stable gaze';
    statusEl.className = 'fov-status-label';
  } else {
    statusEl.textContent = 'rapid gaze shift';
    statusEl.className = 'fov-status-label unstable';
  }
}

// ---------------------------------------------------------------------------
// Integrated glimpse view rendering
// ---------------------------------------------------------------------------

function drawGlimpseView(idx, img) {
  const W = glimpseCanvas.width, H = glimpseCanvas.height;
  if (!img) {
    glimpseCtx.fillStyle = '#111';
    glimpseCtx.fillRect(0, 0, W, H);
    return;
  }

  glimpseCtx.clearRect(0, 0, W, H);

  // 1. Heavily blurred and dimmed background
  const bW = Math.max(2, Math.round(W / 20)), bH = Math.max(2, Math.round(H / 20));
  _blurCtx.drawImage(img, 0, 0, bW, bH);
  glimpseCtx.imageSmoothingEnabled = true;
  glimpseCtx.imageSmoothingQuality = 'low';
  glimpseCtx.drawImage(_blurCanvas, 0, 0, bW, bH, 0, 0, W, H);
  glimpseCtx.imageSmoothingEnabled = false;
  glimpseCtx.fillStyle = 'rgba(0,0,0,0.60)';
  glimpseCtx.fillRect(0, 0, W, H);

  // 2. Gaussian-faded patches from last N frames using _patchCanvas
  //    Use falloff radius (wider than foveated sharp) to match the broader sampled area.
  //    NOTE: Using cached per-frame images when available; falls back to current frame.
  const N = glimpseWindow;
  const patchR = FOV_RADII[fovMode].falloff; // wide blobs to reflect spatial memory
  const pd = _patchCanvas.width;             // fixed at wide.falloff * 2 — never resized
  const halfPd = Math.round(pd / 2);

  for (let age = N - 1; age >= 0; age--) {
    const frameIdx = idx - age;
    if (frameIdx < 0) continue;

    const pf = frames[frameIdx];
    if (!pf || pf.mean_gaze_x === null || pf.mean_gaze_y === null) continue;

    const [gx, gy] = gazeToCanvas(pf.mean_gaze_x, pf.mean_gaze_y, W, H);
    // Smooth alpha decay: recent patches fully opaque, oldest are very faint
    const alpha = Math.pow(1 - age / N, 0.6) * 0.9;

    const cx0 = Math.round(gx) - halfPd, cy0 = Math.round(gy) - halfPd;

    // Draw full frame scaled to canvas size, offset so gaze center lands at patch center.
    // This avoids any source-pixel-coordinate mismatch (img may be 160×210, canvas is W×H).
    _patchCtx.clearRect(0, 0, pd, pd);
    _patchCtx.drawImage(img, halfPd - gx, halfPd - gy, W, H);

    // Gaussian-like radial gradient fade (destination-in masks the patch to a soft blob)
    const grd = _patchCtx.createRadialGradient(halfPd, halfPd, 0, halfPd, halfPd, patchR);
    grd.addColorStop(0,    'rgba(0,0,0,1)');
    grd.addColorStop(0.45, 'rgba(0,0,0,0.9)');
    grd.addColorStop(0.75, 'rgba(0,0,0,0.45)');
    grd.addColorStop(1,    'rgba(0,0,0,0)');
    _patchCtx.globalCompositeOperation = 'destination-in';
    _patchCtx.fillStyle = grd;
    _patchCtx.fillRect(0, 0, pd, pd);
    _patchCtx.globalCompositeOperation = 'source-over';

    // Composite the soft patch onto the glimpse canvas
    glimpseCtx.save();
    glimpseCtx.globalAlpha = alpha;
    glimpseCtx.drawImage(_patchCanvas, 0, 0, pd, pd, cx0, cy0, pd, pd);
    glimpseCtx.restore();
  }

  // Gaze indicator ring at most recent fixation
  const curF = frames[idx];
  if (curF && curF.mean_gaze_x !== null && curF.mean_gaze_y !== null) {
    const [gx, gy] = gazeToCanvas(curF.mean_gaze_x, curF.mean_gaze_y, W, H);
    glimpseCtx.save();
    glimpseCtx.strokeStyle = 'rgba(255,255,255,0.75)';
    glimpseCtx.lineWidth = 1.5;
    glimpseCtx.beginPath();
    glimpseCtx.arc(gx, gy, 10, 0, Math.PI * 2);
    glimpseCtx.stroke();
    glimpseCtx.restore();
  }
}

// ---------------------------------------------------------------------------
// Rendering: game frame image (async with version tracking)
// ---------------------------------------------------------------------------

function loadImg(path) {
  if (imgCache.has(path)) return Promise.resolve(imgCache.get(path));
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      imgCache.set(path, img);
      // decode() ensures the bitmap is ready for paint before resolving, reducing frame jank
      if (img.decode) {
        img.decode().then(() => resolve(img)).catch(() => resolve(img));
      } else {
        resolve(img);
      }
    };
    img.onerror = () => resolve(null);
    img.src = path;
  });
}

function prefetch(idx) {
  // Preload ~1 s of frames ahead (Atari-HEAD is ~60 FPS)
  const end = Math.min(frames.length - 1, idx + 60);
  for (let i = idx + 1; i <= end; i++) {
    const p = frames[i]?.frame_path;
    if (p && !imgCache.has(p)) {
      const img = new Image();
      img.onload = () => imgCache.set(p, img);
      img.src = p;
    }
  }
}

// ---------------------------------------------------------------------------
// Gameplay-level attention statistics
// ---------------------------------------------------------------------------

let _gazePlotImageData = null;

function computeSessionStats() {
  const W = meta.img_width;   // 160
  const H = meta.img_height;  // 210
  const diag = Math.sqrt(W * W + H * H);

  // A. Stable gaze (threshold: normalized displacement ≤ 0.04)
  const STABLE_THRESH = 0.04;
  let stableCount = 0, validPairs = 0;
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i], prev = frames[i - 1];
    if (!f.has_gaze || f.mean_gaze_x === null || !prev.has_gaze || prev.mean_gaze_x === null) continue;
    validPairs++;
    const dx = f.mean_gaze_x - prev.mean_gaze_x;
    const dy = f.mean_gaze_y - prev.mean_gaze_y;
    if (Math.sqrt(dx * dx + dy * dy) / diag <= STABLE_THRESH) stableCount++;
  }
  if (validPairs > 0) {
    const pct = Math.round(stableCount / validPairs * 100);
    // Estimate stable seconds: stableCount frames × avg frame duration
    const avgFrameMs = (meta.segment_duration_ms || 60000) / frames.length;
    const stableSec = (stableCount * avgFrameMs / 1000).toFixed(1);
    document.getElementById('stat-stable').textContent = stableSec + 's (' + pct + '%)';
  } else {
    document.getElementById('stat-stable').textContent = 'not available';
  }

  // B. Attention pattern (normalized entropy over 16×21 grid)
  const GW = 16, GH = 21;
  const grid = new Float32Array(GW * GH);
  let totalPts = 0;
  for (const f of frames) {
    if (!f.has_gaze || f.mean_gaze_x === null) continue;
    const col = Math.min(GW - 1, Math.max(0, Math.floor(f.mean_gaze_x / W * GW)));
    const row = Math.min(GH - 1, Math.max(0, Math.floor(f.mean_gaze_y / H * GH)));
    grid[row * GW + col]++;
    totalPts++;
  }
  let occupied = 0;
  for (let i = 0; i < GW * GH; i++) if (grid[i] > 0) occupied++;
  let entropy = 0;
  if (totalPts > 0 && occupied > 1) {
    for (let i = 0; i < GW * GH; i++) {
      const p = grid[i] / totalPts;
      if (p > 0) entropy -= p * Math.log(p);
    }
    entropy /= Math.log(occupied);
  }
  let pattern;
  if (entropy < 0.35) pattern = 'Focused';
  else if (entropy < 0.60) pattern = 'Mixed';
  else pattern = 'Scanning';
  document.getElementById('stat-pattern').textContent = pattern;

  // C. Gaze traveled (sum of consecutive displacements / diagonal)
  let totalTravel = 0;
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i], prev = frames[i - 1];
    if (!f.has_gaze || f.mean_gaze_x === null || !prev.has_gaze || prev.mean_gaze_x === null) continue;
    const dx = f.mean_gaze_x - prev.mean_gaze_x;
    const dy = f.mean_gaze_y - prev.mean_gaze_y;
    totalTravel += Math.sqrt(dx * dx + dy * dy);
  }
  document.getElementById('stat-traveled').textContent = (totalTravel / diag).toFixed(1) + ' diags';

  // Draw the mini gaze-movement plot
  drawGazePlot();
}

function updateStatsFrameInfo(idx) {
  const f = frames[idx];
  if (!f) return;
  document.getElementById('stat-frame').textContent = (idx + 1) + ' / ' + frames.length;
  const scoreEl = document.getElementById('stat-score');
  scoreEl.textContent = (f.score !== null && f.score !== undefined) ? f.score : '—';
}

function drawGazePlot() {
  const canvas = document.getElementById('gaze-plot-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const cW = canvas.width, cH = canvas.height;
  const diag = Math.sqrt(meta.img_width ** 2 + meta.img_height ** 2);
  const totalMs = meta.segment_duration_ms || 1;
  const binMs = 1000;
  const numBins = Math.ceil(totalMs / binMs);

  const binSums = new Float32Array(numBins);
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i], prev = frames[i - 1];
    if (!f.has_gaze || !prev.has_gaze || f.mean_gaze_x === null || prev.mean_gaze_x === null) continue;
    const dx = f.mean_gaze_x - prev.mean_gaze_x;
    const dy = f.mean_gaze_y - prev.mean_gaze_y;
    const dist = Math.sqrt(dx * dx + dy * dy) / diag;
    const bin = Math.min(numBins - 1, Math.floor(f.cumulative_time_ms / binMs));
    binSums[bin] += dist;
  }

  let maxVal = 0;
  for (let i = 0; i < numBins; i++) if (binSums[i] > maxVal) maxVal = binSums[i];
  if (maxVal === 0) maxVal = 1;

  ctx.clearRect(0, 0, cW, cH);
  const barW = cW / numBins;
  for (let i = 0; i < numBins; i++) {
    const barH = (binSums[i] / maxVal) * (cH - 4);
    ctx.fillStyle = '#9bbcff';
    ctx.fillRect(i * barW, cH - barH, Math.max(1, barW - 1), barH);
  }

  _gazePlotImageData = ctx.getImageData(0, 0, cW, cH);
}

function drawGazePlotCursor(idx) {
  const canvas = document.getElementById('gaze-plot-canvas');
  if (!canvas || !_gazePlotImageData) return;
  const ctx = canvas.getContext('2d');
  const cW = canvas.width, cH = canvas.height;
  ctx.putImageData(_gazePlotImageData, 0, 0);

  const totalMs = meta.segment_duration_ms || 1;
  const curMs = frames[idx]?.cumulative_time_ms ?? 0;
  const x = Math.round((curMs / totalMs) * cW);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - 1, 0, 2, cH);
}

function showRewardBadge(idx) {
  const f = frames[idx];
  const col = document.getElementById('canvas-wrap');
  const old = col.querySelector('.reward-badge');
  if (old) old.remove();

  if (!f || !f.is_positive_reward) return;

  const badge = document.createElement('div');
  badge.className = 'reward-badge';
  badge.textContent = '+' + f.reward + ' reward';
  col.appendChild(badge);
  badge.addEventListener('animationend', () => badge.remove());
}

function renderVisuals(idx, version) {
  // Load frame image once, pass to all image-dependent renderers.
  // Heatmap is synchronous and doesn't need the image — render it immediately.
  const f = frames[idx];
  if (!f) return;

  document.getElementById('action-overlay').textContent = ACTION_ICONS[f.action] ?? '?';

  // Heatmap doesn't need the frame image — draw it right away so it stays in sync
  if (perceptualTab === 'heatmap') {
    drawHeatmap(idx);
  }

  const renderWithImg = (img) => {
    if (version !== renderVersion) return;

    // 1. Draw main frame canvas (always)
    frameCtx.clearRect(0, 0, frameCanvas.width, frameCanvas.height);
    if (img) {
      frameCtx.drawImage(img, 0, 0, frameCanvas.width, frameCanvas.height);
    } else {
      frameCtx.fillStyle = '#111';
      frameCtx.fillRect(0, 0, frameCanvas.width, frameCanvas.height);
    }
    drawGazeOverlay(idx);
    showRewardBadge(idx);

    // 2. Draw only the active perceptual tab
    if (perceptualTab === 'foveated') {
      drawFoveatedView(idx, img);
    } else if (perceptualTab === 'glimpse') {
      drawGlimpseView(idx, img);
    }
    // heatmap already drawn synchronously above
  };

  if (f.frame_path) {
    loadImg(f.frame_path).then(renderWithImg);
  } else {
    renderWithImg(null);
  }
}

// ---------------------------------------------------------------------------
// Rendering: heatmap
// ---------------------------------------------------------------------------

function densityToImageData(density, BW, BH, colorFn, maxVal) {
  const W = heatCanvas.width, H = heatCanvas.height;
  const imgData = heatCtx.createImageData(W, H);
  const scaleX  = BW / W, scaleY = BH / H;

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const bx = Math.min(BW - 1, Math.round(px * scaleX));
      const by = Math.min(BH - 1, Math.round(py * scaleY));
      const v  = density[by * BW + bx];
      const [r, g, b] = colorFn(maxVal > 0 ? v / maxVal : 0);
      const i4 = (py * W + px) * 4;
      imgData.data[i4]     = r;
      imgData.data[i4 + 1] = g;
      imgData.data[i4 + 2] = b;
      imgData.data[i4 + 3] = 255;
    }
  }
  return imgData;
}

function drawHeatmap(idx) {
  // Simplified: always shows the rolling window using the same glimpseWindow setting
  const W = heatCanvas.width, H = heatCanvas.height;
  heatCtx.clearRect(0, 0, W, H);

  const BW = meta.img_width, BH = meta.img_height;
  const start = Math.max(0, idx - glimpseWindow + 1);
  const windowFrames = frames.slice(start, idx + 1);
  const density = accumulateDensity(windowFrames, BW, BH);

  let maxV = 0;
  for (let i = 0; i < BW * BH; i++) if (density[i] > maxV) maxV = density[i];
  if (maxV === 0) return;

  heatCtx.putImageData(densityToImageData(density, BW, BH, t => rampColor(t), maxV), 0, 0);
}

// ---------------------------------------------------------------------------
// Rendering: timeline
// ---------------------------------------------------------------------------

function drawTimeline(idx) {
  const W = tlCanvas.width, H = tlCanvas.height;
  tlCtx.clearRect(0, 0, W, H);
  if (!bins.length) return;

  const maxReward = Math.max(1, ...bins.map(b => b.reward_count));
  const binW = W / bins.length;

  for (const bin of bins) {
    const x = bin.bin_idx * binW;
    const t = bin.reward_count / maxReward;
    const r = Math.round(18  + (255 - 18)  * t);
    const g = Math.round(20  + (180 - 20)  * t);
    const b = Math.round(40  + (40  - 40)  * t);
    tlCtx.fillStyle = `rgb(${r},${g},${b})`;
    tlCtx.fillRect(Math.floor(x), 0, Math.ceil(binW), H - 6);
  }

  // Second ticks
  const totalMs = meta.segment_duration_ms || 0;
  tlCtx.fillStyle = '#33334a';
  for (let t = 0; t <= totalMs; t += 10000) {
    const x = (t / totalMs) * W;
    tlCtx.fillRect(Math.round(x), H - 6, 1, 6);
  }

  // Current frame marker
  const curMs = frames[idx]?.cumulative_time_ms ?? 0;
  const frac  = totalMs > 0 ? curMs / totalMs : 0;
  tlCtx.fillStyle = '#ffffff';
  tlCtx.fillRect(Math.round(frac * W) - 1, 0, 3, H);
}

// ---------------------------------------------------------------------------
// Info panel
// ---------------------------------------------------------------------------

function updateInfoPanel(idx) {
  const f = frames[idx];
  if (!f) return;

  document.getElementById('ip-frame').textContent = `${idx + 1} / ${frames.length}`;
  document.getElementById('ip-frame').title = `frame_id: ${f.frame_id}`;

  // Score: hide row if null for this game
  const scoreRow = document.getElementById('ip-score-row');
  if (f.score !== null && f.score !== undefined) {
    scoreRow.style.display = '';
    document.getElementById('ip-score').textContent = f.score;
  } else {
    scoreRow.style.display = 'none';
  }

  const rv = f.reward;
  const rewardEl = document.getElementById('ip-reward');
  rewardEl.textContent = rv !== 0 ? (rv > 0 ? `+${rv}` : String(rv)) : '0';
  rewardEl.className = 'info-val' + (rv > 0 ? ' reward-pos' : rv < 0 ? ' reward-neg' : '');

  const aLabel = f.action !== null
    ? `${ACTION_ICONS[f.action] ?? '?'}  ${ACTION_NAMES[f.action] ?? f.action}`
    : '—';
  document.getElementById('ip-action').textContent  = aLabel;
  document.getElementById('ip-gaze').textContent    = f.num_gaze_samples ?? 0;

  const ttnr = f.relative_time_to_next_reward_sec;
  document.getElementById('ip-ttnr').textContent =
    ttnr !== null && ttnr !== undefined ? `${ttnr.toFixed(2)} s` : '—';
}

// ---------------------------------------------------------------------------
// Seek / time display
// ---------------------------------------------------------------------------

function updateSeekSlider(idx) {
  document.getElementById('seek-slider').value =
    Math.round((idx / Math.max(1, frames.length - 1)) * 1000);
}

function updateTimeDisplay(idx) {
  const cur   = frames[idx]?.cumulative_time_ms ?? 0;
  const total = meta.segment_duration_ms ?? 0;
  document.getElementById('time-display').textContent =
    `${fmtTime(cur)}  /  ${fmtTime(total)}`;
}

// ---------------------------------------------------------------------------
// Master render
// ---------------------------------------------------------------------------

function renderFrame(idx) {
  idx = Math.max(0, Math.min(frames.length - 1, idx));
  currentIdx = idx;
  gameMs     = frames[idx]?.cumulative_time_ms ?? 0;
  renderVersion++;

  renderVisuals(idx, renderVersion);
  drawTimeline(idx);
  updateInfoPanel(idx);
  updateStatsFrameInfo(idx);
  updateSeekSlider(idx);
  updateTimeDisplay(idx);
  prefetch(idx);
}

// ---------------------------------------------------------------------------
// Playback loop
// ---------------------------------------------------------------------------

function rafLoop(now) {
  if (!playing) return;

  if (lastRafTime !== null) {
    gameMs += (now - lastRafTime) * speed;
  }
  lastRafTime = now;

  const totalMs = meta.segment_duration_ms ?? 0;
  if (gameMs >= totalMs) {
    gameMs = totalMs;
    pausePlayback();
    renderFrame(frames.length - 1);
    return;
  }

  const newIdx = bisectTime(gameMs);
  if (newIdx !== currentIdx) {
    currentIdx = newIdx;
    renderVersion++;
    renderVisuals(newIdx, renderVersion);
    drawTimeline(newIdx);
    updateInfoPanel(newIdx);
    updateStatsFrameInfo(newIdx);
    updateSeekSlider(newIdx);
    updateTimeDisplay(newIdx);
    prefetch(newIdx);
  }

  rafId = requestAnimationFrame(rafLoop);
}

function startPlayback() {
  if (playing) return;
  playing     = true;
  lastRafTime = null;
  document.getElementById('play-btn').textContent = '⏸';
  rafId = requestAnimationFrame(rafLoop);
}

function pausePlayback() {
  playing = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  lastRafTime = null;
  document.getElementById('play-btn').textContent = '▶';
}

function togglePlayback() {
  if (playing) pausePlayback(); else startPlayback();
}

// ---------------------------------------------------------------------------
// Offscreen canvases for foveated/glimpse rendering
// ---------------------------------------------------------------------------

function initOffscreenCanvases(W, H) {
  // Small canvas for downsampled blur background
  if (!_blurCanvas) {
    _blurCanvas = document.createElement('canvas');
    _blurCtx = _blurCanvas.getContext('2d');
  }
  _blurCanvas.width = Math.round(W / 8);
  _blurCanvas.height = Math.round(H / 8);

  // Full-size canvas for foveated sharp patch with gradient alpha mask
  if (!_sharpCanvas) {
    _sharpCanvas = document.createElement('canvas');
    _sharpCtx = _sharpCanvas.getContext('2d');
  }
  _sharpCanvas.width = W;
  _sharpCanvas.height = H;

  // Patch canvas for glimpse view — fixed at max falloff diameter so it never needs resizing
  if (!_patchCanvas) {
    _patchCanvas = document.createElement('canvas');
    _patchCtx = _patchCanvas.getContext('2d');
  }
  const maxPd = FOV_RADII.wide.falloff * 2; // 256px — enough for any fovMode
  _patchCanvas.width  = maxPd;
  _patchCanvas.height = maxPd;
}

// ---------------------------------------------------------------------------
// Per-game plot panel
// ---------------------------------------------------------------------------

async function ensureManifest() {
  if (plotManifest) return;
  try {
    const resp = await fetch('plots/per_game/plot_manifest.json');
    if (resp.ok) plotManifest = await resp.json();
  } catch (e) { /* manifest not available */ }
}

async function updatePlot() {
  await ensureManifest();

  const select  = document.getElementById('game-select');
  const gameId  = select ? select.value : '';
  const plotId  = GAME_ID_TO_PLOT_ID[gameId];
  const img     = document.getElementById('plot-img');
  const caption = document.getElementById('plot-caption');
  if (!img || !caption) return;

  if (!plotManifest || !plotId) {
    img.src = '';
    caption.textContent = '';
    return;
  }

  const entry = plotManifest[plotId]?.[plotCategory]?.[plotMetric];
  if (!entry) {
    img.src = '';
    caption.textContent = 'Plot not available.';
    return;
  }

  img.src = entry.png;
  caption.textContent = entry.caption || '';
}

// ---------------------------------------------------------------------------
// Game loading
// ---------------------------------------------------------------------------

async function loadGame(entry) {
  pausePlayback();
  imgCache.clear();
  preRewardGrid = baselineGrid = diffGrid = null;

  document.getElementById('loading').style.display = '';
  document.getElementById('viz').style.display     = 'none';

  let data;
  try {
    const resp = await fetch(entry.file);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    data = await resp.json();
  } catch (e) {
    document.getElementById('loading').textContent = `Error loading ${entry.file}: ${e.message}`;
    return;
  }

  gameData = data;
  meta     = data.meta;
  frames   = data.frames;
  bins     = data.bins || [];

  // Resize canvases to match image dimensions (×2 for crispness)
  const W = meta.img_width  * 2;
  const H = meta.img_height * 2;
  frameCanvas.width  = W; frameCanvas.height  = H;
  fovCanvas.width    = W; fovCanvas.height    = H;
  glimpseCanvas.width = W; glimpseCanvas.height = H;
  heatCanvas.width   = W; heatCanvas.height   = H;
  tlCanvas.width     = W * 2 + 18;   // match two columns

  // Initialize offscreen canvases for foveated/glimpse rendering
  initOffscreenCanvases(W, H);

  // Session-info subtitle (no raw filename)
  const dur = (meta.segment_duration_ms / 1000).toFixed(1);
  document.getElementById('session-info').textContent =
    `${meta.game_name}  ·  ${frames.length} frames  ·  ${meta.segment_reward_count} rewards  ·  ${dur}s`;

  gameMs        = 0;
  currentIdx    = 0;
  fovMode       = 'medium';
  perceptualTab = 'foveated';
  glimpseWindow = 50;

  // Reset UI controls to initial state
  document.querySelectorAll('.fov-btn').forEach(b => b.classList.remove('active'));
  const defFov = document.querySelector('.fov-btn[data-fov="medium"]');
  if (defFov) defFov.classList.add('active');

  document.querySelectorAll('.perc-tab').forEach(b => b.classList.remove('active'));
  const defPercTab = document.querySelector('.perc-tab[data-tab="foveated"]');
  if (defPercTab) defPercTab.classList.add('active');
  document.getElementById('foveated-canvas').style.display = '';
  document.getElementById('glimpse-canvas').style.display  = 'none';
  document.getElementById('heatmap-canvas').style.display  = 'none';
  document.getElementById('fov-controls').style.display    = 'flex';
  document.getElementById('window-controls').style.display = 'none';
  document.getElementById('fov-status').style.visibility   = 'visible';
  const focusLbl = document.getElementById('focus-label');
  if (focusLbl) focusLbl.textContent = 'Focus';

  document.querySelectorAll('.gw-btn').forEach(b => b.classList.remove('active'));
  const defGW = document.querySelector('.gw-btn[data-gw="50"]');
  if (defGW) defGW.classList.add('active');

  document.getElementById('loading').style.display = 'none';
  document.getElementById('viz').style.display     = '';

  renderFrame(0);
  updatePlot();

  // Background-preload all frames in small batches to warm the cache
  const cacheStatusEl = document.getElementById('cache-status');
  if (cacheStatusEl) cacheStatusEl.style.display = '';

  let batchStart = 0;
  function bgPreloadBatch() {
    const batchEnd = Math.min(batchStart + 60, frames.length);
    for (let i = batchStart; i < batchEnd; i++) {
      const p = frames[i]?.frame_path;
      if (p && !imgCache.has(p)) {
        const img = new Image();
        img.onload = () => imgCache.set(p, img);
        img.src = p;
      }
    }
    batchStart = batchEnd;
    if (batchStart < frames.length) {
      setTimeout(bgPreloadBatch, 150);
    } else {
      if (cacheStatusEl) cacheStatusEl.style.display = 'none';
    }
  }
  setTimeout(bgPreloadBatch, 400);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function wireEvents(games) {
  // Game selector
  const select = document.getElementById('game-select');
  select.addEventListener('change', () => {
    const entry = games.find(g => g.id === select.value);
    if (entry) loadGame(entry);
  });

  // Plot category buttons
  document.querySelectorAll('.plot-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.plot-cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      plotCategory = btn.dataset.cat;
      updatePlot();
    });
  });

  // Plot metric buttons
  document.querySelectorAll('.plot-metric-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.plot-metric-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      plotMetric = btn.dataset.metric;
      updatePlot();
    });
  });

  // Playback
  document.getElementById('play-btn').addEventListener('click', togglePlayback);

  // Reward navigation
  document.getElementById('prev-reward-btn').addEventListener('click', () => {
    pausePlayback();
    for (let i = currentIdx - 1; i >= 0; i--) {
      if (frames[i].is_positive_reward) { renderFrame(i); break; }
    }
  });
  document.getElementById('next-reward-btn').addEventListener('click', () => {
    pausePlayback();
    for (let i = currentIdx + 1; i < frames.length; i++) {
      if (frames[i].is_positive_reward) { renderFrame(i); break; }
    }
  });

  // Frame-by-frame navigation
  document.getElementById('prev-frame-btn').addEventListener('click', () => {
    pausePlayback();
    renderFrame(currentIdx - 1);
  });
  document.getElementById('next-frame-btn').addEventListener('click', () => {
    pausePlayback();
    renderFrame(currentIdx + 1);
  });

  // Speed buttons
  document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      speed = parseFloat(btn.dataset.speed);
      document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Seek slider
  const slider = document.getElementById('seek-slider');
  slider.addEventListener('mousedown', () => pausePlayback());
  slider.addEventListener('input', () => {
    const frac = parseInt(slider.value) / 1000;
    renderFrame(Math.round(frac * (frames.length - 1)));
  });

  // Foveated focus buttons
  document.querySelectorAll('.fov-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      fovMode = btn.dataset.fov;
      document.querySelectorAll('.fov-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderVisuals(currentIdx, ++renderVersion);
    });
  });

  // Perceptual view tabs: switch between foveated, glimpse, and heatmap
  document.querySelectorAll('.perc-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      perceptualTab = btn.dataset.tab;
      document.querySelectorAll('.perc-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Show/hide canvases
      document.getElementById('foveated-canvas').style.display = perceptualTab === 'foveated' ? '' : 'none';
      document.getElementById('glimpse-canvas').style.display  = perceptualTab === 'glimpse'  ? '' : 'none';
      document.getElementById('heatmap-canvas').style.display  = perceptualTab === 'heatmap'  ? '' : 'none';
      // Show/hide contextual controls
      document.getElementById('fov-controls').style.display    = perceptualTab === 'foveated' ? 'flex' : 'none';
      document.getElementById('window-controls').style.display = perceptualTab !== 'foveated' ? 'flex' : 'none';
      // Update focus/window label
      const focusLbl = document.getElementById('focus-label');
      if (focusLbl) focusLbl.textContent = perceptualTab === 'foveated' ? 'Focus' : 'Window';
      // fov-status only relevant for foveated view (use visibility to preserve column height)
      document.getElementById('fov-status').style.visibility   = perceptualTab === 'foveated' ? 'visible' : 'hidden';
      renderVisuals(currentIdx, ++renderVersion);
    });
  });

  // Window buttons (shared by both glimpse and heatmap)
  document.querySelectorAll('.gw-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      glimpseWindow = parseInt(btn.dataset.gw);
      document.querySelectorAll('.gw-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderVisuals(currentIdx, ++renderVersion);
    });
  });

  // Timeline click
  tlCanvas.addEventListener('click', e => {
    pausePlayback();
    const rect = tlCanvas.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    renderFrame(Math.max(0, Math.min(frames.length - 1, Math.round(frac * (frames.length - 1)))));
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
    switch (e.code) {
      case 'Space': case 'KeyP':
        e.preventDefault(); togglePlayback(); break;
      case 'ArrowRight':
        e.preventDefault(); pausePlayback(); renderFrame(currentIdx + 1); break;
      case 'ArrowLeft':
        e.preventDefault(); pausePlayback(); renderFrame(currentIdx - 1); break;
    }
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  frameCanvas = document.getElementById('frame-canvas');
  frameCtx    = frameCanvas.getContext('2d');
  fovCanvas   = document.getElementById('foveated-canvas');
  fovCtx      = fovCanvas.getContext('2d');
  glimpseCanvas = document.getElementById('glimpse-canvas');
  glimpseCtx    = glimpseCanvas.getContext('2d');
  heatCanvas  = document.getElementById('heatmap-canvas');
  heatCtx     = heatCanvas.getContext('2d');
  tlCanvas    = document.getElementById('timeline-canvas');
  tlCtx       = tlCanvas.getContext('2d');

  frameCtx.imageSmoothingEnabled = false;
  fovCtx.imageSmoothingEnabled   = false;
  glimpseCtx.imageSmoothingEnabled = false;
  heatCtx.imageSmoothingEnabled  = false;

  let games;
  try {
    const resp = await fetch('data/games.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    games = await resp.json();
  } catch (e) {
    document.getElementById('loading').textContent = `Could not load data/games.json: ${e.message}`;
    return;
  }

  // Populate dropdown
  const select = document.getElementById('game-select');
  for (const g of games) {
    const opt = document.createElement('option');
    opt.value       = g.id;
    opt.textContent = g.name;
    select.appendChild(opt);
  }

  wireEvents(games);

  if (games.length > 0) {
    await loadGame(games[0]);
  } else {
    document.getElementById('loading').textContent = 'No trials found in data/games.json';
  }
});
