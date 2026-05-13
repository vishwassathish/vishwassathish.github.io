/* =============================================================
   render-publications.js — Fetch publications.json and render cards
   ============================================================= */

/**
 * Maps link type keys to display labels.
 */
function pubLinkLabel(type) {
  const map = {
    paper:   'Paper',
    arxiv:   'arXiv',
    code:    'Code',
    poster:  'Poster',
    slides:  'Slides',
    project: 'Project Page',
    website: 'Website',
    video:   'Video',
  };
  return map[type] || (type.charAt(0).toUpperCase() + type.slice(1));
}

function renderPubCard(pub, root) {
  // Thumbnail
  const thumbHtml = pub.thumbnail
    ? `<img src="${root}${pub.thumbnail}" alt="" class="pub-thumb" loading="lazy">`
    : `<div class="pub-thumb-placeholder" aria-hidden="true">📄</div>`;

  // Badge
  const badgeKey = (pub.badge || '').toLowerCase().replace(/\s+/g, '-');
  const badgeHtml = pub.badge
    ? `<span class="pub-badge badge-${badgeKey}">${pub.badge}</span>`
    : '';

  // Title with optional link
  const firstLink = pub.links && (pub.links.paper || pub.links.arxiv);
  const titleHtml = firstLink
    ? `<a href="${firstLink}" target="_blank" rel="noopener">${pub.title}</a>${badgeHtml}`
    : `${pub.title}${badgeHtml}`;

  // Links row
  const linksHtml = pub.links
    ? Object.entries(pub.links)
        .filter(([, url]) => url)
        .map(([type, url]) =>
          `<a href="${url}" class="pub-link" target="_blank" rel="noopener">${pubLinkLabel(type)}</a>`)
        .join('')
    : '';

  const summaryHtml = pub.summary
    ? `<p class="pub-summary">${pub.summary}</p>`
    : '';

  return `
    <li class="pub-card" data-type="${pub.type || 'other'}" data-selected="${pub.selected ? 'true' : 'false'}">
      ${thumbHtml}
      <div class="pub-content">
        <h3 class="pub-title">${titleHtml}</h3>
        <p class="pub-authors">${pub.authors_html || pub.authors || ''}</p>
        <p class="pub-venue">${pub.venue_html || pub.venue || ''}</p>
        ${summaryHtml}
        ${linksHtml ? `<div class="pub-links">${linksHtml}</div>` : ''}
      </div>
    </li>
  `.trim();
}

/**
 * Fetch publications and render them into `containerId`.
 *
 * @param {string} containerId  - ID of the container element
 * @param {'all'|'selected'|string} filter  - filter by type or 'selected'
 */
async function fetchAndRenderPublications(containerId, filter = 'all') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const root = getRelativeRoot();
  const url  = root + 'assets/data/publications.json';

  try {
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let pubs = await res.json();

    if (filter === 'selected') {
      pubs = pubs.filter(p => p.selected);
    } else if (filter !== 'all') {
      pubs = pubs.filter(p => p.type === filter);
    }

    if (pubs.length === 0) {
      container.innerHTML = '<p class="text-muted">No publications in this category.</p>';
      return;
    }

    const ul = document.createElement('ul');
    ul.className = 'pub-list';
    ul.innerHTML = pubs.map(p => renderPubCard(p, root)).join('');
    container.innerHTML = '';
    container.appendChild(ul);
  } catch (err) {
    container.innerHTML = `
      <p class="text-muted">
        Could not load publications.
        <a href="${rootPath('assets/data/publications.json')}">View raw JSON</a>
        or try running from a local server
        (<code>python3 -m http.server 8000</code>).
      </p>`;
  }
}

/**
 * Wire up publication filter tabs.
 *
 * @param {string} tabsContainerId  - element that holds .pub-tab buttons
 * @param {string} listContainerId  - container passed to fetchAndRenderPublications
 */
function initPubTabs(tabsContainerId, listContainerId) {
  const tabsEl = document.getElementById(tabsContainerId);
  if (!tabsEl) return;

  tabsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.pub-tab');
    if (!btn) return;
    tabsEl.querySelectorAll('.pub-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    fetchAndRenderPublications(listContainerId, btn.dataset.filter || 'all');
  });
}
