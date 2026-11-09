// HanX Assets admin panel: a static page that talks to the GitHub REST API with a
// fine-grained personal access token kept in this browser's localStorage.
const OWNER = 'hanxgames';
const REPO = 'gameassets.tr';
const WORKFLOW = 'deploy.yml';
const HEALTH_WORKFLOW = 'health.yml';
const SITE = 'https://gameassets.tr';
const API = 'https://api.github.com';
const LANGS = ['tr', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'ru', 'ja', 'ko', 'zh', 'id', 'vi'];
const LANG_NAMES = { en: 'English', tr: 'Türkçe', de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano', pt: 'Português (BR)', pl: 'Polski', ru: 'Русский', ja: '日本語', ko: '한국어', zh: '简体中文', id: 'Bahasa Indonesia', vi: 'Tiếng Việt' };
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64encode = (s) => btoa(unescape(encodeURIComponent(s)));
const b64decode = (s) => decodeURIComponent(escape(atob(s.replace(/\n/g, ''))));
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

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
const readJson = async (path, ref = 'main') => JSON.parse(await gh(repoPath(`/contents/${path}?ref=${ref}`), { raw: true }));
async function writeJson(path, data, message) {
  const fresh = await gh(repoPath(`/contents/${path}?ref=main`));
  return gh(repoPath(`/contents/${path}`), {
    method: 'PUT',
    body: { message, content: b64encode(`${JSON.stringify(data, null, 2)}\n`), sha: fresh.sha, branch: 'main' },
  });
}

// ---------- Views and tabs ----------
function show(view) {
  $('view-login').hidden = view !== 'login';
  $('view-dash').hidden = view !== 'dash';
}
const TABS = ['genel', 'paketler', 'anasayfa', 'paylas', 'bakim'];
function selectTab(name, focus = false) {
  if (!TABS.includes(name)) name = 'genel';
  for (const t of TABS) {
    const tab = $(`tab-${t}`);
    tab.setAttribute('aria-selected', String(t === name));
    tab.tabIndex = t === name ? 0 : -1;
    $(`p-${t}`).hidden = t !== name;
  }
  if (focus) $(`tab-${name}`).focus();
  history.replaceState(null, '', `#${name}`);
}
for (const t of TABS) $(`tab-${t}`).addEventListener('click', () => selectTab(t));
document.querySelector('.tabs').addEventListener('keydown', (e) => {
  const i = TABS.findIndex((t) => $(`tab-${t}`).getAttribute('aria-selected') === 'true');
  if (e.key === 'ArrowRight') selectTab(TABS[(i + 1) % TABS.length], true);
  if (e.key === 'ArrowLeft') selectTab(TABS[(i - 1 + TABS.length) % TABS.length], true);
});

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

// ---------- Data ----------
let catalog = null;
let hidden = [];
let translations = {};
let featured = { heroPack: '', heroBundle: '', rail: [] };
let campaign = { enabled: false, text: { en: '' }, link: '', ends: '' };
let schedule = { enabled: true, hoursTR: [7] };

async function openDashboard() {
  show('dash');
  selectTab(location.hash.slice(1));
  await Promise.all([loadCatalog(), loadRuns()]);
  loadTranslations();
  loadSettings();
  loadHealth();
  loadCommits();
}

async function loadCatalog() {
  const [cat, hid] = await Promise.all([readJson('src/data/catalog.json'), readJson('src/data/hidden.json')]);
  catalog = cat;
  hidden = hid;
  renderStats();
  renderPacks();
  fillShareSelects();
}

function visibleAssets() {
  return catalog ? catalog.assets.filter((a) => !hidden.includes(a.slug)) : [];
}

function renderStats() {
  $('s-packs').textContent = `${visibleAssets().length} / ${catalog.assets.length}`;
  $('s-bundles').textContent = String(catalog.bundles.length);
  $('s-hidden').textContent = String(hidden.length);
  $('s-synced').textContent = fmtDate(catalog.syncedAt);
}

async function loadTranslations() {
  const results = await Promise.allSettled(LANGS.map(async (l) => [l, await readJson(`src/i18n/desc/${l}.json`), await readJson(`src/i18n/packs/${l}.json`)]));
  translations = {};
  for (const r of results) if (r.status === 'fulfilled') translations[r.value[0]] = { desc: r.value[1], packs: r.value[2] };
  renderPacks();
  renderShare();
}
const translatedCount = (slug) => LANGS.filter((l) => translations[l] && translations[l].desc[slug] && translations[l].packs[slug]).length;

// ---------- Packs tab ----------
function renderPacks() {
  if (!catalog) return;
  const q = $('pack-filter').value.toLowerCase().trim();
  const rows = catalog.assets.filter((a) => !q || a.title.toLowerCase().includes(q) || a.slug.includes(q));
  const haveT = Object.keys(translations).length > 0;
  $('pack-rows').replaceChildren(
    ...rows.map((a) => {
      const isHidden = hidden.includes(a.slug);
      const tCount = haveT ? translatedCount(a.slug) : null;
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
        el('td', { class: tCount !== null && tCount < LANGS.length ? 'warn' : '', text: tCount === null ? '…' : `${tCount} / ${LANGS.length}` }),
        el('td', {}, toggle),
      );
    }),
  );
  if (!rows.length) $('pack-rows').replaceChildren(el('tr', {}, el('td', { colspan: '4', class: 'small', text: 'Eşleşen paket yok.' })));
}
$('pack-filter').addEventListener('input', renderPacks);

async function toggleHidden(slug, button) {
  button.disabled = true;
  try {
    const list = new Set(await readJson('src/data/hidden.json'));
    const willHide = !list.has(slug);
    willHide ? list.add(slug) : list.delete(slug);
    hidden = [...list].sort();
    await writeJson('src/data/hidden.json', hidden, `admin: ${willHide ? 'hide' : 'show'} ${slug}`);
    renderStats();
    renderPacks();
    $('pack-note').textContent = `${slug} ${willHide ? 'gizlendi' : 'yeniden görünür yapıldı'}. Site birkaç dakika içinde güncellenir.`;
    setTimeout(loadRuns, 4000);
    setTimeout(loadCommits, 4000);
  } catch (err) {
    $('pack-note').textContent = `Kaydedilemedi: ${err.message}`;
    button.disabled = false;
  }
}

// ---------- Home tab: featured and campaign ----------
async function loadSettings() {
  const [f, c, s] = await Promise.allSettled([readJson('src/data/featured.json'), readJson('src/data/campaign.json'), readJson('src/data/schedule.json')]);
  if (f.status === 'fulfilled') featured = f.value;
  if (c.status === 'fulfilled') campaign = c.value;
  if (s.status === 'fulfilled') schedule = s.value;
  renderFeatured();
  renderCampaign();
  renderSchedule();
}

let railPick = [];
function renderFeatured() {
  const packs = visibleAssets();
  $('f-hero').replaceChildren(...packs.map((a) => el('option', { value: a.slug, text: a.title, selected: a.slug === featured.heroPack })));
  $('f-bundle').replaceChildren(...catalog.bundles.map((b) => el('option', { value: b.id, text: `${b.title} (${b.bundlePrice})`, selected: b.id === featured.heroBundle })));
  railPick = (featured.rail || []).filter((s) => packs.some((a) => a.slug === s));
  $(railPick.length ? 'f-rail-picked' : 'f-rail-newest').checked = true;
  renderRailList();
}
function renderRailList() {
  const picked = $('f-rail-picked').checked;
  $('f-rail-list').hidden = !picked;
  $('f-rail-list').replaceChildren(
    ...visibleAssets().map((a) => {
      const pos = railPick.indexOf(a.slug);
      return el('button', {
        type: 'button',
        class: `pick ${pos > -1 ? 'is-on' : ''}`,
        'aria-pressed': String(pos > -1),
        onclick: () => {
          const i = railPick.indexOf(a.slug);
          if (i > -1) railPick.splice(i, 1);
          else if (railPick.length < 8) railPick.push(a.slug);
          renderRailList();
        },
      }, el('img', { src: `${SITE}${a.cover.sm}`, alt: '', width: '96', height: '76', loading: 'lazy' }), el('span', { text: pos > -1 ? `${pos + 1}. ${a.title}` : a.title }));
    }),
  );
}
for (const r of document.querySelectorAll('input[name="rail-mode"]')) r.addEventListener('change', renderRailList);

$('featured-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('featured-save');
  btn.disabled = true;
  $('featured-note').textContent = 'Kaydediliyor…';
  try {
    const next = { heroPack: $('f-hero').value, heroBundle: $('f-bundle').value, rail: $('f-rail-picked').checked ? railPick.slice(0, 8) : [] };
    if ($('f-rail-picked').checked && !next.rail.length) throw new Error('Kendi seçimin için en az bir paket seç.');
    await writeJson('src/data/featured.json', next, 'admin: update home page picks');
    featured = next;
    $('featured-note').textContent = 'Kaydedildi. Ana sayfa birkaç dakika içinde güncellenir.';
    setTimeout(loadRuns, 4000);
    setTimeout(loadCommits, 4000);
  } catch (err) {
    $('featured-note').textContent = `Kaydedilemedi: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

function renderCampaign() {
  $('c-enabled').checked = Boolean(campaign.enabled);
  $('c-en').value = campaign.text?.en || '';
  $('c-tr').value = campaign.text?.tr || '';
  $('c-link').value = campaign.link || '';
  $('c-ends').value = campaign.ends ? toTrLocalInput(campaign.ends) : '';
  $('c-langs').replaceChildren(
    ...LANGS.filter((l) => l !== 'tr').map((l) =>
      el('label', { class: 'field' }, el('span', { text: LANG_NAMES[l] }), el('input', { type: 'text', maxlength: '90', 'data-lang': l, value: campaign.text?.[l] || '' })),
    ),
  );
  updatePreview();
}
function toTrLocalInput(iso) {
  // ISO -> "YYYY-MM-DDTHH:mm" in Türkiye time (UTC+3, no DST)
  const d = new Date(new Date(iso).getTime() + 3 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
}
function fromTrLocalInput(v) {
  return v ? new Date(`${v}:00+03:00`).toISOString() : '';
}
function updatePreview() {
  const text = $('c-tr').value || $('c-en').value;
  $('c-preview').replaceChildren(text ? el('span', { text }) : el('span', { class: 'small', text: 'Metin yazınca burada görünür.' }));
  $('c-preview').classList.toggle('is-off', !$('c-enabled').checked);
}
for (const id of ['c-en', 'c-tr', 'c-enabled']) $(id).addEventListener('input', updatePreview);

$('campaign-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('campaign-save');
  btn.disabled = true;
  $('campaign-note').textContent = 'Kaydediliyor…';
  try {
    const text = { en: $('c-en').value.trim() };
    if ($('c-tr').value.trim()) text.tr = $('c-tr').value.trim();
    for (const input of $('c-langs').querySelectorAll('input[data-lang]')) if (input.value.trim()) text[input.dataset.lang] = input.value.trim();
    const next = { enabled: $('c-enabled').checked, text, link: $('c-link').value.trim(), ends: fromTrLocalInput($('c-ends').value) };
    if (next.enabled && !text.en) throw new Error('Şeridi açmak için en azından İngilizce metni yaz.');
    if (next.link && !/^(\/|https:\/\/)/.test(next.link)) throw new Error('Bağlantı "/" ya da "https://" ile başlamalı.');
    await writeJson('src/data/campaign.json', next, `admin: ${next.enabled ? 'update' : 'turn off'} campaign strip`);
    campaign = next;
    $('campaign-note').textContent = next.enabled ? 'Kaydedildi. Şerit birkaç dakika içinde sitede görünür.' : 'Kaydedildi. Şerit siteden kalkacak.';
    setTimeout(loadRuns, 4000);
    setTimeout(loadCommits, 4000);
  } catch (err) {
    $('campaign-note').textContent = `Kaydedilemedi: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

// ---------- Share tab ----------
function fillShareSelects() {
  const packs = visibleAssets().slice().sort((a, b) => +new Date(b.published || 0) - +new Date(a.published || 0));
  const current = $('sh-pack').value;
  $('sh-pack').replaceChildren(...packs.map((a) => el('option', { value: a.slug, text: a.title, selected: a.slug === current })));
  if (!$('sh-lang').options.length) $('sh-lang').replaceChildren(...Object.entries(LANG_NAMES).map(([k, v]) => el('option', { value: k, text: v })));
  renderShare();
}
function shareText() {
  const a = catalog?.assets.find((x) => x.slug === $('sh-pack').value);
  if (!a) return { text: '', url: '' };
  const lang = $('sh-lang').value || 'en';
  const platform = document.querySelector('input[name="sh-platform"]:checked').value;
  const local = lang === 'en' ? null : translations[lang]?.packs[a.slug];
  const short = (local?.short || a.shortDescription).replace(/[.。]$/, '');
  const url = `${SITE}${lang === 'en' ? '' : `/${lang}`}/assets/${a.slug}/`;
  const sale = a.originalPrice && a.sale ? ` (-${a.sale.rate}%)` : '';
  const pixel = a.series === '3d-pixel';
  const tags = pixel ? '#gamedev #indiedev #pixelart #voxel #unity3d #godot' : '#gamedev #indiedev #lowpoly #3dmodels #unity3d #godot';
  const engines = (a.engines || []).filter((e) => e !== 'threejs').map((e) => ({ unity: 'Unity', godot: 'Godot', unreal: 'Unreal', blender: 'Blender' }[e] || e)).join(', ');
  const formats = (a.formats || []).filter((f) => f !== 'PNG').map((f) => (f === 'BLEND' ? '.blend' : f)).join(', ');
  if (platform === 'x') return { text: `${a.title}: ${short}.\n\n${a.price}${sale}\n${url}\n\n${tags}`, url, x: true };
  if (platform === 'reddit') {
    return {
      text: `${a.title}: ${short}\n\n${short}.\n\n- Models: ${a.modelCount ?? ''}\n- Formats: ${formats}\n- Engines: ${engines}\n- One palette texture, commercial license\n- Price: ${a.price}${sale}\n\n${url}`,
      url,
    };
  }
  return {
    text: `# ${a.title}\n\n![${a.title}](${SITE}${a.cover.src})\n\n${short}.\n\n- **${a.modelCount ?? ''}** models\n- ${formats}\n- ${engines}\n- ${a.price}${sale}\n\n[${url.replace('https://', '')}](${url})`,
    url,
  };
}
function renderShare() {
  if (!catalog) return;
  const { text, x } = shareText();
  $('sh-out').value = text;
  // X counts every link as 23 characters.
  const len = text.replace(/https?:\/\/\S+/g, 'x'.repeat(23)).length;
  $('sh-count').textContent = x ? `${len} / 280 karakter${len > 280 ? ' (uzun, kısalt)' : ''}` : `${text.length} karakter`;
  $('sh-open').hidden = !x;
  $('sh-open').href = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}
for (const id of ['sh-pack', 'sh-lang']) $(id).addEventListener('change', renderShare);
for (const r of document.querySelectorAll('input[name="sh-platform"]')) r.addEventListener('change', renderShare);
$('sh-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('sh-out').value);
    $('sh-note').textContent = 'Panoya kopyalandı.';
  } catch {
    $('sh-out').select();
    $('sh-note').textContent = 'Kopyalanamadı; metin seçili, Ctrl+C ile kopyala.';
  }
});

// ---------- Maintenance tab: schedule, health, restore ----------
function renderSchedule() {
  $('sc-enabled').checked = Boolean(schedule.enabled);
  $('sc-hours').replaceChildren(
    ...Array.from({ length: 24 }, (_, h) => {
      const on = (schedule.hoursTR || []).includes(h);
      return el('button', {
        type: 'button', class: `hour ${on ? 'is-on' : ''}`, 'aria-pressed': String(on), text: `${String(h).padStart(2, '0')}:00`,
        onclick: (e) => { e.currentTarget.classList.toggle('is-on'); e.currentTarget.setAttribute('aria-pressed', String(e.currentTarget.classList.contains('is-on'))); },
      });
    }),
  );
}
$('schedule-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('schedule-save');
  btn.disabled = true;
  $('schedule-note').textContent = 'Kaydediliyor…';
  try {
    const hoursTR = [...$('sc-hours').querySelectorAll('.hour')].map((b, h) => (b.classList.contains('is-on') ? h : -1)).filter((h) => h > -1);
    const next = { enabled: $('sc-enabled').checked, hoursTR };
    if (next.enabled && !hoursTR.length) throw new Error('En az bir saat seç ya da otomatik senkronu kapat.');
    await writeJson('src/data/schedule.json', next, 'admin: update sync schedule');
    schedule = next;
    $('schedule-note').textContent = next.enabled ? `Kaydedildi. itch.io her gün ${hoursTR.map((h) => `${String(h).padStart(2, '0')}:00`).join(', ')}'da kontrol edilecek.` : 'Kaydedildi. Otomatik senkron kapalı; panelden elle çekebilirsin.';
    loadCommits();
  } catch (err) {
    $('schedule-note').textContent = `Kaydedilemedi: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

async function loadHealth() {
  let report = null;
  try { report = await readJson('health.json', 'status'); } catch { /* no report yet */ }
  const box = $('health-report');
  if (!report) {
    box.replaceChildren(el('p', { class: 'small', text: 'Henüz rapor yok. "Şimdi kontrol et" ile ilk kontrolü başlat.' }));
    return;
  }
  const kids = [
    el('p', { class: report.problems.length ? 'bad' : 'ok', text: report.problems.length ? `${report.problems.length} sorun bulundu.` : 'Sorun yok.' }),
    el('p', { class: 'small', text: `Son kontrol: ${fmtDate(report.checkedAt)}, ${report.durationSec} sn. ${report.counts.pages} sayfa, ${report.counts.images} görsel, ${report.counts.itch} itch.io sayfası kontrol edildi.${report.skipped?.length ? ` ${report.skipped.length} itch.io sayfası sorgu sınırı yüzünden kontrol edilemedi.` : ''}` }),
  ];
  if (report.problems.length) {
    const typeName = { page: 'Sayfa', image: 'Görsel', itch: 'itch.io sayfası', 'itch-profile': 'itch.io profili' };
    kids.push(el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Tür' }), el('th', { scope: 'col', text: 'Adres' }), el('th', { scope: 'col', text: 'Durum' }))),
      el('tbody', {}, ...report.problems.slice(0, 50).map((p) => el('tr', {},
        el('td', { text: typeName[p.type] || p.type }),
        el('td', {}, el('a', { class: 'link', href: p.url, target: '_blank', rel: 'noopener', text: p.url.replace('https://', '') })),
        el('td', { class: 'num', text: p.status ? String(p.status) : 'ulaşılamadı' }),
      ))),
    )));
  }
  if (report.newOnItch?.length) {
    const msg = `itch.io'da sitede henüz olmayan ${report.newOnItch.length} paket var: ${report.newOnItch.join(', ')}. "itch.io'dan şimdi çek" ile ekleyebilirsin.`;
    kids.push(el('p', { class: 'notice', text: msg }));
    $('new-on-itch').textContent = msg;
    $('new-on-itch').hidden = false;
  } else {
    $('new-on-itch').hidden = true;
  }
  box.replaceChildren(...kids);
}

$('health-run').addEventListener('click', async () => {
  const btn = $('health-run');
  btn.disabled = true;
  const started = Date.now();
  $('health-report').replaceChildren(el('p', { class: 'small', text: 'Kontrol başlatılıyor…' }));
  try {
    await gh(repoPath(`/actions/workflows/${HEALTH_WORKFLOW}/dispatches`), { method: 'POST', body: { ref: 'main' } });
    let run = null;
    for (let i = 0; i < 40 && !run; i++) {
      await sleep(3000);
      const data = await gh(repoPath(`/actions/workflows/${HEALTH_WORKFLOW}/runs?per_page=3`));
      run = data.workflow_runs.find((r) => new Date(r.created_at).getTime() > started - 60000);
    }
    if (!run) throw new Error('Kontrol başlamadı.');
    while (run.status !== 'completed') {
      $('health-report').replaceChildren(el('p', { class: 'small', text: `Kontrol sürüyor (${Math.round((Date.now() - started) / 1000)} sn). Yaklaşık 4 dakika sürer; bu sayfadan çıkabilirsin.` }));
      await sleep(8000);
      run = await gh(repoPath(`/actions/runs/${run.id}`));
    }
    if (run.conclusion !== 'success') throw new Error('Kontrol hata ile bitti. GitHub Actions kaydına bak.');
    await loadHealth();
  } catch (err) {
    if (err.message !== 'unauthorized') $('health-report').replaceChildren(el('p', { class: 'bad', text: err.message }));
  } finally {
    btn.disabled = false;
  }
});

async function loadCommits() {
  const commits = await gh(repoPath('/commits?sha=main&per_page=15'));
  $('commit-rows').replaceChildren(
    ...commits.map((c, i) =>
      el('tr', {},
        el('td', { class: 'num', text: fmtDate(c.commit.committer.date) }),
        el('td', {}, el('a', { class: 'link', href: c.html_url, target: '_blank', rel: 'noopener', text: c.commit.message.split('\n')[0] })),
        el('td', {}, c.parents.length
          ? el('button', { class: 'btn btn--sm', type: 'button', text: i === 0 ? 'Geri al' : 'Öncesine dön', onclick: (e) => restoreBefore(c, e.currentTarget) })
          : null),
      ),
    ),
  );
}

// Restore the whole site to the state just before commit `c`, keeping the current
// workflows (.github) and sync schedule, as a new commit on top of main.
async function restoreBefore(c, button) {
  const subject = c.commit.message.split('\n')[0];
  if (!confirm(`Site, "${subject}" değişikliğinden önceki haline döndürülecek. Sonrasındaki değişiklikler de geri alınır (kayıtları silinmez). Devam edilsin mi?`)) return;
  button.disabled = true;
  $('restore-note').textContent = 'Geri alınıyor…';
  try {
    const ref = await gh(repoPath('/git/ref/heads/main'));
    const headSha = ref.object.sha;
    const head = await gh(repoPath(`/git/commits/${headSha}`));
    const headTree = await gh(repoPath(`/git/trees/${head.tree.sha}`));
    const githubDir = headTree.tree.find((t) => t.path === '.github');
    const schedFile = await gh(repoPath(`/contents/src/data/schedule.json?ref=${headSha}`));
    const target = await gh(repoPath(`/git/commits/${c.parents[0].sha}`));
    const keep = [{ path: 'src/data/schedule.json', mode: '100644', type: 'blob', sha: schedFile.sha }];
    if (githubDir) keep.push({ path: '.github', mode: '040000', type: 'tree', sha: githubDir.sha });
    const tree = await gh(repoPath('/git/trees'), { method: 'POST', body: { base_tree: target.tree.sha, tree: keep } });
    const commit = await gh(repoPath('/git/commits'), {
      method: 'POST',
      body: { message: `admin: restore site to before "${subject}" (${c.sha.slice(0, 7)})`, tree: tree.sha, parents: [headSha] },
    });
    await gh(repoPath('/git/refs/heads/main'), { method: 'PATCH', body: { sha: commit.sha } });
    $('restore-note').textContent = 'Geri alındı. Site birkaç dakika içinde eski haline döner.';
    await Promise.all([loadCommits(), loadCatalog()]);
    loadSettings();
    setTimeout(loadRuns, 4000);
  } catch (err) {
    $('restore-note').textContent = `Geri alınamadı: ${err.message}`;
    button.disabled = false;
  }
}

// ---------- Runs and dispatch ----------
const STATUS = { queued: 'Sırada', in_progress: 'Çalışıyor', completed: 'Bitti', waiting: 'Bekliyor', pending: 'Bekliyor' };
const CONCLUSION = { success: 'Başarılı', failure: 'Hata', cancelled: 'İptal', skipped: 'Atlandı' };
function runLabel(r) {
  if (r.event === 'workflow_dispatch') {
    const bot = /github-actions/i.test(r.triggering_actor?.login || '');
    return bot ? 'Otomatik itch.io senkronu' : `Panel (${r.triggering_actor?.login || 'elle'})`;
  }
  return (r.display_title || '').split('\n')[0];
}

async function loadRuns() {
  const data = await gh(repoPath(`/actions/workflows/${WORKFLOW}/runs?per_page=10`));
  $('run-rows').replaceChildren(
    ...data.workflow_runs.map((r) =>
      el('tr', {},
        el('td', { class: 'num', text: fmtDate(r.created_at) }),
        el('td', {}, el('a', { class: 'link', href: r.html_url, target: '_blank', rel: 'noopener', text: runLabel(r) })),
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
  $('run-panel').hidden = false;
  $('run-title').textContent = sync ? 'itch.io senkronu' : 'Yeniden yayın';
  $('run-result').replaceChildren();
  setSteps([['İstek gönderiliyor', 'active']]);
  $('run-note').textContent = '';
  try {
    await gh(repoPath(`/actions/workflows/${WORKFLOW}/dispatches`), { method: 'POST', body: { ref: 'main', inputs: { sync: String(sync), reason: 'panel' } } });
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
    loadCommits();
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
    loadHealthHintAfterSync(added.length);
  } catch (err) {
    if (err.message !== 'unauthorized') $('run-result').replaceChildren(el('p', { class: 'bad', text: err.message }));
  } finally {
    btns.forEach((b) => (b.disabled = false));
  }
}
function loadHealthHintAfterSync(addedCount) {
  if (addedCount) $('new-on-itch').hidden = true;
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
