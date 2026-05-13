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

  // Email stored as char codes — never appears as plain text in source
  const _ec = [118,105,115,104,119,97,115,115,97,116,104,105,115,104,64,103,109,97,105,108,46,99,111,109];
  const _re = _ec.map(c => String.fromCharCode(c)).join('');
  // ROT13 of the real email — looks scrambled, easy to decode client-side
  const _sc = 'ivfujnffngvfu@tznvy.pbz';

  header.innerHTML = `
    <nav class="container nav-inner" aria-label="Main navigation">
      <a href="${root}index.html" class="nav-logo">Vishwas Sathish</a>
      <div class="nav-email-wrap" id="nav-email-wrap">
        <span class="nav-email-text" id="nav-email-text" aria-live="polite">${_sc}</span>
        <button class="nav-unscramble-btn" id="nav-unscramble-btn">Unscramble</button>
      </div>
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

  const toggle        = header.querySelector('.nav-toggle');
  const navLinks      = header.querySelector('#nav-links');
  const emailText     = header.querySelector('#nav-email-text');
  const unscrambleBtn = header.querySelector('#nav-unscramble-btn');

  unscrambleBtn.addEventListener('click', () => {
    unscrambleBtn.disabled = true;
    const noise = 'abcdefghijklmnopqrstuvwxyz@.-_0123456789';
    const total = _re.length;
    const steps = 14;
    let step = 0;
    const iv = setInterval(() => {
      step++;
      emailText.textContent = _re.split('').map((ch, i) =>
        (i / total < step / steps) ? ch : noise[Math.floor(Math.random() * noise.length)]
      ).join('');
      if (step >= steps) {
        clearInterval(iv);
        emailText.textContent = '';
        emailText.innerHTML = `<a href="mailto:${_re}" class="nav-email-link">${_re}</a>`;
        unscrambleBtn.style.display = 'none';
      }
    }, 40);
  });

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
