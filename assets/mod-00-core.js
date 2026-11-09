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

