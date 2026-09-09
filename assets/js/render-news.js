/* =============================================================
   render-news.js — Fetch news.json and render news list
   ============================================================= */

/**
 * Fetch news items and render them into `containerId`.
 *
 * @param {string} containerId  - ID of the container element
 * @param {number|null} visible - how many items fit before the list scrolls.
 *                                Every item is still rendered; the rest are
 *                                reachable by scrolling inside the block.
 *                                null = no height cap.
 */
async function fetchAndRenderNews(containerId, visible = null) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const url = getRelativeRoot() + 'assets/data/news.json';

  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = await res.json();

    if (items.length === 0) {
      container.innerHTML = '<p class="text-muted">No news yet.</p>';
      return;
    }

    const ul = document.createElement('ul');
    ul.className = 'news-list';
    ul.innerHTML = items.map(item => `
      <li class="news-item">
        <span class="news-date">${item.date || ''}</span>
        <span class="news-text">${item.description || item.text || ''}</span>
      </li>
    `.trim()).join('');

    container.innerHTML = '';
    container.appendChild(ul);

    // Cap the block at `visible` items and let the rest scroll into view,
    // measured from the rendered items so it stays right at any font size.
    if (typeof visible === 'number' && items.length > visible) {
      const rows = ul.querySelectorAll('.news-item');
      const last = rows[visible - 1];
      const height = last.offsetTop + last.offsetHeight - rows[0].offsetTop;
      container.classList.add('news-scroll');
      container.style.maxHeight = `${Math.round(height)}px`;
    }
  } catch (err) {
    container.innerHTML = '<p class="loading-placeholder">Could not load news.</p>';
  }
}
