// HanX Assets admin panel: a static page that talks to the GitHub REST API with a
// fine-grained personal access token kept in this browser's localStorage.
const OWNER = 'hanxgames';
const REPO = 'gameassets.tr';
const WORKFLOW = 'deploy.yml';
const SITE = 'https://gameassets.tr';
const API = 'https://api.github.com';
const LANGS = ['tr', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'ru', 'ja', 'ko', 'zh', 'id', 'vi'];
const TOKEN_KEY = 'gameassets_admin_token';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids) if (kid !== null && kid !== undefined) n.append(kid);
  return n;
};

let token = null;
try { token = localStorage.getItem(TOKEN_KEY); } catch { /* storage blocked */ }

// ---------- GitHub API ----------
async function gh(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (res.status === 401) { logout('Anahtar geçersiz ya da süresi dolmuş. Yeni bir anahtarla giriş yap.'); throw new Error('unauthorized'); }
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg += `: ${(await res.json()).message}`; } catch { /* no body */ }
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return raw ? res.text() : res.json();
}
const repoPath = (p) => `/repos/${OWNER}/${REPO}${p}`;
const readFile = async (path) => JSON.parse(await gh(repoPath(`/contents/${path}?ref=main`), { raw: true }));

// ---------- Views ----------
function show(view) {
  $('view-login').hidden = view !== 'login';
  $('view-dash').hidden = view !== 'dash';
}

function logout(message) {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  token = null;
  $('bar-user').hidden = true;
  $('login-error').textContent = message || '';
  show('login');
}

$('token-link').href =
  'https://github.com/settings/personal-access-tokens/new?name=gameassets-admin&description=gameassets.tr%20admin%20panel&target_name=hanxgames&expires_in=366&actions=write&contents=write';

$('logout').addEventListener('click', () => logout());

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('login-btn');
  btn.disabled = true;
  $('login-error').textContent = '';
  token = $('token').value.trim();
  try {
    await verify();
    try { localStorage.setItem(TOKEN_KEY, token); } catch { /* still works for this visit */ }
    $('token').value = '';
    await openDashboard();
  } catch (err) {
    if (err.message !== 'unauthorized') $('login-error').textContent = err.message;
    token = null;
  } finally {
    btn.disabled = false;
  }
});

async function verify() {
  const user = await gh('/user');
  const repo = await gh(repoPath(''));
  if (!repo.permissions || !repo.permissions.push) throw new Error('Bu anahtarın gameassets.tr reposuna yazma izni yok. Contents ve Actions için "Read and write" seç.');
  $('user-name').textContent = user.login;
  $('user-avatar').replaceChildren(el('img', { src: user.avatar_url, alt: '', width: '32', height: '32' }));
  $('bar-user').hidden = false;
  return user;
}

// ---------- Dashboard ----------
let catalog = null;
let hidden = { list: [], sha: null };
let translations = {};

async function openDashboard() {
  show('dash');
  await Promise.all([loadCatalog(), loadRuns()]);
  loadTranslations();
}

async function loadCatalog() {
  const [cat, hid] = await Promise.all([
    readFile('src/data/catalog.json'),
    gh(repoPath('/contents/src/data/hidden.json?ref=main')),
  ]);
  catalog = cat;
  hidden = { list: JSON.parse(atob(hid.content.replace(/\n/g, ''))), sha: hid.sha };
  renderStats();
  renderPacks();
}

function renderStats() {
  const visible = catalog.assets.filter((a) => !hidden.list.includes(a.slug));
  $('s-packs').textContent = `${visible.length} / ${catalog.assets.length}`;
  $('s-bundles').textContent = String(catalog.bundles.length);
  $('s-hidden').textContent = String(hidden.list.length);
  $('s-synced').textContent = fmtDate(catalog.syncedAt);
}

async function loadTranslations() {
  const results = await Promise.allSettled(
    LANGS.map(async (l) => [l, await readFile(`src/i18n/desc/${l}.json`), await readFile(`src/i18n/packs/${l}.json`)]),
  );
  translations = {};
  for (const r of results) if (r.status === 'fulfilled') translations[r.value[0]] = { desc: r.value[1], packs: r.value[2] };
  renderPacks();
}

function translatedCount(slug) {
  return LANGS.filter((l) => translations[l] && translations[l].desc[slug] && translations[l].packs[slug]).length;
}

function renderPacks() {
  if (!catalog) return;
  const q = $('pack-filter').value.toLowerCase().trim();
  const rows = catalog.assets.filter((a) => !q || a.title.toLowerCase().includes(q) || a.slug.includes(q));
  const body = $('pack-rows');
  body.replaceChildren(
    ...rows.map((a) => {
      const isHidden = hidden.list.includes(a.slug);
      const tCount = Object.keys(translations).length ? translatedCount(a.slug) : null;
      const toggle = el('button', {
        class: `toggle ${isHidden ? '' : 'is-on'}`,
        type: 'button',
        'aria-pressed': String(!isHidden),
        'aria-label': `${a.title} sitede ${isHidden ? 'gizli' : 'görünür'}`,
        text: isHidden ? 'Gizli' : 'Görünür',
        onclick: () => toggleHidden(a.slug, toggle),
      });
      return el('tr', { class: isHidden ? 'row-hidden' : '' },
        el('td', {},
          el('div', { class: 'pack-cell' },
            el('img', { src: `${SITE}${a.cover.sm}`, alt: '', width: '72', height: '57', loading: 'lazy' }),
            el('div', {},
              el('a', { class: 'link', href: `${SITE}/assets/${a.slug}/`, target: '_blank', rel: 'noopener', text: a.title }),
              el('p', { class: 'small', text: a.published ? `itch.io: ${fmtDate(a.published)}` : '' }),
            ),
          ),
        ),
        el('td', { class: 'num' }, el('span', { text: a.price }), a.originalPrice ? el('s', { class: 'small', text: ` ${a.originalPrice}` }) : null),
        el('td', { class: tCount !== null && tCount < LANGS.length ? 'warn' : '' , text: tCount === null ? '…' : `${tCount} / ${LANGS.length}` }),
        el('td', {}, toggle),
      );
    }),
  );
  if (!rows.length) body.replaceChildren(el('tr', {}, el('td', { colspan: '4', class: 'small', text: 'Eşleşen paket yok.' })));
}
$('pack-filter').addEventListener('input', renderPacks);

async function toggleHidden(slug, button) {
  button.disabled = true;
  try {
    const fresh = await gh(repoPath('/contents/src/data/hidden.json?ref=main'));
    const list = new Set(JSON.parse(atob(fresh.content.replace(/\n/g, ''))));
    const willHide = !list.has(slug);
    willHide ? list.add(slug) : list.delete(slug);
    const next = [...list].sort();
    const res = await gh(repoPath('/contents/src/data/hidden.json'), {
      method: 'PUT',
      body: {
        message: `admin: ${willHide ? 'hide' : 'show'} ${slug}`,
        content: btoa(`${JSON.stringify(next, null, 2)}\n`),
        sha: fresh.sha,
        branch: 'main',
      },
    });
    hidden = { list: next, sha: res.content.sha };
    renderStats();
    renderPacks();
    $('pack-note').textContent = `${slug} ${willHide ? 'gizlendi' : 'yeniden görünür yapıldı'}. Site birkaç dakika içinde güncellenir.`;
    setTimeout(loadRuns, 4000);
  } catch (err) {
    $('pack-note').textContent = `Kaydedilemedi: ${err.message}`;
    button.disabled = false;
  }
}

// ---------- Runs ----------
const EVENT = { push: 'Değişiklik', schedule: 'Günlük senkron', workflow_dispatch: 'Panel' };
const STATUS = { queued: 'Sırada', in_progress: 'Çalışıyor', completed: 'Bitti', waiting: 'Bekliyor', pending: 'Bekliyor' };
const CONCLUSION = { success: 'Başarılı', failure: 'Hata', cancelled: 'İptal', skipped: 'Atlandı' };

async function loadRuns() {
  const data = await gh(repoPath(`/actions/workflows/${WORKFLOW}/runs?per_page=10`));
  $('run-rows').replaceChildren(
    ...data.workflow_runs.map((r) =>
      el('tr', {},
        el('td', { class: 'num', text: fmtDate(r.created_at) }),
        el('td', { text: EVENT[r.event] || r.event }),
        el('td', {}, el('a', { class: 'link', href: r.html_url, target: '_blank', rel: 'noopener', text: (r.head_commit && r.head_commit.message.split('\n')[0]) || r.display_title })),
        el('td', { class: r.conclusion === 'failure' ? 'bad' : '', text: r.status === 'completed' ? CONCLUSION[r.conclusion] || r.conclusion : STATUS[r.status] || r.status }),
      ),
    ),
  );
  return data.workflow_runs;
}

async function dispatch(sync) {
  const btns = [$('btn-sync'), $('btn-deploy')];
  btns.forEach((b) => (b.disabled = true));
  const before = new Set(catalog ? catalog.assets.map((a) => a.slug) : []);
  const started = Date.now();
  const panel = $('run-panel');
  panel.hidden = false;
  $('run-title').textContent = sync ? 'itch.io senkronu' : 'Yeniden yayın';
  $('run-result').replaceChildren();
  setSteps([['İstek gönderiliyor', 'active']]);
  $('run-note').textContent = '';
  try {
    await gh(repoPath(`/actions/workflows/${WORKFLOW}/dispatches`), { method: 'POST', body: { ref: 'main', inputs: { sync: String(sync) } } });
    let run = null;
    for (let i = 0; i < 40 && !run; i++) {
      await sleep(3000);
      const runs = await loadRuns();
      run = runs.find((r) => r.event === 'workflow_dispatch' && new Date(r.created_at).getTime() > started - 60000);
    }
    if (!run) throw new Error('İşlem başlamadı. GitHub Actions sayfasından kontrol et.');
    $('run-note').replaceChildren('Ayrıntılar: ', el('a', { class: 'link', href: run.html_url, target: '_blank', rel: 'noopener', text: 'GitHub Actions kaydı' }));
    while (true) {
      const jobs = await gh(repoPath(`/actions/runs/${run.id}/jobs`));
      setSteps(jobs.jobs.map((j) => [jobName(j.name), j.status === 'completed' ? (j.conclusion === 'success' ? 'done' : j.conclusion === 'skipped' ? 'skip' : 'fail') : j.status === 'in_progress' ? 'active' : 'wait']));
      run = await gh(repoPath(`/actions/runs/${run.id}`));
      if (run.status === 'completed') break;
      await sleep(5000);
    }
    await loadRuns();
    if (run.conclusion !== 'success') throw new Error('İşlem hata ile bitti. GitHub Actions kaydına bak.');
    await loadCatalog();
    loadTranslations();
    const after = catalog.assets.map((a) => a.slug);
    const added = catalog.assets.filter((a) => !before.has(a.slug));
    const removed = [...before].filter((s) => !after.includes(s));
    const secs = Math.round((Date.now() - started) / 1000);
    const summary = el('div', { class: 'result' },
      el('p', { class: 'result-head', text: sync ? `Tamamlandı (${secs} sn). ${added.length} yeni paket, ${removed.length} kaldırılan paket.` : `Site yeniden yayınlandı (${secs} sn).` }),
    );
    if (added.length) {
      summary.append(el('ul', { class: 'added' }, ...added.map((a) =>
        el('li', {}, el('img', { src: `${SITE}${a.cover.sm}`, alt: '', width: '96', height: '76' }), el('a', { class: 'link', href: `${SITE}/assets/${a.slug}/`, target: '_blank', rel: 'noopener', text: a.title })),
      )));
      summary.append(el('p', { class: 'small', text: 'Yeni paketler sitede İngilizce açıklamayla yayında. Diğer dillere çeviri için Claude Code\'a "yeni paketleri çevir" demen yeterli.' }));
    }
    $('run-result').replaceChildren(summary);
  } catch (err) {
    if (err.message !== 'unauthorized') $('run-result').replaceChildren(el('p', { class: 'bad', text: err.message }));
  } finally {
    btns.forEach((b) => (b.disabled = false));
  }
}
$('btn-sync').addEventListener('click', () => dispatch(true));
$('btn-deploy').addEventListener('click', () => dispatch(false));

function jobName(n) {
  return { build: 'itch.io verisi ve derleme', deploy: 'Yayına alma', indexnow: 'Bing ve Yandex bildirimi' }[n] || n;
}
function setSteps(steps) {
  const label = { done: 'tamam', active: 'sürüyor', wait: 'bekliyor', fail: 'hata', skip: 'atlandı' };
  $('run-steps').replaceChildren(...steps.map(([name, state]) => el('li', { class: `step step--${state}` }, el('span', { text: name }), el('span', { class: 'small', text: label[state] || '' }))));
}

// ---------- Helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ---------- Boot ----------
(async () => {
  if (!token) return show('login');
  try {
    await verify();
    await openDashboard();
  } catch (err) {
    if (err.message !== 'unauthorized') { show('login'); $('login-error').textContent = `Bağlanılamadı: ${err.message}`; }
  }
})();
