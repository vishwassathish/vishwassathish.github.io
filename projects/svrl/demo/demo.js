/* =============================================================
   demo.js: interactive trace explorer
   Replays one FVQA inference pass at a time, for either the SVRL
   agent or the MMSearch-R1++ baseline on the same question.
   ============================================================= */

const MODELS = {
  svrl:     { label: 'SVRL (ours)' },
  baseline: { label: 'MMSearch-R1++' },
};

let TRACES = [];
let current = 0;        // index into TRACES
let model   = 'svrl';   // which run we are replaying
let shown   = 0;        // how many steps are revealed

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const host = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
};

const run = () => TRACES[current][model];

/* ---------- steps ---------- */

function renderResults(step) {
  if (!step.results.length) {
    return '<p class="turn-note">No usable snippets came back from this call.</p>';
  }
  return `<div class="ev-grid">${step.results.map((r, i) => {
    // The baseline prompt hands the model image titles only (no URL, no summary),
    // so those cards degrade to just a title.
    const site = r.url ? host(r.url) : '';
    const title = r.title || (r.summary || '').split(/(?<=\.)\s/)[0] || site || 'Retrieved image';
    const thumb = r.thumb
      ? `<img class="ev-thumb" src="${esc(r.thumb)}" alt="" loading="lazy">`
      : `<span class="ev-thumb ev-thumb-none" aria-hidden="true">${esc((site || title).slice(0, 2).toUpperCase())}</span>`;
    const head = `
      <span class="ev-body">
        <span class="ev-n">${i + 1}</span>
        <span class="ev-title">${esc(title)}</span>
        ${site ? `<span class="ev-host">${esc(site)}</span>` : ''}
      </span>`;

    if (!r.summary && !r.url) {                       // nothing to expand into
      return `<div class="ev ev-flat">
                ${step.tool === 'image_search' ? thumb : ''}${head}
              </div>`;
    }
    return `
      <details class="ev">
        <summary>${step.tool === 'image_search' ? thumb : ''}${head}</summary>
        ${r.summary ? `<p>${esc(r.summary)}</p>` : ''}
        ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener nofollow">Open source &rarr;</a>` : ''}
      </details>`;
  }).join('')}</div>`;
}

function renderVerify(v) {
  const kept = v.mask.filter(Boolean).length;
  const what = v.tool === 'image_search' ? 'image_filter' : 'text_filter';
  const noun = v.tool === 'image_search' ? 'image results' : 'text snippets';
  return `
    <div class="verify-block">
      <div class="mask-row">
        <span>${what}</span>
        ${v.mask.map(x => `<span class="mask ${x ? 'mask-keep' : 'mask-drop'}">${x}</span>`).join('')}
      </div>
      <p class="turn-note">Kept ${kept} of ${v.mask.length} ${noun} as useful evidence.</p>
    </div>`;
}

function renderStep(step) {
  switch (step.kind) {
    // Reasoning and the verification mask are emitted in the same turn, so they
    // render as one thought rather than two separate steps.
    case 'reason': {
      const v = step.verify;
      return `<div class="turn turn-agent">
                <span class="turn-tag">Reason${v ? ' &amp; self-verification' : ''}</span>
                <p>${esc(step.text)}</p>
                ${v ? renderVerify(v) : ''}
              </div>`;
    }

    case 'verify':
      return `<div class="turn turn-agent">
                <span class="turn-tag">Self-verification</span>
                ${renderVerify(step)}
              </div>`;

    case 'action': {
      if (step.tool === 'image_search') {
        return `<div class="turn turn-tool">
                  <span class="tool-chip">Image search</span>
                  <code>&lt;search&gt;&lt;img&gt;&lt;/search&gt;</code>
                </div>`;
      }
      const ran = new Set((step.executed || []).map(q => q.toLowerCase()));
      const chips = (step.proposed || []).map(q =>
        `<span class="query${ran.has(q.toLowerCase()) ? ' query-ran' : ''}">${esc(q)}</span>`).join('');
      return `<div class="turn turn-tool turn-tool-block">
                <div class="tool-head">
                  <span class="tool-chip">Text search</span>
                  <span class="turn-note">${(step.proposed || []).length} candidate queries proposed &middot;
                    <span class="ran-key">green</span> = actually executed</span>
                </div>
                <div class="queries">${chips}</div>
              </div>`;
    }

    case 'result': {
      // Styled as an inbound block from outside the model, so retrieved evidence
      // never reads as something the agent itself produced.
      const isImg = step.tool === 'image_search';
      return `<div class="turn turn-result">
                <div class="ext-head">
                  <img class="ext-icon" src="demo/${isImg ? 'icon-lens.webp' : 'icon-google.webp'}"
                       alt="" width="18" height="18">
                  <span class="ext-title">${isImg ? 'Google Lens' : 'Google Search'}</span>
                  <span class="ext-meta">${step.results.length} ${isImg ? 'page' : 'snippet'}${step.results.length === 1 ? '' : 's'} returned to the model</span>
                </div>
                ${renderResults(step)}
              </div>`;
    }

    case 'answer': {
      const r = run();
      return `<div class="turn turn-answer">
                <span class="turn-tag">${esc(MODELS[model].label)} answered</span>
                <div class="answer-line">
                  <p>${esc(step.text)}</p>
                  <span class="judge-pill${r.judge_score ? '' : ' judge-wrong'}">${r.judge_score ? 'Correct' : 'Incorrect'}</span>
                </div>
              </div>`;
    }

    default:
      return '';
  }
}

/* ---------- panels ---------- */

function renderPicker() {
  document.getElementById('demo-picker').innerHTML = TRACES.map((t, i) => `
    <button class="demo-pick${i === current ? ' active' : ''}" data-i="${i}" type="button">
      <img src="${t.image}" alt="" loading="lazy">
      <span class="demo-pick-q">${esc(t.question)}</span>
    </button>`).join('');
}

function renderStage() {
  const t = TRACES[current];
  const r = run();
  const total = r.steps.length;

  document.getElementById('demo-question').innerHTML = `
    <img src="${t.image}" alt="Input image for the question" class="demo-img">
    <div class="demo-qtext">
      <p class="demo-q">${esc(t.question)}</p>
      <p class="demo-gt"><span class="verdict-label">Ground truth</span>${esc(t.ground_truth)}</p>
    </div>`;

  document.getElementById('demo-transcript').innerHTML =
    r.steps.slice(0, shown).map(renderStep).join('');

  const done = shown >= total;
  document.getElementById('demo-verdict').innerHTML = done ? `
    <div class="verdict">
      <div class="verdict-judge">
        <span class="verdict-label">LLM judge reasoning</span>
        <p>${esc(r.judge_reason)}</p>
      </div>
    </div>` : '';

  document.getElementById('demo-progress').textContent = `Step ${shown} / ${total}`;
  document.getElementById('demo-prev').disabled = shown <= 0;
  document.getElementById('demo-next').disabled = done;
  document.getElementById('demo-all').disabled  = done;
  document.getElementById('demo-collapse').disabled = shown <= 1;

  document.querySelectorAll('.demo-model').forEach(b =>
    b.classList.toggle('active', b.dataset.model === model));
}

/* Collapsing or switching models shortens the transcript sharply, which drags
   later sections up under the viewport. Bring the explorer back into view. */
function anchorToExplorer(force = false) {
  const el = document.getElementById('demo');
  if (!el) return;
  const top = el.getBoundingClientRect().top;
  if (force || top < 0 || top > window.innerHeight) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function select(i) {
  current = i;
  model = 'svrl';            // every question opens on our model
  shown = 1;
  renderPicker();
  renderStage();
}

/* ---------- picker scrolling ---------- */

function initScrollArrows() {
  const wrap  = document.getElementById('demo-picker-wrap');
  const left  = document.getElementById('demo-scroll-left');
  const right = document.getElementById('demo-scroll-right');
  if (!wrap || !left || !right) return;

  const update = () => {
    const max = wrap.scrollWidth - wrap.clientWidth;
    left.hidden  = wrap.scrollLeft <= 4;
    right.hidden = wrap.scrollLeft >= max - 4;
  };
  const by = (d) => wrap.scrollBy({ left: d * wrap.clientWidth * 0.8, behavior: 'smooth' });

  left.addEventListener('click', () => by(-1));
  right.addEventListener('click', () => by(1));
  wrap.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
}

/* ---------- wiring ---------- */

async function initDemo() {
  const root = document.getElementById('demo');
  if (!root) return;
  try {
    const res = await fetch('demo/traces.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    TRACES = await res.json();
  } catch (err) {
    root.querySelector('.demo-body').innerHTML =
      '<p class="text-muted">Could not load the trace explorer. ' +
      'Try running from a local server (<code>python3 -m http.server 8000</code>).</p>';
    return;
  }

  document.getElementById('demo-picker').addEventListener('click', (e) => {
    const btn = e.target.closest('.demo-pick');
    if (btn) select(Number(btn.dataset.i));
  });

  document.getElementById('demo-models').addEventListener('click', (e) => {
    const btn = e.target.closest('.demo-model');
    if (!btn || btn.dataset.model === model) return;
    model = btn.dataset.model;
    shown = 1;                 // the two runs diverge, so restart the replay
    renderStage();
    anchorToExplorer();
  });

  document.getElementById('demo-next').addEventListener('click', () => {
    if (shown < run().steps.length) { shown++; renderStage(); }
  });
  document.getElementById('demo-prev').addEventListener('click', () => {
    if (shown > 0) { shown--; renderStage(); }
  });
  document.getElementById('demo-all').addEventListener('click', () => {
    shown = run().steps.length; renderStage();
  });
  // back to just the opening reasoning turn
  document.getElementById('demo-collapse').addEventListener('click', () => {
    shown = 1; renderStage(); anchorToExplorer(true);
  });

  select(0);
  initScrollArrows();
}

document.addEventListener('DOMContentLoaded', initDemo);
