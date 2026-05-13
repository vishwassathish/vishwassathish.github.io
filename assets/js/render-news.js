/* =============================================================
   render-news.js — Fetch news.json and render news list
   ============================================================= */

/**
 * Fetch news items and render them into `containerId`.
 *
 * @param {string} containerId  - ID of the container element
 * @param {number|null} limit   - max items to show (null = all)
 */
async function fetchAndRenderNews(containerId, limit = null) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const url = getRelativeRoot() + 'assets/data/news.json';

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let items = await res.json();

    if (typeof limit === 'number') items = items.slice(0, limit);

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
  } catch (err) {
    container.innerHTML = '<p class="loading-placeholder">Could not load news.</p>';
  }
}
