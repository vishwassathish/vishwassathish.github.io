/* =============================================================
   main.js — Navigation injection, footer, scroll effects
   ============================================================= */

const NAV_LINKS = [
  { href: 'index.html',    label: 'Home',     match: null },
  { href: 'research.html', label: 'Research', match: 'research' },
  { href: 'cv.html',       label: 'CV',       match: 'cv' },
  { href: 'projects.html', label: 'Projects', match: 'projects' },
  // { href: 'writing/',      label: 'Writing',  match: 'writing' },  // hidden — re-enable when ready
  // { href: 'art.html',      label: 'Art',      match: 'art' },       // hidden — re-enable when ready
];

/**
 * Returns the path prefix needed to reach the site root from the current page.
 * e.g. from /writing/posts/foo.html → '../../'
 *      from /index.html             → './'
 */
function getRelativeRoot() {
  const path = window.location.pathname;
  // Count directory levels (separators minus 1 for the filename)
  const depth = (path.match(/\//g) || []).length - 1;
  return depth <= 0 ? './' : '../'.repeat(depth);
}

/** Resolve a root-relative asset path to the current page's relative path */
function rootPath(rel) {
  return getRelativeRoot() + rel;
}

function injectNav() {
  const header = document.getElementById('site-header');
  if (!header) return;

  const root = getRelativeRoot();
  const currentPath = window.location.pathname;

  const linksHtml = NAV_LINKS.map(({ href, label, match }) => {
    let isActive;
    if (match === null) {
      // Home: active only on root or index.html
      isActive = currentPath === '/' || currentPath.endsWith('/index.html') ||
                 currentPath.endsWith('/');
    } else {
      isActive = currentPath.includes(match);
    }
    const cls = isActive ? ' class="active"' : '';
    return `<li><a href="${root}${href}"${cls}>${label}</a></li>`;
  }).join('');

  header.innerHTML = `
    <nav class="container nav-inner" aria-label="Main navigation">
      <a href="${root}index.html" class="nav-logo">Vishwas Sathish</a>
      <button class="nav-toggle" aria-label="Toggle navigation" aria-expanded="false">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round"
             aria-hidden="true">
          <line x1="3" y1="6" x2="19" y2="6"/>
          <line x1="3" y1="11" x2="19" y2="11"/>
          <line x1="3" y1="16" x2="19" y2="16"/>
        </svg>
      </button>
      <ul class="nav-links" id="nav-links">${linksHtml}</ul>
    </nav>
  `;

  const toggle   = header.querySelector('.nav-toggle');
  const navLinks = header.querySelector('#nav-links');

  toggle.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });

  document.addEventListener('click', (e) => {
    if (!header.contains(e.target)) {
      navLinks.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
}

function initScrollEffect() {
  const header = document.getElementById('site-header');
  if (!header) return;
  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function injectFooter() {
  const footer = document.getElementById('site-footer');
  if (!footer) return;
  footer.innerHTML = `
    <div class="container">
      <p>
        © ${new Date().getFullYear()} Vishwas Sathish &nbsp;·&nbsp;
        <a href="mailto:vsathish@cs.washington.edu">vsathish@cs.washington.edu</a>
        &nbsp;·&nbsp;
        <a href="${getRelativeRoot()}index.html">Home</a>
      </p>
    </div>
  `;
}

document.addEventListener('DOMContentLoaded', () => {
  injectNav();
  injectFooter();
  initScrollEffect();
});
