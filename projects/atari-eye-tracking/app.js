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
const SIGMA_FRAC = 0.035;

// Warm colour ramp: black → deep-red → orange → yellow → white
const HEATMAP_RAMP = [
  [0,0,0], [80,0,0], [200,60,0], [255,200,30], [255,255,255],
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let gameData = null;
let frames   = [];
let bins     = [];
let meta     = {};

let currentIdx = 0;
let playing    = false;
let speed      = 1.0;
let heatK      = 10;
let heatMode   = 'window';   // 'window' | 'prereward' | 'diff'

// Playback timing
let rafId        = null;
let lastRafTime  = null;
let gameMs       = 0;
let renderVersion = 0;       // incremented on each renderFrame to cancel stale image loads

// Image cache (cleared on game switch)
const imgCache = new Map();

// Pre-computed static density grids (set by buildStaticDensities)
let preRewardGrid = null;   // Float32Array, size img_width × img_height
let baselineGrid  = null;
let diffGrid      = null;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

let frameCanvas, frameCtx, heatCanvas, heatCtx, tlCanvas, tlCtx;

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

  const preFrames  = frames.filter(f =>
    f.relative_time_to_next_reward_sec !== null &&
    f.relative_time_to_next_reward_sec >= -PRE_REWARD_SEC &&
    f.relative_time_to_next_reward_sec < 0
  );
  const baseFrames = frames.filter(f =>
    !f.is_positive_reward &&
    (f.relative_time_to_next_reward_sec === null ||
     f.relative_time_to_next_reward_sec < -PRE_REWARD_SEC)
  );

  preRewardGrid = accumulateDensity(preFrames,  BW, BH);
  baselineGrid  = accumulateDensity(baseFrames, BW, BH);

  // Normalise each grid and compute difference
  let maxPre = 0, maxBase = 0;
  for (let i = 0; i < BW * BH; i++) {
    if (preRewardGrid[i] > maxPre)   maxPre  = preRewardGrid[i];
    if (baselineGrid[i]  > maxBase)  maxBase = baselineGrid[i];
  }
  maxPre  = maxPre  || 1;
  maxBase = maxBase || 1;

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
// Rendering: game frame image (async with version tracking)
// ---------------------------------------------------------------------------

function loadImg(path) {
  if (imgCache.has(path)) return Promise.resolve(imgCache.get(path));
  return new Promise(resolve => {
    const img = new Image();
    img.onload  = () => { imgCache.set(path, img); resolve(img); };
    img.onerror = () => resolve(null);
    img.src = path;
  });
}

function prefetch(idx) {
  for (let i = idx + 1; i <= idx + 8 && i < frames.length; i++) {
    const p = frames[i].frame_path;
    if (p && !imgCache.has(p)) {
      const img = new Image();
      img.onload = () => imgCache.set(p, img);
      img.src = p;
    }
  }
}

function drawFrame(idx, version) {
  const f = frames[idx];
  if (!f) return;

  document.getElementById('action-overlay').textContent = ACTION_ICONS[f.action] ?? '?';
  document.getElementById('frame-canvas').classList.toggle('reward-frame', !!f.is_positive_reward);

  const paint = (img) => {
    if (version !== renderVersion) return;
    frameCtx.clearRect(0, 0, frameCanvas.width, frameCanvas.height);
    if (img) {
      frameCtx.drawImage(img, 0, 0, frameCanvas.width, frameCanvas.height);
    } else {
      frameCtx.fillStyle = '#111';
      frameCtx.fillRect(0, 0, frameCanvas.width, frameCanvas.height);
    }
    drawGazeOverlay(idx);
    drawRewardBorder(idx);
  };

  if (f.frame_path) {
    loadImg(f.frame_path).then(paint);
  } else {
    paint(null);
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
  const W = heatCanvas.width, H = heatCanvas.height;
  heatCtx.clearRect(0, 0, W, H);

  const BW = meta.img_width, BH = meta.img_height;

  if (heatMode === 'prereward') {
    if (!preRewardGrid) return;
    let maxV = 0;
    for (let i = 0; i < BW * BH; i++) if (preRewardGrid[i] > maxV) maxV = preRewardGrid[i];
    heatCtx.putImageData(densityToImageData(preRewardGrid, BW, BH, t => rampColor(t), maxV), 0, 0);
    return;
  }

  if (heatMode === 'diff') {
    if (!diffGrid) return;
    // For diverging map, find max absolute value
    let maxAbs = 0;
    for (let i = 0; i < BW * BH; i++) if (Math.abs(diffGrid[i]) > maxAbs) maxAbs = Math.abs(diffGrid[i]);
    heatCtx.putImageData(
      densityToImageData(diffGrid, BW, BH, v => diffColor(maxAbs > 0 ? v / maxAbs : 0), 1),
      0, 0
    );
    return;
  }

  // 'window' mode: accumulate current window
  const start = Math.max(0, idx - heatK + 1);
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

  drawFrame(idx, renderVersion);
  drawHeatmap(idx);
  drawTimeline(idx);
  updateInfoPanel(idx);
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
    drawFrame(newIdx, renderVersion);
    drawHeatmap(newIdx);
    drawTimeline(newIdx);
    updateInfoPanel(newIdx);
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
  heatCanvas.width   = W; heatCanvas.height   = H;
  tlCanvas.width     = W * 2 + 18;   // match two columns

  // Session-info subtitle (no raw filename)
  const dur = (meta.segment_duration_ms / 1000).toFixed(1);
  document.getElementById('session-info').textContent =
    `${meta.game_name}  ·  ${frames.length} frames  ·  ${meta.segment_reward_count} rewards  ·  ${dur}s`;

  // Build static densities
  buildStaticDensities();

  gameMs     = 0;
  currentIdx = 0;

  document.getElementById('loading').style.display = 'none';
  document.getElementById('viz').style.display     = '';

  renderFrame(0);
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

  // Window (k) buttons — affect both trail overlay and current-window heatmap
  document.querySelectorAll('.k-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      heatK = parseInt(btn.dataset.k);
      document.querySelectorAll('.k-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      drawFrame(currentIdx, ++renderVersion);
      if (heatMode === 'window') drawHeatmap(currentIdx);
    });
  });

  // Heatmap mode buttons
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      heatMode = btn.dataset.mode;
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      drawHeatmap(currentIdx);
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
  heatCanvas  = document.getElementById('heatmap-canvas');
  heatCtx     = heatCanvas.getContext('2d');
  tlCanvas    = document.getElementById('timeline-canvas');
  tlCtx       = tlCanvas.getContext('2d');

  frameCtx.imageSmoothingEnabled = false;
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
