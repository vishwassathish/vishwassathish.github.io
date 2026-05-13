/* =============================================================
   render-projects.js — Fetch projects.json and render project cards
   ============================================================= */

function projectLinkLabel(type) {
  const map = {
    demo:    'Demo',
    code:    'Code',
    writeup: 'Write-up',
    paper:   'Paper',
    website: 'Website',
    video:   'Video',
    poster:  'Poster',
    slides:  'Slides',
  };
  return map[type] || (type.charAt(0).toUpperCase() + type.slice(1));
}

function renderProjectCard(proj, root) {
  const thumbHtml = proj.thumbnail
    ? `<img src="${root}${proj.thumbnail}" alt="" class="project-thumb" loading="lazy">`
    : '';

  const linksHtml = proj.links
    ? Object.entries(proj.links)
        .filter(([, url]) => url)
        .map(([type, url]) =>
          `<a href="${url}" class="project-link" target="_blank" rel="noopener">${projectLinkLabel(type)}</a>`)
        .join('')
    : '';

  return `
    <div class="project-card" data-type="${proj.type || 'project'}" data-featured="${proj.featured ? 'true' : 'false'}">
      ${thumbHtml}
      <span class="project-type">${proj.type || 'Project'}</span>
      <h3 class="project-title">${proj.title}</h3>
      <p class="project-desc">${proj.description || ''}</p>
      ${linksHtml ? `<div class="project-links">${linksHtml}</div>` : ''}
    </div>
  `.trim();
}

/**
 * Fetch projects and render into `containerId`.
 *
 * @param {string} containerId  - container element ID
 * @param {'all'|'featured'|string} filter
 */
async function fetchAndRenderProjects(containerId, filter = 'all') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const root = getRelativeRoot();
  const url  = root + 'assets/data/projects.json';

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let projects = await res.json();

    if (filter === 'featured') {
      projects = projects.filter(p => p.featured);
    } else if (filter !== 'all') {
      projects = projects.filter(p => p.type === filter);
    }

    if (projects.length === 0) {
      container.innerHTML = '<p class="text-muted">No projects found.</p>';
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'projects-grid';
    grid.innerHTML = projects.map(p => renderProjectCard(p, root)).join('');
    container.innerHTML = '';
    container.appendChild(grid);
  } catch (err) {
    container.innerHTML = '<p class="loading-placeholder">Could not load projects.</p>';
  }
}
