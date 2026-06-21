# Vishwas Sathish — Personal Academic Website

Static HTML/CSS/JS academic website. No build step required. Works directly on GitHub Pages.

Live site: **<https://vishwassathish.github.io/>**

---

## Quick Start (Local Preview)

Because the site uses `fetch()` to load JSON data files, you need a local HTTP server
(browsers block `file://` fetches for security). Run one of:

```bash
# Python 3 (no install needed)
python3 -m http.server 8000
# then open http://localhost:8000

# Node.js
npx serve .
# then open http://localhost:3000
```

---

## File Structure

```
/
├── index.html            Homepage
├── research.html         Publications page
├── cv.html               CV viewer + experience highlights
├── projects.html         Projects & experiments
├── art.html              Art & personal experiments
├── writing/
│   ├── index.html        Writing index (manually maintained)
│   ├── template.html     Copy this to create a new post
│   └── posts/
│       └── predictive-coding-and-rl.html   Example post
├── assets/
│   ├── css/styles.css            All styles (CSS variables for easy theming)
│   ├── js/
│   │   ├── main.js               Nav injection, footer, scroll effects
│   │   ├── render-publications.js
│   │   ├── render-news.js
│   │   └── render-projects.js
│   ├── img/
│   │   ├── profile.jpeg          Profile photo
│   │   ├── uw_logo.png           Favicon
│   │   ├── thumbnails/           Publication/project thumbnails
│   │   └── art/                  (add artwork images here)
│   ├── cv/Vishwas_Sathish_June2026.pdf Your latest CV
│   └── data/
│       ├── publications.json     ← primary edit target
│       ├── news.json
│       ├── projects.json
│       └── experience.json
└── sitemap.xml
```

---

## How to Update Content

### Add a Publication

Edit `assets/data/publications.json`. Add an object to the top-level array:

```json
{
  "id": "unique-slug-2026",
  "type": "conference",
  "selected": true,
  "badge": "In Submission",
  "title": "Paper Title",
  "authors_html": "<strong>Vishwas Sathish</strong>, Co-Author",
  "venue_html": "<a href='https://...'>Conference, 2026</a>",
  "year": 2026,
  "summary": "One sentence describing the contribution.",
  "thumbnail": "assets/img/thumbnails/your-thumb.png",
  "links": { "paper": "https://...", "code": "https://github.com/..." }
}
```

**`type`**: `journal` | `conference` | `workshop` | `preprint` | `patent`  
**`selected: true`** → shown on homepage Selected Research section  
**`badge`**: `Selected` | `Workshop` | `In Submission` | `Patent` | `Report` | `null`  
**`links`** keys: `paper`, `arxiv`, `code`, `poster`, `slides`, `project`, `website`, `video`

### Add a News Item

Edit `assets/data/news.json`. Insert at the **top** (most recent first):

```json
{ "date": "Jan 2027", "description": "HTML allowed: <a href='...'>links</a>." }
```

### Update Projects

Edit `assets/data/projects.json`. Set `"featured": true` to appear on the homepage.  
Link keys: `demo`, `code`, `writeup`, `paper`, `website`, `video`, `poster`.

### Replace the CV PDF

Drop the new file at `assets/cv/Vishwas_Sathish_June2026.pdf` — same filename, it just works.

### Update Experience Highlights

Edit `assets/data/experience.json`. Each item: `years`, `role`, `org`, `detail`.

---

## How to Add a Writing Post

```bash
# 1. Copy the template
cp writing/template.html writing/posts/your-slug.html

# 2. Edit it — replace all PLACEHOLDER text with content

# 3. Register it in writing/index.html — add a <li class="writing-item"> at the top of the list
```

The template has inline comments explaining every field.

---

## Deployment to GitHub Pages

### Recommended: Replace current repo contents (Approach 1)

Your repo `vishwassathish/vishwassathish.github.io` already serves  
`https://vishwassathish.github.io/`. The cleanest migration:

```bash
# 1. Back up old React source (optional — create a branch first)
git checkout -b backup/react-site
git checkout main

# 2. Remove old React artifacts (not needed by the new static site)
rm -rf src/ build/ node_modules/ public/
rm -f package.json package-lock.json

# 3. Stage new files
git add index.html research.html cv.html projects.html art.html
git add writing/ assets/ sitemap.xml README.md

# 4. Commit and push
git commit -m "Rebuild site as clean static academic website"
git push origin main
```

**GitHub Pages settings** (one-time, in repo Settings → Pages):  
Source: `Deploy from branch` → Branch: `main`, Folder: `/` (root)

No build step needed — GitHub Pages serves static files directly.

### Alternative (Approach 2)

Only useful if you want a completely fresh repo. However, since the user-level Pages site
must live in `vishwassathish/vishwassathish.github.io`, a new repo gets a different URL.
**Stick with Approach 1** to keep `https://vishwassathish.github.io/`.

---

## Customization

**Colors** — edit CSS variables at the top of `assets/css/styles.css`:

| Variable | Default | Purpose |
|----------|---------|---------|
| `--primary` | `#4b2e83` | UW purple — links, nav active, buttons |
| `--gold` | `#b7a57a` | UW gold — Selected badge |

Change `--primary` to switch the accent color across the entire site.

**Navigation links** — edit `NAV_LINKS` array at the top of `assets/js/main.js`.

---

## Notes & Assumptions

- **Profile image**: `assets/img/vish.png`. To replace: drop a new image at that path with
  the same filename, or update the `src` attribute in `index.html` (profile section) and the
  `og:image` meta tag.
- **CV file**: Placed at `assets/cv/Vishwas_Sathish_June2026.pdf`. Replace with your latest version
  using the same filename.
- **Atari eye-tracking project**: Imported directly into `projects/atari-eye-tracking/` from
  the local source at `cse512_data_viz/hw3/atari-eye-tracking/public/`. Total size is ~31 MB
  (6 442 frame PNGs across 6 game/session directories). This is within GitHub Pages limits
  (1 GB repo, 100 MB per file). No Git LFS is used — all frames are committed as regular files.
  All internal paths (frame images, JSON data) are relative and work correctly at the new location.
  - To update the project: re-copy `atari-eye-tracking/public/` → `projects/atari-eye-tracking/`.
  - If the frame size ever becomes a concern, options include: reducing resolution with
    `mogrify -resize 50%`, converting frame sequences to WebP, or reducing the frame subset.
- **Writing and Art pages**: Files exist (`writing/`, `art.html`) but links are commented out
  in `assets/js/main.js` (`NAV_LINKS` array). To re-enable, uncomment the relevant entries.
- **LinkedIn URL**: Using `linkedin.com/in/vishwassathish` — update in `index.html` if different.
- **Dark mode**: Not implemented. Can be added with `@media (prefers-color-scheme: dark)` and
  overriding the CSS variables.
- No React dependency remains. No package manager or build tool is required.
