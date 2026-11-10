(() => {
'use strict';
const $ = (id) => document.getElementById(id);

if (document.body.dataset.view === 'login') { initLogin(); } else { initApp(); }

/* ------------------------------------------------------------------ login */
function initLogin() {
  const post = async (a, body) => {
    const r = await fetch('api.php?a=' + a, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Prijava nije uspjela.');
    return d;
  };
  const showCode = (masked) => {
    const f = $('fLogin');
    f.innerHTML = '<p class="muted">Poslali smo 6-znamenkasti kod na <b>' + masked.replace(/[<>&]/g, '') + '</b>. Kod vrijedi 10 minuta.</p>' +
      '<label class="f">Kod za potvrdu<input id="lCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" required autofocus></label>' +
      '<label class="chk"><input type="checkbox" id="lRemember"> Zapamti ovaj uređaj 30 dana</label>' +
      '<div class="msg" id="lMsg" role="alert"></div>' +
      '<button class="btn primary" type="submit" id="lGo">Potvrdi</button>' +
      '<div class="row-btns" style="margin-top:8px"><button class="btn" type="button" id="lResend">Pošalji kod ponovno</button><button class="btn" type="button" id="lBack">Natrag</button></div>';
    f.dataset.step = 'code';
    $('lCode').focus();
    $('lBack').addEventListener('click', () => location.reload());
    $('lResend').addEventListener('click', async () => {
      $('lMsg').textContent = '';
      try { await post('login_resend', {}); $('lMsg').textContent = 'Novi kod je poslan.'; } catch (e) { $('lMsg').textContent = e.message; }
    });
  };
  $('fLogin').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msg = $('lMsg');
    msg.textContent = '';
    if ($('fLogin').dataset.step === 'code') {
      const code = $('lCode').value.replace(/\D/g, '');
      if (code.length !== 6) { msg.textContent = 'Upišite 6-znamenkasti kod.'; return; }
      $('lGo').disabled = true;
      try { await post('login_verify', { code, remember: $('lRemember').checked }); location.reload(); }
      catch (e) { msg.textContent = e.message; $('lGo').disabled = false; if (/Prijavite se ponovno|blokirana/.test(e.message)) setTimeout(() => location.reload(), 2500); }
      return;
    }
    const email = $('lEmail').value.trim();
    const password = $('lPass').value;
    if (!email || !password) { msg.textContent = 'Upišite e-mail i lozinku.'; return; }
    $('lGo').disabled = true;
    try {
      const d = await post('login', { email, password });
      if (d.twofa) { showCode(d.email || ''); return; }
      location.reload();
    } catch (e) {
      msg.textContent = e.message;
      $('lGo').disabled = false;
    }
  });
}

/* -------------------------------------------------------------------- app */
function initApp() {
  const STAGES = [
    { id: 'novi', label: 'Novi kontakt' }, { id: 'kontaktiran', label: 'Kontaktiran' },
    { id: 'ponuda', label: 'Ponuda poslana' }, { id: 'pregovori', label: 'Pregovori' },
    { id: 'aktivni', label: 'Aktivni' }, { id: 'dobiven', label: 'Dobiven' }, { id: 'izgubljen', label: 'Izgubljen' },
  ];
  const STAGE = Object.fromEntries(STAGES.map((s) => [s.id, s]));
  const OPEN = { novi: 1, kontaktiran: 1, ponuda: 1, pregovori: 1 };
  const SERVICES = ['Radio SPOT', 'Radio Emisija', 'PR Portali', 'Baner'];
  const svcBox = (sel) => { const have = String(sel || '').split(',').map((x) => x.trim()); return SERVICES.map((s) => '<label class="chk"><input type="checkbox" value="' + esc(s) + '"' + (have.includes(s) ? ' checked' : '') + '> ' + esc(s) + '</label>').join(''); };
  const svcRead = (id) => Array.from($(id).querySelectorAll('input:checked')).map((i) => i.value).join(', ');
  const TYPES = { note: 'Bilješka', call: 'Kontakt telefonom', meeting: 'Sastanak', email: 'E-mail poslan', inmail: 'E-mail primljen', status: 'Status' };
  const STALE_DAYS = 14;
  const TABS = ['pregled', 'klijenti', 'aktivni', 'zadaci', 'inbox', 'kampanje', 'tim', 'postavke'];
  const meta = document.querySelector('meta[name="csrf"]');
  const S = {
    csrf: meta ? meta.content : '', rev: '', loaded: false, offline: false,
    me: { id: '', name: '', email: '', role: 'sales' }, users: [], usersById: {},
    clients: [], campaigns: [], tasks: [], revenue: null, revPeriod: 'weekly', revUser: '', audit: null, notes: [], emails: [], docs: [], templates: [], scheduled: [], reminders: [], settings: null, mail: { enabled: false, from: '', imap: false, lastSync: 0, error: '', imap2: false, lastSync2: 0, error2: '', imap2Cfg: null },
    byClient: new Map(), clientsById: new Map(), inByClient: new Map(),
    tab: 'pregled', q: '', fStatus: '', fOwner: '', fKind: '', fIndustry: '', fVK: '', fVMin: '', fVMax: '', fNotes: true, sort: 'activity', iq: '', iFilter: 'all', period: '7',
    openId: null, pendingStatus: null, mailClient: null, mailDocs: new Set(), nFromMail: null, nGuess: '', reportText: '', openMailId: null, lastFocus: null, refreshing: false, syncing: false,
  };

  /* ---------- helpers ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = () => ymd(new Date());
  const fmtDate = (ts) => { const d = new Date(ts); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + '.'; };
  const fmtTime = (ts) => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const fmtYmd = (s) => { if (!s) return ''; const p = s.split('-'); return p[2] + '.' + p[1] + '.' + p[0] + '.'; };
  const daysAgo = (ts) => { const a = new Date(ts); a.setHours(0, 0, 0, 0); const b = new Date(); b.setHours(0, 0, 0, 0); return Math.round((b - a) / 864e5); };
  document.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) setTab(g.dataset.goto); });
  const pl3 = (n, a, b, c) => ((n % 10 === 1 && n % 100 !== 11) ? a : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c));
  const plural = (n, one, many) => ((n % 10 === 1 && n % 100 !== 11) ? one : many);
  const rel = (ts) => { if (!ts) return 'nikad'; const n = daysAgo(ts); if (n <= 0) return 'danas'; if (n === 1) return 'jučer'; return 'prije ' + n + ' ' + plural(n, 'dan', 'dana'); };
  const shortDate = (ts) => (daysAgo(ts) <= 0 ? fmtTime(ts) : fmtDate(ts).slice(0, 6));
  const minAgo = (ts) => { if (!ts) return 'još nije'; const m = Math.round((Date.now() - ts) / 60000); if (m < 1) return 'upravo sada'; if (m < 60) return 'prije ' + m + ' min'; const h = Math.round(m / 60); if (h < 24) return 'prije ' + h + ' h'; return fmtDate(ts); };
  const EUR = new Intl.NumberFormat('hr-HR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const eur = (n) => EUR.format(Number(n) || 0);
  const sumVal = (a) => a.reduce((t, c) => t + (Number(c.value) || 0), 0);
  const pill = (st) => { const s = STAGE[st] || STAGES[0]; return '<span class="pill" style="--dot:var(--s-' + s.id + ')"><i></i>' + esc(s.label) + '</span>'; };
  const hue = (id) => 'hsl(' + ((Number(id) || 0) * 67 % 360) + ' 50% 48%)';
  const isAdmin = () => S.me.role === 'admin';

  function toast(msg, bad) {
    const t = $('toast');
    t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 4500);
  }

  let lastInput = Date.now();
  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'].forEach((e) => window.addEventListener(e, () => { lastInput = Date.now(); }, { passive: true, capture: true }));
  const activeHdr = (h) => { if (Date.now() - lastInput < 60000) h['X-Active'] = '1'; return h; };

  async function call(action, body, method) {
    const opt = { method: method || 'POST', credentials: 'same-origin', headers: activeHdr({}) };
    if (opt.method === 'POST') {
      opt.headers['Content-Type'] = 'application/json';
      opt.headers['X-CSRF'] = S.csrf;
      opt.body = JSON.stringify(body || {});
    }
    const res = await fetch('api.php?a=' + action, opt);
    let d = null;
    try { d = await res.json(); } catch (e) { /* ignore */ }
    if (res.status === 401) { location.reload(); throw new Error('Sesija je istekla.'); }
    if (!res.ok) throw new Error((d && d.error) || 'Zahtjev nije uspio.');
    return d;
  }
  async function safe(fn, okMsg) {
    try { const r = await fn(); if (okMsg) toast(okMsg); return r === undefined ? true : r; }
    catch (e) { toast(e.message || 'Radnja nije uspjela.', true); return false; }
  }

  /* ---------- data ---------- */
  async function refresh(force) {
    if (S.refreshing) return;
    S.refreshing = true;
    try {
      const d = await call('bootstrap&rev=' + encodeURIComponent(force ? '' : S.rev), null, 'GET');
      S.csrf = d.csrf || S.csrf;
      if (S.offline) { S.offline = false; renderBanner(); }
      if (d.unchanged) return;
      S.rev = d.rev; S.me = d.me; S.users = d.users; S.clients = d.clients; S.pool = d.pool || 0; S.notes = d.notes; await mergeExtra(); S.emails = d.emails; S.mail = d.mail; S.docs = d.docs || []; S.campaigns = d.campaigns || []; S.tasks = d.tasks || []; S.approvals = d.approvals || []; S.ownerHist = {}; (d.ownerHist || []).forEach((x) => { (S.ownerHist[x[0]] = S.ownerHist[x[0]] || []).push([x[1], x[2]]); }); S.templates = d.templates || []; S.scheduled = d.scheduled || []; S.reminders = d.reminders || []; S.alerts = d.alerts || []; S.dnc = d.dnc || []; S.settings = d.settings || null;
      S.loaded = true;
      derive();
      renderAll(); updateDrawer();
    } catch (e) {
      if (!S.offline) { S.offline = true; renderBanner(); }
    } finally { S.refreshing = false; }
  }
  /* klijenti iz arhive koje je korisnik otvorio ostaju učitani dok ne postanu obični klijenti */
  async function mergeExtra() {
    if (!S.extra || !S.extra.size) return;
    const have = new Set(S.clients.map((c) => c.id));
    for (const id of Array.from(S.extra.keys())) {
      if (have.has(id)) { S.extra.delete(id); continue; }
      try { const r = await call('client_get&id=' + encodeURIComponent(id), null, 'GET'); S.extra.set(id, r); S.clients.push(r.client); S.notes = S.notes.concat(r.notes); } catch (e) { S.extra.delete(id); }
    }
  }
  async function ensureClient(id) {
    if (byId(id)) return true;
    try {
      const r = await call('client_get&id=' + encodeURIComponent(id), null, 'GET');
      (S.extra = S.extra || new Map()).set(String(id), r); S.clients.push(r.client); S.notes = S.notes.concat(r.notes); derive(); return true;
    } catch (e) { toast(e.message, true); return false; }
  }
  function derive() {
    S.usersById = {}; S.users.forEach((u) => { S.usersById[u.id] = u; });
    S.clientsById = new Map(S.clients.map((c) => [c.id, c]));
    const m = new Map();
    S.notes.forEach((n) => { if (!m.has(n.clientId)) m.set(n.clientId, []); m.get(n.clientId).push(n); });
    m.forEach((a) => a.sort((x, y) => y.createdAt - x.createdAt));
    S.byClient = m;
    const im = new Map();
    S.emails.forEach((e) => { if (e.dir === 'in' && e.clientId) { if (!im.has(e.clientId)) im.set(e.clientId, []); im.get(e.clientId).push(e); } });
    S.inByClient = im;
    const dc = new Map();
    S.docs.forEach((x) => { if (x.clientId) { if (!dc.has(x.clientId)) dc.set(x.clientId, []); dc.get(x.clientId).push(x); } });
    S.docsByClient = dc;
  }
  const byId = (id) => S.clientsById.get(id) || null;
  const lastNote = (c) => { const a = S.byClient.get(c.id); return a && a[0] ? a[0] : null; };
  const lastTs = (c) => {
    const n = lastNote(c); let t = n ? n.createdAt : 0;
    (S.inByClient.get(c.id) || []).forEach((e) => { if (e.date > t) t = e.date; });
    return t;
  };
  const isOpen = (c) => !!OPEN[c.status];
  /* kampanje: aktivna je samo dok je označena i datum završetka nije prošao; kraća od 7 dana (npr. dnevna) ima drugu boju */
  const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
  const campActive = (c) => !!c.campActive && !!c.campEnd && c.campEnd >= today();
  const extraCamps = (c) => (c.multiCamp ? (S.campaigns || []).filter((x) => x.clientId === c.id && x.end >= today()).sort((a, b) => a.end.localeCompare(b.end)) : []);
  const campLeft = (c) => dayDiff(today(), c.campEnd);
  const campLen = (c) => (c.campStart ? dayDiff(c.campStart, c.campEnd) + 1 : 0);
  const campShort = (c) => campLen(c) > 0 && campLen(c) < 7;
  const campSoon = (c) => campActive(c) && campLeft(c) <= 7;
  const leftTxt = (c) => { const n = campLeft(c); return n === 0 ? 'ističe danas' : n === 1 ? 'ističe sutra' : 'ističe za ' + n + ' ' + plural(n, 'dan', 'dana'); };
  const lenTxt = (c) => { const n = campLen(c); return n === 1 ? 'dnevna kampanja' : n + ' ' + plural(n, 'dan', 'dana'); };
  const isStale = (c) => { if (!isOpen(c)) return false; const t = lastTs(c); return !t || daysAgo(t) >= STALE_DAYS; };
  const isDue = (c) => isOpen(c) && !!c.nextFollowUp && c.nextFollowUp <= today();
  const overdueDays = (c) => Math.round((new Date(today()) - new Date(c.nextFollowUp)) / 864e5);
  const person = (id) => { const u = S.usersById[id]; return u ? u.name : (id ? 'Bivši korisnik' : 'Nedodijeljeno'); };
  const activeUsers = () => S.users.filter((u) => u.active);
  const unreadCount = () => S.emails.filter((e) => e.dir === 'in' && !e.read).length;
  const kindLabel = (c) => (c.kind === 'osoba' ? 'Fizička osoba' : 'Tvrtka');
  const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const ownerAt = (c, ts) => { const h = (S.ownerHist || {})[c.id]; if (!h || !h.length) return c.ownerId; let o = h[0][1]; h.forEach((x) => { if (x[0] <= ts) o = x[1]; }); return o; }; // prodaja se vodi na prodavača koji je vodio klijenta u tom trenutku
  const canDelete = (c) => isAdmin() || String(c.ownerId) === String(S.me.id);

  /* ---------- shell ---------- */
  function renderBanner() {
    let h = '';
    if (S.offline) h = '<div class="banner" role="status">Nema veze s poslužiteljem. Pokušavam ponovno.</div>';
    else if (S.loaded && !S.mail.enabled) h = '<div class="banner info" role="status">Slanje e-maila još nije podešeno. ' + (isAdmin() ? 'Upišite podatke sandučića u config.php.' : 'Obavijestite administratora.') + '</div>';
    else if (S.loaded && S.mail.error) h = '<div class="banner" role="status">Zadnje osvježavanje pošte nije uspjelo.' + (isAdmin() && S.mail.error !== 'error' ? ' ' + esc(S.mail.error) : '') + '</div>';
    if (S.loaded && isAdmin() && (S.approvals || []).length) h += '<div class="banner info" role="status">Grupne e-mail poruke čekaju vaše odobrenje: <b>' + S.approvals.length + '</b> (' + esc(S.approvals.map((a) => a.user).filter((v, i, x) => x.indexOf(v) === i).join(', ')) + '). <button class="btn sm" data-goto="kampanje">Pregledaj i odobri</button></div>';
    $('banner').innerHTML = h;
  }
  const ADMIN_TABS = ['tim'];
  const tabAllowed = (t) => ADMIN_TABS.indexOf(t) < 0 || isAdmin();
  function renderTabs() {
    if (S.loaded) {
      ADMIN_TABS.forEach((t) => { $('t-' + t).hidden = !isAdmin(); });
      $('t-postavke').textContent = isAdmin() ? 'Postavke' : 'Moj račun';
      if (!tabAllowed(S.tab)) { S.tab = 'pregled'; try { location.hash = 'pregled'; } catch (e) { /* ignore */ } }
    }
    { const n = (S.tasks || []).filter((t) => !t.doneAt && t.assigneeId === S.me.id).length; const el = $('t-zadaci'); if (el.dataset.b !== String(n)) { el.dataset.b = String(n); el.innerHTML = 'Zadaci' + (n ? ' <span class="badge">' + n + '</span>' : ''); } }
    { const n = isAdmin() ? (S.approvals || []).length : 0; const el = $('t-kampanje'); if (el.dataset.b !== String(n)) { el.dataset.b = String(n); el.innerHTML = 'E-mail kampanje' + (n ? ' <span class="badge">' + n + '</span>' : ''); } }
    TABS.forEach((t) => { $('t-' + t).setAttribute('aria-selected', String(S.tab === t)); $('v-' + t).hidden = S.tab !== t; });
    const n = unreadCount(); const b = $('inboxBadge');
    b.hidden = n === 0; b.textContent = n > 99 ? '99+' : String(n);
    $('meName').textContent = S.me.name || '';
    if ($('bkTop')) $('bkTop').hidden = !isAdmin();
  }
  function renderAll() {
    renderBanner(); renderTabs();
    if (S.tab === 'pregled') renderOverview();
    else if (S.tab === 'klijenti') renderClients();
    else if (S.tab === 'inbox') renderInbox();
    else if (S.tab === 'aktivni') renderActive();
    else if (S.tab === 'zadaci') renderTasksTab();
    else if (S.tab === 'kampanje') renderCampaigns();
    else if (S.tab === 'tim') renderTeam();
    else if (S.tab === 'postavke') { const r = $('v-postavke'); if (!r.contains(document.activeElement) || !r.innerHTML) renderSettings(); }
  }
  function setTab(t) {
    if (TABS.indexOf(t) < 0 || (S.loaded && !tabAllowed(t))) return;
    S.tab = t;
    try { if (location.hash.slice(1) !== t) location.hash = t; } catch (e) { /* ignore */ }
    if (t === 'postavke') renderSettings();
    renderAll(); window.scrollTo(0, 0);
    if (t === 'inbox') syncInbox(false, true);
  }

  /* ---------- overview ---------- */
  const loadingHtml = () => '<div class="empty"><p>Učitavanje…</p></div>';
  const emptyHtml = () => '<div class="empty"><h2>Još nema klijenata</h2><p>Dodajte prvog klijenta. Uz svakog klijenta obavezna je bilješka, pa se cijela povijest razgovora vidi na jednom mjestu.</p><div class="row-btns"><button class="btn primary" data-act="new">Dodaj klijenta</button></div></div>';
  const rowLi = (c, right, cls) => '<li><button class="li" data-open="' + esc(c.id) + '"><span class="a"><b>' + esc(c.name) + '</b><small>' + (c.kind === 'osoba' ? 'fizička osoba' : esc(c.contact)) + (c.service ? ' · ' + esc(c.service) : '') + '</small></span><span class="b ' + cls + '">' + right + '</span></button></li>';


  /* ---------- zadaci ---------- */
  const tomorrow = () => ymd(new Date(Date.now() + 864e5));
  const taskLi = (t, withClient) => {
    const c = t.clientId ? byId(t.clientId) : null; const d = dayDiff(today(), t.due);
    const cls = t.doneAt ? 'ok' : d < 0 ? 'late' : d === 0 ? 'today' : '';
    const when = t.doneAt ? 'završeno' : d < 0 ? 'kasni ' + (-d) + ' ' + plural(-d, 'dan', 'dana') : d === 0 ? 'danas' : d === 1 ? 'sutra' : fmtYmd(t.due);
    return '<li class="task' + (t.doneAt ? ' done' : '') + '"><button class="tick" data-act="taskdone" data-id="' + esc(t.id) + '" data-done="' + (t.doneAt ? '' : '1') + '" aria-label="' + (t.doneAt ? 'Vrati u otvorene' : 'Označi završenim') + '">' + (t.doneAt ? '✓' : '') + '</button>' +
      '<span class="a"><button class="lnk tkopen" data-act="taskopen" data-id="' + esc(t.id) + '"><b>' + esc(t.title) + '</b></button><small>' + (t.takenAt && !t.doneAt ? 'preuzeto · ' : '') + (withClient && c ? '<button class="lnk" data-open="' + esc(c.id) + '">' + esc(c.name) + '</button> · ' : '') + (isAdmin() || t.assigneeId !== S.me.id ? esc(person(t.assigneeId)) + ' · ' : '') + 'rok ' + esc(fmtYmd(t.due)) + '</small></span>' +
      '<span class="b ' + cls + '">' + when + '</span><button class="x" data-act="taskdel" data-id="' + esc(t.id) + '" aria-label="Obriši zadatak">×</button></li>';
  };
  const taskForm = (p, cid) => '<div class="tkform"><input id="' + p + 'Title" placeholder="Novi zadatak, npr. poslati ponudu" maxlength="300" aria-label="Zadatak">' +
    '<input id="' + p + 'Due" type="date" value="' + tomorrow() + '" aria-label="Rok">' +
    (cid ? '' : '<input id="' + p + 'Client" list="tkClients" placeholder="Klijent (nije obavezno)" aria-label="Klijent"><datalist id="tkClients">' + S.clients.map((c) => '<option value="' + esc(c.name) + '"></option>').join('') + '</datalist>') +
    '<select id="' + p + 'Rep" aria-label="Ponavljanje"><option value="">Ne ponavlja se</option><option value="dnevno">Ponavlja svaki dan</option><option value="tjedno">Ponavlja svaki tjedan</option><option value="mjesecno">Ponavlja svaki mjesec</option></select>' +
    (!cid ? '<select id="' + p + 'Who" aria-label="Izvršitelj">' + ownerOptions().map((o) => '<option value="' + esc(o[0]) + '"' + (o[0] === S.me.id ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>' : '') +
    '<button class="btn primary sm" data-act="taskadd" data-p="' + p + '"' + (cid ? ' data-cid="' + esc(cid) + '"' : '') + '>Dodaj zadatak</button></div>';
  function tasksPanel() {
    const open = S.tasks.filter((t) => !t.doneAt).sort((a, b) => a.due.localeCompare(b.due) || Number(a.id) - Number(b.id));
    const done = S.tasks.filter((t) => t.doneAt).sort((a, b) => b.doneAt - a.doneAt);
    const late = open.filter((t) => t.due < today()).length;
    return '<section class="panel-b"><header><h3>Zadaci</h3><span class="muted">' + open.length + ' otvoreno' + (late ? ' · <b class="lt">' + late + ' kasni</b>' : '') + '</span></header>' +
      (open.length ? '<ul class="list tasks">' + (S.tkMore ? open : open.slice(0, 10)).map((t) => taskLi(t, true)).join('') + '</ul>' + (open.length > 10 ? '<div class="revmore"><button class="btn sm" data-act="tkmore">' + (S.tkMore ? 'Prikaži manje (prvih 10)' : 'Prikaži više (još ' + (open.length - 10) + ')') + '</button></div>' : '') : '<p class="muted pad">Nema otvorenih zadataka.</p>') +
      taskForm('tk', '') +
      (done.length ? '<details class="tkdone"><summary>Završeno zadnjih 7 dana (' + done.length + ')</summary><ul class="list tasks">' + done.map((t) => taskLi(t, true)).join('') + '</ul></details>' : '') + '</section>';
  }
  async function taskAdd(btn) {
    const p = btn.dataset.p; let cid = btn.dataset.cid || '';
    const title = $(p + 'Title').value.trim(), due = $(p + 'Due').value;
    if (title.length < 3) { toast('Upišite zadatak (barem 3 znaka).', true); $(p + 'Title').focus(); return; }
    if (!due) { toast('Odaberite rok zadatka.', true); return; }
    if (!cid && $(p + 'Client') && $(p + 'Client').value.trim()) {
      const f = S.clients.find((c) => c.name === $(p + 'Client').value.trim());
      if (!f) { toast('Klijent nije pronađen. Odaberite ga s popisa.', true); return; }
      cid = f.id;
    }
    const who = $(p + 'Who') ? $(p + 'Who').value : '';
    const descr = $(p + 'Descr') ? $(p + 'Descr').value.trim() : '';
    const ok = await safe(() => call('task_create', { title, descr, due, client_id: cid || undefined, assignee_id: who || undefined, repeat: $(p + 'Rep') ? $(p + 'Rep').value : '' }), 'Zadatak dodan');
    if (ok) { $(p + 'Title').value = ''; if ($(p + 'Descr')) $(p + 'Descr').value = ''; if ($(p + 'Client')) $(p + 'Client').value = ''; await refresh(true); if (p === 'tz') { document.activeElement && document.activeElement.blur(); renderTasksTab(); } }
  }
  async function taskAct(btn) {
    const done = btn.dataset.act === 'taskdone';
    if (!done && !confirm('Obrisati zadatak?')) return;
    const ok = await safe(() => call(done ? 'task_done' : 'task_delete', { id: btn.dataset.id, done: !!btn.dataset.done }));
    if (ok) await refresh(true);
  }

  /* ---------- zadaci: kartica, preuzimanje, bilješke, vremena ---------- */
  const fmtDT = (ts) => fmtDate(ts) + ' ' + fmtTime(ts);
  function fmtDur(ms) {
    const m = Math.floor(Math.max(0, ms) / 60000);
    if (m < 1) return 'manje od minute';
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
    const d = Math.floor(h / 24);
    return d + ' ' + plural(d, 'dan', 'dana') + (h % 24 ? ' ' + (h % 24) + ' h' : '');
  }
  const taskState = (t) => (t.doneAt ? 'zavrsen' : t.takenAt ? 'preuzet' : 'novi');
  const TK_LABEL = { novi: 'Novi', preuzet: 'Preuzet', zavrsen: 'Završen' };
  const tkPill = (t) => '<span class="tkst ' + taskState(t) + '">' + TK_LABEL[taskState(t)] + '</span>';
  function renderTasksTab() {
    const root = $('v-zadaci');
    if (!S.loaded) { root.innerHTML = loadingHtml(); return; }
    const ae = document.activeElement;
    if (root.innerHTML && root.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
    const f = S.tkFilter || 'otvoreni'; const who = S.tkWho || '';
    let a = S.tasks.filter((t) => !who || t.assigneeId === who);
    const cnt = { otvoreni: 0, novi: 0, preuzet: 0, zavrsen: 0, svi: a.length };
    a.forEach((t) => { const st = taskState(t); cnt[st === 'zavrsen' ? 'zavrsen' : st]++; if (st !== 'zavrsen') cnt.otvoreni++; });
    a = a.filter((t) => f === 'svi' || (f === 'otvoreni' ? !t.doneAt : f === 'novi' ? taskState(t) === 'novi' : f === 'preuzet' ? taskState(t) === 'preuzet' : !!t.doneAt));
    a.sort((x, y) => (f === 'zavrsen' ? y.doneAt - x.doneAt : (x.doneAt ? 1 : 0) - (y.doneAt ? 1 : 0) || x.due.localeCompare(y.due) || Number(x.id) - Number(y.id)));
    const chips = [['otvoreni', 'Otvoreni'], ['novi', 'Novi'], ['preuzet', 'Preuzeti'], ['zavrsen', 'Završeni'], ['svi', 'Svi']].map((x) => '<button class="chipbtn' + (f === x[0] ? ' on' : '') + '" data-act="tkfilter" data-v="' + x[0] + '">' + x[1] + ' <small>' + cnt[x[0]] + '</small></button>').join('');
    const whoSel = isAdmin() ? '<label class="f inl">Izvršitelj<select id="tkWho"><option value="">Svi korisnici</option>' + ownerOptions().map((o) => '<option value="' + esc(o[0]) + '"' + (o[0] === who ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select></label>' : '';
    const today0 = today();
    root.innerHTML = '<section class="panel-b"><header><h3>Novi zadatak</h3><span class="muted">' + (isAdmin() ? 'možete zadati bilo kojem korisniku' : 'sebi ili drugom korisniku') + '</span></header>' +
      '<div class="tkform tkbig"><input id="tzTitle" placeholder="Što treba napraviti, npr. poslati ponudu" maxlength="300" aria-label="Zadatak">' +
      '<textarea id="tzDescr" rows="2" maxlength="4000" placeholder="Opis (nije obavezno)" aria-label="Opis"></textarea>' +
      '<label class="f inl">Rok<input id="tzDue" type="date" value="' + tomorrow() + '"></label>' +
      '<label class="f inl">Klijent<input id="tzClient" list="tkClients2" placeholder="nije obavezno" autocomplete="off"><datalist id="tkClients2">' + S.clients.map((c) => '<option value="' + esc(c.name) + '"></option>').join('') + '</datalist></label>' +
      '<label class="f inl">Ponavljanje<select id="tzRep"><option value="">Ne ponavlja se</option><option value="dnevno">Svaki dan</option><option value="tjedno">Svaki tjedan</option><option value="mjesecno">Svaki mjesec</option></select></label>' +
      '<label class="f inl">Izvršitelj<select id="tzWho">' + ownerOptions().map((o) => '<option value="' + esc(o[0]) + '"' + (o[0] === S.me.id ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select></label>' +
      '<button class="btn primary" data-act="taskadd" data-p="tz">Dodaj zadatak</button></div></section>' +
      '<section class="panel-b"><header><h3>' + (isAdmin() ? 'Svi zadaci' : 'Moji zadaci') + '</h3><span class="muted">' + a.length + ' prikazano</span></header>' +
      '<div class="tkbar">' + chips + whoSel + '</div>' +
      (a.length ? '<div class="tblwrap"><table class="tktable"><thead><tr><th>Zadatak</th><th>Izvršitelj</th><th>Rok</th><th>Status</th><th>Dodan</th><th>Preuzet</th><th>Završen</th></tr></thead><tbody>' + a.map((t) => {
        const c = t.clientId ? byId(t.clientId) : null; const late = !t.doneAt && t.due < today0;
        return '<tr data-act="taskopen" data-id="' + esc(t.id) + '"><td><b>' + esc(t.title) + '</b>' + (c ? '<small>' + esc(c.name) + '</small>' : '') + (t.notes.length ? '<small>' + t.notes.length + ' ' + plural(t.notes.length, 'bilješka', 'bilješki') + '</small>' : '') + '</td>' +
          '<td>' + esc(person(t.assigneeId)) + '</td><td class="' + (late ? 'late' : '') + '">' + esc(fmtYmd(t.due)) + (late ? ' <small>kasni</small>' : '') + '</td><td>' + tkPill(t) + '</td>' +
          '<td>' + esc(fmtDT(t.createdAt)) + '<small>' + esc(person(t.createdBy)) + '</small></td>' +
          '<td>' + (t.takenAt ? esc(fmtDT(t.takenAt)) + '<small>nakon ' + fmtDur(t.takenAt - t.createdAt) + '</small>' : '<span class="muted">—</span>') + '</td>' +
          '<td>' + (t.doneAt ? esc(fmtDT(t.doneAt)) + '<small>trajanje ' + fmtDur(t.doneAt - (t.takenAt || t.createdAt)) + '</small>' : '<span class="muted">—</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted pad">Nema zadataka za odabrani prikaz.</p>') + '</section>';
  }
  function taskOpen(id) {
    const t = S.tasks.find((x) => x.id === id);
    if (!t) { toast('Zadatak nije pronađen.', true); return; }
    S.tkOpen = id; const now = Date.now(); const c = t.clientId ? byId(t.clientId) : null;
    const line = (label, body) => '<li><span class="tl-l">' + label + '</span><span>' + body + '</span></li>';
    const tl = '<ul class="tkline">' +
      line('Dodan', '<b>' + esc(fmtDT(t.createdAt)) + '</b> · ' + esc(person(t.createdBy))) +
      line('Preuzet', t.takenAt ? '<b>' + esc(fmtDT(t.takenAt)) + '</b> · ' + esc(person(t.takenBy)) + ' <small>(nakon ' + fmtDur(t.takenAt - t.createdAt) + ')</small>' : '<span class="muted">još nije preuzet</span> <small>(čeka ' + fmtDur((t.doneAt || now) - t.createdAt) + ')</small>') +
      line('Završen', t.doneAt ? '<b>' + esc(fmtDT(t.doneAt)) + '</b> · ' + esc(person(t.doneBy)) + ' <small>(' + (t.takenAt ? 'rad ' + fmtDur(t.doneAt - t.takenAt) + ', ' : '') + 'ukupno od dodavanja ' + fmtDur(t.doneAt - t.createdAt) + ')</small>' : '<span class="muted">u tijeku</span>' + (t.takenAt ? ' <small>(preuzeto prije ' + fmtDur(now - t.takenAt) + ')</small>' : '')) + '</ul>';
    const notes = t.notes.length ? '<ul class="tknotes">' + t.notes.map((n) => '<li class="' + n.kind + '"><small>' + esc(fmtDT(n.at)) + ' · ' + esc(person(n.userId)) + (n.kind === 'close' ? ' · završna bilješka' : '') + '</small><div>' + esc(n.body).replace(/\n/g, '<br>') + '</div></li>').join('') + '</ul>' : '<p class="muted">Još nema bilješki.</p>';
    const can = { take: !t.takenAt && !t.doneAt, del: isAdmin() || t.createdBy === S.me.id };
    toolModal('Zadatak', '<div class="tkhead"><h3>' + esc(t.title) + '</h3>' + tkPill(t) + '</div>' +
      '<p class="hint">Izvršitelj: <b>' + esc(person(t.assigneeId)) + '</b> · Rok: <b>' + esc(fmtYmd(t.due)) + '</b>' + (t.repeat ? ' · <b>ponavlja se ' + ({ dnevno: 'svaki dan', tjedno: 'svaki tjedan', mjesecno: 'svaki mjesec' }[t.repeat] || '') + '</b>' : '') + (c ? ' · Klijent: <button class="lnk" data-act="tk_client" data-id="' + esc(c.id) + '">' + esc(c.name) + '</button>' : '') + '</p>' +
      (t.descr ? '<p class="tkdescr">' + esc(t.descr).replace(/\n/g, '<br>') + '</p>' : '') + tl +
      '<h4>Bilješke</h4>' + notes +
      (t.doneAt ? '' : '<div class="tkassign"><label class="f inl">Dodijeli drugom korisniku<select id="tkAssignTo">' + S.users.filter((u) => u.active && u.id !== t.assigneeId).map((u) => '<option value="' + esc(u.id) + '">' + esc(u.name) + '</option>').join('') + '</select></label><button class="btn sm" data-act="tk_assign" data-id="' + esc(t.id) + '">Dodijeli</button></div>') +
      (t.doneAt ? '' : '<label class="f">Nova bilješka' + '<textarea id="tkNote" rows="3" maxlength="5000" placeholder="Što je napravljeno, dogovor s klijentom…"></textarea></label>') +
      '<div class="acts">' + (t.doneAt ? '<button class="btn" data-act="tk_reopen" data-id="' + esc(t.id) + '">Vrati u otvoreno</button>' :
        (can.take ? '<button class="btn primary" data-act="tk_take" data-id="' + esc(t.id) + '">Preuzmi zadatak</button>' : '') +
        '<button class="btn" data-act="tk_note" data-id="' + esc(t.id) + '">Spremi bilješku</button>' +
        '<button class="btn primary" data-act="tk_done" data-id="' + esc(t.id) + '">Završi zadatak</button>') +
      (can.del ? '<button class="btn danger" data-act="tk_del" data-id="' + esc(t.id) + '">Obriši</button>' : '') + '</div>' +
      (t.doneAt ? '' : '<p class="hint">Tekst u polju bilješke kod „Završi zadatak" sprema se kao završna bilješka.</p>'));
  }
  async function taskDetailAct(act, a) {
    const id = a.dataset.id; const note = $('tkNote') ? $('tkNote').value.trim() : '';
    if (act === 'tk_client') { toolClose(); openClient(id); return; }
    if (act === 'tk_assign') { const to = $('tkAssignTo') && $('tkAssignTo').value; if (!to) return; const ok2 = await safe(() => call('task_assign', { id, assignee_id: to }), 'Zadatak dodijeljen'); if (ok2) { await refresh(true); toolClose(); } return; }
    let ok;
    if (act === 'tk_take') ok = await safe(() => call('task_take', { id }), 'Zadatak preuzet');
    else if (act === 'tk_note') { if (note.length < 3) { toast('Upišite bilješku (barem 3 znaka).', true); return; } ok = await safe(() => call('task_note', { id, body: note }), 'Bilješka spremljena'); }
    else if (act === 'tk_done') ok = await safe(() => call('task_done', { id, done: true, body: note }), 'Zadatak završen');
    else if (act === 'tk_reopen') ok = await safe(() => call('task_done', { id, done: false }), 'Zadatak ponovno otvoren');
    else if (act === 'tk_del') { if (!confirm('Obrisati zadatak i sve njegove bilješke?')) return; ok = await safe(() => call('task_delete', { id }), 'Zadatak obrisan'); if (ok) { toolClose(); await refresh(true); return; } }
    if (ok) { await refresh(true); if (S.tasks.find((x) => x.id === id)) taskOpen(id); else toolClose(); }
  }

  /* ---------- prihod od kampanja ---------- */
  const MONTHS = ['siječanj', 'veljača', 'ožujak', 'travanj', 'svibanj', 'lipanj', 'srpanj', 'kolovoz', 'rujan', 'listopad', 'studeni', 'prosinac'];
  function revPeriods(kind, n) {
    const out = []; const now = new Date();
    if (kind === 'weekly') {
      const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      for (let i = 0; i < (n || 8); i++) { const s = new Date(d); s.setDate(d.getDate() - 7 * i); const e = new Date(s); e.setDate(s.getDate() + 6); out.push({ key: ymd(s), label: pad(s.getDate()) + '.' + pad(s.getMonth() + 1) + '. – ' + pad(e.getDate()) + '.' + pad(e.getMonth() + 1) + '.' }); }
    } else {
      for (let i = 0; i < (n || 6); i++) { const m = new Date(now.getFullYear(), now.getMonth() - i, 1); out.push({ key: m.getFullYear() + '-' + pad(m.getMonth() + 1), label: MONTHS[m.getMonth()] + ' ' + m.getFullYear() + '.' }); }
    }
    return out;
  }
  /* ---------- statistika po korisniku (Tijek prodaje): tekući tjedan u odnosu na prošli ---------- */
  const stageByLabel = Object.fromEntries(STAGES.map((s) => [s.label, s.id]));
  const fmtHM = (secs) => { const m = Math.round((secs || 0) / 60); return Math.floor(m / 60) + ' h ' + pad(m % 60) + ' min'; };
  const weekRange = (back) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7 * back); const e = new Date(d); e.setDate(d.getDate() + 7); return { from: ymd(d), to: ymd(e) }; };
  function loadUserStats(from, to, cb) {
    const key = from + '|' + to; S.ustats = S.ustats || {};
    const hit = S.ustats[key];
    if (hit && hit.data && Date.now() - hit.at < 60000) return hit.data;
    if (hit && hit.busy) return hit.data || null;
    S.ustats[key] = { busy: true, at: hit ? hit.at : 0, data: hit ? hit.data : null };
    call('user_stats&from=' + from + '&to=' + to, null, 'GET').then((r) => { S.ustats[key] = { data: r.users, at: Date.now() }; if (cb) cb(); }).catch(() => { S.ustats[key] = { data: null, at: Date.now() }; });
    return S.ustats[key].data;
  }
  function pipeCalc(f, t, users) {
    const stat = {}; users.forEach((u) => { stat[u.id] = { n: 0, mv: {}, wonV: 0 }; });
    S.clients.forEach((c) => { const o = ownerAt(c, c.createdAt); if (stat[o] && c.createdAt >= f && c.createdAt < t) stat[o].n++; });
    S.notes.forEach((n) => {
      if (n.type !== 'status' || n.createdAt < f || n.createdAt >= t) return;
      const c = byId(n.clientId); const ow = c && ownerAt(c, n.createdAt); if (!c || !stat[ow]) return;
      const mm = /→ ([^\n]+)/.exec(n.text || n.body || ''); const st = mm && stageByLabel[mm[1].trim()]; if (!st) return;
      stat[ow].mv[st] = (stat[ow].mv[st] || 0) + 1;
      if (st === 'dobiven') stat[ow].wonV += c.value || 0;
    });
    return stat;
  }
  function trend(cur, prev, fmt, lowerBetter) {
    const d = cur - prev; const f = fmt || String;
    if (d === 0) return cur === 0 ? '' : '<small class="tr eq">= kao prošli tjedan</small>';
    const good = lowerBetter ? d < 0 : d > 0;
    const pct = prev > 0 ? ' (' + (d > 0 ? '+' : '') + Math.round(d / prev * 100) + '%)' : '';
    return '<small class="tr ' + (good ? 'up' : 'down') + '">' + (d > 0 ? '▲ rast ' : '▼ pad ') + esc(f(Math.abs(d))) + esc(pct) + '</small>';
  }
  function pipeStats() {
    const w0 = weekRange(0), w1 = weekRange(1);
    const users = isAdmin() ? S.users.filter((u) => u.active || S.clients.some((c) => c.ownerId === u.id)) : S.users.filter((u) => u.id === S.me.id);
    const t = (x) => new Date(x + 'T00:00:00').getTime();
    const cur = pipeCalc(t(w0.from), t(w0.to), users), prv = pipeCalc(t(w1.from), t(w1.to), users);
    const redraw = () => { if (S.tab === 'pregled') renderOverview(); };
    const us0 = loadUserStats(w0.from, w0.to, redraw), us1 = loadUserStats(w1.from, w1.to, redraw);
    const ready = !!(us0 && us1);
    const ux = (arr, id) => (arr || []).find((x) => x.id === id) || { calls: 0, replies: 0, loginSecs: 0 };
    const cols = ['kontaktiran', 'ponuda', 'pregovori', 'aktivni', 'dobiven', 'izgubljen'];
    const mk = (u) => {
      const c = cur[u.id], p = prv[u.id], a = ux(us0, u.id), b = ux(us1, u.id);
      return { n: c.n, pn: p.n, calls: a.calls, pcalls: b.calls, rep: a.replies, prep: b.replies, login: a.loginSecs, plogin: b.loginSecs, mv: c.mv, pmv: p.mv, wonV: c.wonV };
    };
    const rowsD = users.map((u) => [u, mk(u)]);
    const tot = { n: 0, pn: 0, calls: 0, pcalls: 0, rep: 0, prep: 0, login: 0, plogin: 0, mv: {}, pmv: {}, wonV: 0 };
    rowsD.forEach(([, x]) => { ['n', 'pn', 'calls', 'pcalls', 'rep', 'prep', 'login', 'plogin', 'wonV'].forEach((k) => { tot[k] += x[k]; }); cols.forEach((k) => { tot.mv[k] = (tot.mv[k] || 0) + (x.mv[k] || 0); tot.pmv[k] = (tot.pmv[k] || 0) + (x.pmv[k] || 0); }); });
    const cell = (v, pv, fmt, lower) => '<td class="nums">' + (fmt ? fmt(v) : v) + '<br>' + trend(v, pv, fmt, lower) + '</td>';
    const dash = '<td class="nums muted">…</td>';
    const row = (name, x, b) => '<tr' + (b ? ' class="tot"' : '') + '><th>' + esc(name) + '</th>' + cell(x.n, x.pn) +
      (ready ? cell(x.calls, x.pcalls) + cell(x.rep, x.prep) + cell(x.login, x.plogin, fmtHM) : dash + dash + dash) +
      cols.map((k) => '<td class="nums">' + (x.mv[k] || 0) + (k === 'dobiven' && x.wonV ? ' <small>(' + eur(x.wonV) + ')</small>' : '') + '<br>' + trend(x.mv[k] || 0, x.pmv[k] || 0, null, k === 'izgubljen') + '</td>').join('') + '</tr>';
    const lab = (r) => fmtYmd(r.from) + ' – ' + fmtYmd(ymd(new Date(new Date(r.to + 'T12:00:00').getTime() - 864e5)));
    return '<div class="pstats"><div class="revbar"><h4>Statistika po korisniku</h4><span class="muted">tekući tjedan (' + esc(lab(w0)) + ') u odnosu na prošli tjedan (' + esc(lab(w1)) + ')</span></div>' +
      '<div class="tblwrap"><table class="rev"><thead><tr><th>Prodavač</th><th>Novi klijenti</th><th>Telefonski pozivi</th><th>Odgovoreni e-mailovi</th><th>Vrijeme u aplikaciji</th>' + cols.map((k) => '<th>' + esc(STAGE[k].label) + '</th>').join('') + '</tr></thead><tbody>' +
      rowsD.map(([u, x]) => row(u.name, x)).join('') + '</tbody>' + (isAdmin() && users.length > 1 ? '<tfoot>' + row('Ukupno', tot, true) + '</tfoot>' : '') + '</table></div>' +
      '<p class="muted pad small">Prikazan je tekući tjedan (od ponedjeljka do danas) i usporedba s cijelim prošlim tjednom. Statusi pokazuju koliko je klijenata prešlo u pojedini status; prodaja se računa prodavaču koji je vodio klijenta u trenutku promjene. Vrijeme u aplikaciji računa se dok je aplikacija otvorena i prijavljena. Ostalu statistiku za bilo koje razdoblje administrator bira u kartici Tim.</p></div>';
  }
  async function loadRevenue(force) {
    if (S.revBusy || (!force && S.revenue && Date.now() - S.revAt < 30000)) return;
    S.revBusy = true;
    try { S.revenue = await call('revenue', null, 'GET'); S.revAt = Date.now(); if (S.tab === 'pregled') renderRevenue(); } catch (e) { /* ignore */ } finally { S.revBusy = false; }
  }
  function renderRevenue() {
    const el = $('revPanel'); if (!el) return;
    const R = S.revenue; const kind = S.revPeriod; const adminAll = isAdmin();
    let h = '<header><h3>Prihod od kampanja</h3><span class="muted">' + (adminAll ? 'ukupni promet' + (S.revUser ? ': ' + esc(person(S.revUser)) : '') : 'vaše kampanje') + ' · po datumu početka kampanje</span></header>';
    h += '<div class="revbar"><div class="seg"><button class="' + (kind === 'weekly' ? 'on' : '') + '" data-act="revper" data-v="weekly">Tjedno</button><button class="' + (kind === 'monthly' ? 'on' : '') + '" data-act="revper" data-v="monthly">Mjesečno</button></div>' +
      (adminAll ? '<label class="f inl">Prodavač<select id="revUser"><option value="">Svi (ukupno)</option>' + S.users.filter((u) => u.active).map((u) => '<option value="' + esc(u.id) + '"' + (S.revUser === u.id ? ' selected' : '') + '>' + esc(u.name) + '</option>').join('') + '</select></label>' : '') + '</div>';
    if (!R) { el.innerHTML = h + '<p class="muted pad">Učitavanje…</p>'; return; }
    const data = (R[kind] || []).filter((x) => !S.revUser || x.u === S.revUser);
    const per = revPeriods(kind, S.revMore ? 12 : 4);
    const extra = Array.from(new Set(data.map((x) => x.s))).filter((s) => !SERVICES.includes(s));
    const cols = SERVICES.concat(extra);
    const sum = (f) => data.reduce((t, x) => t + (f(x) ? x.v : 0), 0);
    const totals = cols.map(() => 0); let grand = 0;
    h += '<div class="tblwrap"><table class="rev"><thead><tr><th>' + (kind === 'weekly' ? 'Tjedan' : 'Mjesec') + '</th>' + cols.map((c) => '<th>' + esc(c) + '</th>').join('') + '<th>Ukupno</th></tr></thead><tbody>' +
      per.map((p) => { const cells = cols.map((c, i) => { const v = sum((x) => x.p === p.key && x.s === c); totals[i] += v; return '<td class="nums">' + (v ? eur(v) : '–') + '</td>'; }); const rt = sum((x) => x.p === p.key); grand += rt; return '<tr><th>' + esc(p.label) + '</th>' + cells.join('') + '<td class="nums"><b>' + (rt ? eur(rt) : '–') + '</b></td></tr>'; }).join('') +
      '</tbody><tfoot><tr><th>Zbroj</th>' + totals.map((v) => '<td class="nums">' + (v ? eur(v) : '–') + '</td>').join('') + '<td class="nums"><b>' + eur(grand) + '</b></td></tr></tfoot></table></div>';
    if (adminAll && !S.revUser) {
      const owners = Array.from(new Set((R[kind] || []).map((x) => x.u)));
      if (owners.length) {
        const k0 = per[0].key, k1 = per[1].key, allk = per.map((p) => p.key);
        const osum = (o, f) => (R[kind] || []).reduce((t, x) => t + (x.u === o && f(x) ? x.v : 0), 0);
        h += '<div class="tblwrap"><table class="rev"><thead><tr><th>Po prodavaču</th><th>' + esc(per[0].label) + '</th><th>' + esc(per[1].label) + '</th><th>Zadnjih ' + per.length + '</th></tr></thead><tbody>' +
          owners.map((o) => '<tr><th>' + esc(o === '0' ? 'Bez prodavača' : person(o)) + '</th><td class="nums">' + eur(osum(o, (x) => x.p === k0)) + '</td><td class="nums">' + eur(osum(o, (x) => x.p === k1)) + '</td><td class="nums"><b>' + eur(osum(o, (x) => allk.includes(x.p))) + '</b></td></tr>').join('') + '</tbody></table></div>';
      }
    }
    h += '<div class="revmore"><button class="btn sm" data-act="revmore">' + (S.revMore ? 'Prikaži manje (zadnja 4 ' + (kind === 'weekly' ? 'tjedna' : 'mjeseca') + ')' : 'Prikaži više (zadnjih 12 ' + (kind === 'weekly' ? 'tjedana' : 'mjeseci') + ')') + '</button></div>';
    h += '<p class="muted pad small">Jednokratna kampanja se računa u tjedan/mjesec u kojem počinje; ugovor se u statistiku broji kao mjesečni iznos za svaki mjesec trajanja (u tjednom prikazu proporcionalno po tjednima), a ne kao ukupna vrijednost ugovora. Ako klijent ima više usluga, vrijednost se dijeli jednako među njima.</p>';
    el.innerHTML = h;
  }

  /* ---------- dnevnik promjena (admin) ---------- */
  const AUD = { create: 'novo', update: 'izmjena', delete: 'brisanje', status: 'status', campaign: 'kampanja', doc: 'dokument', backup: 'backup', task: 'zadatak', email: 'e-mail' };
  const auditLi = (e, withClient) => '<li><span class="when">' + esc(fmtTs(e.at)) + '</span><span class="who">' + esc(e.user) + '</span><span class="tag">' + esc(AUD[e.action] || e.action) + '</span><span class="what">' + (withClient && e.client ? (e.clientId && byId(e.clientId) ? '<button class="lnk" data-open="' + esc(e.clientId) + '">' + esc(e.client) + '</button>: ' : '<b>' + esc(e.client) + '</b>: ') : '') + esc(e.details) + '</span></li>';
  async function loadAudit() {
    if (!isAdmin() || S.auditBusy) return;
    S.auditBusy = true;
    try { const d = await call('audit_list&limit=150', null, 'GET'); S.audit = d.entries || []; if (S.tab === 'tim') renderAudit(); } catch (e) { /* ignore */ } finally { S.auditBusy = false; }
  }
  function renderAudit() {
    const el = $('auditPanel'); if (!el) return;
    const A = S.audit;
    el.innerHTML = '<header><h3>Dnevnik promjena</h3><span class="muted">tko je i kada mijenjao podatke · zadnjih 150</span></header>' +
      (!A ? '<p class="muted pad">Učitavanje…</p>' : A.length ? '<ul class="audit">' + A.map((e) => auditLi(e, true)).join('') + '</ul>' : '<p class="muted pad">Još nema zapisa.</p>');
  }
  async function loadClientAudit(id) {
    const key = id + ':' + S.rev; if (!isAdmin() || S.auditFor === key) return; S.auditFor = key;
    try { const d = await call('audit_list&limit=60&client_id=' + encodeURIComponent(id), null, 'GET'); const el = $('dAudit'); if (el && S.openId === id) el.innerHTML = d.entries.length ? d.entries.map((e) => auditLi(e, false)).join('') : '<li class="muted">Nema zapisa.</li>'; } catch (e) { S.auditFor = ''; }
  }

  /* lijevak Pregovori -> Ugovoreno */
  async function loadPipeline(force) {
    if (S.plBusy || (!force && S.pipeline && Date.now() - S.plAt < 30000)) return;
    S.plBusy = true;
    try { S.pipeline = await call('pipeline', null, 'GET'); S.plAt = Date.now(); if (S.tab === 'pregled') renderPipeline(); } catch (e) { /* ignore */ } finally { S.plBusy = false; }
  }
  function renderPipeline() {
    const el = $('plPanel'); if (!el) return;
    const P = S.pipeline;
    if (!P) { el.innerHTML = '<header><h3>Lijevak: Pregovori → Ugovoreno</h3></header><p class="muted pad">Učitavanje…</p>'; return; }
    const n = P.negotiating, c = P.contracted; const tot = (n.value + c.value) || 1;
    let h = '<header><h3>Lijevak: Pregovori → Ugovoreno</h3><span class="muted">' + (P.scope === 'all' ? 'svi prodavači' : 'vaši klijenti') + ' · vrijednosti klijenata</span></header><div class="pad">' +
      '<div class="funnel"><div class="fn neg" style="--w:' + Math.max(18, Math.round(n.value * 100 / tot)) + '%"><span>Pregovori</span><b>' + eur(n.value) + '</b><small>' + n.count + ' ' + plural(n.count, 'klijent', 'klijenata') + ' · u prosjeku ' + n.avgAgeDays + ' dana u pregovorima</small></div>' +
      '<div class="fn arrow" aria-hidden="true">↓ ' + esc(String(P.conversionCount)).replace('.', ',') + '% klijenata · ' + esc(String(P.conversionValue)).replace('.', ',') + '% vrijednosti</div>' +
      '<div class="fn con" style="--w:' + Math.max(18, Math.round(c.value * 100 / tot)) + '%"><span>Ugovoreno</span><b>' + eur(c.value) + '</b><small>' + c.count + ' ' + plural(c.count, 'klijent', 'klijenata') + (c.avgDaysToContract ? ' · od pregovora do ugovora prosječno ' + c.avgDaysToContract + ' dana' : '') + '</small></div></div>';
    if (P.scope === 'all') {
      const ids = Object.keys(P.byOwner);
      if (ids.length) h += '<div class="tblwrap"><table class="rev"><thead><tr><th>Prodavač</th><th>Pregovori (kom.)</th><th>Pregovori (€)</th><th>Ugovoreno (kom.)</th><th>Ugovoreno (€)</th></tr></thead><tbody>' +
        ids.map((id) => { const o = P.byOwner[id]; return '<tr><td class="l">' + esc(person(id)) + '</td><td>' + o.neg.n + '</td><td>' + eur(o.neg.v) + '</td><td>' + o.con.n + '</td><td>' + eur(o.con.v) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }
    if (P.recent.length) h += '<h4 style="margin:14px 0 6px">Zadnji ugovoreni</h4><ul class="list">' + P.recent.map((r) => '<li><button class="li" data-open="' + esc(r.id) + '"><span class="a"><b>' + esc(r.name) + '</b><small>' + eur(r.value) + ' · ' + (P.scope === 'all' ? esc(person(r.owner)) + ' · ' : '') + 'ugovoreno ' + esc(fmtDate(r.at)) + '</small></span><span class="b">' + r.days + ' ' + plural(r.days, 'dan', 'dana') + '</span></button></li>').join('') + '</ul>';
    el.innerHTML = h + '<p class="muted small">Trajanje se računa od prve bilješke s vrijednošću u pregovorima do prve bilješke s ugovorenom vrijednošću.</p></div>';
  }
  function renderOverview() {
    const root = $('v-pregled');
    if (!S.loaded) { root.innerHTML = loadingHtml(); return; }
    if (!S.clients.length) { root.innerHTML = emptyHtml() + (isAdmin() ? '<section class="panel-b" id="usagePanel" style="margin-top:16px"></section>' : ''); if (isAdmin()) { renderUsage(); loadUsage(); } return; }
    const mine = isAdmin() ? S.clients : S.clients.filter((c) => String(c.ownerId) === String(S.me.id)); // prodavač na Pregledu vidi samo svoje klijente
    const open = mine.filter(isOpen);
    const won = mine.filter((c) => c.status === 'dobiven');
    const due = open.filter(isDue).sort((a, b) => a.nextFollowUp.localeCompare(b.nextFollowUp));
    const stale = open.filter(isStale).sort((a, b) => lastTs(a) - lastTs(b));
    const rem = S.reminders.filter((r) => byId(r.clientId));
    const pend = S.scheduled.filter((x) => x.status === 'pending' || x.status === 'sending');
    let h = '';
    if (rem.length) {
      h += '<section class="panel-b"><header><h3>Čekaju odgovor</h3><span class="muted">klijenti koji nisu odgovorili na e-mail</span></header><ul class="list">' + rem.map((r) => {
        const c = byId(r.clientId);
        return '<li class="remrow"><button class="li" data-open="' + esc(c.id) + '"><span class="a"><b>' + esc(c.name) + '</b><small>' + esc(r.subject) + ' · poslano ' + esc(fmtDate(r.sentAt)) + '</small></span><span class="b stale">bez odgovora ' + r.days + ' ' + plural(r.days, 'dan', 'dana') + '</span></button>' +
          '<span class="acts"><button class="btn sm" data-act="remfollow" data-cid="' + esc(c.id) + '">Pošalji podsjetnik</button><button class="btn sm" data-act="remsnooze" data-id="' + esc(r.id) + '">Odgodi 2 dana</button><button class="btn sm" data-act="remdone" data-id="' + esc(r.id) + '">Odbaci</button></span></li>';
      }).join('') + '</ul></section>';
    }
    h += alertsPanel();
    h += tasksPanel();
    h += '<div class="strip">' +
      '<div><div class="k">Otvoreni klijenti</div><div class="v">' + open.length + '</div><div class="s">u radu, ' + eur(sumVal(open)) + '</div></div>' +
      '<div><div class="k">Javiti se danas</div><div class="v' + (due.length ? ' warn' : '') + '">' + due.length + '</div><div class="s">' + due.filter((c) => c.nextFollowUp < today()).length + ' kasni</div></div>' +
      '<div><div class="k">Bez nedavnog kontakta</div><div class="v' + (stale.length ? ' warn' : '') + '">' + stale.length + '</div><div class="s">' + STALE_DAYS + ' dana ili dulje</div></div>' +
      '<div><div class="k">Dobiveno</div><div class="v">' + won.length + '</div><div class="s">' + eur(sumVal(won)) + '</div></div></div>';
    if (isAdmin() && pend.length) h += '<p class="hint">Zakazano slanje: ' + pend.length + ' ' + plural(pend.length, 'poruka', 'poruka') + ' (Inbox > Zakazano slanje).</p>';
    h += '<section class="panel-b" id="goalPanel" hidden></section>';
    const ending = mine.filter(campSoon).sort((a, b) => a.campEnd.localeCompare(b.campEnd));
    if (ending.length) {
      h += '<section class="panel-b"><header><h3>Kampanje koje istječu za 7 dana</h3><span class="muted">ljubičasto: dnevne i kampanje kraće od 7 dana</span></header><ul class="list">' +
        ending.map((c) => campLi(c)).join('') + '</ul></section>';
    }
    h += '<div class="cols"><section class="panel-b"><header><h3>Za javiti se</h3><span class="muted">po datumu sljedećeg kontakta</span></header>';
    h += due.length ? '<ul class="list">' + due.slice(0, 8).map((c) => { const d = overdueDays(c); return rowLi(c, d > 0 ? 'kasni ' + d + ' ' + plural(d, 'dan', 'dana') : 'danas', d > 0 ? 'late' : ''); }).join('') + '</ul>' : '<div class="none">Nema klijenata za javiti se danas.</div>';
    h += '</section><section class="panel-b"><header><h3>Treba bilješku</h3><span class="muted">dugo bez upisa ili pošte</span></header>';
    h += stale.length ? '<ul class="list">' + stale.slice(0, 8).map((c) => { const t = lastTs(c); return rowLi(c, t ? 'zadnje ' + rel(t) : 'nema bilješki', 'stale'); }).join('') + '</ul>' : '<div class="none">Svi otvoreni klijenti imaju svježu bilješku.</div>';
    h += '</section></div>';
    const tot = S.clients.length;
    if (!isAdmin()) { root.innerHTML = h + '<section class="panel-b" id="plPanel"></section><section class="panel-b">' + pipeStats() + '</section>'; renderPipeline(); loadPipeline(); return; }
    h += '<section class="panel-b"><header><h3>Tijek prodaje</h3><span class="muted nums">' + tot + ' ' + plural(tot, 'klijent', 'klijenata') + '</span></header><div class="pipe"><div class="pipe-bar" role="img" aria-label="Raspodjela klijenata po statusu">' +
      STAGES.map((s) => { const n = S.clients.filter((c) => c.status === s.id).length; return n ? '<i style="flex:' + n + ';background:var(--s-' + s.id + ')" title="' + esc(s.label) + ': ' + n + '"></i>' : ''; }).join('') +
      '</div><div class="pipe-leg">' +
      STAGES.map((s) => { const a = S.clients.filter((c) => c.status === s.id); return '<div><span class="nm" style="--dot:var(--s-' + s.id + ')"><i></i>' + esc(s.label) + '</span><b>' + a.length + '</b><small class="nums">' + eur(sumVal(a)) + '</small></div>'; }).join('') +
      '</div></div>' + pipeStats() + '</section>';
    h += '<section class="panel-b" id="plPanel"></section><section class="panel-b" id="revPanel"></section>';
    if (isAdmin()) h += '<section class="panel-b" id="usagePanel"></section>';
    root.innerHTML = h;
    renderPipeline(); loadPipeline(); renderRevenue(); loadRevenue(); renderGoals(); loadGoals();
    if (isAdmin()) { renderUsage(); loadUsage(); }
  }

  const fmtTs = (ts) => { const d = new Date(ts); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '. ' + fmtTime(ts); };
  const hm = (ms) => { const m = Math.round((ms || 0) / 60000); return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min'; };
  const WD = ['ned', 'pon', 'uto', 'sri', 'čet', 'pet', 'sub'];
  async function loadUsage() {
    if (!isAdmin() || S.usageBusy) return;
    S.usageBusy = true;
    try { const d = await call('usage', null, 'GET'); S.usage = d.usage || []; if (S.tab === 'pregled') renderUsage(); } catch (e) { /* ignore */ } finally { S.usageBusy = false; }
  }
  function renderUsage() {
    const el = $('usagePanel'); if (!el) return;
    const U = S.usage || [];
    let h = '<header><h3>Korištenje aplikacije</h3><span class="muted">aktivno vrijeme prodavača · odjava nakon 15 min mirovanja</span></header>';
    if (!U.length) { el.innerHTML = h + '<p class="muted" style="padding:14px 16px">Nema prodavača.</p>'; return; }
    h += '<div class="usage">' + U.map((u) => {
      const max = Math.max.apply(null, u.days.map((d) => d.ms).concat([3600000]));
      return '<div class="urow"><div class="un"><b>' + esc(u.name) + '</b>' + (u.online ? ' <span class="chip ok">na mreži</span>' : '') +
        '<small>' + (u.lastLogin ? 'prijava ' + esc(fmtTs(u.lastLogin)) : 'još se nije prijavio/la') + '</small></div>' +
        '<div class="ut"><span>Danas</span><b class="nums">' + hm(u.todayMs) + '</b></div>' +
        '<div class="ut"><span>Ovaj tjedan</span><b class="nums">' + hm(u.weekMs) + '</b></div>' +
        '<div class="ubars" title="zadnjih 7 dana">' + u.days.map((d) => '<i style="height:' + Math.max(3, Math.round(d.ms / max * 34)) + 'px" title="' + esc(WD[new Date(d.d + 'T12:00:00').getDay()] + ' ' + d.d.slice(8) + '.' + d.d.slice(5, 7) + '.: ' + hm(d.ms)) + '"></i>').join('') + '</div></div>' +
        (u.logins.length ? '<details class="ulog"><summary>Zadnje prijave</summary><ul>' + u.logins.map((l) => '<li>' + esc(fmtTs(l.at)) + ' → ' + (l.end ? esc(fmtTs(l.end)) + (l.why === 'idle' ? ' (odjava zbog neaktivnosti)' : '') : (u.online && l === u.logins[0] ? 'u tijeku' : esc(fmtTs(l.seen)) + ' (zadnja aktivnost)')) + '</li>').join('') + '</ul></details>' : '');
    }).join('') + '</div>';
    el.innerHTML = h;
  }

  function campLi(c) {
    const short = campShort(c);
    return '<li class="' + (short ? 'short' : '') + '"><button class="li" data-open="' + esc(c.id) + '"><span class="a"><b>' + esc(c.name) + (short ? ' <span class="chip short">' + esc(lenTxt(c)) + '</span>' : '') + '</b><small>' + esc((c.service ? c.service + ' · ' : '') + fmtYmd(c.campStart) + ' – ' + fmtYmd(c.campEnd) + (c.campValue ? ' · ' + (c.campType === 'godisnji' ? 'ugovor ' + eur(c.campValue) + ' (' + eur(c.campValue / (c.campMonths || 12)) + '/mj. × ' + (c.campMonths || 12) + ')' : eur(c.campValue)) : '') + ' · ' + person(c.ownerId)) + '</small></span>' +
      '<span class="b ' + (short ? 'shortc' : (campSoon(c) ? 'soon' : '')) + '">' + esc(leftTxt(c)) + '</span></button></li>';
  }
  /* prihod ovaj mjesec u odnosu na prošli (iz izvještaja prihoda; prodavač vidi svoje) */
  function monthCmpHtml() {
    const R = S.revenue; if (!R) { loadRevenue(); return '<div><div class="k">Ovaj mjesec</div><div class="v">…</div><div class="s">učitavanje</div></div>'; }
    const d = new Date(); const cur = d.getFullYear() + '-' + pad(d.getMonth() + 1); const pv = new Date(d.getFullYear(), d.getMonth() - 1, 1); const prev = pv.getFullYear() + '-' + pad(pv.getMonth() + 1);
    const sum = (k) => (R.monthly || []).filter((x) => x.p === k).reduce((t, x) => t + x.v, 0);
    const a = sum(cur), b = sum(prev); const diff = a - b; const pct = b > 0 ? Math.round(diff * 100 / b) : null;
    return '<div><div class="k">Prihod ovaj mjesec</div><div class="v">' + eur(a) + '</div><div class="s">' + (b > 0 || a > 0 ? 'prošli mjesec ' + eur(b) + (pct !== null ? ' · <b class="' + (diff >= 0 ? 'up' : 'down') + '">' + (diff >= 0 ? '▲ +' : '▼ ') + pct + '%</b>' : '') : 'nema podataka') + '</div></div>';
  }
  function renderActive() {
    const root = $('v-aktivni');
    if (!S.loaded) { root.innerHTML = loadingHtml(); return; }
    const act = S.clients.filter(campActive).sort((a, b) => a.campEnd.localeCompare(b.campEnd));
    const gone = S.clients.filter((c) => c.campActive && c.campEnd && c.campEnd < today()).sort((a, b) => b.campEnd.localeCompare(a.campEnd));
    const shortN = act.filter(campShort).length, soonN = act.filter(campSoon).length;
    let h = '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><h2>Aktivni klijenti</h2><span class="muted">kampanje i klijenti sa statusom Aktivni</span></div>' +
      '<div class="strip"><div><div class="k">Aktivne kampanje</div><div class="v">' + act.length + '</div><div class="s">trenutno traju</div></div>' +
      '<div><div class="k">Istječu za 7 dana</div><div class="v' + (soonN ? ' warn' : '') + '">' + soonN + '</div><div class="s">uključujući danas</div></div>' +
      '<div><div class="k">Kraće od 7 dana</div><div class="v">' + shortN + '</div><div class="s">dnevne i kratke (ljubičasto)</div></div>' +
      '<div><div class="k">Vrijednost kampanja</div><div class="v">' + eur(act.reduce((t, c) => t + (c.campValue || 0), 0)) + '</div><div class="s">aktivne kampanje i ugovori (ukupno)</div></div>' +
      '<div><div class="k">Mjesečni iznos ugovora</div><div class="v">' + eur(act.filter((c) => c.campType === 'godisnji').reduce((t, c) => t + (c.campValue || 0) / (c.campMonths || 12), 0)) + '</div><div class="s">zbroj mjesečnih iznosa aktivnih ugovora</div></div>' + monthCmpHtml() + '</div>';
    h += '<section class="panel-b"><header><h3>Aktivne kampanje</h3><span class="muted">po datumu završetka</span></header>' +
      (act.length ? '<ul class="list">' + act.map((c) => campLi(c)).join('') + '</ul>' : '<div class="none">Nema aktivnih kampanja. U kartici klijenta označite "Aktivni" i odaberite datum do kada kampanja traje.</div>') + '</section>';
    if (gone.length) h += '<section class="panel-b"><header><h3>Istekle kampanje</h3><span class="muted">završile su; otvorite klijenta i upišite novu kampanju (termin i vrijednost)</span></header><ul class="list">' +
      gone.map((c) => '<li><button class="li" data-open="' + esc(c.id) + '"><span class="a"><b>' + esc(c.name) + '</b><small>' + esc(fmtYmd(c.campStart) + ' – ' + fmtYmd(c.campEnd) + (c.campValue ? ' · ' + eur(c.campValue) : '')) + '</small></span><span class="b late">upišite novu kampanju</span></button></li>').join('') + '</ul></section>';
    const nocamp = S.clients.filter((c) => c.status === 'aktivni' && !campActive(c) && !extraCamps(c).length).sort((a, b) => a.name.localeCompare(b.name, 'hr'));
    h += '<section class="panel-b"><header><h3>Aktivni klijenti bez aktivne kampanje</h3><span class="muted">' + nocamp.length + '</span></header>' +
      (nocamp.length ? '<ul class="list">' + nocamp.map((c) => '<li><button class="li" data-open="' + esc(c.id) + '"><span class="a"><b>' + esc(c.name) + '</b><small>' + esc((c.service ? c.service + ' · ' : '') + person(c.ownerId)) + '</small></span><span class="b">bez kampanje</span></button></li>').join('') + '</ul>' : '<div class="none">Nema aktivnih klijenata bez kampanje.</div>') + '</section>';
    root.innerHTML = h;
  }

  /* ---------- clients ---------- */
  function fillSelect(sel, opts, value) {
    sel.innerHTML = opts.map((o) => '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>').join('');
    sel.value = value;
    if (sel.value !== value && sel.options.length) sel.selectedIndex = 0;
  }
  function ownerOptions(first) {
    const a = first ? [first] : [];
    S.users.filter((u) => u.active || S.clients.some((c) => c.ownerId === u.id)).forEach((u) => a.push([u.id, u.name + (u.id === S.me.id ? ' (ja)' : '')]));
    return a;
  }
  function industryList() {
    const m = new Map();
    (S.clients || []).forEach((c) => { const v = (c.industry || '').trim(); if (v && !m.has(v.toLowerCase())) m.set(v.toLowerCase(), v); });
    return Array.from(m.values()).sort((a, b) => a.localeCompare(b, 'hr'));
  }
  function filteredClients() {
    let a = S.clients.slice(); const q = S.q.trim().toLowerCase();
    if (q) a = a.filter((c) => [c.name, c.contact, c.email, c.email2, c.phone, c.service, c.oib, c.industry, c.address].some((v) => (v || '').toLowerCase().includes(q)) || (S.fNotes && (S.byClient.get(c.id) || []).some((n) => (n.text || '').toLowerCase().includes(q))));
    if (S.fVK) a = a.filter((c) => (S.fVK === 'none' ? !c.value : (c.value > 0 && (c.valueKind === 'ugovoreno' ? 'ugovoreno' : 'ponudeno') === S.fVK)));
    if (S.fVMin !== '') a = a.filter((c) => (c.value || 0) >= Number(S.fVMin));
    if (S.fVMax !== '') a = a.filter((c) => (c.value || 0) <= Number(S.fVMax));
    if (S.fStatus) a = a.filter((c) => c.status === S.fStatus);
    if (S.fOwner) a = a.filter((c) => c.ownerId === S.fOwner);
    if (S.fKind) a = a.filter((c) => (c.kind || 'tvrtka') === S.fKind);
    if (S.fIndustry) a = a.filter((c) => (S.fIndustry === '__none' ? !c.industry : (c.industry || '').toLowerCase() === S.fIndustry.toLowerCase()));
    a.sort((x, y) => {
      if (S.sort === 'name') return (x.name || '').localeCompare(y.name || '', 'hr');
      if (S.sort === 'value') return (y.value || 0) - (x.value || 0);
      if (S.sort === 'follow') return (x.nextFollowUp || '9999').localeCompare(y.nextFollowUp || '9999');
      return Math.max(lastTs(y), y.updatedAt || 0) - Math.max(lastTs(x), x.updatedAt || 0);
    });
    return a;
  }
  function renderClients() {
    clientTools();
    fillSelect($('fStatus'), [['', 'Svi statusi']].concat(STAGES.map((s) => [s.id, s.label])), S.fStatus);
    fillSelect($('fOwner'), ownerOptions(['', 'Svi prodavači']), S.fOwner);
    const inds = industryList();
    if (S.fIndustry && S.fIndustry !== '__none' && !inds.some((x) => x.toLowerCase() === S.fIndustry.toLowerCase())) S.fIndustry = '';
    fillSelect($('fIndustry'), [['', 'Sve djelatnosti'], ['__none', '(bez djelatnosti)']].concat(inds.map((x) => [x, x])), S.fIndustry);
    $('industryList').innerHTML = inds.map((x) => '<option value="' + esc(x) + '"></option>').join('');
    const box = $('clist');
    if (!S.loaded) { box.innerHTML = '<div class="cnone">Učitavanje…</div>'; return; }
    if (!S.clients.length) { box.innerHTML = emptyHtml(); $('fCount').textContent = ''; return; }
    const a = filteredClients();
    $('fCount').textContent = a.length + ' od ' + S.clients.length;
    let h = (S.pool ? '<div class="poolbar"><span><b>' + S.pool.toLocaleString('hr-HR') + '</b> izgubljenih klijenata bez prodavača nalazi se u arhivi (ne učitavaju se u popis radi brzine).</span><button class="btn sm" data-act="poolopen">Otvori arhivu</button></div>' : '') + '<div class="chead" aria-hidden="true"><span>Klijent</span><span>Usluga</span><span>Status</span><span style="text-align:right">Vrijednost</span><span>Prodavač</span><span>Zadnji kontakt</span><span>Javiti se</span></div>';
    if (!a.length) h += '<div class="cnone">Nijedan klijent ne odgovara filtrima.</div>';
    h += a.map((c) => {
      const t = lastTs(c); const st = isStale(c); const du = isDue(c);
      return '<button class="crow st-' + esc(c.status) + '" data-open="' + esc(c.id) + '">' +
        '<span class="c-main"><b>' + esc(c.name) + (campActive(c) ? ' <span class="chip ' + (campShort(c) ? 'short' : 'camp') + '">' + (c.campType === 'godisnji' ? 'ugovor do ' : 'kampanja do ') + esc(fmtYmd(c.campEnd)) + '</span>' : '') + (c.hasContract ? ' <span class="chip ' + (c.contractEnd && c.contractEnd < today() ? 'short' : 'camp') + '">ugovor' + (c.contractEnd ? ' do ' + esc(fmtYmd(c.contractEnd)) : '') + '</span>' : '') + '</b><small>' + (c.kind === 'osoba' ? 'fizička osoba' : esc(c.contact)) + (c.industry ? ' · ' + esc(c.industry) : '') + '</small></span>' +
        '<span class="c-svc">' + esc(c.service) + '</span><span class="c-st">' + pill(c.status) + '</span>' +
        '<span class="c-val">' + (c.value ? eur(c.value) + '<small>' + (c.valueKind === 'ugovoreno' ? 'ugovoreno' : 'pregovori') + '</small>' : '') + '</span><span class="c-own">' + esc(person(c.ownerId)) + '</span>' +
        '<span class="c-note' + (st ? ' flag-stale' : '') + '" data-l="Zadnji kontakt:">' + esc(t ? rel(t) : 'nema bilješki') + '</span>' +
        '<span class="c-next' + (du ? ' flag-late' : '') + '" data-l="Javiti se:">' + (c.nextFollowUp ? fmtYmd(c.nextFollowUp) + (c.nextFollowTime ? ' ' + esc(c.nextFollowTime) : '') : '–') + '</span></button>';
    }).join('');
    box.innerHTML = h;
  }

  /* ---------- inbox ---------- */
  function filteredEmails() {
    let a = S.emails.slice(); const q = S.iq.trim().toLowerCase();
    if (q) a = a.filter((e) => [e.fromName, e.fromEmail, e.to, e.subject, e.preview].some((v) => (v || '').toLowerCase().includes(q)));
    if (S.iFilter === 'sched') return [];
    if (S.iFilter === 'all') a = a.filter((e) => e.dir === 'in'); // Sve poruke = samo primljene (poslane su pod Poslano)
    else if (S.iFilter === 'unread') a = a.filter((e) => e.dir === 'in' && !e.read);
    else if (S.iFilter === 'in') a = a.filter((e) => e.dir === 'in');
    else if (S.iFilter === 'out') a = a.filter((e) => e.dir === 'out');
    else if (S.iFilter === 'box2') a = a.filter((e) => e.box === 2 && e.dir === 'in');
    else if (S.iFilter === 'box1') a = a.filter((e) => e.box !== 2 && e.dir === 'in');
    else if (S.iFilter === 'nolink') a = a.filter((e) => !e.clientId);
    return a;
  }
  function renderScheduled(box) {
    const a = S.scheduled.slice().sort((x, y) => x.sendAt - y.sendAt);
    if (!a.length) { box.innerHTML = '<div class="cnone">Nema zakazanih poruka.</div>'; return; }
    box.innerHTML = a.map((x) => {
      const c = byId(x.clientId); const mine = isAdmin() || x.userId === S.me.id;
      const st = x.status === 'failed' ? '<span class="chip bad">nije poslano</span>' : (x.status === 'awaiting' ? '<span class="chip warn">čeka odobrenje</span>' : x.status === 'sending' ? '<span class="chip">šalje se</span>' : '<span class="chip">zakazano</span>');
      return '<div class="mrow sched"><span class="dot"></span><span class="m-body"><span class="m-from">Za: ' + esc(x.to) + (c ? ' · ' + esc(c.name) : '') + '</span><span class="m-subj">' + esc(x.subject) + '</span>' +
        '<span class="m-prev">' + esc(person(x.userId)) + (x.error ? ' · ' + esc(x.error) : '') + '</span></span>' +
        '<span class="m-meta"><span class="nums">' + fmtDate(x.sendAt) + ' ' + fmtTime(x.sendAt) + '</span>' + st + (mine && x.status !== 'sending' ? '<button class="btn sm" data-act="schedcancel" data-id="' + esc(x.id) + '">Otkaži</button>' : '') + '</span></div>';
    }).join('');
  }
  function renderInbox() {
    const box = $('ilist');
    $('btnSync').disabled = !S.mail.imap || S.syncing;
    $('btnSync').textContent = S.syncing ? 'Osvježavam…' : 'Osvježi poštu';
    $('optBox2').hidden = !S.mail.imap2; $('optBox1').hidden = !S.mail.imap2;
    $('syncInfo').textContent = S.mail.imap ? 'Zadnje osvježeno: ' + minAgo(S.mail.lastSync) : 'Primanje pošte nije podešeno.';
    if (!S.loaded) { box.innerHTML = '<div class="cnone">Učitavanje…</div>'; return; }
    if (S.iFilter === 'sched') { renderScheduled(box); return; }
    const a = filteredEmails();
    if (!a.length) {
      box.innerHTML = '<div class="cnone">' + (S.emails.length ? 'Nijedna poruka ne odgovara filtru.' : (S.mail.imap ? 'Sandučić je prazan ili se još nije osvježio.' : 'Još nema poruka. Poslane poruke pojavit će se ovdje.')) + '</div>';
      return;
    }
    box.innerHTML = a.map((e) => {
      const c = e.clientId ? byId(e.clientId) : null;
      const who = e.dir === 'in' ? (e.fromName || e.fromEmail || '(nepoznato)') : 'Za: ' + e.to;
      const unread = e.dir === 'in' && !e.read;
      const rb = e.dir === 'in' && e.repliedBy ? person(e.repliedBy) : '';
      return '<button class="mrow' + (unread ? ' unread' : '') + (rb ? ' replied' : '') + '" data-mail="' + esc(e.id) + '"><span class="dot"></span>' +
        '<span class="m-body"><span class="m-from">' + esc(who) + '</span>' + (e.dir === 'in' && e.to ? '<span class="m-to">Primljeno na: ' + esc(e.to) + '</span>' : '') + '<span class="m-subj">' + esc(e.subject || '(bez predmeta)') + (e.att ? ' · privitak' : '') + '</span><span class="m-prev">' + esc(e.preview) + '</span></span>' +
        '<span class="m-meta"><span class="nums">' + shortDate(e.date) + '</span><span class="m-del" role="button" tabindex="0" data-mdel="' + esc(e.id) + '" title="Obriši poruku" aria-label="Obriši poruku"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg><b>Obriši</b></span>' + (c ? '<span class="chip">' + esc(c.name) + '</span>' : (e.dir === 'out' ? '<span class="chip out">poslano</span>' : '')) + (rb ? '<span class="chip replied" title="Odgovor je poslan ' + esc(fmtTs(e.repliedAt)) + '">Odgovorio/la: ' + esc(rb) + '</span>' : '') + (e.auto ? '<span class="chip out">automatski</span>' : '') + (e.box === 2 ? '<span class="chip">Inbox 2</span>' : (e.dir === 'in' && S.mail.imap2 ? '<span class="chip">Inbox 1</span>' : '')) + '</span></button>';
    }).join('');
  }
  async function syncInbox(force, quiet) {
    if (!S.mail.imap || S.syncing) return;
    S.syncing = true; renderInbox();
    try {
      const r = await call('inbox_sync', { force: !!force });
      if (r.ok === false) { if (!quiet || force) toast(r.error || 'Osvježavanje pošte nije uspjelo.', true); }
      else if (force) toast(r.new ? 'Nove poruke: ' + r.new : 'Nema novih poruka.');
    } catch (e) { if (!quiet || force) toast(e.message, true); }
    S.syncing = false;
    await refresh(true);
    if (S.tab === 'inbox') renderInbox();
  }

  /* ---------- mail reader ---------- */
  async function openMailItem(id) {
    S.lastFocus = document.activeElement; S.openMailId = id; S.rFiles = [];
    const sh = $('rSheet');
    sh.innerHTML = '<div class="sh-h"><h2 id="rSubject">Učitavanje…</h2><button class="x" data-act="close" aria-label="Zatvori">×</button></div>';
    $('mdrawer').hidden = false; document.body.classList.add('lock');
    let e;
    try { e = (await call('email_open', { id })).email; } catch (err) { toast(err.message, true); closeTop(); return; }
    const local = S.emails.find((x) => x.id === id); if (local) local.read = true;
    renderTabs(); if (S.tab === 'inbox') renderInbox();
    const c = e.clientId ? byId(e.clientId) : null;
    const incoming = e.dir === 'in';
    let h = '<div class="sh-h"><div><h2 id="rSubject">' + esc(e.subject || '(bez predmeta)') + '</h2><div class="sub"><span>' + esc(incoming ? 'Primljeno' : 'Poslano') + (e.box === 2 ? ' · Inbox 2' : (incoming && S.mail.imap2 ? ' · Inbox 1' : '')) + '</span><span class="nums">' + fmtDate(e.date) + ' ' + fmtTime(e.date) + '</span></div></div><button class="x" data-act="close" aria-label="Zatvori">×</button></div><div class="sh-b">';
    h += '<dl class="meta-grid"><dt>Od</dt><dd>' + esc((e.fromName ? e.fromName + ' ' : '') + '<' + e.fromEmail + '>') + '</dd><dt>' + (incoming ? 'Primljeno na' : 'Za') + '</dt><dd>' + esc(e.to) + '</dd>' +
      (e.att ? '<dt>Privitak</dt><dd>' + ((e.docs && e.docs.length) ? e.docs.map((d) => '<a class="doclink" href="api.php?a=doc_download&id=' + encodeURIComponent(d.id) + '">' + esc(d.name) + '</a> <span class="hint">' + esc(fmtSize(d.size)) + '</span>').join('<br>') : esc(e.att) + ' <span class="hint">(datoteka nije spremljena, vidi se u webmailu)</span>') + '</dd>' : '') + '</dl>';
    h += '<div class="sec"><h3>Klijent</h3>';
    if (c) {
      h += '<div class="acts"><span class="chip">' + esc(c.name) + '</span><button class="btn sm" data-open="' + esc(c.id) + '" data-keep="1">Otvori klijenta</button><button class="btn sm" data-act="unlink" data-id="' + esc(e.id) + '">Odvoji</button></div>';
    } else {
      h += '<div class="acts"><label class="f">Poveži s klijentom<select id="rLink"><option value="">Odaberite klijenta</option>' + S.clients.slice().sort((a, b) => a.name.localeCompare(b.name, 'hr')).map((x) => '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>').join('') + '</select></label>' +
        '<button class="btn" data-act="link" data-id="' + esc(e.id) + '">Poveži</button>' + (incoming ? '<button class="btn primary" data-act="mkclient" data-id="' + esc(e.id) + '">+ Upiši novog klijenta</button>' : '') + '</div>' +
        '<p class="hint">Povezivanje i upis klijenta nisu obavezni: odgovor možete poslati i bez klijenta (polje Odgovor niže). Novi klijent se upisuje iz podataka pošiljatelja.</p>';
    }
    h += '</div><div class="sec"><h3>Poruka</h3><div class="mailbody">' + esc(e.body) + '</div><div class="acts" style="margin-top:10px"><button class="btn sm danger" data-act="maildel" data-id="' + esc(e.id) + '">Obriši poruku</button><span class="hint">Briše poruku iz aplikacije (ne i sa poslužitelja e-pošte).</span></div></div>';
    {
      const target = incoming ? (e.replyTo || e.fromEmail) : e.to;
      h += '<div class="sec"><h3>' + 'Odgovor' + '</h3><div class="compose">' + replyQuick() + replyTplSelect() + '<textarea id="rBody" placeholder="Upišite odgovor. Citat izvorne poruke dodaje se automatski."></textarea><div class="rattach"><label class="btn sm filebtn"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l9-9a3.7 3.7 0 015.2 5.2l-9 9a1.8 1.8 0 01-2.6-2.6l8.4-8.4"/></svg> Dodaj privitak<input type="file" id="rFile" multiple hidden></label><span class="hint">najviše 10 datoteka, ukupno 15 MB</span></div><ul class="rfiles" id="rFiles"></ul><div class="foot"><span class="msg" id="rMsg" role="alert"></span><button class="btn primary" data-act="reply" data-id="' + esc(e.id) + '">Pošalji odgovor</button></div></div>' +
        '<div class="rsavetpl"><button class="btn sm" data-act="rtplshow" type="button">★ Spremi kao predložak</button><span id="rTplRow" hidden><input id="rTplName" maxlength="120" placeholder="Naziv predloška"> <button class="btn sm primary" data-act="rtplsave" type="button">Spremi</button></span></div>' +
        '<p class="hint">Odgovor odlazi s adrese ' + esc(e.box === 2 && S.mail.from2 ? S.mail.from2 : S.mail.from) + ' (sandučić na koji je poruka stigla) na ' + esc(target) + '. Dodaje se Vaš potpis.</p></div>';
    }
    h += '</div>';
    sh.innerHTML = h;
  }
  /* brzi odgovori: jedan klik ubacuje gotov tekst */
  function replyQuick() {
    const tpls = S.templates.filter((t) => t.kind !== 'akcija').slice(0, 8);
    if (!tpls.length) return '';
    return '<div class="quick" role="group" aria-label="Brzi odgovori"><span class="muted small">Brzi odgovori:</span>' + tpls.map((t) => '<button class="chipbtn" type="button" data-act="rquick" data-id="' + esc(t.id) + '" title="' + esc(t.subject) + '">⚡ ' + esc(t.name) + '</button>').join('') + '</div>';
  }
  function replyInsert(id) { const sel = $('rTpl'); if (sel) { sel.value = id; } else { return; } replyApplyTpl(); }
  async function replySaveTpl() {
    const ta = $('rBody'); const body = ta ? ta.value.trim() : ''; const name = $('rTplName') ? $('rTplName').value.trim() : '';
    if (body.length < 10) { toast('Najprije upišite tekst odgovora koji želite spremiti.', true); return; }
    if (name.length < 2) { toast('Upišite naziv predloška.', true); $('rTplName').focus(); return; }
    const e = S.emails.find((x) => x.id === S.openMailId) || {};
    const ok = await safe(() => call('template_quick', { name, body, subject: e.subject ? 'Re: ' + e.subject.replace(/^(re:\s*)+/i, '') : '' }), 'Predložak spremljen');
    if (ok) { $('rTplRow').hidden = true; $('rTplName').value = ''; await refresh(true); }
  }
  function replyTplSelect() {
    const tpls = S.templates.filter((t) => t.kind !== 'akcija');
    if (!tpls.length) return '';
    return '<label class="f">Predložak odgovora<select id="rTpl"><option value="">Umetni gotov tekst…</option>' + tpls.map((t) => '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>').join('') + '</select></label>';
  }
  function replyApplyTpl() {
    const t = S.templates.find((x) => x.id === $('rTpl').value); if (!t) return;
    const e = S.emails.find((x) => x.id === S.openMailId) || {};
    const c = (e.clientId && byId(e.clientId)) || { contact: (e.fromName || '').trim(), name: '', service: '' };
    const body = fillTpl(t, c).body; const ta = $('rBody');
    ta.value = ta.value.trim() ? ta.value.trim() + '\n\n' + body : body;
    $('rTpl').value = ''; ta.focus();
  }
  async function deleteMail(id, fromList) {
    const em = S.emails.find((x) => x.id === id);
    if (!(await confirmBox('Obrisati poruku?', (em ? '<b>' + esc(em.subject || '(bez predmeta)') + '</b><br><small>' + esc(em.dir === 'in' ? (em.fromName || em.fromEmail || '') : 'Za: ' + em.to) + '</small><br><br>' : '') + 'Poruka će biti obrisana iz aplikacije i premještena u smeće na poslužitelju. Radnja se ne može poništiti.', 'Da, obriši'))) return;
    let srv = '';
    const ok = await safe(async () => { const r = await call('email_delete', { id }); srv = r.server || ''; return r; }, '');
    if (ok) { toast(srv === 'moved' ? 'Poruka obrisana i premještena u smeće na poslužitelju' : (srv === 'error' ? 'Poruka obrisana u aplikaciji, ali premještanje u smeće na poslužitelju nije uspjelo' : (srv === 'notfound' ? 'Poruka obrisana (na poslužitelju nije pronađena)' : 'Poruka obrisana')), srv === 'error'); S.emails = S.emails.filter((x) => x.id !== id); if (fromList) renderInbox(); else closeTop(); await refresh(true); }
  }
  async function sendReply(id) {
    const ta = $('rBody'); const body = ta.value.trim();
    if (body.length < 2) { $('rMsg').textContent = 'Upišite tekst odgovora.'; ta.focus(); return; }
    $('rMsg').textContent = '';
    const files = S.rFiles || [];
    if (files.reduce((s, f) => s + f.size, 0) > 15 * 1024 * 1024) { $('rMsg').textContent = 'Privici zajedno smiju imati najviše 15 MB.'; return; }
    if (files.length > 10) { $('rMsg').textContent = 'Najviše 10 privitaka po poruci.'; return; }
    const ok = await safe(async () => {
      if (!files.length) return call('email_reply', { email_id: id, body });
      const fd = new FormData(); fd.append('data', JSON.stringify({ email_id: id, body })); files.forEach((f) => fd.append('files[]', f, f.name));
      const res = await fetch('api.php?a=email_reply', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF': S.csrf }, body: fd });
      let d = null; try { d = await res.json(); } catch (e) { /* ignore */ }
      if (!res.ok) throw new Error((d && d.error) || 'Slanje nije uspjelo.');
      return d;
    }, 'Odgovor poslan');
    if (ok) { S.rFiles = []; closeTop(); refresh(true); }
  }
  function renderReplyFiles() {
    const ul = $('rFiles'); if (!ul) return;
    const fs = S.rFiles || [];
    ul.innerHTML = fs.map((f, i) => '<li><span>' + esc(f.name) + ' <small>' + (f.size >= 1048576 ? (f.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(f.size / 1024)) + ' KB') + '</small></span><button type="button" class="x" data-act="rfdel" data-i="' + i + '" aria-label="Ukloni privitak">×</button></li>').join('');
  }

  /* ---------- team ---------- */
  /* razdoblje u kartici Tim: brzi odabiri ili ručno od–do (samo datumi) */
  function teamRange() {
    const today0 = new Date(); today0.setHours(12, 0, 0, 0);
    const p = S.period; let from, to; // to = zadnji dan uključivo
    if (p === 'custom' && S.tmFrom && S.tmTo && S.tmFrom <= S.tmTo) { from = S.tmFrom; to = S.tmTo; }
    else if (p === 'week') { const r = weekRange(0); from = r.from; to = ymd(today0); }
    else if (p === 'lastweek') { const r = weekRange(1); from = r.from; to = ymd(new Date(new Date(r.to + 'T12:00:00').getTime() - 864e5)); }
    else if (p === 'month') { from = ymd(new Date(today0.getFullYear(), today0.getMonth(), 1, 12)); to = ymd(today0); }
    else if (p === 'lastmonth') { from = ymd(new Date(today0.getFullYear(), today0.getMonth() - 1, 1, 12)); to = ymd(new Date(today0.getFullYear(), today0.getMonth(), 0, 12)); }
    else if (p === 'all') { from = '2020-01-01'; to = ymd(today0); }
    else { const n = Number(p) || 7; from = ymd(new Date(today0.getTime() - (n - 1) * 864e5)); to = ymd(today0); }
    const next = ymd(new Date(new Date(to + 'T12:00:00').getTime() + 864e5));
    return { from, to, next, f: new Date(from + 'T00:00:00').getTime(), t: new Date(next + 'T00:00:00').getTime() };
  }
  function renderTeam() {
    const root = $('v-tim');
    if (!S.loaded) { root.innerHTML = loadingHtml(); return; }
    const R = teamRange(); const cut = R.f, cutTo = R.t;
    const us = loadUserStats(R.from, R.next, () => { if (S.tab === 'tim') renderTeam(); });
    const ux = (id) => ((us || []).find((x) => x.id === id)) || { replies: 0, loginSecs: 0 };
    const rows = S.users.filter((u) => u.active || S.notes.some((n) => n.authorId === u.id)).map((u) => {
      const mine = S.notes.filter((n) => n.authorId === u.id && n.createdAt >= cut && n.createdAt < cutTo);
      const cnt = (t) => mine.filter((n) => n.type === t).length;
      const own = S.clients.filter((c) => c.ownerId === u.id);
      const open = own.filter(isOpen);
      const won = own.filter((c) => c.status === 'dobiven' && (c.wonAt || c.createdAt) >= cut && (c.wonAt || c.createdAt) < cutTo);
      return { id: u.id, total: mine.length, notes: mine.filter((n) => n.type === 'note' || n.type === 'status').length, calls: cnt('call'), meet: cnt('meeting'), mail: cnt('email'), rep: ux(u.id).replies, login: ux(u.id).loginSecs,
        open: open.length, pipe: sumVal(open), won: won.length, wonV: sumVal(won), stale: open.filter(isStale).length };
    }).sort((a, b) => b.total - a.total);
    const max = Math.max(1, ...rows.map((r) => r.total));
    const P = [['7', 'Zadnjih 7 dana'], ['30', 'Zadnjih 30 dana'], ['week', 'Ovaj tjedan'], ['lastweek', 'Prošli tjedan'], ['month', 'Ovaj mjesec'], ['lastmonth', 'Prošli mjesec'], ['all', 'Sve']];
    let h = '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><h2>Rad prodavača</h2><div class="seg" role="group" aria-label="Razdoblje">' +
      P.map((p) => '<button data-period="' + p[0] + '" aria-pressed="' + (S.period === p[0]) + '">' + p[1] + '</button>').join('') + '</div></div>';
    h += '<div class="revbar"><label class="f inl">Od<input type="date" id="tmFrom" value="' + esc(S.tmFrom || R.from) + '"></label><label class="f inl">Do<input type="date" id="tmTo" value="' + esc(S.tmTo || R.to) + '"></label>' +
      '<button class="btn sm" data-act="tmapply">Prikaži razdoblje</button><span class="muted">Prikazano: ' + (S.period === 'all' ? 'sve' : esc(fmtYmd(R.from) + ' – ' + fmtYmd(R.to))) + '</span></div>';
    h += '<section class="panel-b"><div class="tscroll"><table class="tbl"><thead><tr><th>Prodavač</th><th>Aktivnosti</th><th>Bilješke</th><th>Pozivi</th><th>Sastanci</th><th>E-mailovi</th><th>Odgovoreni e-mailovi</th><th>Vrijeme u aplikaciji</th><th>Otvoreni</th><th>Dobiveno</th><th>Bez kontakta</th></tr></thead><tbody>';
    h += rows.map((r) => '<tr><td><span class="who"><i style="background:' + hue(r.id) + '"></i>' + esc(person(r.id)) + (r.id === S.me.id ? ' <span class="muted" style="font-weight:400">(ja)</span>' : '') + '</span></td>' +
      '<td>' + r.total + '<span class="mini"><i style="width:' + Math.round(r.total / max * 100) + '%"></i></span></td><td>' + r.notes + '</td><td>' + r.calls + '</td><td>' + r.meet + '</td><td>' + r.mail + '</td>' +
      '<td>' + (us ? r.rep : '…') + '</td><td>' + (us ? esc(fmtHM(r.login)) : '…') + '</td>' +
      '<td>' + r.open + '<br><span class="muted">' + eur(r.pipe) + '</span></td><td>' + r.won + '<br><span class="muted">' + eur(r.wonV) + '</span></td><td' + (r.stale ? ' class="flag-stale"' : '') + '>' + r.stale + '</td></tr>').join('');
    h += '</tbody></table></div><p class="muted pad small">Razdoblje birate ručno (brzi odabiri ili datumi od–do). Odgovoreni e-mailovi su poslani odgovori na primljene poruke; vrijeme u aplikaciji bilježi se od uvođenja ove mogućnosti, dok je aplikacija otvorena i prijavljena.</p></section>';
    const feed = S.notes.slice(0, 15);
    h += '<section class="panel-b feed"><header><h3>Zadnje aktivnosti</h3><span class="muted">svi prodavači</span></header>';
    h += feed.length ? '<ul class="list">' + feed.map((n) => { const c = byId(n.clientId); if (!c) return ''; const t = n.type === 'email' ? (n.subject || 'E-mail') : n.text;
      return '<li><button class="li" data-open="' + esc(c.id) + '"><span class="a"><b>' + esc(c.name) + '</b><small><span class="tag">' + esc(TYPES[n.type] || 'Bilješka') + '</span>' + esc(person(n.authorId)) + ': ' + esc(t.length > 110 ? t.slice(0, 110) + '…' : t) + '</small></span><span class="b muted">' + esc(rel(n.createdAt)) + '</span></button></li>'; }).join('') + '</ul>' : '<div class="none">Još nema zabilježenih aktivnosti.</div>';
    root.innerHTML = h + '</section>' + (isAdmin() ? '<section class="panel-b" id="auditPanel"></section>' : '');
    if (isAdmin()) { renderAudit(); loadAudit(); }
  }

  /* ---------- obavijesti, sigurnost, ne kontaktirati, duplikati, uvoz ---------- */
  const dncHas = (e) => !!e && (S.dnc || []).includes(String(e).toLowerCase());
  const ALERT_ICON = { task: '📋', camp_end: '🔔', camp_soon: '⏳', neg_stale: '⏰', security: '🛡️', unsub: '✉️' };
  function alertsPanel() {
    const al = S.alerts || [];
    if (!al.length) return '';
    return '<section class="panel-b" id="alertsPanel"><header><h3>Obavijesti</h3><span class="muted">' + al.length + ' ' + (al.length === 1 ? 'nova' : 'novih') + '</span></header><ul class="list">' + al.map((a) => {
      const c = a.clientId ? byId(a.clientId) : null;
      return '<li class="alrow"><div class="a"><b>' + (ALERT_ICON[a.kind] || '⏰') + ' ' + esc(a.title) + '</b><small>' + esc(a.body).replace(/\n/g, '<br>') + '</small></div><span class="acts">' +
        (c ? '<button class="btn sm" data-open="' + esc(c.id) + '">Otvori klijenta</button>' : '') +
        (a.kind === 'camp_end' && a.data ? '<button class="btn sm primary" data-act="alrenew" data-id="' + esc(a.id) + '">Obnovi kampanju</button>' : '') +
        (a.kind === 'camp_soon' && a.data ? '<button class="btn sm primary" data-act="alextend" data-id="' + esc(a.id) + '">Produži</button>' : '') +
        (a.kind === 'security' && isAdmin() ? '<button class="btn sm" data-goto="postavke">Sigurnost</button>' : '') +
        '<button class="btn sm" data-act="aldone" data-id="' + esc(a.id) + '">Riješeno</button></span></li>';
    }).join('') + '</ul></section>';
  }
  async function alertDone(id) {
    const ok = await safe(() => call('alert_done', { id }));
    if (ok) { S.alerts = (S.alerts || []).filter((a) => a.id !== id); renderOverview(); }
  }
  /* Produži: obrazac je unaprijed popunjen (isti tip, mjesečni iznos i broj mjeseci), prodavač može sve izmijeniti */
  function alertExtend(id) {
    const a = (S.alerts || []).find((x) => x.id === id); if (!a || !a.data) return;
    const d = a.data; const c = byId(a.clientId) || {};
    const g = d.type === 'godisnji';
    S.prolong = { id, cid: a.clientId };
    toolModal('Produži: ' + (c.name || ''), '<div class="grid2">' +
      '<label class="f wide">Vrsta<select id="plType"><option value="jednokratno"' + (g ? '' : ' selected') + '>Kampanja (jednokratni iznos)</option><option value="godisnji"' + (g ? ' selected' : '') + '>Ugovor (mjesečni iznos × broj mjeseci)</option></select></label>' +
      '<label class="f">Početak<input id="plStart" type="date" value="' + esc(d.start) + '"></label>' +
      '<label class="f" id="plMLab"' + (g ? '' : ' hidden') + '>Broj mjeseci (1–12)<select id="plMonths">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((k) => '<option value="' + k + '"' + (k === (d.months || 12) ? ' selected' : '') + '>' + k + '</option>').join('') + '</select></label>' +
      '<label class="f"><span id="plAmtLab">' + (g ? 'Mjesečni iznos (€)' : 'Vrijednost (€)') + '</span><input id="plAmt" type="number" min="0" step="0.01" value="' + esc(g ? d.monthly : d.value) + '"></label>' +
      '<label class="f">Završetak<input id="plEnd" type="date" value="' + esc(d.end) + '"></label>' +
      '<label class="f" id="plTLab"' + (g ? '' : ' hidden') + '>Vrijednost ugovora (€)<input id="plTot" readonly tabindex="-1"></label></div>' +
      '<div class="msg" id="plMsg" role="alert"></div><div class="row-btns"><button class="btn" data-act="plcancel">Odustani</button><button class="btn primary" data-act="plsave">Spremi produljenje</button></div>');
    plSync(false);
  }
  function plSync(setEnd) {
    const g = $('plType').value === 'godisnji'; const mo = Number($('plMonths').value) || 12; const amt = Number($('plAmt').value) || 0;
    $('plMLab').hidden = !g; $('plTLab').hidden = !g; $('plAmtLab').textContent = g ? 'Mjesečni iznos (€)' : 'Vrijednost (€)';
    $('plTot').value = g ? eur(amt * mo) : '';
    if (g && setEnd && $('plStart').value) { const dd = new Date($('plStart').value + 'T12:00:00'); dd.setMonth(dd.getMonth() + mo); dd.setDate(dd.getDate() - 1); $('plEnd').value = ymd(dd); }
  }
  async function plSave() {
    const g = $('plType').value === 'godisnji'; const mo = g ? (Number($('plMonths').value) || 12) : 12; const amt = Number($('plAmt').value) || 0;
    if (!(amt > 0)) { $('plMsg').textContent = 'Upišite ' + (g ? 'mjesečni iznos' : 'vrijednost') + ' (€).'; return; }
    const total = Math.round(amt * (g ? mo : 1) * 100) / 100;
    const ok = await safe(() => call('campaign_renew', { client_id: S.prolong.cid, start: $('plStart').value, end: $('plEnd').value, value: total, months: mo, type: $('plType').value }), 'Produljenje upisano');
    if (ok) { await safe(() => call('alert_done', { id: S.prolong.id })); S.alerts = (S.alerts || []).filter((x) => x.id !== S.prolong.id); toolClose(); await refresh(true); renderOverview(); } else { $('plMsg').textContent = 'Spremanje nije uspjelo.'; }
  }
  async function alertRenew(id) {
    const a = (S.alerts || []).find((x) => x.id === id); if (!a || !a.data) return;
    const d = a.data;
    if (!confirm('Upisati novu kampanju za ' + (byId(a.clientId) || {}).name + '?\n\nOd ' + fmtYmd(d.start) + ' do ' + fmtYmd(d.end) + ' (' + d.days + ' dana), vrijednost ' + d.value + ' €.\n\nDatume i iznos kasnije možete izmijeniti u kartici klijenta.')) return;
    const ok = await safe(() => call('campaign_renew', { client_id: a.clientId, start: d.start, end: d.end, value: d.value }), 'Nova kampanja upisana');
    if (ok) { await safe(() => call('alert_done', { id })); await refresh(true); renderOverview(); }
  }

  /* sigurnost */
  function secHtml() {
    const s = S.sec;
    let h = '<header><h3>Sigurnost prijave</h3><span class="muted">dva koraka i blokada IP adresa</span></header><div class="pad">' +
      '<p class="hint">Nakon unosa lozinke šalje se 6-znamenkasti kod na e-mail korisnika. Nakon 5 uzastopnih pogrešnih prijava IP adresa se blokira na 24 sata, a isto vrijedi za pokušaje probijanja prijave (administratori dobivaju obavijest). Lozinku korisnika resetirate u tablici Korisnici.</p>';
    if (!s) return h + '<p class="muted">Učitavanje…</p></div>';
    h += '<label class="chk"><input type="checkbox" id="secTwofa"' + (s.twofa ? ' checked' : '') + '> Prijava u dva koraka (kod e-mailom) za sve korisnike</label>' +
      (!s.mailOk ? '<p class="hint">E-mail nije podešen pa se dva koraka ne mogu primijeniti.</p>' : '') +
      '<label class="chk"><input type="checkbox" id="secRevoke"> Poništi sve zapamćene uređaje (' + s.trusted + ')</label>' +
      '<div class="row-btns start"><button class="btn primary" data-act="secsave">Spremi</button></div>' +
      '<h4 style="margin:16px 0 6px">Blokirane IP adrese</h4>' +
      (s.blocks.length ? '<table class="tbl"><thead><tr><th>IP adresa</th><th>Razlog</th><th>Blokirano do</th><th></th></tr></thead><tbody>' + s.blocks.map((b) => '<tr><td>' + esc(b.ip) + '</td><td>' + esc(b.reason) + '</td><td>' + esc(new Date(b.until).toLocaleString('hr-HR')) + '</td><td><button class="btn sm" data-act="ipunblock" data-ip="' + esc(b.ip) + '">Odblokiraj</button></td></tr>').join('') + '</tbody></table>' : '<p class="muted">Nema blokiranih adresa.</p>') +
      '<div class="msg" id="secMsg" role="alert"></div></div>';
    return h;
  }
  async function loadSecurity() {
    try { S.sec = await call('security_overview', null, 'GET'); } catch (e) { return; }
    const p = $('secPanel'); if (p) p.innerHTML = secHtml();
  }
  async function secSave() {
    const ok = await safe(() => call('security_save', { twofa: $('secTwofa').checked, revoke_trusted: $('secRevoke').checked }), 'Postavke sigurnosti spremljene');
    if (ok) loadSecurity();
  }
  async function ipUnblock(ip) {
    if (!confirm('Odblokirati IP adresu ' + ip + '?')) return;
    const ok = await safe(() => call('ip_unblock', { ip }), 'IP adresa odblokirana');
    if (ok) loadSecurity();
  }

  /* ne kontaktirati */
  const DNC_SRC = { link: 'odjava putem poveznice', manual: 'ručno', import: 'uvoz' };
  function renderDnc() {
    const p = $('dncPanel'); if (!p) return;
    const l = S.dncList;
    p.innerHTML = '<header><h3>Ne kontaktirati</h3><span class="muted">odjavljeni i ručno dodani · izuzeti iz grupnih poruka i kampanja</span></header><div class="pad">' +
      '<div class="row"><label class="f">E-mail adresa<input id="dncEmail" type="email" placeholder="ime@tvrtka.hr" autocomplete="off"></label><label class="f">Razlog<input id="dncReason" placeholder="npr. klijent je tražio da ga ne kontaktiramo"></label><button class="btn" data-act="dncadd">Dodaj</button></div>' +
      '<div class="msg" id="dncMsg" role="alert"></div>' +
      (!l ? '<p class="muted">Učitavanje…</p>' : (l.length ? '<div class="tscroll"><table class="tbl"><thead><tr><th>E-mail</th><th>Klijent</th><th>Razlog</th><th>Izvor</th><th>Datum</th><th></th></tr></thead><tbody>' + l.map((x) => { const c = x.client ? byId(x.client) : null; return '<tr><td>' + esc(x.email) + '</td><td>' + (c ? '<button class="li" data-open="' + esc(c.id) + '">' + esc(c.name) + '</button>' : '') + '</td><td>' + esc(x.reason) + '</td><td>' + esc(DNC_SRC[x.source] || x.source) + '</td><td>' + esc(fmtDate(x.at)) + '</td><td>' + (isAdmin() ? '<button class="btn sm" data-act="dncrm" data-id="' + esc(x.id) + '">Ukloni</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted">Popis je prazan. Klijenti se na njega dodaju kad se odjave putem poveznice u e-mailu.</p>')) + '</div>';
  }
  async function loadDnc() {
    try { S.dncList = (await call('dnc_list', null, 'GET')).list; } catch (e) { return; }
    renderDnc();
  }
  async function dncAdd() {
    const email = $('dncEmail').value.trim();
    if (!email) { $('dncMsg').textContent = 'Upišite e-mail adresu.'; return; }
    const ok = await safe(() => call('dnc_add', { email, reason: $('dncReason').value.trim() }), 'Dodano na popis');
    if (ok) { await refresh(true); loadDnc(); } else { $('dncMsg').textContent = ''; }
  }
  async function dncRemove(id) {
    if (!confirm('Ukloniti adresu s popisa? Ponovno će primati grupne poruke.')) return;
    const ok = await safe(() => call('dnc_remove', { id }), 'Uklonjeno s popisa');
    if (ok) { await refresh(true); loadDnc(); }
  }
  function dncBanner(c) {
    if (!c.email) return '';
    if (dncHas(c.email)) return '<div class="banner" role="status">Ne kontaktirati: adresa ' + esc(c.email) + ' je na popisu (odjava ili zahtjev klijenta). Grupne poruke se ne šalju.</div>';
    return '';
  }
  async function dncClient(id) {
    const c = byId(id); if (!c || !c.email) return;
    if (!confirm('Dodati ' + c.email + ' na popis "ne kontaktirati"?')) return;
    const ok = await safe(() => call('dnc_add', { email: c.email, reason: 'Označeno na kartici klijenta' }), 'Dodano na popis');
    if (ok) { await refresh(true); openClient(id, true); }
  }

  /* alati (duplikati, uvoz) */
  function toolModal(title, html) {
    const m = $('toolModal'); m.querySelector('h2').textContent = title; m.querySelector('.sh-b').innerHTML = html; m.hidden = false;
    document.body.classList.add('lock');
  }
  /* vlastiti dijalog potvrde (umjesto prozora preglednika) */
  function confirmBox(title, html, yes) {
    return new Promise((res) => {
      S.cfRes = res;
      toolModal(title, '<div class="cfbody"><div class="cficon"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg></div><p>' + html + '</p></div><div class="acts cfacts"><button class="btn" data-tool="cfno">Odustani</button><button class="btn danger" data-tool="cfyes">' + esc(yes || 'Da') + '</button></div>');
    });
  }
  function toolClose() { if (S.cfRes) { const r = S.cfRes; S.cfRes = null; r(false); } $('toolModal').hidden = true; if ($('drawer').hidden && $('mdrawer').hidden) document.body.classList.remove('lock'); }
  const REASON = { 'OIB': 'isti OIB', 'e-mail': 'ista e-mail adresa', 'telefon': 'isti telefon', 'naziv': 'sličan naziv' };
  async function dupOpen() {
    toolModal('Duplikati klijenata', '<p class="muted">Tražim duplikate…</p>');
    let d; try { d = await call('dup_scan', null, 'GET'); } catch (e) { toolModal('Duplikati klijenata', '<p class="msg">' + esc(e.message) + '</p>'); return; }
    S.dupData = d; dupRender();
  }
  function dupRender() {
    const d = S.dupData;
    if (!d.groups.length) { toolModal('Duplikati klijenata', '<p>Nema pronađenih duplikata.</p>'); return; }
    toolModal('Duplikati klijenata', '<p class="hint">Pronađeno skupina: <b>' + d.total + '</b> (prikazano ' + d.groups.length + '). Odaberite klijenta kojeg želite zadržati; bilješke, zadaci, e-mailovi i dokumenti ostalih prebacuju se na njega, a ostali se brišu.</p>' +
      d.groups.map((g, gi) => '<div class="dupgrp" data-gi="' + gi + '"><div class="dh">Podudaranje: ' + g.reasons.map((r) => esc(REASON[r] || r)).join(', ') + '</div>' + g.clients.map((c, ci) =>
        '<label class="dupc"><input type="radio" name="keep' + gi + '" value="' + esc(c.id) + '"' + (ci === 0 ? ' checked' : '') + '><span><b>' + esc(c.name) + '</b><small>' + esc([c.oib && 'OIB ' + c.oib, c.email, c.phone, STAGES.find((x) => x.id === c.status).label, 'prodavač ' + c.owner].filter(Boolean).join(' · ')) + '<br>' + c.notes + ' bilješki, ' + c.emails + ' e-mailova, ' + c.docs + ' dokumenata</small></span></label>').join('') +
        '<div class="acts"><button class="btn sm primary" data-tool="merge" data-gi="' + gi + '">Spoji u odabranog</button><button class="btn sm" data-tool="ignore" data-gi="' + gi + '">Nisu duplikati</button></div></div>').join(''));
  }
  async function dupMerge(gi) {
    const g = S.dupData.groups[gi]; const keep = document.querySelector('input[name=keep' + gi + ']:checked').value;
    const rm = g.clients.map((c) => c.id).filter((i) => i !== keep);
    const kc = g.clients.find((c) => c.id === keep);
    if (!confirm('Zadržati "' + kc.name + '" i spojiti ' + rm.length + ' ' + (rm.length === 1 ? 'klijenta' : 'klijenata') + ' u njega?\n\nOvo se ne može poništiti.')) return;
    const ok = await safe(() => call('client_merge', { keep, remove: rm }), 'Klijenti spojeni');
    if (ok) { await refresh(true); S.dupData.groups.splice(gi, 1); S.dupData.total--; dupRender(); }
  }
  async function dupIgnore(gi) {
    const g = S.dupData.groups[gi];
    const ok = await safe(() => call('dup_ignore', { ids: g.clients.map((c) => c.id) }), 'Skupina označena kao različiti klijenti');
    if (ok) { S.dupData.groups.splice(gi, 1); S.dupData.total--; dupRender(); }
  }
  function impOpen() {
    S.imp = null;
    toolModal('Uvoz klijenata iz Excela', '<p class="hint">Učitajte datoteku <b>.xlsx</b> ili <b>.csv</b>. Prvi redak mora sadržavati zaglavlja, npr. <i>Naziv, Kontakt osoba, OIB, E-mail, Telefon, Usluga, Vrijednost, Status, Napomena</i> (obavezan je samo naziv). Prije uvoza vidjet ćete provjeru: greške i duplikate.</p>' +
      '<label class="f">Datoteka<input type="file" id="impFile" accept=".xlsx,.csv,.txt"></label><div class="msg" id="impMsg" role="alert"></div><div class="acts"><button class="btn primary" data-tool="impcheck">Provjeri datoteku</button></div>');
  }
  async function impCheck() {
    const f = $('impFile').files[0]; const m = $('impMsg');
    if (!f) { m.textContent = 'Odaberite datoteku.'; return; }
    m.textContent = 'Provjera…';
    const fd = new FormData(); fd.append('file', f);
    try {
      const r = await fetch('api.php?a=import_preview', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF': S.csrf }, body: fd });
      const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Provjera nije uspjela.');
      S.imp = d; impPreview();
    } catch (e) { m.textContent = e.message; }
  }
  function impPreview() {
    const d = S.imp;
    const tbl = (rows, cols) => rows.length ? '<div class="tscroll" style="max-height:200px"><table class="tbl"><thead><tr><th>Redak</th><th>Naziv</th><th>E-mail</th><th>' + cols + '</th></tr></thead><tbody>' + rows.map((r) => '<tr><td>' + r.row + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.email) + '</td><td>' + (r.errors.length ? esc(r.errors.join(', ')) : (r.dup ? 'već postoji: ' + esc(r.dup.name) + ' (' + esc(r.dup.where) + ', ' + esc(r.dup.type) + ')' : '')) + '</td></tr>').join('') + '</tbody></table></div>' : '';
    toolModal('Uvoz klijenata iz Excela', '<p><b>' + esc(d.file) + '</b>: ' + d.total + ' redaka. Prepoznati stupci: ' + d.columns.map((c) => esc(c[1])).join(', ') + '.</p>' +
      '<div class="strip impstrip"><div><div class="k">Spremno za uvoz</div><div class="v">' + d.ok + '</div></div><div><div class="k">Duplikati</div><div class="v' + (d.dup ? ' warn' : '') + '">' + d.dup + '</div></div><div><div class="k">S greškom</div><div class="v' + (d.bad ? ' warn' : '') + '">' + d.bad + '</div></div></div>' +
      (d.bad ? '<h4>Redci s greškom (preskaču se)</h4>' + tbl(d.badRows, 'Greška') : '') + (d.dup ? '<h4>Duplikati</h4>' + tbl(d.dupRows, 'Postojeći klijent') : '') + (d.ok ? '<h4>Primjer redaka za uvoz</h4>' + tbl(d.okRows, '') : '') +
      '<div class="row"><label class="f">Dodijeli prodavaču<select id="impOwner">' + ownerOptions().map((o) => '<option value="' + esc(o[0]) + '"' + (o[0] === S.me.id ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '<option value="none">— bez prodavača —</option></select></label>' +
      '<label class="f">Status<select id="impStatus"><option value="">Prema datoteci (zadano: Novi)</option>' + STAGES.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.label) + '</option>').join('') + '</select></label>' +
      '<label class="f">Duplikati<select id="impMode"><option value="skip">Preskoči duplikate (preporučeno)</option><option value="oib">Preskoči samo iste OIB-ove</option><option value="all">Uvezi i duplikate</option></select></label></div>' +
      '<div class="msg" id="impMsg" role="alert"></div><div class="acts"><button class="btn primary" data-tool="impgo"' + (d.ok + d.dup ? '' : ' disabled') + '>Uvezi klijente</button><button class="btn" data-tool="impopen">Druga datoteka</button></div>');
  }
  async function impGo() {
    const d = S.imp; const mode = $('impMode').value;
    const n = mode === 'all' ? d.ok + d.dup : (mode === 'oib' ? 'do ' + (d.ok + d.dup) : d.ok);
    if (!confirm('Uvesti ' + n + ' klijenata?')) return;
    try {
      const r = await call('import_commit', { token: d.token, mode, status: $('impStatus').value, owner_id: $('impOwner').value });
      await refresh(true);
      toolModal('Uvoz završen', '<p>Uvezeno klijenata: <b>' + r.created + '</b>. Preskočeno duplikata: ' + r.skippedDup + '. Redaka s greškom: ' + r.skippedBad + '.</p><div class="acts"><button class="btn primary" data-tool="close">Zatvori</button></div>');
    } catch (e) { $('impMsg').textContent = e.message; }
  }
  /* ---------- arhiva izgubljenih klijenata (bez prodavača) ---------- */
  async function poolLoad(p) {
    const q = ($('poolQ') ? $('poolQ').value : (S.poolQ || '')).trim(); S.poolQ = q;
    const box = $('poolRes'); if (!box) return;
    box.innerHTML = '<p class="muted">Učitavanje…</p>';
    try {
      const d = await call('pool_list&q=' + encodeURIComponent(q) + '&p=' + (p || 1), null, 'GET');
      const pages = Math.max(1, Math.ceil(d.total / d.per));
      box.innerHTML = '<p class="muted small">' + d.total.toLocaleString('hr-HR') + ' klijenata' + (q ? ' za "' + esc(q) + '"' : '') + ' · stranica ' + d.page + ' od ' + pages + '</p>' +
        (d.clients.length ? '<div class="tscroll" style="max-height:52vh"><table class="tbl"><thead><tr><th>Tvrtka</th><th>OIB</th><th>E-mail</th><th>Telefon</th><th>Adresa</th></tr></thead><tbody>' +
          d.clients.map((c) => '<tr><td><button class="lnk" data-tool="poolopen" data-id="' + esc(c.id) + '">' + esc(c.name) + '</button></td><td>' + esc(c.oib) + '</td><td>' + esc(c.email) + '</td><td>' + esc(c.phone) + '</td><td>' + esc(c.address) + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="muted">Nema rezultata.</p>') +
        '<div class="acts"><button class="btn sm" data-tool="poolpage" data-p="' + (d.page - 1) + '"' + (d.page <= 1 ? ' disabled' : '') + '>← Prethodna</button><button class="btn sm" data-tool="poolpage" data-p="' + (d.page + 1) + '"' + (d.page >= pages ? ' disabled' : '') + '>Sljedeća →</button></div>';
    } catch (e) { box.innerHTML = '<p class="msg">' + esc(e.message) + '</p>'; }
  }
  /* kampanja "povratak" za arhivu izgubljenih: segment po gradu / djelatnosti */
  async function poolCampInit() {
    const el = $('poolCamp'); if (!el) return;
    el.innerHTML = '<p class="muted">Učitavanje segmenata…</p>';
    let d; try { d = await call('pool_segments', null, 'GET'); } catch (e) { el.innerHTML = '<p class="msg">' + esc(e.message) + '</p>'; return; }
    S.poolSeg = d;
    el.innerHTML = '<h4 style="margin:18px 0 6px">Kampanja „Povratak"</h4><p class="hint">Šalje se izgubljenim klijentima iz arhive s ispravnom e-mail adresom (' + d.total.toLocaleString('hr-HR') + '). Poruke idu kroz red slanja: 08–16 h najviše 20 na sat, 16–08 h najviše 55 na sat, a pojedinačni e-mailovi imaju prednost. Isti klijent ne dobiva istu poruku (isti predmet) češće od jednom u 30 dana.</p>' +
      '<div class="grid2"><label class="f">Grad<select id="pcCity"><option value="">Svi gradovi</option>' + d.cities.map((c) => '<option value="' + esc(c.name) + '">' + esc(c.name) + ' (' + c.count.toLocaleString('hr-HR') + ')</option>').join('') + '</select></label>' +
      '<label class="f">Djelatnost<select id="pcInd"><option value="">Sve djelatnosti</option>' + d.industries.map((c) => '<option value="' + esc(c.name) + '">' + esc(c.name) + ' (' + c.count + ')</option>').join('') + '</select></label>' +
      '<label class="f">Najviše primatelja (do 1000 po slanju)<input id="pcLimit" type="number" min="1" max="1000" value="200"></label></div>' +
      '<label class="f">Predmet<input id="pcSubj" maxlength="255" value="Vraćamo se s novom ponudom za {{tvrtka}}"></label>' +
      '<label class="f">Poruka<textarea id="pcBody" rows="7">Poštovani,\n\nnekada smo surađivali s tvrtkom {{tvrtka}}, a od tada smo proširili ponudu radijskog oglašavanja, PR portala i digitalnih kampanja. Rado bismo Vam predstavili aktualne mogućnosti i posebnu ponudu za povratak.\n\nJavite nam se odgovorom na ovu poruku ili nazovite, pa dogovaramo termin.\n\nLijep pozdrav,\n{{moje_ime}}</textarea></label>' +
      '<p class="hint" id="pcInfo"></p><div class="msg" id="pcMsg" role="alert"></div><div class="row-btns"><button class="btn" data-tool="pcprev">Pregled primatelja</button><button class="btn primary" data-tool="pcsend">Stavi u red slanja</button></div>';
  }
  async function poolCampRun(preview) {
    const body = { city: $('pcCity').value, industry: $('pcInd').value, limit: Number($('pcLimit').value) || 200, subject: $('pcSubj').value.trim(), body: $('pcBody').value.trim() };
    if (preview) {
      try { const r = await call('pool_campaign', Object.assign({ preview: true }, body)); $('pcInfo').innerHTML = 'Primatelja u odabranom segmentu: <b>' + r.count + '</b>.' + (r.samples.length ? '<br>Primjer: <i>' + esc(r.samples[0].subject) + '</i> → ' + esc(r.samples[0].to) : ''); } catch (e) { $('pcMsg').textContent = e.message; }
      return;
    }
    if (!(await confirmBox('Poslati kampanju „Povratak"?', 'Poruke se stavljaju u red slanja (do ' + body.limit + ' primatelja) i šalju se uz ograničenje po satu. Slanje se može otkazati u kartici E-mail kampanje.', 'Da, stavi u red'))) return;
    try { const r = await call('pool_campaign', body); toast('Kampanja čeka odobrenje administratora: ' + r.queued + (r.skipped ? ' (preskočeno ' + r.skipped + ')' : '')); $('pcMsg').textContent = ''; } catch (e) { $('pcMsg').textContent = e.message; }
  }
  function poolOpen() {
    toolModal('Arhiva izgubljenih klijenata', '<p class="hint">Izgubljeni klijenti bez prodavača. Otvorite klijenta za uređivanje ili ga preuzmite. Za slanje e-mail kampanje u kartici E-mail kampanje odaberite status Izgubljen.</p>' +
      '<label class="f">Pretraga<input id="poolQ" type="search" placeholder="Tvrtka, OIB, e-mail, telefon, adresa" value="' + esc(S.poolQ || '') + '"></label><div id="poolRes"></div>' + (isAdmin() ? '<div id="poolCamp"></div>' : ''));
    if (isAdmin()) poolCampInit();
    let tm = null; $('poolQ').addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => poolLoad(1), 350); });
    poolLoad(1);
  }
  function toolClick(ev) {
    const b = ev.target.closest('[data-tool]');
    if (b) {
      const t = b.dataset.tool;
      if (t === 'close') toolClose();
      else if (t === 'merge') dupMerge(+b.dataset.gi);
      else if (t === 'ignore') dupIgnore(+b.dataset.gi);
      else if (t === 'impcheck') impCheck();
      else if (t === 'impgo') impGo();
      else if (t === 'impopen') impOpen();
      else if (t === 'cfno') toolClose();
      else if (t === 'cfyes') { const r = S.cfRes; S.cfRes = null; toolClose(); if (r) r(true); }
      else if (t === 'poolpage') poolLoad(+b.dataset.p);
      else if (t === 'pcprev') poolCampRun(true);
      else if (t === 'pcsend') poolCampRun(false);
      else if (t === 'poolopen') { const id = b.dataset.id; toolClose(); ensureClient(id).then((ok) => { if (ok) { renderAll(); openClient(id); } }); }
      return;
    }
    if (ev.target.classList && ev.target.classList.contains('overlay')) toolClose();
  }
  function clientTools() {
    const el = $('clTools'); if (!el) return;
    el.innerHTML = isAdmin() ? '<button class="btn sm" data-act="impopen">Uvoz iz Excela</button><button class="btn sm" data-act="dupopen">Duplikati</button>' : '';
  }

  /* ---------- settings ---------- */
  function bkHtml() {
    const b = S.backups;
    let h = '<header><h3>Sigurnosna kopija (backup)</h3><span class="muted">cijela baza klijenata</span></header><div class="pad">' +
      '<p class="hint">Kopija se automatski sprema na poslužitelj ako unazad 24 sata nije napravljena. Čuva se zadnjih ' + esc(b ? b.keep : 5) + ' kopija, starije se brišu čim nastane nova. Preuzmite kopiju na svoje računalo ili drugi disk, jer kopija na istom poslužitelju ne štiti od kvara poslužitelja. Ručno se može napraviti samo jednom dnevno.</p>';
    if (!b) return h + '<p class="muted">Učitavanje…</p></div>';
    h += '<table class="tbl"><thead><tr><th>Datum i vrijeme</th><th>Veličina</th><th></th></tr></thead><tbody>' +
      (b.backups.length ? b.backups.map((x) => '<tr><td>' + esc(new Date(x.at).toLocaleString('hr-HR')) + '</td><td>' + esc(x.size >= 1048576 ? (x.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(x.size / 1024)) + ' KB') + '</td><td><a class="btn" href="api.php?a=backup_download&f=' + encodeURIComponent(x.name) + '">Preuzmi</a></td></tr>').join('') : '<tr><td colspan="3" class="muted">Još nema kopija.</td></tr>') + '</tbody></table>' +
      '<div class="msg" id="bkMsg" role="alert"></div><div class="row-btns start"><a class="btn primary" href="api.php?a=backup_latest" download>⬇ Preuzmi najnoviju kopiju</a><button class="btn" data-act="bkrun"' + (b.doneToday ? ' disabled' : '') + '>Napravi kopiju sada</button>' + (b.doneToday ? '<span class="muted">Današnja kopija već postoji.</span>' : '') + '</div></div>';
    return h;
  }
  async function loadBackups() {
    try { S.backups = await call('backup_list', null, 'GET'); } catch (e) { return; }
    const p = $('bkPanel'); if (p) p.innerHTML = bkHtml();
  }
  async function runBackup() {
    const m = $('bkMsg'); if (m) m.textContent = 'Izrada kopije…';
    try { const r = await call('backup_run', {}); S.backups = r; toast('Sigurnosna kopija je spremljena'); } catch (e) { toast(e.message, true); await loadBackups(); return; }
    const p = $('bkPanel'); if (p) p.innerHTML = bkHtml();
  }

  function renderSettings() {
    const root = $('v-postavke');
    if (!S.loaded) { root.innerHTML = loadingHtml(); return; }
    let h = '<h2>' + (isAdmin() ? 'Postavke' : 'Moj račun') + '</h2>';
    h += '<section class="panel-b"><header><h3>Moj račun</h3></header><div class="pad"><p><b>' + esc(S.me.name) + '</b> · ' + esc(S.me.email) + ' · ' + (isAdmin() ? 'administrator' : 'prodavač') + '</p>' +
      '<div class="grid2"><label class="f">Trenutna lozinka<input id="pwCur" type="password" autocomplete="current-password"></label><span></span>' +
      '<label class="f">Nova lozinka (najmanje 10 znakova)<input id="pwNew" type="password" autocomplete="new-password"></label>' +
      '<label class="f">Ponovite novu lozinku<input id="pwNew2" type="password" autocomplete="new-password"></label></div>' +
      '<div class="msg" id="pwMsg" role="alert"></div><div class="row-btns start"><button class="btn" data-act="pwchange">Promijeni lozinku</button></div></div></section>';
    h += '<section class="panel-b"><header><h3>Moj potpis</h3><span class="muted">dodaje se na svaki e-mail koji pošaljete</span></header><div class="pad">' +
      '<label class="f">Potpis<textarea id="sigText" rows="4" placeholder="Ostavite prazno za zadani potpis">' + esc(S.me.signature || '') + '</textarea></label>' +
      '<div class="sigprev"><b>Zadani potpis</b><pre>' + esc(S.me.signatureEffective && !S.me.signature ? S.me.signatureEffective : defaultSigGuess()) + '</pre></div>' +
      '<div class="msg" id="sigMsg" role="alert"></div><div class="row-btns start"><button class="btn" data-act="sigsave">Spremi potpis</button></div></div></section>';
    if (isAdmin()) {
      h += '<section class="panel-b"><header><h3>Pošta</h3><span class="muted">sandučić za slanje i primanje</span></header><div class="pad">' +
        '<dl class="meta-grid"><dt>Adresa</dt><dd>' + esc(S.mail.from || 'nije podešena') + '</dd><dt>Slanje (SMTP)</dt><dd>' + (S.mail.enabled ? 'podešeno' : 'nije podešeno') + '</dd>' +
        '<dt>Primanje (IMAP)</dt><dd>' + (S.mail.imap ? 'podešeno, zadnje osvježeno ' + esc(minAgo(S.mail.lastSync)) : 'nije podešeno') + '</dd>' +
        '<dt>Inbox 2 (primanje i slanje)</dt><dd>' + (S.mail.imap2 ? 'podešen, zadnje osvježeno ' + esc(minAgo(S.mail.lastSync2)) + (S.mail.error2 && S.mail.error2 !== 'error' ? ' · greška: ' + esc(S.mail.error2) : '') : 'nije podešen (config.php, odjeljak imap2)') + '</dd>' +
        (S.mail.error && S.mail.error !== 'error' ? '<dt>Zadnja greška</dt><dd>' + esc(S.mail.error) + '</dd>' : '') + '</dl>' +
        '<div class="msg" id="mtMsg" role="alert"></div><div class="row-btns start"><button class="btn" data-act="mailtest"' + (S.mail.enabled ? '' : ' disabled') + '>Pošalji probni e-mail meni</button>' + '<button class="btn" data-act="mailtest2"' + (S.mail.imap2 ? '' : ' disabled') + ' title="Šalje s adrese Inboxa 2">Probni e-mail s Inboxa 2</button>' +
        '<button class="btn" data-act="syncnow"' + (S.mail.imap ? '' : ' disabled') + '>Osvježi poštu sada</button></div></div></section>';
      h += '<section class="panel-b" id="secPanel">' + secHtml() + '</section>';
      h += '<section class="panel-b" id="bkPanel">' + bkHtml() + '</section>';
      const ic = S.mail.imap2Cfg || { host: '', port: 993, secure: 'ssl', user: '', folder: 'INBOX', hasPass: false, source: '' };
      h += '<section class="panel-b" id="box2form"><header><h3>Inbox 2 (primanje i odgovaranje)</h3><span class="muted">' + (S.mail.imap2 ? 'podešen' : 'nije podešen') + '</span></header><div class="pad">' +
        '<p class="hint">Dodatni sandučić čije se poruke vide u Inboxu pod "Inbox 2". Odgovori na poruke iz Inboxa 2 šalju se s adrese ovog sandučića; odgovori na ostale poruke s adrese ' + esc(S.mail.from || 'marketing@vip-grupa.eu') + '.' + (ic.source === 'config' ? ' Trenutno se koriste podaci iz config.php; spremanjem ovdje zamjenjuju se.' : '') + '</p>' +
        '<div class="grid2"><label class="f">IMAP poslužitelj<input id="b2Host" value="' + esc(ic.host || 'mail.vip-grupa.eu') + '" autocomplete="off" placeholder="mail.vip-grupa.eu"></label>' +
        '<label class="f">Port<input id="b2Port" type="number" min="1" max="65535" value="' + esc(ic.port || 993) + '"></label>' +
        '<label class="f">Sigurnost<select id="b2Sec"><option value="ssl"' + (ic.secure === 'ssl' ? ' selected' : '') + '>SSL/TLS (port 993)</option><option value="tls"' + (ic.secure === 'tls' ? ' selected' : '') + '>STARTTLS (port 143)</option><option value="none"' + (ic.secure === 'none' ? ' selected' : '') + '>Bez šifriranja</option></select></label>' +
        '<label class="f">Mapa<input id="b2Folder" value="' + esc(ic.folder || 'INBOX') + '" autocomplete="off"></label>' +
        '<label class="f">Korisnik (e-mail adresa)<input id="b2User" type="email" value="' + esc(ic.user) + '" autocomplete="off"></label>' +
        '<label class="f">Lozinka<input id="b2Pass" type="password" autocomplete="new-password" placeholder="' + (ic.hasPass ? 'spremljena, ostavite prazno da ostane' : 'lozinka sandučića') + '"></label>' +
        '<label class="f">SMTP poslužitelj (slanje)<input id="b2SHost" value="' + esc(ic.smtpHost || ic.host || '') + '" autocomplete="off" placeholder="isti kao IMAP"></label>' +
        '<label class="f">SMTP port<input id="b2SPort" type="number" min="1" max="65535" value="' + esc(ic.smtpPort || 465) + '"></label>' +
        '<label class="f">SMTP sigurnost<select id="b2SSec"><option value="ssl"' + ((ic.smtpSecure || 'ssl') === 'ssl' ? ' selected' : '') + '>SSL/TLS (port 465)</option><option value="tls"' + (ic.smtpSecure === 'tls' ? ' selected' : '') + '>STARTTLS (port 587)</option><option value="none"' + (ic.smtpSecure === 'none' ? ' selected' : '') + '>Bez šifriranja</option></select></label>' +
        '<label class="f">Naziv pošiljatelja (neobavezno)<input id="b2FName" value="' + esc(ic.fromName || '') + '" autocomplete="off" placeholder="npr. Sjeverni FM"></label></div>' +
        '<div class="msg" id="b2Msg" role="alert"></div><div class="row-btns start"><button class="btn" data-act="b2test">Provjeri vezu</button><button class="btn primary" data-act="b2save">Spremi</button>' + (ic.source === 'settings' ? '<button class="btn danger" data-act="b2clear">Ukloni Inbox 2</button>' : '') + '</div></div></section>';
      const st = S.settings || { autoreply: { enabled: true, subject: '', body: '' }, reportEnabled: true, workHours: '' };
      h += '<section class="panel-b"><header><h3>Automatski odgovor izvan radnog vremena</h3><span class="muted">radno vrijeme: ' + esc(st.workHours) + '</span></header><div class="pad">' +
        '<label class="chk"><input type="checkbox" id="arOn"' + (st.autoreply.enabled ? ' checked' : '') + '> Uključen. Svaki pošiljatelj dobiva najviše jedan automatski odgovor dnevno, a ne odgovara se na automatsku poštu, newslettere i no-reply adrese.</label>' +
        '<label class="f">Predmet<input id="arSubj" value="' + esc(st.autoreply.subject) + '"><span class="hint">Oznaka <code>{{predmet}}</code> zamjenjuje se predmetom dolazne poruke.</span></label>' +
        '<label class="f">Tekst odgovora<textarea id="arBody" rows="7">' + esc(st.autoreply.body) + '</textarea></label>' +
        '<label class="chk"><input type="checkbox" id="repOn"' + (st.reportEnabled ? ' checked' : '') + '> Tjedni izvještaj voditeljima (administratorima) svaki ponedjeljak od 08:00 i mjesečni izvještaj 1. u mjesecu od 08:00 (po prodavaču, s popisom izvršenih usluga)</label>' +
        '<div class="msg" id="arMsg" role="alert"></div><div class="row-btns start"><button class="btn primary" data-act="arsave">Spremi</button><button class="btn" data-act="reportprev">Pregledaj izvještaj za prošli tjedan</button><button class="btn" data-act="reportsend"' + (S.mail.enabled ? '' : ' disabled') + '>Pošalji izvještaj meni</button><button class="btn" data-act="reportprevm">Pregledaj mjesečni izvještaj</button><button class="btn" data-act="reportsendm"' + (S.mail.enabled ? '' : ' disabled') + '>Pošalji mjesečni izvještaj meni</button></div>' +
        '<pre class="reportbox" id="reportBox" hidden></pre></div></section>';
      h += goalSettingsHtml();
      h += '<section class="panel-b"><header><h3>Predlošci e-mailova</h3><span class="muted">oznake: {{ime}} {{tvrtka}} {{usluga}} {{moje_ime}}; potpis se dodaje sam</span></header><div class="pad">' +
        S.templates.filter((t) => t.kind !== 'akcija').map((t) => tplForm(t)).join('') +
        tplForm({ id: '', kind: 'email', name: '', subject: '', body: '' }, 'Novi predložak') + '</div></section>';
      h += '<section class="panel-b"><header><h3>Akcije</h3><span class="muted">poruka za grupu klijenata; svakom ide osobna poruka s potpisom prodavača</span></header><div class="pad">' +
        S.templates.filter((t) => t.kind === 'akcija').map((t) => tplForm(t)).join('') +
        tplForm({ id: '', kind: 'akcija', name: '', subject: '', body: '' }, 'Nova akcija') + '</div></section>';
      h += '<section class="panel-b"><header><h3>Korisnici</h3><span class="muted">' + S.users.length + '</span></header><div class="tscroll"><table class="tbl"><thead><tr><th>Ime</th><th>E-mail</th><th>Uloga</th><th>Aktivan</th><th>Nova lozinka</th><th></th></tr></thead><tbody>';
      h += S.users.map((u) => { const self = u.id === S.me.id;
        return '<tr data-uid="' + esc(u.id) + '"><td class="l"><input data-f="name" value="' + esc(u.name) + '" aria-label="Ime"></td><td class="l"><input data-f="email" type="email" value="' + esc(u.email || '') + '" aria-label="E-mail"></td>' +
          '<td class="l"><select data-f="role"' + (self ? ' disabled' : '') + ' aria-label="Uloga"><option value="sales"' + (u.role === 'sales' ? ' selected' : '') + '>Prodavač</option><option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>Administrator</option></select></td>' +
          '<td><input data-f="active" type="checkbox" style="width:auto"' + (u.active ? ' checked' : '') + (self ? ' disabled' : '') + ' aria-label="Aktivan"></td>' +
          '<td class="l"><input data-f="password" type="password" autocomplete="new-password" placeholder="neobavezno" aria-label="Nova lozinka"></td><td><button class="btn sm" data-act="usave">Spremi</button></td></tr>'; }).join('');
      h += '</tbody></table></div><div class="pad"><h3>Novi korisnik</h3><div class="grid2"><label class="f">Ime i prezime<input id="uName" autocomplete="off"></label><label class="f">E-mail<input id="uEmail" type="email" autocomplete="off"></label>' +
        '<label class="f">Lozinka (najmanje 10 znakova)<input id="uPass" type="password" autocomplete="new-password"></label><label class="f">Uloga<select id="uRole"><option value="sales">Prodavač</option><option value="admin">Administrator</option></select></label></div>' +
        '<div class="msg" id="uMsg" role="alert"></div><div class="row-btns start"><button class="btn primary" data-act="ucreate">Dodaj korisnika</button></div></div></section>';
    }
    root.innerHTML = h;
    if (isAdmin()) { loadBackups(); loadSecurity(); }
  }
  function defaultSigGuess() { return [S.me.name, S.mail.from].filter(Boolean).join('\n'); }
  async function sigSave() {
    const ok = await safe(() => call('signature_save', { signature: $('sigText').value.trim() }), 'Potpis spremljen');
    if (ok) refresh(true);
  }
  function b2Body() { return { host: $('b2Host').value.trim(), port: Number($('b2Port').value) || 993, secure: $('b2Sec').value, folder: $('b2Folder').value.trim(), user: $('b2User').value.trim(), pass: $('b2Pass').value, smtp_host: $('b2SHost').value.trim(), smtp_port: Number($('b2SPort').value) || 465, smtp_secure: $('b2SSec').value, from_name: $('b2FName').value.trim() }; }
  async function b2Test() {
    const m = $('b2Msg'); m.textContent = 'Provjeravam vezu…';
    try { const r = await call('imap2_test', b2Body()); m.textContent = r.ok ? 'Veza radi: primanje (IMAP) i slanje (SMTP) su u redu. Kliknite Spremi.' : r.error; } catch (e) { m.textContent = e.message; }
  }
  async function b2Save() {
    const m = $('b2Msg'); m.textContent = '';
    try { await call('imap2_save', b2Body()); toast('Inbox 2 spremljen'); await refresh(true); renderSettings(); syncInbox(true, true); } catch (e) { m.textContent = e.message; }
  }
  async function b2Clear() {
    if (!confirm('Ukloniti Inbox 2? Već preuzete poruke ostaju u Inboxu.')) return;
    const ok = await safe(() => call('imap2_clear', {}), 'Inbox 2 uklonjen');
    if (ok) { await refresh(true); renderSettings(); }
  }
  async function arSave() {
    const m = $('arMsg'); m.textContent = '';
    try {
      await call('settings_save', { ar_enabled: $('arOn').checked, ar_subject: $('arSubj').value.trim(), ar_body: $('arBody').value.trim(), report_enabled: $('repOn').checked });
      toast('Postavke spremljene'); refresh(true);
    } catch (e) { m.textContent = e.message; }
  }
  async function reportPreview(monthly) {
    const box = $('reportBox');
    try { const r = await call('report_preview' + (monthly ? '&period=month' : ''), null, 'GET'); box.textContent = r.text; box.hidden = false; }
    catch (e) { toast(e.message, true); }
  }
  const AUD_GROUPS = [['aktivni', 'Aktivni (novi, kontaktirani, ponuda, pregovori)'], ['dobiveni', 'Dobiveni (postojeći klijenti)'], ['neaktivni', 'Neaktivni (izgubljeni)']];
  function localDT(ms) { const d = new Date(ms); return ymd(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function tplForm(t, title) {
    const akc = t.kind === 'akcija';
    const aud = t.audience || { groups: ['aktivni'], kind: 'sve', owner: '' };
    const inp = t.inputs || {};
    const mode = t.sendMode || 'manual';
    const fixedVal = t.sendFixed ? localDT(t.sendFixed) : '';
    let h = '<div class="tplrow" data-tid="' + esc(t.id) + '" data-kind="' + (akc ? 'akcija' : 'email') + '">' + (title ? '<h3>' + esc(title) + '</h3>' : '') +
      '<label class="f">Naziv<input data-f="name" value="' + esc(t.name) + '"></label><label class="f">Predmet<input data-f="subject" value="' + esc(t.subject) + '"></label>';
    if (akc) {
      h += '<fieldset class="f wide aud"><legend>Kome se šalje</legend>' + AUD_GROUPS.map((g) => '<label class="chk"><input type="checkbox" data-aud="' + g[0] + '"' + (aud.groups.indexOf(g[0]) >= 0 ? ' checked' : '') + '> ' + esc(g[1]) + '</label>').join('') +
        '<div class="grid2"><label class="f">Vrsta klijenta<select data-f="aud_kind"><option value="sve"' + (aud.kind === 'sve' ? ' selected' : '') + '>Tvrtke i fizičke osobe</option><option value="tvrtka"' + (aud.kind === 'tvrtka' ? ' selected' : '') + '>Samo tvrtke</option><option value="osoba"' + (aud.kind === 'osoba' ? ' selected' : '') + '>Samo fizičke osobe</option></select></label>' +
        '<label class="f">Klijenti prodavača<select data-f="aud_owner"><option value="">Svi prodavači</option>' + S.users.filter((u) => u.active).map((u) => '<option value="' + esc(u.id) + '"' + (String(aud.owner) === String(u.id) ? ' selected' : '') + '>' + esc(u.name) + '</option>').join('') + '</select></label></div>' +
        '<span class="hint">Šalje se samo klijentima koji imaju upisan ispravan e-mail, svaka adresa najviše jednom.</span></fieldset>' +
        '<fieldset class="f wide aud"><legend>Podaci o akciji</legend><div class="grid2">' +
        '<label class="f">Naziv akcije<input data-f="in_naziv" value="' + esc(inp.naziv || '') + '" placeholder="npr. Jesenska akcija na društvene mreže"></label>' +
        '<label class="f">Povoljnost / cijena<input data-f="in_popust" value="' + esc(inp.popust || '') + '" placeholder="npr. 20% popusta na prvi mjesec"></label>' +
        '<label class="f">Vrijedi do<input type="date" data-f="in_rok" value="' + esc(inp.rok || '') + '"></label>' +
        '<label class="f">Ton poruke<select data-f="in_ton"><option value="formalan"' + (inp.ton !== 'prijateljski' && inp.ton !== 'hitan' ? ' selected' : '') + '>Formalan</option><option value="prijateljski"' + (inp.ton === 'prijateljski' ? ' selected' : '') + '>Prijateljski</option><option value="hitan"' + (inp.ton === 'hitan' ? ' selected' : '') + '>Naglasak na roku</option></select></label></div>' +
        '<label class="f">Što nudimo (kratki opis)<textarea data-f="in_ponuda" rows="3" placeholder="npr. Vođenje Facebooka i Instagrama, 12 objava mjesečno i izvještaj.">' + esc(inp.ponuda || '') + '</textarea></label>' +
        '<label class="f">Poziv na akciju / kontakt<input data-f="in_kontakt" value="' + esc(inp.kontakt || '') + '" placeholder="npr. Javite se odgovorom na ovu poruku ili nazovite 01 234 5678"></label>' +
        '<div class="row-btns start"><button class="btn sm" data-act="tplsuggest">Predloži poruku</button><span class="hint">Predloženi predmet i tekst upisuju se ispod, a možete ih urediti.</span></div></fieldset>';
    }
    h += '<label class="f wide">Tekst<textarea data-f="body" rows="' + (akc ? 9 : 6) + '">' + esc(t.body) + '</textarea></label>' +
      '<fieldset class="f wide aud"><legend>Kada se šalje</legend><div class="grid2"><label class="f">Način<select data-f="send_mode"><option value="manual"' + (mode === 'manual' ? ' selected' : '') + '>Ručno: odmah, kad pokrenem slanje</option><option value="delay"' + (mode === 'delay' ? ' selected' : '') + '>Zakazano: za određeni broj dana</option><option value="fixed"' + (mode === 'fixed' ? ' selected' : '') + '>Zakazano: točan datum i vrijeme</option></select></label>' +
      '<div class="f sch" data-sch="delay"' + (mode === 'delay' ? '' : ' hidden') + '><label class="f">Za koliko dana<input type="number" min="0" max="60" data-f="send_days" value="' + esc(t.sendDays != null ? t.sendDays : 1) + '"></label><label class="f">U koliko sati<input type="time" data-f="send_time" value="' + esc(t.sendTime || '09:00') + '"></label></div>' +
      '<label class="f sch" data-sch="fixed"' + (mode === 'fixed' ? '' : ' hidden') + '>Datum i vrijeme<input type="datetime-local" data-f="send_fixed" value="' + esc(fixedVal) + '"></label></div>' +
      '<span class="hint">' + (akc ? 'Vrijedi i za pokretanje akcije: poruke se zakazuju za to vrijeme i šalju u serijama. ' : 'Pri slanju e-maila klijentu ovaj se termin predlaže sam, a možete ga promijeniti. ') + 'Kod ručnog slanja ništa se ne zakazuje.</span></fieldset>' +
      '<div class="msg" data-msg role="alert"></div><div class="row-btns start"><button class="btn' + (t.id ? '' : ' primary') + ' sm" data-act="tplsave">' + (t.id ? 'Spremi' : (akc ? 'Dodaj akciju' : 'Dodaj predložak')) + '</button>' +
      (t.id && akc ? '<button class="btn primary sm" data-act="tplrun">Pošalji akciju…</button>' : '') +
      (t.id ? '<button class="btn sm danger" data-act="tpldel">Obriši</button>' : '') + '</div></div>';
    return h;
  }
  function tplRead(row) {
    const g = (f) => { const el = row.querySelector('[data-f="' + f + '"]'); return el ? el.value : ''; };
    const akc = row.dataset.kind === 'akcija';
    const body = { id: row.dataset.tid || undefined, kind: row.dataset.kind, name: g('name').trim(), subject: g('subject').trim(), body: g('body').trim(),
      send_mode: g('send_mode'), send_days: Number(g('send_days') || 0), send_time: g('send_time') || '09:00' };
    if (body.send_mode === 'fixed') body.send_fixed = g('send_fixed') ? new Date(g('send_fixed')).getTime() : null;
    if (akc) {
      body.audience = { groups: Array.from(row.querySelectorAll('[data-aud]:checked')).map((x) => x.dataset.aud), kind: g('aud_kind'), owner: g('aud_owner') };
      body.inputs = { naziv: g('in_naziv'), ponuda: g('in_ponuda'), popust: g('in_popust'), rok: g('in_rok'), kontakt: g('in_kontakt'), ton: g('in_ton') };
    }
    return body;
  }
  function tplSuggest(row) {
    const g = (f) => (row.querySelector('[data-f="' + f + '"]') || { value: '' }).value.trim();
    const naziv = g('in_naziv'), ponuda = g('in_ponuda'), popust = g('in_popust'), kontakt = g('in_kontakt'), ton = g('in_ton'), rokRaw = g('in_rok');
    const m = row.querySelector('[data-msg]');
    if (!naziv) { m.textContent = 'Upišite naziv akcije da bih predložio poruku.'; row.querySelector('[data-f="in_naziv"]').focus(); return; }
    m.textContent = '';
    const rok = rokRaw ? rokRaw.split('-').reverse().join('.') + '.' : '';
    const cta = kontakt || 'Za više informacija ili ponudu prilagođenu tvrtki {{tvrtka}} slobodno odgovorite na ovu poruku.';
    const lines = [];
    if (ton === 'prijateljski') {
      lines.push('Bok {{ime}},', '', 'imamo nešto što bi moglo koristiti i tvrtki {{tvrtka}}: ' + naziv + '.', '');
      if (ponuda) lines.push(ponuda, '');
      if (popust) lines.push('Za Vas: ' + popust + '.');
      if (rok) lines.push('Vrijedi do ' + rok);
    } else if (ton === 'hitan') {
      lines.push('Poštovani/a {{ime}},', '', rok ? 'do ' + rok + ' traje naša akcija: ' + naziv + '.' : 'traje naša akcija: ' + naziv + '.', '');
      if (ponuda) lines.push(ponuda, '');
      if (popust) lines.push('Povoljnost: ' + popust + '.');
      lines.push('Broj mjesta je ograničen, pa Vas molimo da se javite što prije.');
    } else {
      lines.push('Poštovani/a {{ime}},', '', 'obavještavamo Vas o našoj akciji: ' + naziv + '.', '');
      if (ponuda) lines.push(ponuda, '');
      if (popust) lines.push('Povoljnost: ' + popust + '.');
      if (rok) lines.push('Akcija traje do ' + rok);
    }
    if (lines[lines.length - 1] !== '') lines.push('');
    lines.push(cta, '', 'Lijep pozdrav,');
    row.querySelector('[data-f="body"]').value = lines.join('\n');
    const sj = row.querySelector('[data-f="subject"]');
    if (!sj.value.trim()) sj.value = naziv + (popust ? ': ' + popust : '');
    if (!row.querySelector('[data-f="name"]').value.trim()) row.querySelector('[data-f="name"]').value = naziv;
    m.textContent = 'Poruka je predložena. Pregledajte je i spremite.';
  }
  async function tplSave(row) {
    const body = tplRead(row);
    const ok = await safe(() => call('template_save', body), body.id ? 'Spremljeno' : (body.kind === 'akcija' ? 'Akcija dodana' : 'Predložak dodan'));
    if (ok) { await refresh(true); renderSettings(); }
  }
  async function tplRun(row) {
    const body = tplRead(row); const m = row.querySelector('[data-msg]');
    m.textContent = '';
    if (!body.name || !body.subject || !body.body) { m.textContent = 'Naziv, predmet i tekst su obavezni.'; return; }
    try {
      await call('template_save', body);
      const pv = await call('campaign_preview', { audience: body.audience });
      if (!pv.count) { m.textContent = 'Nijedan klijent ne odgovara odabranim skupinama (ili nema upisan e-mail).'; return; }
      const when = body.send_mode === 'manual' ? 'odmah (u serijama)' : body.send_mode === 'fixed' ? 'u ' + fmtDate(body.send_fixed) + ' ' + fmtTime(body.send_fixed) : 'za ' + body.send_days + ' d u ' + body.send_time;
      if (!confirm('Akcija "' + body.name + '" šalje se na ' + pv.count + ' adresa, ' + when + '.\n\nPrimjeri: ' + pv.sample.join(', ') + (pv.count > pv.sample.length ? '…' : '') + '\n\nNastaviti?')) { refresh(true).then(renderSettings); return; }
      const r = await call('campaign_send', { id: row.dataset.tid });
      toast('Akcija čeka odobrenje administratora: ' + r.queued + ' poruka' + (r.skipped ? ' (preskočeno ' + r.skipped + ': već poslano zadnjih 30 dana)' : '') + '. Odobrite je u E-mail kampanje.');
      await refresh(true); renderSettings();
    } catch (e) { m.textContent = e.message; }
  }
  async function pwChange() {
    const cur = $('pwCur').value, n1 = $('pwNew').value, n2 = $('pwNew2').value, m = $('pwMsg');
    if (!cur || !n1) { m.textContent = 'Upišite trenutnu i novu lozinku.'; return; }
    if (n1 !== n2) { m.textContent = 'Nove lozinke se ne podudaraju.'; return; }
    m.textContent = '';
    const ok = await safe(() => call('password_change', { current: cur, password: n1 }), 'Lozinka promijenjena');
    if (ok) { $('pwCur').value = ''; $('pwNew').value = ''; $('pwNew2').value = ''; }
  }
  async function userSave(tr) {
    const g = (f) => tr.querySelector('[data-f="' + f + '"]');
    const body = { id: tr.dataset.uid, name: g('name').value.trim(), email: g('email').value.trim(), role: g('role').value, active: g('active').checked, password: g('password').value };
    const ok = await safe(() => call('user_update', body), 'Korisnik spremljen');
    if (ok) { g('password').value = ''; refresh(true); }
  }
  async function userCreate() {
    const m = $('uMsg'); m.textContent = '';
    const body = { name: $('uName').value.trim(), email: $('uEmail').value.trim(), password: $('uPass').value, role: $('uRole').value };
    try { await call('user_create', body); toast('Korisnik dodan'); await refresh(true); renderSettings(); }
    catch (e) { m.textContent = e.message; }
  }
  async function mailTest(box) {
    const m = $('mtMsg'); m.textContent = 'Šaljem…';
    try { const r = await call('mail_test', { box: box || 1 }); m.style.color = r.ok ? 'var(--good)' : 'var(--bad)'; m.textContent = r.ok ? 'Probni e-mail poslan na ' + r.to + (r.from ? ' (pošiljatelj ' + r.from + ')' : '') + '.' : 'Slanje nije uspjelo: ' + r.error; }
    catch (e) { m.style.color = 'var(--bad)'; m.textContent = e.message; }
  }

  /* ---------- client drawer ---------- */
  function openClient(id, keep) {
    const c = byId(id); if (!c) return;
    if (!keep) S.lastFocus = document.activeElement;
    if (keep) { $('mdrawer').hidden = true; }
    S.openId = id; S.pendingStatus = null;
    const campExpired = !!c.campActive && !!c.campEnd && c.campEnd < today();
    const extraList = extraCamps(c); const extraIds = new Set(extraList.map((x) => x.id));
    const campHist = (S.campaigns || []).filter((x) => x.clientId === c.id && !extraIds.has(x.id));
    const ownerOpts = (c.ownerId ? '' : '<option value="" selected>— bez prodavača —</option>') + ownerOptions().map((o) => '<option value="' + esc(o[0]) + '"' + (o[0] === c.ownerId ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('');
    let h = '<div class="sh-h"><div><h2 id="dTitle"></h2><div class="sub"><span id="dPill"></span><span id="dSub"></span></div></div><button class="x" data-act="close" aria-label="Zatvori">×</button></div><div class="sh-b">' +
      dncBanner(c) +
      '<div class="sec"><div class="acts"><label class="f">Status<select id="stSel">' + STAGES.map((s) => '<option value="' + s.id + '">' + esc(s.label) + '</option>').join('') + '</select></label><button class="btn" data-act="mail">Napiši e-mail</button>' + (String(c.ownerId) !== String(S.me.id) ? '<button class="btn" data-act="take">Preuzmi klijenta</button>' : '') + '</div>' +
      '<div class="pending" id="stPending" hidden><p id="stLabel"></p><textarea id="stText" placeholder="Razlog promjene ili što je dogovoreno (obavezno)"></textarea><div class="msg" id="stMsg" role="alert"></div><div class="row-btns start"><button class="btn primary sm" data-act="stok">Potvrdi promjenu</button><button class="btn sm" data-act="stno">Odustani</button></div></div></div>' +
      '<div class="sec"><h3>Nova bilješka <span class="req" style="font-size:12px">obavezno</span></h3><div class="compose"><div class="row"><label class="f">Vrsta<select id="noteType"><option value="note">Bilješka</option><option value="call">Kontakt telefonom</option><option value="meeting">Sastanak</option></select></label>' +
      '<label class="f">Sljedeći kontakt (datum)<input id="noteFollow" type="date"' + (c.nextFollowUp ? ' value="' + esc(c.nextFollowUp) + '"' : '') + '></label>' +
      '<label class="f">Sat sljedećeg kontakta<input id="noteFollowT" type="time"' + (c.nextFollowTime ? ' value="' + esc(c.nextFollowTime) + '"' : '') + '></label>' +
      '<label class="f">Vrijednost (€)<input id="noteValue" type="number" min="0" step="50" inputmode="decimal" value="' + esc(c.value || '') + '"></label>' +
      '<label class="f">Status<select id="noteVKind"><option value="ponudeno"' + (c.valueKind !== 'ugovoreno' ? ' selected' : '') + '>Pregovori</option><option value="ugovoreno"' + (c.valueKind === 'ugovoreno' ? ' selected' : '') + '>Ugovoreno</option></select></label></div><textarea id="noteText" placeholder="Što je dogovoreno ili napravljeno, i koji je sljedeći korak."></textarea>' +
      '<div class="f wide campbox"><label class="chk"><input type="checkbox" id="cCamp"' + (c.campActive ? ' checked' : '') + '> Aktivni: klijent ima aktivnu kampanju</label>' +
      '<div class="grid2" id="cCampDates"' + (c.campActive ? '' : ' hidden') + '>' + campTypeSel('cCampType', c.campType) + '<label class="f">Kampanja od<input id="cCampStart" type="date" value="' + esc(c.campStart) + '"></label><label class="f">Aktivna do <span class="req">*</span><input id="cCampEnd" type="date" value="' + esc(c.campEnd) + '"></label>' +
      '<label class="f">Vrijednost (€) <span class="req">*</span><input id="cCampValue" type="number" min="0" step="10" inputmode="decimal" value="' + esc(c.campValue || '') + '"></label></div>' +
      (campExpired ? '<div class="renew" id="iRenew"><b>Kampanja je završila ' + esc(fmtYmd(c.campEnd)) + ' Upišite novu kampanju:</b><div class="grid2">' + campTypeSel('rType', c.campType) + '<label class="f">Od<input id="rStart" type="date" value="' + today() + '"></label><label class="f">Do <span class="req">*</span><input id="rEnd" type="date"></label><label class="f">Vrijednost (€) <span class="req">*</span><input id="rValue" type="number" min="0" step="10" inputmode="decimal"></label></div><div class="msg" id="rMsg" role="alert"></div><div class="row-btns start"><button class="btn primary sm" data-act="renew">Spremi novu kampanju</button></div></div>' : '') +
      '<div class="multibox"><label class="chk"><input type="checkbox" id="cMulti"' + (c.multiCamp ? ' checked' : '') + '> Marketing agencija: može imati više aktivnih kampanja odjednom</label>' +
      (c.multiCamp ? '<div class="campnote">Dodatne aktivne kampanje</div>' + (extraList.length ? '<ul class="camphist">' + extraList.map((x) => '<li>' + (x.title ? esc(x.title) + ' · ' : '') + esc(fmtYmd(x.start) + ' – ' + fmtYmd(x.end)) + (x.type === 'godisnji' ? ' · ugovor (' + (x.months || 12) + ' mj. × ' + eur(x.value / (x.months || 12)) + ')' : '') + ' · <b>' + esc(eur(x.value)) + '</b> <button class="btn sm" data-act="campdel" data-id="' + esc(x.id) + '">Obriši</button></li>').join('') + '</ul>' : '<div class="campnote">Nema dodatnih aktivnih kampanja.</div>') +
        '<div class="grid2">' + campTypeSel('xType', 'jednokratno') + '<label class="f">Naziv (nije obavezno)<input id="xTitle" type="text" maxlength="190"></label><label class="f">Od<input id="xStart" type="date" value="' + today() + '"></label><label class="f">Do <span class="req">*</span><input id="xEnd" type="date"></label><label class="f">Vrijednost (€) <span class="req">*</span><input id="xValue" type="number" min="0" step="10" inputmode="decimal"></label></div><div class="msg" id="xMsg" role="alert"></div><div class="row-btns start"><button class="btn sm" data-act="campadd">Dodaj kampanju</button></div>' : '') + '</div>' +
      (campHist.length ? '<div class="campnote">Prošle kampanje</div><ul class="camphist">' + campHist.map((x) => '<li>' + esc(fmtYmd(x.start) + ' – ' + fmtYmd(x.end)) + (x.type === 'godisnji' ? ' · ugovor (' + (x.months || 12) + ' mj. × ' + eur(x.value / (x.months || 12)) + ')' : '') + ' · <b>' + esc(eur(x.value)) + '</b></li>').join('') + '</ul>' : '') +
      '<span class="campnote">Vrijedi samo uz aktivnu kampanju. Kampanje kraće od 7 dana (i dnevne) označene su ljubičasto. Klijent s aktivnom kampanjom ima status Aktivni, ali status Aktivni može imati i klijent bez kampanje (mijenja se u kartici klijenta). Kad kampanji istekne termin, status se ne mijenja. Za novu kampanju ponovno označite Aktivni i upišite termin i vrijednost u eurima. Promjena se sprema zajedno s bilješkom.</span></div>' +
      '<div class="foot"><span class="msg" id="noteMsg" role="alert"></span><button class="btn primary" data-act="note">Spremi bilješku</button></div></div></div>' +
      '<div class="sec" id="schedSec" hidden><h3>Zakazano slanje</h3><ul class="docs" id="schedList"></ul></div>' +
      '<div class="sec"><h3>Zadaci <small id="dTkCount"></small></h3><ul class="list tasks" id="dTkList"></ul>' + taskForm('dTk', c.id) + '</div>' +
      '<div class="sec"><h3>Dokumenti <small id="docCount"></small></h3><ul class="docs" id="docList"></ul><div class="acts"><label class="btn sm filebtn">Dodaj dokument<input type="file" id="docFile" hidden></label><span class="hint" id="docMsg">najviše 10 MB po datoteci</span></div></div>' +
      '<div class="sec"><h3>Povijest <small id="tlCount"></small></h3><ol class="tl" id="tl"></ol></div>' +
      (isAdmin() ? '<details class="info"><summary>Dnevnik promjena</summary><ul class="audit" id="dAudit"><li class="muted">Učitavanje…</li></ul></details>' : '') +
      '<details class="info"><summary>Podaci o klijentu</summary><div class="grid2">' +
      '<label class="f">Vrsta klijenta<select id="iKind"><option value="tvrtka"' + (c.kind !== 'osoba' ? ' selected' : '') + '>Tvrtka</option><option value="osoba"' + (c.kind === 'osoba' ? ' selected' : '') + '>Fizička osoba</option></select></label>' +
      '<label class="f"><span><span id="iNameL">' + (c.kind === 'osoba' ? 'Ime i prezime' : 'Naziv tvrtke') + '</span> <span class="req">*</span></span><input id="iName" value="' + esc(c.name) + '"></label>' +
      '<label class="f" id="iContactW"' + (c.kind === 'osoba' ? ' hidden' : '') + '><span>Kontakt osoba <span class="req">*</span></span><input id="iContact" value="' + esc(c.kind === 'osoba' ? '' : c.contact) + '"></label><label class="f">OIB<input id="iOib" inputmode="numeric" maxlength="11" value="' + esc(c.oib || '') + '"></label>' +
      '<label class="f">E-mail<input id="iEmail" type="email" value="' + esc(c.email) + '"></label><label class="f">Telefon<input id="iPhone" type="tel" value="' + esc(c.phone) + '"></label><label class="f">Dodatni e-mail (u kopiji – CC)<input id="iEmail2" type="email" value="' + esc(c.email2 || '') + '" placeholder="nije obavezno"></label><label class="f wide">Adresa<input id="iAddr" maxlength="255" value="' + esc(c.address || '') + '"></label>' +
      '<label class="f">Djelatnost<input id="iIndustry" list="industryList" maxlength="120" autocomplete="off" placeholder="upišite ili odaberite postojeću" value="' + esc(c.industry || '') + '"></label>' +
      '<div class="f"><span>Usluga (možete odabrati više)</span><div class="svcbox" id="iService">' + svcBox(c.service) + '</div></div>' +
      '<label class="f">Prodavač<select id="iOwner">' + ownerOpts + '</select></label>' +
      '<div class="f wide campbox" id="contractBox"><label class="chk"><input type="checkbox" id="iContract"' + (c.hasContract ? ' checked' : '') + '> Klijent ima ugovor</label>' +
      '<div id="iContractW"' + (c.hasContract ? '' : ' hidden') + '><label class="f">Ugovor vrijedi do <span class="req">*</span><input id="iContractEnd" type="date" value="' + esc(c.contractEnd || '') + '"></label>' +
      '<div class="campnote">Datoteka ugovora (PDF ili Word)</div><ul class="docs" id="contractList"></ul>' +
      '<div class="acts"><label class="btn sm filebtn">Dodaj ugovor<input type="file" id="contractFile" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden></label><span class="hint" id="contractMsg">PDF ili Word, najviše 10 MB</span></div></div></div>' +
      '</div>' +
      '<div class="msg" id="iMsg" role="alert"></div><div class="row-btns start" style="margin-top:6px"><button class="btn" data-act="saveinfo">Spremi podatke</button></div></details>' +
      (canDelete(c) ? '<div class="danger-z"><button class="btn danger sm" data-act="del1">Obriši klijenta</button><span id="delConfirm" hidden><span class="hint">Briše klijenta i sve njegove bilješke. Ne može se poništiti. </span><button class="btn danger sm" data-act="del2">Da, obriši</button></span></div>' : '') + '</div>';
    $('dSheet').innerHTML = h;
    annInit('cCampType', c); if ($('rType')) annInit('rType', c); if ($('xType')) annInit('xType', null);
    $('drawer').hidden = false; document.body.classList.add('lock');
    updateDrawer();
    if (!matchMedia('(pointer:coarse)').matches) $('noteText').focus();
  }
  function updateDrawer() {
    if (!S.openId || $('drawer').hidden) return;
    const c = byId(S.openId);
    if (!c) { closeAll(); toast('Klijent je obrisan.'); return; }
    $('dTitle').textContent = c.name;
    $('dPill').innerHTML = pill(c.status);
    $('dSub').textContent = (c.kind === 'osoba' ? 'Fizička osoba' : (c.contact || '')) + (c.industry ? ' · ' + c.industry : '') + ' · Prodavač: ' + person(c.ownerId);
    const docs = (S.docsByClient && S.docsByClient.get(c.id)) || [];
    if ($('contractList')) {
      const cd = docs.filter((d) => d.contract);
      $('contractList').innerHTML = cd.length ? cd.map((d) => '<li><a class="doclink" href="api.php?a=doc_download&id=' + encodeURIComponent(d.id) + '">' + esc(d.name) + '</a><span class="hint">' + esc(fmtSize(d.size)) + ' · ' + fmtDate(d.createdAt) + '</span>' +
        ((isAdmin() || d.by === S.me.id || String(c.ownerId) === String(S.me.id)) ? '<button class="btn sm danger" data-act="docdel" data-id="' + esc(d.id) + '">Obriši</button>' : '') + '</li>').join('') : '<li class="hint">Ugovor još nije učitan.</li>';
    }
    $('docCount').textContent = docs.length ? docs.length + ' ' + plural(docs.length, 'datoteka', 'datoteka') : '';
    $('docList').innerHTML = docs.length ? docs.map((d) => '<li><a class="doclink" href="api.php?a=doc_download&id=' + encodeURIComponent(d.id) + '">' + esc(d.name) + '</a><span class="hint">' + esc(fmtSize(d.size)) + ' · ' + fmtDate(d.createdAt) + (d.emailId ? ' · iz e-maila' : '') + (d.contract ? ' · ugovor' : '') + '</span>' +
      ((isAdmin() || d.by === S.me.id || String(c.ownerId) === String(S.me.id)) ? '<button class="btn sm danger" data-act="docdel" data-id="' + esc(d.id) + '">Obriši</button>' : '') + '</li>').join('') : '<li class="hint">Nema dokumenata. Dodajte ponudu, ugovor ili drugi dokument.</li>';
    const sc = S.scheduled.filter((x) => x.clientId === c.id);
    const tk = S.tasks.filter((t) => t.clientId === c.id).sort((a, b) => (a.doneAt ? 1 : 0) - (b.doneAt ? 1 : 0) || a.due.localeCompare(b.due));
    $('dTkCount').textContent = tk.filter((t) => !t.doneAt).length ? tk.filter((t) => !t.doneAt).length + ' otvoreno' : '';
    $('dTkList').innerHTML = tk.length ? tk.map((t) => taskLi(t, false)).join('') : '<li class="muted pad">Nema zadataka za ovog klijenta.</li>';
    loadClientAudit(c.id);
    $('schedSec').hidden = !sc.length;
    $('schedList').innerHTML = sc.map((x) => '<li><span><b>' + esc(x.subject) + '</b> <span class="hint">' + (x.status === 'failed' ? 'nije poslano: ' + esc(x.error) : 'šalje se ' + fmtDate(x.sendAt) + ' ' + fmtTime(x.sendAt)) + ' · ' + esc(person(x.userId)) + '</span></span>' +
      (x.status !== 'sending' && (isAdmin() || x.userId === S.me.id) ? '<button class="btn sm" data-act="schedcancel" data-id="' + esc(x.id) + '">Otkaži</button>' : '') + '</li>').join('');
    if (!S.pendingStatus) $('stSel').value = c.status;
    const items = (S.byClient.get(c.id) || []).map((n) => ({ kind: n.type, ts: n.createdAt, n }))
      .concat((S.inByClient.get(c.id) || []).map((e) => ({ kind: 'inmail', ts: e.date, e }))).sort((a, b) => b.ts - a.ts);
    $('tlCount').textContent = items.length ? items.length + ' ' + plural(items.length, 'zapis', 'zapisa') : '';
    $('tl').innerHTML = items.length ? items.map((it) => {
      let who, body;
      if (it.kind === 'inmail') { who = it.e.fromName || it.e.fromEmail; body = '<span class="subj">' + esc(it.e.subject || '(bez predmeta)') + '</span>' + esc(it.e.preview) + ' <button class="open-mail" data-mail="' + esc(it.e.id) + '">Otvori poruku</button>'; }
      else if (it.kind === 'email') { who = person(it.n.authorId); const t = it.n.text || ''; body = '<span class="subj">' + (it.n.bulk ? '<span class="chip">grupni</span> ' : '') + esc(it.n.subject || '(bez predmeta)') + '</span>' + esc(t.length > 500 ? t.slice(0, 500) + '…' : t); }
      else { who = person(it.n.authorId); body = esc(it.n.text); }
      return '<li class="t-' + esc(it.kind) + '"><span class="rail"><i></i><u></u></span><div><div class="h"><b>' + esc(TYPES[it.kind] || 'Bilješka') + '</b><span>' + esc(who) + '</span><span class="nums">' + fmtDate(it.ts) + ' ' + fmtTime(it.ts) + '</span></div><div class="b">' + body + '</div></div></li>';
    }).join('') : '<li><span></span><div class="hint">Još nema bilješki. Upišite prvu iznad.</div></li>';
  }
  function closeAll() {
    ['mMail', 'mNew', 'drawer', 'mdrawer'].forEach((i) => { $(i).hidden = true; });
    document.body.classList.remove('lock'); S.openId = null; S.pendingStatus = null; S.openMailId = null;
    if (S.lastFocus && S.lastFocus.focus && document.contains(S.lastFocus)) S.lastFocus.focus();
  }
  function closeTop() {
    if ($('toolModal') && !$('toolModal').hidden) { $('toolModal').hidden = true; return; }
    if (!$('mMail').hidden) { $('mMail').hidden = true; return; }
    if (!$('mNew').hidden) { $('mNew').hidden = true; if ($('drawer').hidden && $('mdrawer').hidden) document.body.classList.remove('lock'); return; }
    if (!$('mdrawer').hidden) { $('mdrawer').hidden = true; S.openMailId = null; if ($('drawer').hidden) document.body.classList.remove('lock'); return; }
    closeAll();
  }

  /* ---------- client actions ---------- */
  async function saveNote() {
    const c = byId(S.openId); if (!c) return;
    const ta = $('noteText'); const text = ta.value.trim();
    if (text.length < 3) { $('noteMsg').textContent = 'Bilješka je obavezna. Upišite što je dogovoreno ili napravljeno.'; ta.focus(); return; }
    const body = { client_id: c.id, type: $('noteType').value, text };
    const fu = $('noteFollow').value, fut = $('noteFollowT').value;
    if (fu && (fu !== c.nextFollowUp || fut !== (c.nextFollowTime || ''))) { body.next_follow_up = fu; body.next_follow_time = fut; }
    const nv = $('noteValue').value, nk = $('noteVKind').value;
    if (nk !== (c.valueKind || 'ponudeno') && !$('cCamp').checked && !(Number(nv) > 0)) { $('noteMsg').textContent = 'Za status (' + (nk === 'ugovoreno' ? 'ugovoreno' : 'pregovori') + ') upišite Vrijednost (€).'; $('noteValue').focus(); return; }
    if (nv !== '' && (Number(nv) !== Number(c.value || 0) || nk !== (c.valueKind || 'ponudeno'))) { body.value = Number(nv); body.value_kind = nk; }
    const on = $('cCamp').checked, cs = $('cCampStart').value, ce = $('cCampEnd').value, cv = $('cCampValue').value;
    const ct = $('cCampType').value; const campChanged = on !== !!c.campActive || (on && (ct !== (c.campType || 'jednokratno') || ce !== (c.campEnd || '') || (cs || '') !== (c.campStart || '') || annAmount('cCampType').value !== Number(c.campValue || 0) || (ct === 'godisnji' && annAmount('cCampType').months !== (c.campMonths || 12))));
    if (campChanged && on) {
      if (!ce) { $('noteMsg').textContent = 'Odaberite točan datum do kada je kampanja aktivna.'; $('cCampEnd').focus(); return; }
      if (cs && cs > ce) { $('noteMsg').textContent = 'Početak kampanje ne može biti nakon datuma završetka.'; return; }
      if (cv === '' || Number(cv) < 0) { $('noteMsg').textContent = 'Upišite vrijednost kampanje.'; $('cCampValue').focus(); return; }
    }
    if (campChanged) Object.assign(body, { camp_active: on, camp_start: cs, camp_end: ce, camp_value: annAmount('cCampType').value, camp_months: annAmount('cCampType').months, camp_type: ct });
    $('noteMsg').textContent = '';
    const ok = await safe(() => call('note_add', body), 'Bilješka spremljena');
    if (ok) { ta.value = ''; await refresh(true); }
  }
  function onStatusChange() {
    const c = byId(S.openId); if (!c) return;
    const v = $('stSel').value;
    if (v === c.status) { cancelStatus(); return; }
    S.pendingStatus = v;
    $('stLabel').textContent = 'Promjena: ' + STAGE[c.status].label + ' → ' + STAGE[v].label + '. Upišite razlog.';
    $('stPending').hidden = false; $('stText').focus();
  }
  function cancelStatus() {
    const c = byId(S.openId); S.pendingStatus = null;
    if (c && $('stSel')) $('stSel').value = c.status;
    if ($('stPending')) $('stPending').hidden = true;
    if ($('stMsg')) $('stMsg').textContent = '';
  }
  async function confirmStatus() {
    const c = byId(S.openId), v = S.pendingStatus; if (!c || !v) return;
    const text = $('stText').value.trim();
    if (text.length < 3) { $('stMsg').textContent = 'Razlog je obavezan.'; $('stText').focus(); return; }
    const ok = await safe(() => call('status_change', { client_id: c.id, status: v, text }), 'Status promijenjen');
    if (ok) { $('stText').value = ''; S.pendingStatus = null; $('stPending').hidden = true; await refresh(true); }
  }
  async function saveInfo() {
    const c = byId(S.openId); if (!c) return;
    const kind = $('iKind').value, name = $('iName').value.trim(), contact = $('iContact').value.trim(), email = $('iEmail').value.trim(), oib = $('iOib').value.trim();
    if (!name || (kind === 'tvrtka' && !contact)) { $('iMsg').textContent = kind === 'osoba' ? 'Ime i prezime je obavezno.' : 'Tvrtka i kontakt osoba su obavezni.'; return; }
    if (oib && !/^\d{11}$/.test(oib)) { $('iMsg').textContent = 'OIB mora imati 11 znamenki.'; return; }
    if (email && email.indexOf('@') < 1) { $('iMsg').textContent = 'E-mail adresa nije ispravna.'; return; }
    if ($('iContract').checked && !$('iContractEnd').value) { $('iMsg').textContent = 'Odaberite datum do kada je ugovor aktivan.'; $('iContractEnd').focus(); return; }
    $('iMsg').textContent = '';
    const ok = await safe(() => call('client_update', { id: c.id, kind, oib, name, contact: kind === 'osoba' ? name : contact, email, phone: $('iPhone').value.trim(), address: $('iAddr').value.trim(), email2: $('iEmail2').value.trim(), service: svcRead('iService'), industry: $('iIndustry').value.trim(), owner_id: $('iOwner').value, has_contract: $('iContract').checked, contract_end: $('iContractEnd').value }), 'Podaci spremljeni');
    if (ok) refresh(true);
  }
  async function renewCampaign() {
    const c = byId(S.openId); if (!c) return;
    const m = $('rMsg'), st = $('rStart').value, en = $('rEnd').value, v = $('rValue').value;
    if (!en) { m.textContent = 'Odaberite točan datum završetka nove kampanje.'; $('rEnd').focus(); return; }
    if (st && st > en) { m.textContent = 'Početak ne može biti nakon završetka.'; return; }
    if (v === '' || Number(v) < 0) { m.textContent = 'Upišite vrijednost nove kampanje.'; $('rValue').focus(); return; }
    m.textContent = '';
    const ok = await safe(() => call('campaign_renew', { client_id: c.id, start: st, end: en, value: annAmount('rType').value, months: annAmount('rType').months, type: $('rType').value }), 'Nova kampanja spremljena');
    if (ok) { await refresh(true); openClient(c.id, true); }
  }
  async function addExtraCamp() {
    const c = byId(S.openId); if (!c) return;
    const m = $('xMsg'), st = $('xStart').value, en = $('xEnd').value, v = $('xValue').value;
    if (!en) { m.textContent = 'Odaberite točan datum završetka kampanje.'; $('xEnd').focus(); return; }
    if (st && st > en) { m.textContent = 'Početak ne može biti nakon završetka.'; return; }
    if (v === '' || Number(v) < 0) { m.textContent = 'Upišite vrijednost kampanje.'; $('xValue').focus(); return; }
    m.textContent = '';
    const ok = await safe(() => call('campaign_add', { client_id: c.id, title: $('xTitle').value.trim(), start: st, end: en, value: annAmount('xType').value, months: annAmount('xType').months, type: $('xType').value }), 'Kampanja dodana');
    if (ok) { await refresh(true); openClient(c.id, true); }
  }
  async function delExtraCamp(id) {
    const c = byId(S.openId); if (!c) return;
    const ok = await safe(() => call('campaign_remove', { id }), 'Kampanja obrisana');
    if (ok) { await refresh(true); openClient(c.id, true); }
  }
  async function setMulti(on) {
    const c = byId(S.openId); if (!c) return;
    const ok = await safe(() => call('client_multi', { client_id: c.id, on }), on ? 'Označeno kao marketing agencija' : 'Oznaka maknuta');
    await refresh(true); openClient(c.id, true);
  }
  async function deleteClient() {
    const c = byId(S.openId); if (!c) return;
    const ok = await safe(() => call('client_delete', { id: c.id }), 'Klijent obrisan');
    if (ok) { closeAll(); refresh(true); }
  }

  /* ---------- new client ---------- */
  const nKind = () => { const r = document.querySelector('input[name="nKindR"]:checked'); return r ? r.value : ''; };
  function applyNewKind() {
    const k = nKind();
    $('nNameL').textContent = k === 'osoba' ? 'Ime i prezime' : 'Naziv tvrtke';
    $('nContactW').hidden = k === 'osoba';
    if (k === 'osoba' && !$('nName').value.trim() && S.nGuess) $('nName').value = S.nGuess;
    if (k === 'tvrtka' && !$('nContact').value.trim() && S.nGuess) $('nContact').value = S.nGuess;
  }
  /* tjedni ciljevi prihoda */
  async function loadGoals(force) {
    if (S.goalBusy || (!force && S.goals && Date.now() - S.goalAt < 30000)) return;
    S.goalBusy = true;
    try { S.goals = await call('goals', null, 'GET'); S.goalAt = Date.now(); if (S.tab === 'pregled') renderGoals(); } catch (e) { /* ignore */ } finally { S.goalBusy = false; }
  }
  function goalBar(name, goal, cur, prev, strong) {
    const pct = goal > 0 ? Math.round(cur / goal * 100) : 0; const w = Math.max(0, Math.min(100, pct));
    const left = Math.max(0, goal - cur);
    const state = goal <= 0 ? '' : pct >= 100 ? 'goal-done' : pct >= 60 ? 'goal-mid' : 'goal-low';
    const d = cur - prev;
    return '<div class="goalrow ' + state + (strong ? ' strong' : '') + '"><div class="gtop"><b>' + esc(name) + '</b><span class="nums">' + eur(cur) + (goal > 0 ? ' <small>od ' + eur(goal) + '</small>' : '') + '</span></div>' +
      (goal > 0 ? '<div class="mini goalbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + w + '"><i style="width:' + w + '%"></i></div>' : '<div class="hint">Cilj nije postavljen.</div>') +
      '<div class="gfoot"><small>' + (goal > 0 ? (pct >= 100 ? 'Cilj ostvaren (' + pct + ' %)' + (cur > goal ? ', iznad cilja ' + eur(cur - goal) : '') : pct + ' % cilja, još ' + eur(left)) : '') + '</small><small class="tr ' + (d > 0 ? 'up' : d < 0 ? 'down' : 'eq') + '">' + (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '= ') + eur(Math.abs(d)) + ' u odnosu na prošli tjedan</small></div></div>';
  }
  function renderGoals() {
    const el = $('goalPanel'); if (!el) return;
    const G = S.goals; if (!G || !G.rows || !G.rows.some((r) => r.goal > 0 || !G.admin)) { el.innerHTML = ''; el.hidden = true; return; }
    el.hidden = false;
    let h = '<header><h3>Tjedni cilj prihoda</h3><span class="muted">' + esc(fmtYmd(G.week)) + ' – ' + esc(fmtYmd(G.weekEnd)) + ' · kampanja se računa u tjednu početka</span></header><div class="pad goalwrap">';
    if (G.admin && G.total) h += goalBar('Ukupno (svi prodavači)', G.total.goal, G.total.cur, G.total.prev, true);
    G.rows.filter((r) => r.goal > 0 || !G.admin).forEach((r) => { h += goalBar(r.name, r.goal, r.cur, r.prev, false); });
    el.innerHTML = h + '</div>';
  }
  async function saveGoals() {
    const goals = {}; document.querySelectorAll('[data-goal]').forEach((i) => { goals[i.dataset.goal] = Number(i.value) || 0; });
    const ok = await safe(() => call('goals_save', { goals }), 'Ciljevi spremljeni');
    if (ok) { S.goals = null; loadGoals(true); }
  }
  function goalSettingsHtml() {
    if (!S.goals && !S.goalBusy && !S.goalTried) { S.goalTried = true; loadGoals(true).then(() => { if (S.tab === 'postavke') renderSettings(); }); }
    const sellers = S.users.filter((u) => u.role === 'sales' && u.active);
    const cur = (S.goals && S.goals.rows) || [];
    return '<section class="panel-b"><header><h3>Tjedni cilj prihoda</h3><span class="muted">u eurima po prodavaču; prikazuje se na Pregledu</span></header><div class="pad">' +
      (sellers.length ? '<div class="grid2">' + sellers.map((u) => { const r = cur.find((x) => x.userId === u.id); return '<label class="f">' + esc(u.name) + ' (€ tjedno)<input type="number" min="0" step="50" inputmode="decimal" data-goal="' + esc(u.id) + '" value="' + esc(r && r.goal ? r.goal : '') + '"></label>'; }).join('') + '</div>' : '<p class="muted">Nema aktivnih prodavača.</p>') +
      '<div class="row-btns start"><button class="btn primary" data-act="goalsave">Spremi ciljeve</button></div><p class="hint">Svaki prodavač vidi samo svoj cilj i napredak, a administrator vidi svakog prodavača i zbroj.</p></div></section>';
  }
  const campTypeSel = (id, val) => '<label class="f wide">Vrsta<select id="' + id + '"><option value="jednokratno"' + (val !== 'godisnji' ? ' selected' : '') + '>Jednokratna kampanja</option><option value="godisnji"' + (val === 'godisnji' ? ' selected' : '') + '>Ugovor (mjesečni iznos × broj mjeseci)</option></select></label>';
  const campTypeTxt = (t) => (t === 'godisnji' ? 'ugovor' : 'jednokratno');
  /* godišnji ugovor: upisuje se mjesečni iznos i broj mjeseci (1-12); vrijednost ugovora = iznos x mjeseci */
  const ANN = { nCampType: ['nCampValue', 'nCampStart', 'nCampEnd'], cCampType: ['cCampValue', 'cCampStart', 'cCampEnd'], rType: ['rValue', 'rStart', 'rEnd'], xType: ['xValue', 'xStart', 'xEnd'] };
  function annSync(typeId, setEnd) {
    const a = ANN[typeId]; const sel = $(typeId), v = a && $(a[0]); if (!sel || !v) return;
    const g = sel.value === 'godisnji'; const lab = v.closest('label');
    let m = $(a[0] + 'M');
    if (!m) {
      lab.insertAdjacentHTML('afterend', '<label class="f ann" data-ann="' + a[0] + '" hidden>Broj mjeseci (1–12) <span class="req">*</span><select id="' + a[0] + 'M">' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((k) => '<option value="' + k + '"' + (k === 12 ? ' selected' : '') + '>' + k + '</option>').join('') + '</select></label>' +
        '<label class="f ann" data-ann="' + a[0] + '" hidden>Vrijednost ugovora (€)<input id="' + a[0] + 'T" type="text" readonly tabindex="-1"></label>');
      m = $(a[0] + 'M');
    }
    if (lab.firstChild && lab.firstChild.nodeType === 3) lab.firstChild.nodeValue = g ? 'Mjesečni iznos (€) ' : (lab.dataset.orig || (lab.dataset.orig = lab.firstChild.nodeValue));
    if (g && lab.dataset.orig === undefined) lab.dataset.orig = 'Vrijednost (€) ';
    document.querySelectorAll('[data-ann="' + a[0] + '"]').forEach((x) => { x.hidden = !g; });
    $(a[0] + 'T').value = g ? eur((Number(v.value) || 0) * Number(m.value)) : '';
    const st = $(a[1]), en = $(a[2]);
    if (g && setEnd && st && en) { const d = new Date((st.value || today()) + 'T12:00:00'); d.setMonth(d.getMonth() + Number(m.value)); d.setDate(d.getDate() - 1); en.value = ymd(d); }
  }
  /* iznos za slanje: za godišnji ugovor ukupna vrijednost ugovora i broj mjeseci */
  function annAmount(typeId) {
    const a = ANN[typeId]; const g = $(typeId).value === 'godisnji'; const raw = $(a[0]).value;
    if (!g) return { value: Number(raw) || 0, months: 12 };
    const mo = Number($(a[0] + 'M').value) || 12;
    return { value: Math.round((Number(raw) || 0) * mo * 100) / 100, months: mo };
  }
  function annInit(typeId, c) {
    annSync(typeId, false);
    if (c && c.campType === 'godisnji' && $(typeId) && $(typeId).value === 'godisnji') {
      const a = ANN[typeId]; const mo = c.campMonths || 12;
      $(a[0] + 'M').value = String(mo); $(a[0]).value = c.campValue ? String(Math.round(c.campValue / mo * 100) / 100) : ''; annSync(typeId, false);
    }
  }
  function campTypeChanged(sel, startId, endId) { annSync(sel.id, true); }
  document.addEventListener('change', (e) => { const id = e.target && e.target.id; if (id === 'plType' || id === 'plMonths' || id === 'plStart') plSync(true); });
  document.addEventListener('input', (e) => { if (e.target && e.target.id === 'plAmt') plSync(false); });
  document.addEventListener('input', (e) => { const id = e.target && e.target.id; if (!id) return; Object.keys(ANN).forEach((t) => { if (ANN[t][0] === id) annSync(t, false); }); });
  document.addEventListener('change', (e) => {
    const id = e.target && e.target.id; if (!id) return;
    Object.keys(ANN).forEach((t) => { if (id === ANN[t][0] + 'M' || id === ANN[t][1]) annSync(t, true); });
  });
  /* pretraga kroz sve: klijenti, bilješke i poruke */
  let gTimer = null, gSeq = 0;
  async function globalSearch(q) {
    const box = $('gres'); if (!box) return;
    q = q.trim();
    if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
    const seq = ++gSeq; let r;
    try { r = await call('search&q=' + encodeURIComponent(q), null, 'GET'); } catch (e) { return; }
    if (seq !== gSeq) return;
    const sec = (title, items) => items.length ? '<div class="gh">' + title + '</div>' + items.join('') : '';
    const noteLbl = { note: 'bilješka', call: 'poziv', meeting: 'sastanak', email: 'e-mail', inmail: 'e-mail', status: 'status' };
    const h = sec('Klijenti', r.clients.map((c) => '<button type="button" class="gi" data-gopen="' + esc(c.id) + '"><b>' + esc(c.name) + '</b><small>' + esc((c.contact || '') + (c.email ? ' · ' + c.email : '')) + '</small></button>')) +
      sec('Bilješke', r.notes.map((n) => '<button type="button" class="gi" data-gopen="' + esc(n.clientId) + '"><b>' + esc(n.client) + ' <span class="tag">' + esc(noteLbl[n.type] || n.type) + '</span></b><small>' + esc(n.snip) + '</small></button>')) +
      sec('Poruke', r.emails.map((m) => '<button type="button" class="gi" data-gmail="' + esc(m.id) + '"><b>' + esc(m.subject || '(bez predmeta)') + ' <span class="tag">' + (m.dir === 'in' ? 'primljeno' : 'poslano') + '</span></b><small>' + esc(m.who) + ' · ' + esc(m.snip) + '</small></button>'));
    box.innerHTML = h || '<div class="gh">Nema rezultata za „' + esc(q) + '“.</div>'; box.hidden = false;
  }
  function globalSearchClose() { const b = $('gres'); if (b) { b.hidden = true; } }
  /* upozorenje o mogućem duplikatu: isti OIB, isti e-mail ili sličan naziv */
  const nameKey = (n) => String(n || '').toLowerCase().replace(/dž/g, 'dz').replace(/[čć]/g, 'c').replace(/ž/g, 'z').replace(/š/g, 's').replace(/đ/g, 'd').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !['doo', 'jdoo', 'dd', 'obrt', 'vl', 'vlasnik', 'ltd', 'gmbh', 'd', 'o', 'j', 'sa', 'za', 'i'].includes(w)).join(' ');
  function findDupes(name, oib, email) {
    const nk = nameKey(name), em = String(email || '').trim().toLowerCase(), ob = String(oib || '').trim(); const out = [];
    S.clients.forEach((c) => {
      const why = [];
      if (ob.length >= 8 && c.oib === ob) why.push('isti OIB');
      if (em && String(c.email || '').toLowerCase() === em) why.push('isti e-mail');
      const ck = nameKey(c.name);
      if (nk.length >= 4 && ck.length >= 4 && (ck === nk || (Math.min(ck.length, nk.length) >= 5 && (ck.includes(nk) || nk.includes(ck))))) why.push('sličan naziv');
      if (why.length) out.push({ c, why });
    });
    return out.slice(0, 5);
  }
  function checkDupes() {
    const box = $('nDup'); if (!box) return;
    const d = findDupes($('nName').value, $('nOib').value, $('nEmail').value);
    if (!d.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.innerHTML = '<div><b>Moguć duplikat:</b> ' + d.map((x) => '<button type="button" class="lnk" data-open="' + esc(x.c.id) + '">' + esc(x.c.name) + '</button> (' + esc(x.why.join(', ')) + (x.c.ownerId ? ', prodavač: ' + esc(person(x.c.ownerId)) : '') + ')').join('; ') + '. Provjerite prije spremanja; spremanje je i dalje moguće.</div>';
    box.hidden = false;
  }
  function openNew(prefill) {
    S.lastFocus = document.activeElement;
    ['nName', 'nContact', 'nOib', 'nIndustry', 'nEmail', 'nEmail2', 'nPhone', 'nValue', 'nFollow', 'nFollowT', 'nNote', 'nCampStart', 'nCampEnd', 'nCampValue'].forEach((i) => { $(i).value = ''; });
    $('nCamp').checked = false; $('nCampDates').hidden = true; $('nCampType').value = 'jednokratno'; annSync('nCampType', false); $('nVKind').value = ''; $('nValReq').hidden = true; if ($('nDup')) { $('nDup').hidden = true; $('nDup').innerHTML = ''; }
    S.nFromMail = prefill ? prefill.emailId || null : null; S.nGuess = prefill ? prefill.guess || '' : '';
    document.querySelectorAll('input[name="nKindR"]').forEach((r) => { r.checked = !prefill && r.value === 'tvrtka'; });
    $('nHint').hidden = !prefill; applyNewKind();
    $('nService').innerHTML = svcBox('');
    fillSelect($('nStatus'), STAGES.filter((s) => OPEN[s.id]).map((s) => [s.id, s.label]), 'novi');
    fillSelect($('nOwner'), activeUsers().map((u) => [u.id, u.name + (u.id === S.me.id ? ' (ja)' : '')]), S.me.id);
    if (prefill) { $('nEmail').value = prefill.email || ''; $('nEmail').dispatchEvent(new Event('input', { bubbles: true })); $('nNote').value = prefill.note || ''; }
    $('nMsg').textContent = '';
    $('mNew').hidden = false; document.body.classList.add('lock');
    $('nName').focus(); setTimeout(checkDupes, 0);
  }
  async function submitNew(ev) {
    ev.preventDefault();
    const kind = nKind(), oib = $('nOib').value.trim();
    const name = $('nName').value.trim(), contact = kind === 'osoba' ? name : $('nContact').value.trim(), email = $('nEmail').value.trim(), note = $('nNote').value.trim(); const m = $('nMsg');
    if (!kind) { m.textContent = 'Odaberite vrstu klijenta: tvrtka ili fizička osoba.'; return; }
    if (!name) { m.textContent = kind === 'osoba' ? 'Upišite ime i prezime.' : 'Upišite naziv tvrtke.'; $('nName').focus(); return; }
    if (!contact) { m.textContent = 'Upišite kontakt osobu.'; $('nContact').focus(); return; }
    if (oib && !/^\d{11}$/.test(oib)) { m.textContent = 'OIB mora imati 11 znamenki.'; $('nOib').focus(); return; }
    if (email && email.indexOf('@') < 1) { m.textContent = 'E-mail adresa nije ispravna.'; $('nEmail').focus(); return; }
    if ($('nEmail2').value.trim() && $('nEmail2').value.indexOf('@') < 1) { m.textContent = 'Dodatna e-mail adresa nije ispravna.'; $('nEmail2').focus(); return; }
    if ($('nVKind').value && !$('nCamp').checked && !(Number($('nValue').value) > 0)) { m.textContent = 'Za status (' + ($('nVKind').value === 'ugovoreno' ? 'ugovoreno' : 'pregovori') + ') upišite Vrijednost (€).'; $('nValue').focus(); return; }
    if (note.length < 3) { m.textContent = 'Prva bilješka je obavezna.'; $('nNote').focus(); return; }
    if ($('nCamp').checked && !$('nCampEnd').value) { m.textContent = 'Odaberite točan datum do kada je kampanja aktivna.'; $('nCampEnd').focus(); return; }
    if ($('nCamp').checked && $('nCampValue').value === '') { m.textContent = 'Upišite vrijednost kampanje.'; $('nCampValue').focus(); return; }
    m.textContent = ''; $('nSave').disabled = true;
    try {
      const r = await call('client_create', { kind, oib, email_id: S.nFromMail || undefined, name, contact, email, email2: $('nEmail2').value.trim(), phone: $('nPhone').value.trim(), service: svcRead('nService'), industry: $('nIndustry').value.trim(), value: Number($('nValue').value) || 0, value_kind: $('nVKind').value, status: $('nStatus').value, owner_id: $('nOwner').value, next_follow_up: $('nFollow').value, next_follow_time: $('nFollowT').value, camp_active: $('nCamp').checked, camp_type: $('nCampType').value, camp_start: $('nCampStart').value, camp_end: $('nCampEnd').value, camp_value: annAmount('nCampType').value, camp_months: annAmount('nCampType').months, note });
      toast('Klijent spremljen');
      $('mNew').hidden = true;
      await refresh(true);
      if (byId(r.id)) { S.lastFocus = null; $('mdrawer').hidden = true; openClient(r.id, true); } else document.body.classList.remove('lock');
    } catch (e) { m.textContent = e.message; }
    $('nSave').disabled = false;
  }

  /* ---------- e-mail to client ---------- */

  /* ---------------------------------------------------------- E-mail kampanje */
  const MC_PURPOSES = [['prvi', 'Početni mail (prvi kontakt)'], ['izgubljen', 'Izgubljeni klijent – ponovni kontakt'], ['ponuda', 'Slanje ponude'], ['followup', 'Provjera nakon ponude'], ['zahvala', 'Zahvala'], ['drugo', 'Drugo (opišite u uputi)']];
  const MC_PRESETS = { izgubljen: ['izgubljen'], otvoreni: ['novi', 'kontaktiran', 'ponuda', 'pregovori'], aktivni: ['aktivni'], dobiveni: ['dobiven'] };
  const mcMine = () => (isAdmin() ? S.clients : S.clients.filter((c) => String(c.ownerId) === String(S.me.id)));
  function mcState() { return (S.mc = S.mc || { mode: 'single', clientId: '', stat: { izgubljen: true }, preview: null, picked: new Set(), ack: false, built: false, ov: null }); }
  function renderCampaigns() {
    const root = $('v-kampanje'); const M = mcState();
    if (!M.built || !root.innerHTML) {
      M.built = true;
      const tpls = S.templates.filter((t) => t.kind !== 'akcija');
      root.innerHTML = '<h2>E-mail kampanje</h2>' +
        '<section class="panel-b"><header><h3>Nova poruka</h3><span class="muted">pojedinačno ili grupno · svaki poslani mail upisuje se u bilješke klijenta</span></header><div class="pad mc">' +
        '<div class="seg" role="group" aria-label="Primatelji"><button data-mc="mode" data-v="single">Jedan klijent</button><button data-mc="mode" data-v="group">Grupa klijenata</button></div>' +
        '<div id="mcSingle"><div class="row"><label class="f">Klijent<input id="mcClient" list="mcClients" placeholder="Počnite upisivati naziv" autocomplete="off"></label><label class="f">Adresa primatelja<input id="mcTo" type="email" placeholder="e-mail"></label></div>' +
        '<datalist id="mcClients">' + mcMine().map((c) => '<option value="' + esc(c.name + (c.email ? ' · ' + c.email : '')) + '"></option>').join('') + '</datalist></div>' +
        '<div id="mcGroup" hidden><div class="mcst"><span class="lbl">Statusi primatelja</span>' + STAGES.map((st) => '<label class="chk"><input type="checkbox" data-mc="stat" value="' + st.id + '"> ' + esc(st.label) + '</label>').join('') + '</div>' +
        '<div class="row"><div class="acts"><button class="btn sm" data-mc="preset" data-v="izgubljen">Izgubljeni klijenti</button><button class="btn sm" data-mc="preset" data-v="otvoreni">Otvoreni</button><button class="btn sm" data-mc="preset" data-v="aktivni">Aktivni</button><button class="btn sm" data-mc="preset" data-v="dobiveni">Dobiveni</button></div></div>' +
        '<div class="row"><label class="f">Vrsta<select id="mcKind"><option value="">Sve vrste</option><option value="tvrtka">Tvrtke</option><option value="osoba">Fizičke osobe</option></select></label>' +
        (isAdmin() ? '<label class="f">Prodavač<select id="mcOwner"><option value="">Svi prodavači</option>' + S.users.map((u) => '<option value="' + esc(u.id) + '">' + esc(u.name) + '</option>').join('') + '</select></label>' : '') +
        '<button class="btn" data-mc="preview">Prikaži primatelje</button></div><div id="mcPrev"></div></div>' +
        '<div class="row"><label class="f">Predložak<select id="mcTpl"><option value="">(prazna poruka)</option>' + tpls.map((t) => '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>').join('') + '</select></label></div>' +
        '<label class="f">Predmet<input id="mcSubj" maxlength="255"></label>' +
        '<label class="f">Poruka<textarea id="mcBody" rows="11" placeholder="Poštovani/a {{ime}},"></textarea></label>' +
        '<p class="hint" id="mcHint"></p>' +
        '<details class="info"><summary>Napiši s AI</summary><div class="mcai"><div class="row"><label class="f">Svrha<select id="mcPurpose">' + MC_PURPOSES.map((p) => '<option value="' + p[0] + '">' + esc(p[1]) + '</option>').join('') + '</select></label></div>' +
        '<label class="f">Što želite poručiti (nije obavezno)<textarea id="mcAiHint" rows="2" placeholder="npr. spomenuti nove cijene paketa i ponuditi kratki razgovor"></textarea></label>' +
        '<div class="acts"><button class="btn" data-mc="ai">Napiši tekst</button><span class="hint">Tekst je uljudan i profesionalan; uvijek ga pročitajte prije slanja.</span></div></div></details>' +
        '<div class="spell" id="mcSpell" aria-live="polite"></div>' +
        '<div class="foot"><span class="msg" id="mcMsg" role="alert"></span><button class="btn" data-mc="spell">Provjeri pravopis</button><button class="btn primary" data-mc="send" id="mcSend">Pošalji</button></div>' +
        '</div></section>' +
        '<section class="panel-b" id="mcApprove" hidden></section><section class="panel-b" id="mcQueue"></section><section class="panel-b" id="mcStats"></section><section class="panel-b" id="dncPanel"></section>';
      root.addEventListener('click', mcClick); $('mcModal').addEventListener('click', mcClick); root.addEventListener('change', mcChange); root.addEventListener('input', mcInput);
      mcMode(M.mode); Object.keys(M.stat).forEach((k) => { const i = root.querySelector('input[data-mc=stat][value=' + k + ']'); if (i) i.checked = !!M.stat[k]; });
    }
    renderMcQueue(); renderMcStats(); loadMcOverview(); renderDnc(); loadDnc();
  }
  const mcLim = () => { const o = mcState().ov; const lim = o && o.rateDay !== o.rateNight ? '08–16 h: ' + o.rateDay + ', 16–08 h: ' + o.rateNight : ''; return { n: o ? o.perHour : 55, w: lim ? lim + ' na sat' : 'bez ograničenja termina' }; };
  function mcHintText() {
    if (!$('mcHint')) return;
    $('mcHint').textContent = mcState().mode === 'group' ? 'Oznake {{ime}}, {{tvrtka}}, {{usluga}} i {{moje_ime}} svakom se primatelju popune osobno. Potpis prodavača dodaje se automatski. Slanje: najviše ' + mcLim().n + ' poruka na sat (' + mcLim().w + ')' + (isAdmin() ? '.' : '. Grupne poruke korisnika šalju se tek nakon odobrenja administratora.') : 'Oznake {{ime}}, {{tvrtka}} i {{usluga}} popunjavaju se podacima odabranog klijenta. Potpis se dodaje automatski.';
  }
  function mcMode(m) {
    const M = mcState(); M.mode = m; M.ack = false;
    $('mcSingle').hidden = m !== 'single'; $('mcGroup').hidden = m !== 'group';
    document.querySelectorAll('#v-kampanje [data-mc=mode]').forEach((b) => b.classList.toggle('on', b.dataset.v === m));
    mcHintText();
    $('mcSend').textContent = m === 'group' ? 'Pregled i slanje' : 'Pošalji e-mail';
  }
  async function loadMcOverview() {
    if (S.mcBusy) return; S.mcBusy = true;
    try { mcState().ov = await call('mail_overview', null, 'GET'); if (S.tab === 'kampanje') { renderMcQueue(); mcHintText(); } } catch (e) { /* ignore */ } finally { S.mcBusy = false; }
  }
  const mcSamples = (list) => list.map((m, i) => '<details class="mcsample"' + (i === 0 ? ' open' : '') + '><summary><b>' + esc(m.name) + '</b> <small>' + esc(m.to) + (m.sender ? ' · pošiljatelj: ' + esc(m.sender) : '') + '</small></summary><div class="mcmail"><div class="mcsubj">' + esc(m.subject) + '</div><pre>' + esc(m.body) + '</pre></div></details>').join('');
  function mcModal(html) { const o = $('mcModal'); o.querySelector('.sh-b').innerHTML = html; o.hidden = false; }
  function mcModalClose() { $('mcModal').hidden = true; }
  async function mcBatchView(batch, admin) {
    try {
      const d = await call('batch_detail', { batch });
      mcModal('<p class="mcline"><b>' + esc(d.by) + '</b> · ' + d.total + ' ' + pl3(d.total, 'primatelj', 'primatelja', 'primatelja') + ' · slanje: ' + (d.sendAt > Date.now() + 60000 ? 'zakazano za ' + esc(fmtTs(d.sendAt)) : 'što prije') + '</p>' +
        '<h4>Primjeri poruka (točno kako će stići primateljima)</h4>' + mcSamples(d.samples) +
        '<details class="info"><summary>Svi primatelji (' + d.total + ')</summary><ul class="mcrec">' + d.recipients.map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul></details>' +
        '<div class="foot">' + (admin && d.status === 'awaiting' ? '<button class="btn danger" data-mc="decide" data-d="reject" data-b="' + esc(batch) + '">Odbij</button><button class="btn primary" data-mc="decide" data-d="approve" data-b="' + esc(batch) + '">Odobri slanje</button>' : '<button class="btn" data-mc="pvclose">Zatvori</button>') + '</div>');
    } catch (e) { toast(e.message, true); }
  }
  function renderMcQueue() {
    const el = $('mcQueue'); if (!el) return; const o = mcState().ov;
    const ap = $('mcApprove');
    if (ap) {
      const L = isAdmin() && o ? o.approvals : [];
      ap.hidden = !L.length;
      ap.innerHTML = L.length ? '<header><h3>Čeka odobrenje <span class="badge">' + L.length + '</span></h3><span class="muted">poruke se ne šalju dok ih ne odobrite</span></header><div class="pad"><div class="tblwrap"><table class="rev"><thead><tr><th>Prodavač</th><th>Predmet</th><th>Primatelja</th><th>Slanje</th><th></th></tr></thead><tbody>' +
        L.map((a) => '<tr><td>' + esc(a.user) + '</td><td>' + esc(a.subject) + '</td><td class="nums">' + a.total + '</td><td>' + (a.sendAt > Date.now() + 60000 ? esc(fmtTs(a.sendAt)) : 'što prije') + '</td><td class="acts"><button class="btn sm" data-mc="view" data-b="' + esc(a.batch) + '" data-a="1">Pregled</button> <button class="btn sm primary" data-mc="decide" data-d="approve" data-b="' + esc(a.batch) + '">Odobri</button> <button class="btn sm danger" data-mc="decide" data-d="reject" data-b="' + esc(a.batch) + '">Odbij</button></td></tr>').join('') + '</tbody></table></div></div>' : '';
    }
    if (!o) { el.innerHTML = '<header><h3>Red slanja</h3></header><p class="muted pad">Učitavanje…</p>'; return; }
    const eta = o.eta ? new Date(o.eta) : null;
    let h = '<header><h3>Red slanja grupne pošte</h3><span class="muted">od 08 do 16 h najviše ' + (o.rateDay || o.perHour) + ' poruka na sat, od 16 do 08 h najviše ' + (o.rateNight || o.perHour) + ' · odgovori iz Inboxa i pojedinačni mailovi imaju prednost</span></header><div class="pad">' +
      '<p class="mcline"><span class="chip ' + (o.windowOpen ? 'ok' : '') + '">' + (o.windowOpen ? 'Slanje je sada dopušteno' : 'Izvan termina slanja') + '</span> <b class="nums">' + (o.sentLastHour + (o.individualLastHour || 0)) + ' / ' + o.perHour + '</b> poslano u zadnjih sat vremena (grupnih ' + o.sentLastHour + ', pojedinačnih ' + (o.individualLastHour || 0) + ') · na čekanju: <b class="nums">' + o.pending + '</b>' + (o.hardReached ? ' · <span class="chip warn">kvota ' + o.hardLimit + '/h puna, slanje je pauzirano</span>' : ' · ukupno ' + (o.totalLastHour || 0) + ' / ' + (o.hardLimit || 50) + ' (kvota poslužitelja)') +
      (eta && o.pending ? ' · procjena završetka: <b>' + esc(fmtTs(o.eta)) + '</b>' : '') + '</p>';
    if (o.batches.length) {
      h += '<div class="tblwrap"><table class="rev"><thead><tr><th>Kada</th><th>Predmet</th>' + (isAdmin() ? '<th>Prodavač</th>' : '') + '<th>Poslano</th><th>Stanje</th><th></th></tr></thead><tbody>' +
        o.batches.map((b) => {
          const st = b.awaiting ? '<span class="chip warn">čeka odobrenje</span>' : (b.approval === 'rejected' ? '<span class="chip bad">odbijeno</span>' : (b.pending ? 'u redu: ' + b.pending + (b.sendAt > Date.now() + 60000 ? ' · zakazano ' + esc(fmtTs(b.sendAt)) : '') : (b.failed ? 'neuspjelo: ' + b.failed : (b.cancelled && !b.sent ? 'otkazano' : 'završeno'))));
          return '<tr><td>' + esc(fmtTs(b.created)) + '</td><td>' + esc(b.subject) + '</td>' + (isAdmin() ? '<td>' + esc(b.by) + '</td>' : '') + '<td class="nums">' + b.sent + ' / ' + b.total + '</td><td>' + st + '</td><td class="acts"><button class="btn sm" data-mc="view" data-b="' + esc(b.batch) + '">Pregled</button> ' +
            (b.pending || b.failed || b.awaiting ? '<button class="btn sm danger" data-mc="cancel" data-b="' + esc(b.batch) + '">Otkaži preostale</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    } else h += '<p class="muted">Još nema grupnih slanja.</p>';
    el.innerHTML = h + '</div>';
  }
  function renderMcStats() {
    const el = $('mcStats'); if (!el) return; const M = mcState();
    const mine = mcMine(); const ids = new Set(mine.map((c) => c.id));
    const now = new Date(); const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const wk = d0 - ((now.getDay() + 6) % 7) * 86400000; const mo = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const per = { c: {}, last: {}, b: {} }; const tot = { d: [0, 0], w: [0, 0], m: [0, 0] };
    S.notes.forEach((n) => {
      if (n.type !== 'email' || !ids.has(n.clientId)) return;
      per.c[n.clientId] = (per.c[n.clientId] || 0) + 1; if (n.bulk) per.b[n.clientId] = (per.b[n.clientId] || 0) + 1;
      if (!per.last[n.clientId] || n.createdAt > per.last[n.clientId]) per.last[n.clientId] = n.createdAt;
      const k = n.bulk ? 1 : 0;
      if (n.createdAt >= d0) tot.d[k]++; if (n.createdAt >= wk) tot.w[k]++; if (n.createdAt >= mo) tot.m[k]++;
    });
    const q = (M.sq || '').toLowerCase(); const only = M.sNever;
    let list = mine.filter((c) => (!q || (c.name + ' ' + c.email).toLowerCase().includes(q)) && (!only || !per.c[c.id]));
    list.sort((a, b) => (per.last[b.id] || 0) - (per.last[a.id] || 0) || a.name.localeCompare(b.name, 'hr'));
    const tr = (lbl, v) => '<tr><th>' + lbl + '</th><td class="nums">' + v[0] + '</td><td class="nums">' + v[1] + '</td><td class="nums">' + (v[0] + v[1]) + '</td></tr>';
    el.innerHTML = '<header><h3>Statistika e-mailova</h3><span class="muted">' + (isAdmin() ? 'svi klijenti' : 'vaši klijenti') + '</span></header><div class="pad">' +
      '<div class="tblwrap"><table class="rev"><thead><tr><th></th><th>Pojedinačni</th><th>Grupni</th><th>Ukupno</th></tr></thead><tbody>' + tr('Danas', tot.d) + tr('Ovaj tjedan', tot.w) + tr('Ovaj mjesec', tot.m) + '</tbody></table></div>' +
      '<div class="row" style="margin-top:12px"><label class="f">Pretraga klijenta<input id="mcSq" type="search" value="' + esc(M.sq || '') + '" placeholder="Naziv ili e-mail"></label><label class="chk"><input type="checkbox" id="mcNever"' + (only ? ' checked' : '') + '> samo klijenti koji nisu dobili mail</label></div>' +
      '<div class="tblwrap"><table class="rev"><thead><tr><th>Klijent</th><th>Status</th><th>Primljeno mailova</th><th>od toga grupnih</th><th>Zadnji mail</th></tr></thead><tbody>' +
      (list.slice(0, 100).map((c) => '<tr><th><button class="lnk" data-open="' + esc(c.id) + '">' + esc(c.name) + '</button></th><td>' + esc((STAGE[c.status] || {}).label || '') + '</td><td class="nums">' + (per.c[c.id] || 0) + '</td><td class="nums">' + (per.b[c.id] || 0) + '</td><td>' + (per.last[c.id] ? esc(fmtTs(per.last[c.id])) : '<span class="muted">nikad</span>') + '</td></tr>').join('') || '<tr><td colspan="5" class="muted">Nema klijenata.</td></tr>') +
      '</tbody></table></div>' + (list.length > 100 ? '<p class="muted small">Prikazano prvih 100 od ' + list.length + '. Suzite pretragu.</p>' : '') + '</div>';
  }
  function mcInput(ev) {
    const M = mcState(); const t = ev.target;
    if (t.id === 'mcSubj' || t.id === 'mcBody') { M.ack = false; return; }
    if (t.id === 'mcClient') {
      const c = mcMine().find((x) => (x.name + (x.email ? ' · ' + x.email : '')) === t.value);
      if (c) { M.clientId = c.id; $('mcTo').value = c.email || ''; if ($('mcTpl').value) mcApplyTpl(); } else if (!t.value) M.clientId = '';
    }
    if (t.id === 'mcSq') { M.sq = t.value; const pos = t.selectionStart; renderMcStats(); const n = $('mcSq'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } }
  }
  function mcApplyTpl() {
    const M = mcState(); const t = S.templates.find((x) => x.id === $('mcTpl').value); if (!t) return;
    if (M.mode === 'single' && M.clientId) { const f = fillTpl(t, byId(M.clientId)); $('mcSubj').value = f.subject; $('mcBody').value = f.body; }
    else { $('mcSubj').value = t.subject; $('mcBody').value = t.body; }
    M.ack = false;
  }
  function mcChange(ev) {
    const M = mcState(); const t = ev.target;
    if (t.id === 'mcTpl') { if (t.value) mcApplyTpl(); }
    else if (t.dataset.mc === 'stat') { M.stat[t.value] = t.checked; M.preview = null; $('mcPrev').innerHTML = ''; }
    else if (t.id === 'mcKind' || t.id === 'mcOwner') { M.preview = null; $('mcPrev').innerHTML = ''; }
    else if (t.id === 'mcNever') { M.sNever = t.checked; renderMcStats(); }
    else if (t.dataset.mc === 'pick') { if (t.checked) M.picked.add(t.value); else M.picked.delete(t.value); mcPickInfo(); }
  }
  function mcAudience() { const M = mcState(); return { statuses: STAGES.map((s) => s.id).filter((k) => M.stat[k]), kind: $('mcKind').value, owner: $('mcOwner') ? $('mcOwner').value : '' }; }
  function mcPickInfo() { const M = mcState(); const e = $('mcPickInfo'); if (e) e.textContent = 'Odabrano: ' + M.picked.size + ' od ' + (M.preview ? M.preview.clients.length : 0); }
  function mcRenderPreview() {
    const M = mcState(); const p = M.preview; const el = $('mcPrev'); if (!p) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="mcprev"><p class="mcline"><b class="nums">' + p.total + '</b> ' + pl3(p.total, 'primatelj', 'primatelja', 'primatelja') + ' s ispravnom adresom' + (p.noEmail ? ' · <span class="muted">' + p.noEmail + ' bez e-mail adrese (preskočeno)</span>' : '') +
      (p.total ? ' · procjena završetka slanja: <b>' + esc(fmtTs(p.eta)) + '</b>' : '') + '</p>' +
      '<div class="acts"><button class="btn sm" data-mc="all">Označi sve</button><button class="btn sm" data-mc="none">Poništi odabir</button><span class="hint nums" id="mcPickInfo"></span></div>' +
      '<div class="mclist">' + p.clients.map((c) => '<label class="chk"><input type="checkbox" data-mc="pick" value="' + esc(c.id) + '"' + (M.picked.has(c.id) ? ' checked' : '') + '> <b>' + esc(c.name) + '</b> <small>' + esc(c.email) + ' · ' + esc((STAGE[c.status] || {}).label || '') + ' · ' + c.mails + ' ' + pl3(c.mails, 'mail', 'maila', 'mailova') + (c.last ? ', zadnji ' + esc(fmtTs(c.last)) : '') + '</small></label>').join('') + '</div></div>';
    mcPickInfo();
  }
  function mcSpellHtml(r) {
    if (!r.issues.length && !r.ai) return '<p class="okmsg">Nisu pronađene pravopisne pogreške.</p>';
    let h = '';
    if (r.issues.length) h += '<p><b>Moguće pogreške (' + r.issues.length + '):</b></p><ul>' + r.issues.map((i) => '<li><span class="bad">' + esc(i.found) + '</span>' + (i.fix ? ' → <span class="good">' + esc(i.fix) + '</span>' : '') + ' <small class="muted">' + esc(i.msg) + '</small></li>').join('') + '</ul><button class="btn sm" data-mc="applyfix">Primijeni ispravke</button> ';
    if (r.ai) h += '<details class="info"><summary>AI lektura (prijedlog)</summary><pre class="aitext">' + esc(r.ai) + '</pre><button class="btn sm" data-mc="applyai">Primijeni AI lekturu</button></details>';
    return h;
  }
  async function mcSpell(withAi) {
    const r = await call('spell_check', { subject: $('mcSubj').value, body: $('mcBody').value, ai: !!withAi });
    S.mcSpell = r; $('mcSpell').innerHTML = mcSpellHtml(r); return r;
  }
  async function mcClick(ev) {
    const b = ev.target.closest('[data-mc]'); if (!b || b.tagName === 'INPUT') return;
    const M = mcState(); const act = b.dataset.mc; const msg = $('mcMsg');
    if (act === 'mode') { mcMode(b.dataset.v); return; }
    if (act === 'preset') { const set = MC_PRESETS[b.dataset.v]; M.stat = {}; set.forEach((k) => { M.stat[k] = true; }); document.querySelectorAll('#v-kampanje input[data-mc=stat]').forEach((i) => { i.checked = !!M.stat[i.value]; }); M.preview = null; $('mcPrev').innerHTML = ''; return; }
    if (act === 'all' || act === 'none') { M.picked = new Set(act === 'all' && M.preview ? M.preview.clients.map((c) => c.id) : []); document.querySelectorAll('#v-kampanje input[data-mc=pick]').forEach((i) => { i.checked = M.picked.has(i.value); }); mcPickInfo(); return; }
    if (act === 'preview') {
      const a = mcAudience(); if (!a.statuses.length) { msg.textContent = 'Odaberite barem jedan status.'; return; } msg.textContent = '';
      b.disabled = true;
      try { const r = await call('bulk_preview', { audience: a }); M.preview = r; M.picked = new Set(r.clients.map((c) => c.id)); mcRenderPreview(); }
      catch (e) { msg.textContent = e.message; } finally { b.disabled = false; }
      return;
    }
    if (act === 'pvclose') { mcModalClose(); return; }
    if (act === 'view') { mcBatchView(b.dataset.b, !!b.dataset.a || isAdmin()); return; }
    if (act === 'decide') {
      const ap = b.dataset.d === 'approve';
      if (!confirm(ap ? 'Odobriti slanje? Poruke odlaze primateljima unutar dopuštenog termina.' : 'Odbiti slanje? Poruke se neće poslati.')) return;
      const ok = await safe(() => call('batch_decide', { batch: b.dataset.b, decision: ap ? 'approve' : 'reject' }), ap ? 'Slanje odobreno' : 'Slanje odbijeno');
      if (ok) { mcModalClose(); await refresh(true); loadMcOverview(); }
      return;
    }
    if (act === 'confirmsend') {
      const when = (document.querySelector('input[name=mcWhen]:checked') || {}).value; let at = null;
      if (when === 'later') { const v = $('mcAt').value; at = v ? new Date(v).getTime() : 0; if (!at || at < Date.now() + 60000) { $('mcPvMsg').textContent = 'Odaberite vrijeme slanja u budućnosti.'; return; } }
      b.disabled = true;
      try {
        const r = await call('bulk_send', { subject: M.pv.subject, body: M.pv.body, ids: M.pv.ids, send_at: at });
        mcModalClose();
        toast(r.needsApproval ? 'Poslano administratoru na odobrenje (' + r.queued + ' ' + pl3(r.queued, 'primatelj', 'primatelja', 'primatelja') + ')' : 'U red je stavljeno ' + r.queued + ' ' + pl3(r.queued, 'poruka', 'poruke', 'poruka') + (r.skipped ? ' (preskočeno: ' + r.skipped + ')' : ''));
        M.preview = null; M.picked = new Set(); $('mcPrev').innerHTML = ''; M.ack = false; M.pv = null; loadMcOverview(); if (isAdmin()) refresh(true);
      } catch (e) { $('mcPvMsg').textContent = e.message; b.disabled = false; }
      return;
    }
    if (act === 'cancel') { if (!confirm('Otkazati sve poruke iz ovog slanja koje još nisu poslane?')) return; const ok = await safe(() => call('bulk_cancel', { batch: b.dataset.b }), 'Preostale poruke otkazane'); if (ok) loadMcOverview(); return; }
    if (act === 'applyfix' && S.mcSpell) { $('mcSubj').value = S.mcSpell.subject; $('mcBody').value = S.mcSpell.body; $('mcSpell').innerHTML = '<p class="okmsg">Ispravci su primijenjeni.</p>'; M.ack = false; return; }
    if (act === 'applyai' && S.mcSpell && S.mcSpell.ai) { $('mcBody').value = S.mcSpell.ai; $('mcSpell').innerHTML = '<p class="okmsg">AI lektura je primijenjena. Pročitajte tekst prije slanja.</p>'; M.ack = false; return; }
    if (act === 'spell') { msg.textContent = ''; b.disabled = true; try { await mcSpell(true); } catch (e) { msg.textContent = e.message; } finally { b.disabled = false; } return; }
    if (act === 'ai') {
      msg.textContent = ''; b.disabled = true; b.textContent = 'Pišem…';
      try {
        const r = await call('ai_draft', { purpose: $('mcPurpose').value, hint: $('mcAiHint').value, client_id: M.mode === 'single' ? M.clientId : '' });
        $('mcSubj').value = r.subject; $('mcBody').value = r.body; M.ack = false; $('mcSpell').innerHTML = '';
        toast('Tekst je napisan. Pročitajte ga i po potrebi prilagodite.');
      } catch (e) { msg.textContent = e.message; } finally { b.disabled = false; b.textContent = 'Napiši tekst'; }
      return;
    }
    if (act === 'send') {
      const subject = $('mcSubj').value.trim(); const body = $('mcBody').value.trim();
      if (!subject || !body) { msg.textContent = 'Upišite predmet i poruku.'; return; }
      if (M.mode === 'single' && (!M.clientId || !$('mcTo').value.trim())) { msg.textContent = 'Odaberite klijenta i adresu primatelja.'; return; }
      if (M.mode === 'group' && !M.picked.size) { msg.textContent = 'Prikažite primatelje i odaberite barem jednog.'; return; }
      msg.textContent = ''; b.disabled = true;
      try {
        if (!M.ack) { // pravopis se uvijek provjerava prije slanja
          const r = await mcSpell(false);
          if (r.issues.length) { M.ack = true; msg.textContent = 'Pronađene su moguće pogreške. Primijenite ispravke ili ponovno kliknite gumb za slanje bez ispravaka.'; return; }
        }
        if (M.mode === 'single') {
          const ok = await safe(() => call('email_send', { client_id: M.clientId, to: $('mcTo').value.trim(), subject, body }), 'E-mail poslan');
          if (ok) { await refresh(true); renderMcStats(); }
        } else {
          const ids = Array.from(M.picked);
          const pv = await call('bulk_preview_msg', { subject, body, ids });
          if (!pv.total) { msg.textContent = 'Nijedan odabrani primatelj nema ispravnu adresu.'; return; }
          M.pv = { subject, body, ids };
          const lim = mcLim(); const d = new Date(Date.now() + 86400000); d.setHours(9, 0, 0, 0); const loc = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T09:00';
          mcModal('<p class="mcline"><b class="nums">' + pv.total + '</b> ' + pl3(pv.total, 'primatelj', 'primatelja', 'primatelja') + '. Ovako će poruke izgledati primateljima (prikazano ' + pv.samples.length + ' primjera):</p>' + mcSamples(pv.samples) +
            '<fieldset class="mcwhen"><legend>Slanje</legend><label class="chk"><input type="radio" name="mcWhen" value="now" checked> Što prije (najviše ' + lim.n + ' na sat; ' + esc(lim.w) + ')</label>' +
            '<label class="chk"><input type="radio" name="mcWhen" value="later"> Zakaži za <input type="datetime-local" id="mcAt" value="' + loc + '"></label></fieldset>' +
            (pv.needsApproval ? '<p class="banner info">Poruke se neće poslati dok ih ne odobri administrator. Administrator dobiva obavijest.</p>' : '') +
            '<div class="msg" id="mcPvMsg" role="alert"></div><div class="foot"><button class="btn" data-mc="pvclose">Natrag na uređivanje</button><button class="btn primary" data-mc="confirmsend">' + (pv.needsApproval ? 'Pošalji na odobrenje' : 'Potvrdi i stavi u red') + '</button></div>');
        }
      } catch (e) { msg.textContent = e.message; } finally { b.disabled = false; }
    }
  }
  function fillTpl(t, c) {
    const first = (c.contact || c.name || '').trim().split(/\s+/)[0] || '';
    const map = { ime: first, tvrtka: c.name || '', usluga: c.service || 'marketing', moje_ime: S.me.name || '' };
    const f = (x) => x.replace(/\{\{(\w+)\}\}/g, (_, k) => (map[k] != null ? map[k] : ''));
    return { subject: f(t.subject), body: f(t.body) };
  }
  function defaultSendAt() {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return ymd(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function renderMailDocs() {
    const c = byId(S.mailClient); const docs = (c && S.docsByClient.get(c.id)) || [];
    $('mDocs').innerHTML = '<b>Privici</b>' + (docs.length ? docs.map((d) => '<label class="chk"><input type="checkbox" data-doc="' + esc(d.id) + '"' + (S.mailDocs.has(d.id) ? ' checked' : '') + '> ' + esc(d.name) + ' <span class="hint">' + esc(fmtSize(d.size)) + '</span></label>').join('') : '<span class="hint"> nema spremljenih dokumenata klijenta</span>') +
      '<label class="btn sm filebtn">Dodaj datoteku<input type="file" id="mFile" hidden></label>';
  }
  function applyTplSchedule(t) {
    let at = 0;
    if (t && t.sendMode === 'delay') {
      const d = new Date(); d.setDate(d.getDate() + (t.sendDays || 0));
      const [hh, mm] = String(t.sendTime || '09:00').split(':'); d.setHours(+hh, +mm, 0, 0); at = d.getTime();
    } else if (t && t.sendMode === 'fixed' && t.sendFixed) at = t.sendFixed;
    const later = at > Date.now() + 60000;
    if (later) $('mAt').value = localDT(at);
    $('mWhen').value = later ? 'later' : 'now'; $('mAtW').hidden = !later;
    $('mSend').textContent = later ? 'Zakaži slanje' : 'Pošalji e-mail';
  }
  function openMail(tplPrefix) {
    const c = byId(S.openId); if (!c) return;
    S.mailClient = c.id; S.mailDocs = new Set(); S.mailFollowup = false;
    $('mSub').textContent = c.name + (c.kind === 'osoba' ? ' · fizička osoba' : (c.contact ? ' · ' + c.contact : ''));
    const tpls = S.templates.filter((t) => t.kind !== 'akcija');
    fillSelect($('mTpl'), [['', '(prazna poruka)']].concat(tpls.map((t) => [t.id, t.name])), '');
    const pick = (tplPrefix && tpls.find((t) => t.name.toLowerCase().startsWith(tplPrefix.toLowerCase()))) || tpls[0];
    $('mTo').value = c.email || '';
    $('mCc').hidden = !c.email2; $('mCc').textContent = c.email2 ? 'Kopija (CC): ' + c.email2 : '';
    if (pick) { $('mTpl').value = pick.id; const t = fillTpl(pick, c); $('mSubj').value = t.subject; $('mBody').value = t.body; } else { $('mSubj').value = ''; $('mBody').value = ''; }
    $('mSig').textContent = S.me.signatureEffective || '';
    $('mWhen').value = 'now'; $('mAtW').hidden = true; $('mAt').value = defaultSendAt(); $('mRemind').value = '3';
    applyTplSchedule(pick);
    $('mFrom').textContent = S.mail.enabled ? 'Poruka odlazi s adrese ' + S.mail.from + '. Odgovori klijenta stižu u Inbox i uz klijenta.' : 'Slanje e-maila još nije podešeno. Administrator ga podešava u config.php.';
    $('mSend').disabled = !S.mail.enabled; $('mSend').textContent = 'Pošalji e-mail'; $('mMsg').textContent = '';
    renderMailDocs();
    $('mMail').hidden = false; ($('mTo').value ? $('mSubj') : $('mTo')).focus();
  }
  async function uploadDoc(file, clientId, contract) {
    if (file.size > 10 * 1048576) throw new Error('Datoteka je prevelika (najviše 10 MB).');
    const fd = new FormData(); fd.append('client_id', clientId); fd.append('file', file); if (contract) fd.append('contract', '1');
    const res = await fetch('api.php?a=doc_upload', { method: 'POST', credentials: 'same-origin', headers: activeHdr({ 'X-CSRF': S.csrf }), body: fd });
    let d = null; try { d = await res.json(); } catch (e) { /* ignore */ }
    if (res.status === 401) { location.reload(); throw new Error('Sesija je istekla.'); }
    if (!res.ok) throw new Error((d && d.error) || 'Učitavanje datoteke nije uspjelo.');
    return d.id;
  }
  async function onContractFile(input) {
    const f = input.files && input.files[0]; input.value = ''; const cid = S.openId; if (!f || !cid) return;
    const msg = $('contractMsg');
    if (!/\.(pdf|docx?)$/i.test(f.name)) { msg.textContent = 'Ugovor mora biti PDF ili Word datoteka.'; return; }
    msg.textContent = 'Učitavam…';
    try { await uploadDoc(f, cid, true); await refresh(true); $('contractMsg').textContent = 'Ugovor dodan.'; } catch (e) { msg.textContent = e.message; }
  }
  async function onDocFile(input, inMail) {
    const f = input.files && input.files[0]; input.value = '';
    const cid = inMail ? S.mailClient : S.openId; if (!f || !cid) return;
    const msg = inMail ? $('mMsg') : $('docMsg');
    msg.textContent = 'Učitavam…';
    try {
      const id = await uploadDoc(f, cid);
      await refresh(true);
      if (inMail) { S.mailDocs.add(id); renderMailDocs(); $('mMsg').textContent = ''; } else { msg.textContent = 'Dokument dodan.'; }
    } catch (e) { msg.textContent = e.message; }
  }
  async function sendMail() {
    const c = byId(S.mailClient); if (!c) return;
    const to = $('mTo').value.trim(), subject = $('mSubj').value.trim(), body = $('mBody').value.trim();
    const later = $('mWhen').value === 'later';
    if (!to || to.indexOf('@') < 1) { $('mMsg').textContent = 'Upišite ispravnu adresu primatelja.'; $('mTo').focus(); return; }
    if (!subject) { $('mMsg').textContent = 'Predmet je obavezan.'; $('mSubj').focus(); return; }
    if (!body) { $('mMsg').textContent = 'Poruka je prazna.'; $('mBody').focus(); return; }
    let sendAt;
    if (later) {
      sendAt = new Date($('mAt').value).getTime();
      if (!sendAt || sendAt < Date.now() + 60000) { $('mMsg').textContent = 'Odaberite vrijeme slanja u budućnosti.'; $('mAt').focus(); return; }
    }
    $('mMsg').textContent = ''; $('mSend').disabled = true; $('mSend').textContent = later ? 'Zakazujem…' : 'Šaljem…';
    try {
      const r = await call('email_send', { client_id: c.id, to, subject, body, doc_ids: Array.from(S.mailDocs), remind_days: $('mRemind').value || null, send_at: later ? sendAt : undefined, followup: S.mailFollowup ? 1 : undefined });
      toast(r.needsApproval ? 'E-mail čeka odobrenje administratora' + (r.scheduled ? ' (zakazano za ' + fmtDate(r.sendAt) + ' ' + fmtTime(r.sendAt) + ')' : '') : 'E-mail poslan'); $('mMail').hidden = true; refresh(true);
    } catch (e) { $('mMsg').textContent = e.message; }
    $('mSend').disabled = !S.mail.enabled; $('mSend').textContent = $('mWhen').value === 'later' ? 'Zakaži slanje' : 'Pošalji e-mail';
  }

  /* ---------- events ---------- */
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    const go = t.closest('[data-gopen]'); if (go) { globalSearchClose(); $('gq').value = ''; openClient(go.dataset.gopen); return; }
    const gm = t.closest('[data-gmail]'); if (gm) { globalSearchClose(); $('gq').value = ''; openMailItem(gm.dataset.gmail); return; }
    if (!t.closest('.gsearch')) globalSearchClose();
    const tab = t.closest('[data-tab]'); if (tab) { setTab(tab.dataset.tab); return; }
    const per = t.closest('[data-period]'); if (per) { S.period = per.dataset.period; S.tmFrom = ''; S.tmTo = ''; renderTeam(); return; }
    const mdel = t.closest('[data-mdel]'); if (mdel) { ev.preventDefault(); ev.stopPropagation(); deleteMail(mdel.dataset.mdel, true); return; }
    const mailBtn = t.closest('[data-mail]'); if (mailBtn) { openMailItem(mailBtn.dataset.mail); return; }
    const op = t.closest('[data-open]'); if (op) { const oid = op.dataset.open; const kp = !!op.dataset.keep; if (byId(oid)) openClient(oid, kp); else ensureClient(oid).then((ok) => { if (ok) { renderAll(); openClient(oid, kp); } }); return; }
    const a = t.closest('[data-act]');
    if (a && !a.disabled) {
      const act = a.dataset.act;
      if (act === 'new') openNew();
      else if (act === 'close') closeTop();
      else if (act === 'logout') call('logout', {}).finally(() => location.reload());
      else if (act === 'note') saveNote();
      else if (act === 'stok') confirmStatus();
      else if (act === 'stno') cancelStatus();
      else if (act === 'saveinfo') saveInfo();
      else if (act === 'renew') renewCampaign();
      else if (act === 'campadd') addExtraCamp();
      else if (act === 'campdel') delExtraCamp(a.dataset.id);
      else if (act === 'taskadd') taskAdd(a);
      else if (act === 'maildel') deleteMail(a.dataset.id);
      else if (act === 'taskdone' || act === 'taskdel') taskAct(a);
      else if (act === 'taskopen') taskOpen(a.dataset.id);
      else if (act.indexOf('tk_') === 0) taskDetailAct(act, a);
      else if (act === 'tkfilter') { S.tkFilter = a.dataset.v; renderTasksTab(); }
      else if (act === 'goalsave') saveGoals();
      else if (act === 'tkmore') { S.tkMore = !S.tkMore; renderOverview(); }
      else if (act === 'revmore') { S.revMore = !S.revMore; renderRevenue(); }
      else if (act === 'revper') { S.revPeriod = a.dataset.v; renderRevenue(); }
      else if (act === 'mail') openMail('Prvi');
      else if (act === 'msend') sendMail();
      else if (act === 'del1') $('delConfirm').hidden = false;
      else if (act === 'del2') deleteClient();
      else if (act === 'tmapply') { const f = $('tmFrom').value, t2 = $('tmTo').value; if (!f || !t2 || f > t2) { toast('Upišite ispravno razdoblje (Od ne smije biti iza Do).', true); return; } S.tmFrom = f; S.tmTo = t2; S.period = 'custom'; renderTeam(); }
      else if (act === 'sync' || act === 'syncnow') syncInbox(true, false);
      else if (act === 'reply') sendReply(a.dataset.id);
      else if (act === 'rfdel') { (S.rFiles || []).splice(+a.dataset.i, 1); renderReplyFiles(); }
      else if (act === 'link') { const v = $('rLink').value; if (v) safe(() => call('email_link', { email_id: a.dataset.id, client_id: v }), 'Poruka povezana').then((ok) => { if (ok) refresh(true).then(() => openMailItem(a.dataset.id)); }); }
      else if (act === 'unlink') safe(() => call('email_link', { email_id: a.dataset.id, client_id: null }), 'Poruka odvojena').then((ok) => { if (ok) refresh(true).then(() => openMailItem(a.dataset.id)); });
      else if (act === 'mkclient') {
        const e = S.emails.find((x) => x.id === a.dataset.id); if (!e) return;
        $('mdrawer').hidden = true;
        openNew({ emailId: e.id, guess: e.fromName || '', email: e.replyTo || e.fromEmail, note: 'Upit e-mailom: ' + (e.subject || '(bez predmeta)') + '\n' + e.preview });
      }
      else if (act === 'take') { if (confirm('Preuzeti klijenta ' + (byId(S.openId) || {}).name + '? Od sada ga vodite vi, a prodaja se do sada vodi na prethodnog prodavača.')) safe(() => call('client_take', { id: S.openId }), 'Klijent preuzet').then(async (ok) => { if (ok) { await refresh(true); openClient(S.openId, true); } }); }
      else if (act === 'docdel') safe(() => call('doc_delete', { id: a.dataset.id }), 'Dokument obrisan').then((ok) => { if (ok) refresh(true); });
      else if (act === 'schedcancel') safe(() => call('sched_cancel', { id: a.dataset.id }), 'Zakazano slanje otkazano').then((ok) => { if (ok) refresh(true); });
      else if (act === 'remdone') safe(() => call('reminder_done', { email_id: a.dataset.id }), 'Podsjetnik odbačen').then((ok) => { if (ok) refresh(true); });
      else if (act === 'remsnooze') safe(() => call('reminder_done', { email_id: a.dataset.id, snooze_days: 2 }), 'Podsjetnik odgođen za 2 dana').then((ok) => { if (ok) refresh(true); });
      else if (act === 'remfollow') { S.lastFocus = a; openClient(a.dataset.cid, true); openMail('Follow-up bez'); S.mailFollowup = true; }
      else if (act === 'sigsave') sigSave();
      else if (act === 'arsave') arSave();
      else if (act === 'reportprev') reportPreview(false);
      else if (act === 'reportprevm') reportPreview(true);
      else if (act === 'reportsendm') safe(() => call('report_send', { monthly: true }).then((r) => { if (r.ok === false) throw new Error(r.error || 'Slanje nije uspjelo.'); toast('Mjesečni izvještaj poslan na ' + r.to); }));
      else if (act === 'reportsend') safe(() => call('report_send', {}).then((r) => { if (r.ok === false) throw new Error(r.error || 'Slanje nije uspjelo.'); toast('Izvještaj poslan na ' + r.to); }));
      else if (act === 'b2test') b2Test();
      else if (act === 'b2save') b2Save();
      else if (act === 'b2clear') b2Clear();
      else if (act === 'tplsave') tplSave(a.closest('.tplrow'));
      else if (act === 'tplsuggest') tplSuggest(a.closest('.tplrow'));
      else if (act === 'tplrun') tplRun(a.closest('.tplrow'));
      else if (act === 'tpldel') { if (confirm('Obrisati predložak?')) safe(() => call('template_delete', { id: a.closest('.tplrow').dataset.tid }), 'Predložak obrisan').then((ok) => { if (ok) refresh(true).then(renderSettings); }); }
      else if (act === 'pwchange') pwChange();
      else if (act === 'usave') userSave(a.closest('tr'));
      else if (act === 'ucreate') userCreate();
      else if (act === 'mailtest') mailTest(1);
      else if (act === 'mailtest2') mailTest(2);
      else if (act === 'bkrun') runBackup();
      else if (act === 'secsave') secSave();
      else if (act === 'ipunblock') ipUnblock(a.dataset.ip);
      else if (act === 'aldone') alertDone(a.dataset.id);
      else if (act === 'alrenew') alertRenew(a.dataset.id);
      else if (act === 'alextend') alertExtend(a.dataset.id);
      else if (act === 'rquick') replyInsert(a.dataset.id);
      else if (act === 'rtplshow') { $('rTplRow').hidden = !$('rTplRow').hidden; if (!$('rTplRow').hidden) $('rTplName').focus(); }
      else if (act === 'rtplsave') replySaveTpl();
      else if (act === 'plsave') plSave();
      else if (act === 'plcancel') toolClose();
      else if (act === 'dncadd') dncAdd();
      else if (act === 'dncrm') dncRemove(a.dataset.id);
      else if (act === 'dnccl') dncClient(a.dataset.id);
      else if (act === 'dupopen') dupOpen();
      else if (act === 'impopen') impOpen();
      else if (act === 'poolopen') poolOpen();
      return;
    }
    if (t.classList && t.classList.contains('overlay')) closeTop();
  });
  document.addEventListener('change', (ev) => {
    if (ev.target && ev.target.id === 'rFile') { S.rFiles = (S.rFiles || []).concat(Array.from(ev.target.files)); ev.target.value = ''; renderReplyFiles(); return; }
    const id = ev.target.id;
    if (id === 'stSel') onStatusChange();
    else if (id === 'fStatus') { S.fStatus = ev.target.value; renderClients(); }
    else if (id === 'fOwner') { S.fOwner = ev.target.value; renderClients(); }
    else if (id === 'fKind') { S.fKind = ev.target.value; renderClients(); }
    else if (id === 'fIndustry') { S.fIndustry = ev.target.value; renderClients(); }
    else if (id === 'fVK') { S.fVK = ev.target.value; renderClients(); }
    else if (id === 'fNotes') { S.fNotes = ev.target.checked; renderClients(); }
    else if (id === 'tkWho') { S.tkWho = ev.target.value; document.activeElement.blur(); renderTasksTab(); }
    else if (id === 'revUser') { S.revUser = ev.target.value; renderRevenue(); }
    else if (id === 'iKind') { const o = ev.target.value === 'osoba'; $('iContactW').hidden = o; $('iNameL').textContent = o ? 'Ime i prezime' : 'Naziv tvrtke'; }
    else if (ev.target.name === 'nKindR') applyNewKind();
    else if (ev.target.dataset && ev.target.dataset.f === 'send_mode') { const r = ev.target.closest('.tplrow'); r.querySelectorAll('[data-sch]').forEach((x) => { x.hidden = x.dataset.sch !== ev.target.value; }); }
    else if (id === 'rTpl') replyApplyTpl();
    else if (id === 'cCampType') campTypeChanged(ev.target, 'cCampStart', 'cCampEnd');
    else if (id === 'nCampType') campTypeChanged(ev.target, 'nCampStart', 'nCampEnd');
    else if (id === 'rType') campTypeChanged(ev.target, 'rStart', 'rEnd');
    else if (id === 'xType') campTypeChanged(ev.target, 'xStart', 'xEnd');
    else if (id === 'cMulti') setMulti(ev.target.checked);
    else if (id === 'cCamp' || id === 'iCamp' || id === 'nCamp') { const p = id[0]; $(p + 'CampDates').hidden = !ev.target.checked; if (ev.target.checked && !$(p + 'CampStart').value) $(p + 'CampStart').value = today(); }
    else if (id === 'mWhen') { const l = ev.target.value === 'later'; $('mAtW').hidden = !l; $('mSend').textContent = l ? 'Zakaži slanje' : 'Pošalji e-mail'; }
    else if (id === 'docFile') onDocFile(ev.target, false);
    else if (id === 'contractFile') onContractFile(ev.target);
    else if (id === 'iContract') { $('iContractW').hidden = !ev.target.checked; }
    else if (id === 'mFile') onDocFile(ev.target, true);
    else if (ev.target.dataset && ev.target.dataset.doc) { if (ev.target.checked) S.mailDocs.add(ev.target.dataset.doc); else S.mailDocs.delete(ev.target.dataset.doc); }
    else if (id === 'fSort') { S.sort = ev.target.value; renderClients(); }
    else if (id === 'iFilter') { S.iFilter = ev.target.value; renderInbox(); }
    else if (id === 'mTpl') { const c = byId(S.mailClient); const t = S.templates.find((x) => x.id === ev.target.value); if (c && t) { const f = fillTpl(t, c); $('mSubj').value = f.subject; $('mBody').value = f.body; applyTplSchedule(t); } else if (!ev.target.value) { $('mSubj').value = ''; $('mBody').value = ''; } }
  });
  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'fq') { S.q = ev.target.value; renderClients(); }
    if (ev.target.id === 'fVMin') { S.fVMin = ev.target.value; renderClients(); }
    if (ev.target.id === 'fVMax') { S.fVMax = ev.target.value; renderClients(); }
    else if (ev.target.id === 'iq') { S.iq = ev.target.value; renderInbox(); }
    else if (ev.target.id === 'nName' || ev.target.id === 'nOib' || ev.target.id === 'nEmail') checkDupes();
    else if (ev.target.id === 'gq') { clearTimeout(gTimer); const v = ev.target.value; gTimer = setTimeout(() => globalSearch(v), 250); }
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && (!$('drawer').hidden || !$('mdrawer').hidden || !$('mNew').hidden || !$('mMail').hidden || !$('toolModal').hidden)) closeTop(); });
  $('toolModal').addEventListener('click', toolClick);
  $('fNew').addEventListener('submit', submitNew);
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TABS.includes(h) && h !== S.tab && !(S.loaded && !tabAllowed(h))) { S.tab = h; renderAll(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });

  /* ---------- start ---------- */
  const h0 = location.hash.slice(1); if (TABS.includes(h0)) S.tab = h0;
  renderTabs(); renderAll();
  refresh(true).then(() => { if (S.tab === 'postavke') renderSettings(); if (S.tab === 'inbox') syncInbox(false, true); });
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 20000);
  setInterval(() => { if (document.visibilityState === 'visible' && S.tab === 'pregled') { loadUsage(); if (isAdmin()) loadRevenue(true); } if (document.visibilityState === 'visible' && S.tab === 'tim') loadAudit(); }, 60000);
  setInterval(() => { if (document.visibilityState === 'visible' && S.tab === 'inbox') syncInbox(false, true); }, 120000);
  /* vrijeme u aplikaciji: otvorena i prijavljena aplikacija javlja se svakih 45 s */
  const presencePing = () => { if (S.me && S.csrf) call('ping', {}).catch(() => {}); };
  setInterval(presencePing, 45000);
  setTimeout(presencePing, 3000);
}
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'nVKind') { const r = document.getElementById('nValReq'); if (r) r.hidden = !e.target.value; }
});

document.addEventListener('change', (e) => {
  const t = e.target; if (!t) return;
  if (t.id === 'nCamp' || t.id === 'cCamp') {
    const sel = document.getElementById(t.id === 'nCamp' ? 'nVKind' : 'noteVKind');
    if (sel && t.checked) { sel.value = 'ugovoreno'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  if ((t.id === 'nVKind' || t.id === 'noteVKind') && t.value === 'ponudeno') {
    const cb = document.getElementById(t.id === 'nVKind' ? 'nCamp' : 'cCamp');
    if (cb && cb.checked) { t.value = 'ugovoreno'; const tt = document.getElementById('toast'); if (tt) { tt.textContent = 'Klijent s aktivnom kampanjom mora imati status Ugovoreno.'; tt.className = 'toast bad'; tt.hidden = false; setTimeout(() => { tt.hidden = true; }, 4500); } }
  }
});
})();
