(() => {
'use strict';
const $ = (id) => document.getElementById(id);

if (document.body.dataset.view === 'login') { initLogin(); } else { initApp(); }

/* ------------------------------------------------------------------ login */
function initLogin() {
  $('fLogin').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msg = $('lMsg');
    msg.textContent = '';
    const email = $('lEmail').value.trim();
    const password = $('lPass').value;
    if (!email || !password) { msg.textContent = 'Upišite e-mail i lozinku.'; return; }
    $('lGo').disabled = true;
    try {
      const r = await fetch('api.php?a=login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Prijava nije uspjela.');
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
    { id: 'dobiven', label: 'Dobiven' }, { id: 'izgubljen', label: 'Izgubljen' },
  ];
  const STAGE = Object.fromEntries(STAGES.map((s) => [s.id, s]));
  const OPEN = { novi: 1, kontaktiran: 1, ponuda: 1, pregovori: 1 };
  const SERVICES = ['Društvene mreže', 'Google Ads', 'SEO optimizacija', 'Izrada web stranice', 'Content marketing', 'E-mail marketing', 'Brendiranje i dizajn', 'Cjelovito vođenje marketinga'];
  const TYPES = { note: 'Bilješka', call: 'Poziv', meeting: 'Sastanak', email: 'E-mail poslan', inmail: 'E-mail primljen', status: 'Status' };
  const STALE_DAYS = 14;
  const TABS = ['pregled', 'klijenti', 'inbox', 'tim', 'postavke'];
  const meta = document.querySelector('meta[name="csrf"]');
  const S = {
    csrf: meta ? meta.content : '', rev: '', loaded: false, offline: false,
    me: { id: '', name: '', email: '', role: 'sales' }, users: [], usersById: {},
    clients: [], notes: [], emails: [], docs: [], templates: [], scheduled: [], reminders: [], settings: null, mail: { enabled: false, from: '', imap: false, lastSync: 0, error: '', imap2: false, lastSync2: 0, error2: '' },
    byClient: new Map(), clientsById: new Map(), inByClient: new Map(),
    tab: 'pregled', q: '', fStatus: '', fOwner: '', fKind: '', sort: 'activity', iq: '', iFilter: 'all', period: '7',
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

  async function call(action, body, method) {
    const opt = { method: method || 'POST', credentials: 'same-origin', headers: {} };
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
      S.rev = d.rev; S.me = d.me; S.users = d.users; S.clients = d.clients; S.notes = d.notes; S.emails = d.emails; S.mail = d.mail; S.docs = d.docs || []; S.templates = d.templates || []; S.scheduled = d.scheduled || []; S.reminders = d.reminders || []; S.settings = d.settings || null;
      S.loaded = true;
      derive();
      renderAll(); updateDrawer();
    } catch (e) {
      if (!S.offline) { S.offline = true; renderBanner(); }
    } finally { S.refreshing = false; }
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
  const isStale = (c) => { if (!isOpen(c)) return false; const t = lastTs(c); return !t || daysAgo(t) >= STALE_DAYS; };
  const isDue = (c) => isOpen(c) && !!c.nextFollowUp && c.nextFollowUp <= today();
  const overdueDays = (c) => Math.round((new Date(today()) - new Date(c.nextFollowUp)) / 864e5);
  const person = (id) => { const u = S.usersById[id]; return u ? u.name : (id ? 'Bivši korisnik' : 'Nedodijeljeno'); };
  const activeUsers = () => S.users.filter((u) => u.active);
  const unreadCount = () => S.emails.filter((e) => e.dir === 'in' && !e.read).length;
  const kindLabel = (c) => (c.kind === 'osoba' ? 'Fizička osoba' : 'Tvrtka');
  const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const canDelete = (c) => isAdmin() || String(c.ownerId) === String(S.me.id);

  /* ---------- shell ---------- */
  function renderBanner() {
    let h = '';
    if (S.offline) h = '<div class="banner" role="status">Nema veze s poslužiteljem. Pokušavam ponovno.</div>';
    else if (S.loaded && !S.mail.enabled) h = '<div class="banner info" role="status">Slanje e-maila još nije podešeno. ' + (isAdmin() ? 'Upišite podatke sandučića u config.php.' : 'Obavijestite administratora.') + '</div>';
    else if (S.loaded && S.mail.error) h = '<div class="banner" role="status">Zadnje osvježavanje pošte nije uspjelo.' + (isAdmin() && S.mail.error !== 'error' ? ' ' + esc(S.mail.error) : '') + '</div>';
    $('banner').innerHTML = h;
  }
  function renderTabs() {
    TABS.forEach((t) => { $('t-' + t).setAttribute('aria-selected', String(S.tab === t)); $('v-' + t).hidden = S.tab !== t; });
    const n = unreadCount(); const b = $('inboxBadge');
    b.hidden = n === 0; b.textContent = n > 99 ? '99+' : String(n);
    $('meName').textContent = S.me.name || '';
  }
  function renderAll() {
    renderBanner(); renderTabs();
    if (S.tab === 'pregled') renderOverview();
    else if (S.tab === 'klijenti') renderClients();
    else if (S.tab === 'inbox') renderInbox();
    else if (S.tab === 'tim') renderTeam();
    else if (S.tab === 'postavke') { const r = $('v-postavke'); if (!r.contains(document.activeElement) || !r.innerHTML) renderSettings(); }
  }
  function setTab(t) {
    if (TABS.indexOf(t) < 0) return;
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

  function renderOverview() {
    const root = $('v-pregled');
    if (!S.loaded) { root.innerHTML = loadingHtml(); return; }
    if (!S.clients.length) { root.innerHTML = emptyHtml(); return; }
    const open = S.clients.filter(isOpen);
    const won = S.clients.filter((c) => c.status === 'dobiven');
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
    h += '<div class="strip">' +
      '<div><div class="k">Otvoreni klijenti</div><div class="v">' + open.length + '</div><div class="s">u radu, ' + eur(sumVal(open)) + '</div></div>' +
      '<div><div class="k">Javiti se danas</div><div class="v' + (due.length ? ' warn' : '') + '">' + due.length + '</div><div class="s">' + due.filter((c) => c.nextFollowUp < today()).length + ' kasni</div></div>' +
      '<div><div class="k">Bez nedavnog kontakta</div><div class="v' + (stale.length ? ' warn' : '') + '">' + stale.length + '</div><div class="s">' + STALE_DAYS + ' dana ili dulje</div></div>' +
      '<div><div class="k">Dobiveno</div><div class="v">' + won.length + '</div><div class="s">' + eur(sumVal(won)) + '</div></div></div>';
    if (pend.length) h += '<p class="hint">Zakazano slanje: ' + pend.length + ' ' + plural(pend.length, 'poruka', 'poruka') + ' (Inbox > Zakazano slanje).</p>';
    h += '<div class="cols"><section class="panel-b"><header><h3>Za javiti se</h3><span class="muted">po datumu sljedećeg kontakta</span></header>';
    h += due.length ? '<ul class="list">' + due.slice(0, 8).map((c) => { const d = overdueDays(c); return rowLi(c, d > 0 ? 'kasni ' + d + ' ' + plural(d, 'dan', 'dana') : 'danas', d > 0 ? 'late' : ''); }).join('') + '</ul>' : '<div class="none">Nema klijenata za javiti se danas.</div>';
    h += '</section><section class="panel-b"><header><h3>Treba bilješku</h3><span class="muted">dugo bez upisa ili pošte</span></header>';
    h += stale.length ? '<ul class="list">' + stale.slice(0, 8).map((c) => { const t = lastTs(c); return rowLi(c, t ? 'zadnje ' + rel(t) : 'nema bilješki', 'stale'); }).join('') + '</ul>' : '<div class="none">Svi otvoreni klijenti imaju svježu bilješku.</div>';
    h += '</section></div>';
    const tot = S.clients.length;
    h += '<section class="panel-b"><header><h3>Tijek prodaje</h3><span class="muted nums">' + tot + ' ' + plural(tot, 'klijent', 'klijenata') + '</span></header><div class="pipe"><div class="pipe-bar" role="img" aria-label="Raspodjela klijenata po statusu">' +
      STAGES.map((s) => { const n = S.clients.filter((c) => c.status === s.id).length; return n ? '<i style="flex:' + n + ';background:var(--s-' + s.id + ')" title="' + esc(s.label) + ': ' + n + '"></i>' : ''; }).join('') +
      '</div><div class="pipe-leg">' +
      STAGES.map((s) => { const a = S.clients.filter((c) => c.status === s.id); return '<div><span class="nm" style="--dot:var(--s-' + s.id + ')"><i></i>' + esc(s.label) + '</span><b>' + a.length + '</b><small class="nums">' + eur(sumVal(a)) + '</small></div>'; }).join('') +
      '</div></div></section>';
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
  function filteredClients() {
    let a = S.clients.slice(); const q = S.q.trim().toLowerCase();
    if (q) a = a.filter((c) => [c.name, c.contact, c.email, c.phone, c.service, c.oib].some((v) => (v || '').toLowerCase().includes(q)));
    if (S.fStatus) a = a.filter((c) => c.status === S.fStatus);
    if (S.fOwner) a = a.filter((c) => c.ownerId === S.fOwner);
    if (S.fKind) a = a.filter((c) => (c.kind || 'tvrtka') === S.fKind);
    a.sort((x, y) => {
      if (S.sort === 'name') return (x.name || '').localeCompare(y.name || '', 'hr');
      if (S.sort === 'value') return (y.value || 0) - (x.value || 0);
      if (S.sort === 'follow') return (x.nextFollowUp || '9999').localeCompare(y.nextFollowUp || '9999');
      return Math.max(lastTs(y), y.updatedAt || 0) - Math.max(lastTs(x), x.updatedAt || 0);
    });
    return a;
  }
  function renderClients() {
    fillSelect($('fStatus'), [['', 'Svi statusi']].concat(STAGES.map((s) => [s.id, s.label])), S.fStatus);
    fillSelect($('fOwner'), ownerOptions(['', 'Svi prodavači']), S.fOwner);
    const box = $('clist');
    if (!S.loaded) { box.innerHTML = '<div class="cnone">Učitavanje…</div>'; return; }
    if (!S.clients.length) { box.innerHTML = emptyHtml(); $('fCount').textContent = ''; return; }
    const a = filteredClients();
    $('fCount').textContent = a.length + ' od ' + S.clients.length;
    let h = '<div class="chead" aria-hidden="true"><span>Klijent</span><span>Usluga</span><span>Status</span><span style="text-align:right">Vrijednost</span><span>Prodavač</span><span>Zadnji kontakt</span><span>Javiti se</span></div>';
    if (!a.length) h += '<div class="cnone">Nijedan klijent ne odgovara filtrima.</div>';
    h += a.map((c) => {
      const t = lastTs(c); const st = isStale(c); const du = isDue(c);
      return '<button class="crow" data-open="' + esc(c.id) + '">' +
        '<span class="c-main"><b>' + esc(c.name) + '</b><small>' + (c.kind === 'osoba' ? 'fizička osoba' : esc(c.contact)) + '</small></span>' +
        '<span class="c-svc">' + esc(c.service) + '</span><span class="c-st">' + pill(c.status) + '</span>' +
        '<span class="c-val">' + (c.value ? eur(c.value) : '') + '</span><span class="c-own">' + esc(person(c.ownerId)) + '</span>' +
        '<span class="c-note' + (st ? ' flag-stale' : '') + '" data-l="Zadnji kontakt:">' + esc(t ? rel(t) : 'nema bilješki') + '</span>' +
        '<span class="c-next' + (du ? ' flag-late' : '') + '" data-l="Javiti se:">' + (c.nextFollowUp ? fmtYmd(c.nextFollowUp) : '–') + '</span></button>';
    }).join('');
    box.innerHTML = h;
  }

  /* ---------- inbox ---------- */
  function filteredEmails() {
    let a = S.emails.slice(); const q = S.iq.trim().toLowerCase();
    if (q) a = a.filter((e) => [e.fromName, e.fromEmail, e.to, e.subject, e.preview].some((v) => (v || '').toLowerCase().includes(q)));
    if (S.iFilter === 'sched') return [];
    if (S.iFilter === 'unread') a = a.filter((e) => e.dir === 'in' && !e.read);
    else if (S.iFilter === 'in') a = a.filter((e) => e.dir === 'in');
    else if (S.iFilter === 'out') a = a.filter((e) => e.dir === 'out');
    else if (S.iFilter === 'box2') a = a.filter((e) => e.box === 2);
    else if (S.iFilter === 'nolink') a = a.filter((e) => !e.clientId);
    return a;
  }
  function renderScheduled(box) {
    const a = S.scheduled.slice().sort((x, y) => x.sendAt - y.sendAt);
    if (!a.length) { box.innerHTML = '<div class="cnone">Nema zakazanih poruka.</div>'; return; }
    box.innerHTML = a.map((x) => {
      const c = byId(x.clientId); const mine = isAdmin() || x.userId === S.me.id;
      const st = x.status === 'failed' ? '<span class="chip bad">nije poslano</span>' : (x.status === 'sending' ? '<span class="chip">šalje se</span>' : '<span class="chip">zakazano</span>');
      return '<div class="mrow sched"><span class="dot"></span><span class="m-body"><span class="m-from">Za: ' + esc(x.to) + (c ? ' · ' + esc(c.name) : '') + '</span><span class="m-subj">' + esc(x.subject) + '</span>' +
        '<span class="m-prev">' + esc(person(x.userId)) + (x.error ? ' · ' + esc(x.error) : '') + '</span></span>' +
        '<span class="m-meta"><span class="nums">' + fmtDate(x.sendAt) + ' ' + fmtTime(x.sendAt) + '</span>' + st + (mine && x.status !== 'sending' ? '<button class="btn sm" data-act="schedcancel" data-id="' + esc(x.id) + '">Otkaži</button>' : '') + '</span></div>';
    }).join('');
  }
  function renderInbox() {
    const box = $('ilist');
    $('btnSync').disabled = !S.mail.imap || S.syncing;
    $('btnSync').textContent = S.syncing ? 'Osvježavam…' : 'Osvježi poštu';
    $('optBox2').hidden = !S.mail.imap2;
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
      return '<button class="mrow' + (unread ? ' unread' : '') + '" data-mail="' + esc(e.id) + '"><span class="dot"></span>' +
        '<span class="m-body"><span class="m-from">' + esc(who) + '</span><span class="m-subj">' + esc(e.subject || '(bez predmeta)') + (e.att ? ' · privitak' : '') + '</span><span class="m-prev">' + esc(e.preview) + '</span></span>' +
        '<span class="m-meta"><span class="nums">' + shortDate(e.date) + '</span>' + (c ? '<span class="chip">' + esc(c.name) + '</span>' : (e.dir === 'out' ? '<span class="chip out">poslano</span>' : '')) + (e.auto ? '<span class="chip out">automatski</span>' : '') + (e.box === 2 ? '<span class="chip">Inbox 2</span>' : '') + '</span></button>';
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
    S.lastFocus = document.activeElement; S.openMailId = id;
    const sh = $('rSheet');
    sh.innerHTML = '<div class="sh-h"><h2 id="rSubject">Učitavanje…</h2><button class="x" data-act="close" aria-label="Zatvori">×</button></div>';
    $('mdrawer').hidden = false; document.body.classList.add('lock');
    let e;
    try { e = (await call('email_open', { id })).email; } catch (err) { toast(err.message, true); closeTop(); return; }
    const local = S.emails.find((x) => x.id === id); if (local) local.read = true;
    renderTabs(); if (S.tab === 'inbox') renderInbox();
    const c = e.clientId ? byId(e.clientId) : null;
    const incoming = e.dir === 'in';
    let h = '<div class="sh-h"><div><h2 id="rSubject">' + esc(e.subject || '(bez predmeta)') + '</h2><div class="sub"><span>' + esc(incoming ? 'Primljeno' : 'Poslano') + (e.box === 2 ? ' · Inbox 2' : '') + '</span><span class="nums">' + fmtDate(e.date) + ' ' + fmtTime(e.date) + '</span></div></div><button class="x" data-act="close" aria-label="Zatvori">×</button></div><div class="sh-b">';
    h += '<dl class="meta-grid"><dt>Od</dt><dd>' + esc((e.fromName ? e.fromName + ' ' : '') + '<' + e.fromEmail + '>') + '</dd><dt>Za</dt><dd>' + esc(e.to) + '</dd>' +
      (e.att ? '<dt>Privitak</dt><dd>' + ((e.docs && e.docs.length) ? e.docs.map((d) => '<a class="doclink" href="api.php?a=doc_download&id=' + encodeURIComponent(d.id) + '">' + esc(d.name) + '</a> <span class="hint">' + esc(fmtSize(d.size)) + '</span>').join('<br>') : esc(e.att) + ' <span class="hint">(datoteka nije spremljena, vidi se u webmailu)</span>') + '</dd>' : '') + '</dl>';
    h += '<div class="sec"><h3>Klijent</h3>';
    if (c) {
      h += '<div class="acts"><span class="chip">' + esc(c.name) + '</span><button class="btn sm" data-open="' + esc(c.id) + '" data-keep="1">Otvori klijenta</button><button class="btn sm" data-act="unlink" data-id="' + esc(e.id) + '">Odvoji</button></div>';
    } else {
      h += '<div class="acts"><label class="f">Poveži s klijentom<select id="rLink"><option value="">Odaberite klijenta</option>' + S.clients.slice().sort((a, b) => a.name.localeCompare(b.name, 'hr')).map((x) => '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>').join('') + '</select></label>' +
        '<button class="btn" data-act="link" data-id="' + esc(e.id) + '">Poveži</button>' + (incoming ? '<button class="btn primary" data-act="mkclient" data-id="' + esc(e.id) + '">Napravi klijenta iz poruke</button>' : '') + '</div>';
    }
    h += '</div><div class="sec"><h3>Poruka</h3><div class="mailbody">' + esc(e.body) + '</div></div>';
    {
      const target = incoming ? (e.replyTo || e.fromEmail) : e.to;
      h += '<div class="sec"><h3>' + 'Odgovor' + '</h3><div class="compose"><textarea id="rBody" placeholder="Upišite odgovor. Citat izvorne poruke dodaje se automatski."></textarea><div class="foot"><span class="msg" id="rMsg" role="alert"></span><button class="btn primary" data-act="reply" data-id="' + esc(e.id) + '">Pošalji odgovor</button></div></div>' +
        '<p class="hint">Odgovor odlazi s adrese ' + esc(S.mail.from) + ' na ' + esc(target) + '. Dodaje se Vaš potpis.</p></div>';
    }
    h += '</div>';
    sh.innerHTML = h;
  }
  async function sendReply(id) {
    const ta = $('rBody'); const body = ta.value.trim();
    if (body.length < 2) { $('rMsg').textContent = 'Upišite tekst odgovora.'; ta.focus(); return; }
    $('rMsg').textContent = '';
    const ok = await safe(() => call('email_reply', { email_id: id, body }), 'Odgovor poslan');
    if (ok) { closeTop(); refresh(true); }
  }

  /* ---------- team ---------- */
  function renderTeam() {
    const root = $('v-tim');
    if (!S.loaded) { root.innerHTML = loadingHtml(); return; }
    const cut = S.period === 'all' ? 0 : Date.now() - Number(S.period) * 864e5;
    const rows = S.users.filter((u) => u.active || S.notes.some((n) => n.authorId === u.id)).map((u) => {
      const mine = S.notes.filter((n) => n.authorId === u.id && n.createdAt >= cut);
      const cnt = (t) => mine.filter((n) => n.type === t).length;
      const own = S.clients.filter((c) => c.ownerId === u.id);
      const open = own.filter(isOpen);
      const won = own.filter((c) => c.status === 'dobiven' && (c.wonAt || c.createdAt) >= cut);
      return { id: u.id, total: mine.length, notes: mine.filter((n) => n.type === 'note' || n.type === 'status').length, calls: cnt('call'), meet: cnt('meeting'), mail: cnt('email'),
        open: open.length, pipe: sumVal(open), won: won.length, wonV: sumVal(won), stale: open.filter(isStale).length };
    }).sort((a, b) => b.total - a.total);
    const max = Math.max(1, ...rows.map((r) => r.total));
    let h = '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><h2>Rad prodavača</h2><div class="seg" role="group" aria-label="Razdoblje">' +
      [['7', '7 dana'], ['30', '30 dana'], ['all', 'Sve']].map((p) => '<button data-period="' + p[0] + '" aria-pressed="' + (S.period === p[0]) + '">' + p[1] + '</button>').join('') + '</div></div>';
    h += '<section class="panel-b"><div class="tscroll"><table class="tbl"><thead><tr><th>Prodavač</th><th>Aktivnosti</th><th>Bilješke</th><th>Pozivi</th><th>Sastanci</th><th>E-mailovi</th><th>Otvoreni</th><th>Dobiveno</th><th>Bez kontakta</th></tr></thead><tbody>';
    h += rows.map((r) => '<tr><td><span class="who"><i style="background:' + hue(r.id) + '"></i>' + esc(person(r.id)) + (r.id === S.me.id ? ' <span class="muted" style="font-weight:400">(ja)</span>' : '') + '</span></td>' +
      '<td>' + r.total + '<span class="mini"><i style="width:' + Math.round(r.total / max * 100) + '%"></i></span></td><td>' + r.notes + '</td><td>' + r.calls + '</td><td>' + r.meet + '</td><td>' + r.mail + '</td>' +
      '<td>' + r.open + '<br><span class="muted">' + eur(r.pipe) + '</span></td><td>' + r.won + '<br><span class="muted">' + eur(r.wonV) + '</span></td><td' + (r.stale ? ' class="flag-stale"' : '') + '>' + r.stale + '</td></tr>').join('');
    h += '</tbody></table></div></section>';
    const feed = S.notes.slice(0, 15);
    h += '<section class="panel-b feed"><header><h3>Zadnje aktivnosti</h3><span class="muted">svi prodavači</span></header>';
    h += feed.length ? '<ul class="list">' + feed.map((n) => { const c = byId(n.clientId); if (!c) return ''; const t = n.type === 'email' ? (n.subject || 'E-mail') : n.text;
      return '<li><button class="li" data-open="' + esc(c.id) + '"><span class="a"><b>' + esc(c.name) + '</b><small><span class="tag">' + esc(TYPES[n.type] || 'Bilješka') + '</span>' + esc(person(n.authorId)) + ': ' + esc(t.length > 110 ? t.slice(0, 110) + '…' : t) + '</small></span><span class="b muted">' + esc(rel(n.createdAt)) + '</span></button></li>'; }).join('') + '</ul>' : '<div class="none">Još nema zabilježenih aktivnosti.</div>';
    root.innerHTML = h + '</section>';
  }

  /* ---------- settings ---------- */
  function renderSettings() {
    const root = $('v-postavke');
    if (!S.loaded) { root.innerHTML = loadingHtml(); return; }
    let h = '<h2>Postavke</h2>';
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
        '<dt>Inbox 2 (samo primanje)</dt><dd>' + (S.mail.imap2 ? 'podešen, zadnje osvježeno ' + esc(minAgo(S.mail.lastSync2)) + (S.mail.error2 && S.mail.error2 !== 'error' ? ' · greška: ' + esc(S.mail.error2) : '') : 'nije podešen (config.php, odjeljak imap2)') + '</dd>' +
        (S.mail.error && S.mail.error !== 'error' ? '<dt>Zadnja greška</dt><dd>' + esc(S.mail.error) + '</dd>' : '') + '</dl>' +
        '<div class="msg" id="mtMsg" role="alert"></div><div class="row-btns start"><button class="btn" data-act="mailtest"' + (S.mail.enabled ? '' : ' disabled') + '>Pošalji probni e-mail meni</button>' +
        '<button class="btn" data-act="syncnow"' + (S.mail.imap ? '' : ' disabled') + '>Osvježi poštu sada</button></div></div></section>';
      const st = S.settings || { autoreply: { enabled: true, subject: '', body: '' }, reportEnabled: true, workHours: '' };
      h += '<section class="panel-b"><header><h3>Automatski odgovor izvan radnog vremena</h3><span class="muted">radno vrijeme: ' + esc(st.workHours) + '</span></header><div class="pad">' +
        '<label class="chk"><input type="checkbox" id="arOn"' + (st.autoreply.enabled ? ' checked' : '') + '> Uključen. Svaki pošiljatelj dobiva najviše jedan automatski odgovor dnevno, a ne odgovara se na automatsku poštu, newslettere i no-reply adrese.</label>' +
        '<label class="f">Predmet<input id="arSubj" value="' + esc(st.autoreply.subject) + '"><span class="hint">Oznaka <code>{{predmet}}</code> zamjenjuje se predmetom dolazne poruke.</span></label>' +
        '<label class="f">Tekst odgovora<textarea id="arBody" rows="7">' + esc(st.autoreply.body) + '</textarea></label>' +
        '<label class="chk"><input type="checkbox" id="repOn"' + (st.reportEnabled ? ' checked' : '') + '> Tjedni izvještaj voditeljima (administratorima) svaki ponedjeljak od 08:00 i mjesečni izvještaj 1. u mjesecu od 08:00 (po prodavaču, s popisom izvršenih usluga)</label>' +
        '<div class="msg" id="arMsg" role="alert"></div><div class="row-btns start"><button class="btn primary" data-act="arsave">Spremi</button><button class="btn" data-act="reportprev">Pregledaj izvještaj za prošli tjedan</button><button class="btn" data-act="reportsend"' + (S.mail.enabled ? '' : ' disabled') + '>Pošalji izvještaj meni</button><button class="btn" data-act="reportprevm">Pregledaj mjesečni izvještaj</button><button class="btn" data-act="reportsendm"' + (S.mail.enabled ? '' : ' disabled') + '>Pošalji mjesečni izvještaj meni</button></div>' +
        '<pre class="reportbox" id="reportBox" hidden></pre></div></section>';
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
  }
  function defaultSigGuess() { return [S.me.name, S.mail.from].filter(Boolean).join('\n'); }
  async function sigSave() {
    const ok = await safe(() => call('signature_save', { signature: $('sigText').value.trim() }), 'Potpis spremljen');
    if (ok) refresh(true);
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
      toast('Zakazano ' + r.queued + ' poruka' + (r.skipped ? ' (preskočeno ' + r.skipped + ': već poslano zadnjih 30 dana)' : '') + '. Vidi se u Inboxu pod Zakazano slanje.');
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
  async function mailTest() {
    const m = $('mtMsg'); m.textContent = 'Šaljem…';
    try { const r = await call('mail_test', {}); m.style.color = r.ok ? 'var(--good)' : 'var(--bad)'; m.textContent = r.ok ? 'Probni e-mail poslan na ' + r.to + '.' : 'Slanje nije uspjelo: ' + r.error; }
    catch (e) { m.style.color = 'var(--bad)'; m.textContent = e.message; }
  }

  /* ---------- client drawer ---------- */
  function openClient(id, keep) {
    const c = byId(id); if (!c) return;
    if (!keep) S.lastFocus = document.activeElement;
    if (keep) { $('mdrawer').hidden = true; }
    S.openId = id; S.pendingStatus = null;
    const svc = SERVICES.slice(); if (c.service && !svc.includes(c.service)) svc.push(c.service);
    const ownerOpts = ownerOptions().map((o) => '<option value="' + esc(o[0]) + '"' + (o[0] === c.ownerId ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('');
    let h = '<div class="sh-h"><div><h2 id="dTitle"></h2><div class="sub"><span id="dPill"></span><span id="dSub"></span></div></div><button class="x" data-act="close" aria-label="Zatvori">×</button></div><div class="sh-b">' +
      '<div class="sec"><div class="acts"><label class="f">Status<select id="stSel">' + STAGES.map((s) => '<option value="' + s.id + '">' + esc(s.label) + '</option>').join('') + '</select></label><button class="btn" data-act="mail">Napiši e-mail</button></div>' +
      '<div class="pending" id="stPending" hidden><p id="stLabel"></p><textarea id="stText" placeholder="Razlog promjene ili što je dogovoreno (obavezno)"></textarea><div class="msg" id="stMsg" role="alert"></div><div class="row-btns start"><button class="btn primary sm" data-act="stok">Potvrdi promjenu</button><button class="btn sm" data-act="stno">Odustani</button></div></div></div>' +
      '<div class="sec"><h3>Nova bilješka <span class="req" style="font-size:12px">obavezno</span></h3><div class="compose"><div class="row"><label class="f">Vrsta<select id="noteType"><option value="note">Bilješka</option><option value="call">Poziv</option><option value="meeting">Sastanak</option></select></label>' +
      '<label class="f">Sljedeći kontakt<input id="noteFollow" type="date"></label></div><textarea id="noteText" placeholder="Što je dogovoreno ili napravljeno, i koji je sljedeći korak."></textarea>' +
      '<div class="foot"><span class="msg" id="noteMsg" role="alert"></span><button class="btn primary" data-act="note">Spremi bilješku</button></div></div></div>' +
      '<div class="sec" id="schedSec" hidden><h3>Zakazano slanje</h3><ul class="docs" id="schedList"></ul></div>' +
      '<div class="sec"><h3>Dokumenti <small id="docCount"></small></h3><ul class="docs" id="docList"></ul><div class="acts"><label class="btn sm filebtn">Dodaj dokument<input type="file" id="docFile" hidden></label><span class="hint" id="docMsg">najviše 10 MB po datoteci</span></div></div>' +
      '<div class="sec"><h3>Povijest <small id="tlCount"></small></h3><ol class="tl" id="tl"></ol></div>' +
      '<details class="info"><summary>Podaci o klijentu</summary><div class="grid2">' +
      '<label class="f">Vrsta klijenta<select id="iKind"><option value="tvrtka"' + (c.kind !== 'osoba' ? ' selected' : '') + '>Tvrtka</option><option value="osoba"' + (c.kind === 'osoba' ? ' selected' : '') + '>Fizička osoba</option></select></label>' +
      '<label class="f"><span><span id="iNameL">' + (c.kind === 'osoba' ? 'Ime i prezime' : 'Naziv tvrtke') + '</span> <span class="req">*</span></span><input id="iName" value="' + esc(c.name) + '"></label>' +
      '<label class="f" id="iContactW"' + (c.kind === 'osoba' ? ' hidden' : '') + '><span>Kontakt osoba <span class="req">*</span></span><input id="iContact" value="' + esc(c.kind === 'osoba' ? '' : c.contact) + '"></label><label class="f">OIB<input id="iOib" inputmode="numeric" maxlength="11" value="' + esc(c.oib || '') + '"></label>' +
      '<label class="f">E-mail<input id="iEmail" type="email" value="' + esc(c.email) + '"></label><label class="f">Telefon<input id="iPhone" type="tel" value="' + esc(c.phone) + '"></label>' +
      '<label class="f">Usluga<select id="iService"><option value="">–</option>' + svc.map((s) => '<option' + (s === c.service ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select></label>' +
      '<label class="f">Vrijednost (€)<input id="iValue" type="number" min="0" step="50" value="' + esc(c.value || '') + '"></label>' +
      '<label class="f">Prodavač<select id="iOwner">' + ownerOpts + '</select></label><label class="f">Sljedeći kontakt<input id="iFollow" type="date" value="' + esc(c.nextFollowUp) + '"></label></div>' +
      '<div class="msg" id="iMsg" role="alert"></div><div class="row-btns start" style="margin-top:6px"><button class="btn" data-act="saveinfo">Spremi podatke</button></div></details>' +
      (canDelete(c) ? '<div class="danger-z"><button class="btn danger sm" data-act="del1">Obriši klijenta</button><span id="delConfirm" hidden><span class="hint">Briše klijenta i sve njegove bilješke. Ne može se poništiti. </span><button class="btn danger sm" data-act="del2">Da, obriši</button></span></div>' : '') + '</div>';
    $('dSheet').innerHTML = h;
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
    $('dSub').textContent = (c.kind === 'osoba' ? 'Fizička osoba' : (c.contact || '')) + ' · Prodavač: ' + person(c.ownerId);
    const docs = (S.docsByClient && S.docsByClient.get(c.id)) || [];
    $('docCount').textContent = docs.length ? docs.length + ' ' + plural(docs.length, 'datoteka', 'datoteka') : '';
    $('docList').innerHTML = docs.length ? docs.map((d) => '<li><a class="doclink" href="api.php?a=doc_download&id=' + encodeURIComponent(d.id) + '">' + esc(d.name) + '</a><span class="hint">' + esc(fmtSize(d.size)) + ' · ' + fmtDate(d.createdAt) + (d.emailId ? ' · iz e-maila' : '') + '</span>' +
      ((isAdmin() || d.by === S.me.id || String(c.ownerId) === String(S.me.id)) ? '<button class="btn sm danger" data-act="docdel" data-id="' + esc(d.id) + '">Obriši</button>' : '') + '</li>').join('') : '<li class="hint">Nema dokumenata. Dodajte ponudu, ugovor ili drugi dokument.</li>';
    const sc = S.scheduled.filter((x) => x.clientId === c.id);
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
      else if (it.kind === 'email') { who = person(it.n.authorId); const t = it.n.text || ''; body = '<span class="subj">' + esc(it.n.subject || '(bez predmeta)') + '</span>' + esc(t.length > 500 ? t.slice(0, 500) + '…' : t); }
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
    $('noteMsg').textContent = '';
    const ok = await safe(() => call('note_add', { client_id: c.id, type: $('noteType').value, text, next_follow_up: $('noteFollow').value }), 'Bilješka spremljena');
    if (ok) { ta.value = ''; $('noteFollow').value = ''; refresh(true); }
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
    $('iMsg').textContent = '';
    const ok = await safe(() => call('client_update', { id: c.id, kind, oib, name, contact: kind === 'osoba' ? name : contact, email, phone: $('iPhone').value.trim(), service: $('iService').value, value: Number($('iValue').value) || 0, owner_id: $('iOwner').value, next_follow_up: $('iFollow').value }), 'Podaci spremljeni');
    if (ok) refresh(true);
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
  function openNew(prefill) {
    S.lastFocus = document.activeElement;
    ['nName', 'nContact', 'nOib', 'nEmail', 'nPhone', 'nValue', 'nFollow', 'nNote'].forEach((i) => { $(i).value = ''; });
    S.nFromMail = prefill ? prefill.emailId || null : null; S.nGuess = prefill ? prefill.guess || '' : '';
    document.querySelectorAll('input[name="nKindR"]').forEach((r) => { r.checked = !prefill && r.value === 'tvrtka'; });
    $('nHint').hidden = !prefill; applyNewKind();
    fillSelect($('nService'), [['', '–']].concat(SERVICES.map((s) => [s, s])), '');
    fillSelect($('nStatus'), STAGES.filter((s) => OPEN[s.id]).map((s) => [s.id, s.label]), 'novi');
    fillSelect($('nOwner'), activeUsers().map((u) => [u.id, u.name + (u.id === S.me.id ? ' (ja)' : '')]), S.me.id);
    if (prefill) { $('nEmail').value = prefill.email || ''; $('nNote').value = prefill.note || ''; }
    $('nMsg').textContent = '';
    $('mNew').hidden = false; document.body.classList.add('lock');
    $('nName').focus();
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
    if (note.length < 3) { m.textContent = 'Prva bilješka je obavezna.'; $('nNote').focus(); return; }
    m.textContent = ''; $('nSave').disabled = true;
    try {
      const r = await call('client_create', { kind, oib, email_id: S.nFromMail || undefined, name, contact, email, phone: $('nPhone').value.trim(), service: $('nService').value, value: Number($('nValue').value) || 0, status: $('nStatus').value, owner_id: $('nOwner').value, next_follow_up: $('nFollow').value, note });
      toast('Klijent spremljen');
      $('mNew').hidden = true;
      await refresh(true);
      if (byId(r.id)) { S.lastFocus = null; $('mdrawer').hidden = true; openClient(r.id, true); } else document.body.classList.remove('lock');
    } catch (e) { m.textContent = e.message; }
    $('nSave').disabled = false;
  }

  /* ---------- e-mail to client ---------- */
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
    S.mailClient = c.id; S.mailDocs = new Set();
    $('mSub').textContent = c.name + (c.kind === 'osoba' ? ' · fizička osoba' : (c.contact ? ' · ' + c.contact : ''));
    const tpls = S.templates.filter((t) => t.kind !== 'akcija');
    fillSelect($('mTpl'), [['', '(prazna poruka)']].concat(tpls.map((t) => [t.id, t.name])), '');
    const pick = (tplPrefix && tpls.find((t) => t.name.toLowerCase().startsWith(tplPrefix.toLowerCase()))) || tpls[0];
    $('mTo').value = c.email || '';
    if (pick) { $('mTpl').value = pick.id; const t = fillTpl(pick, c); $('mSubj').value = t.subject; $('mBody').value = t.body; } else { $('mSubj').value = ''; $('mBody').value = ''; }
    $('mSig').textContent = S.me.signatureEffective || '';
    $('mWhen').value = 'now'; $('mAtW').hidden = true; $('mAt').value = defaultSendAt(); $('mRemind').value = '3';
    applyTplSchedule(pick);
    $('mFrom').textContent = S.mail.enabled ? 'Poruka odlazi s adrese ' + S.mail.from + '. Odgovori klijenta stižu u Inbox i uz klijenta.' : 'Slanje e-maila još nije podešeno. Administrator ga podešava u config.php.';
    $('mSend').disabled = !S.mail.enabled; $('mSend').textContent = 'Pošalji e-mail'; $('mMsg').textContent = '';
    renderMailDocs();
    $('mMail').hidden = false; ($('mTo').value ? $('mSubj') : $('mTo')).focus();
  }
  async function uploadDoc(file, clientId) {
    if (file.size > 10 * 1048576) throw new Error('Datoteka je prevelika (najviše 10 MB).');
    const fd = new FormData(); fd.append('client_id', clientId); fd.append('file', file);
    const res = await fetch('api.php?a=doc_upload', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF': S.csrf }, body: fd });
    let d = null; try { d = await res.json(); } catch (e) { /* ignore */ }
    if (res.status === 401) { location.reload(); throw new Error('Sesija je istekla.'); }
    if (!res.ok) throw new Error((d && d.error) || 'Učitavanje datoteke nije uspjelo.');
    return d.id;
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
      const r = await call('email_send', { client_id: c.id, to, subject, body, doc_ids: Array.from(S.mailDocs), remind_days: $('mRemind').value || null, send_at: later ? sendAt : undefined });
      toast(r.scheduled ? 'E-mail zakazan za ' + fmtDate(r.sendAt) + ' ' + fmtTime(r.sendAt) : 'E-mail poslan'); $('mMail').hidden = true; refresh(true);
    } catch (e) { $('mMsg').textContent = e.message; }
    $('mSend').disabled = !S.mail.enabled; $('mSend').textContent = $('mWhen').value === 'later' ? 'Zakaži slanje' : 'Pošalji e-mail';
  }

  /* ---------- events ---------- */
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    const tab = t.closest('[data-tab]'); if (tab) { setTab(tab.dataset.tab); return; }
    const per = t.closest('[data-period]'); if (per) { S.period = per.dataset.period; renderTeam(); return; }
    const mailBtn = t.closest('[data-mail]'); if (mailBtn) { openMailItem(mailBtn.dataset.mail); return; }
    const op = t.closest('[data-open]'); if (op) { openClient(op.dataset.open, !!op.dataset.keep); return; }
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
      else if (act === 'mail') openMail('Prvi');
      else if (act === 'msend') sendMail();
      else if (act === 'del1') $('delConfirm').hidden = false;
      else if (act === 'del2') deleteClient();
      else if (act === 'sync' || act === 'syncnow') syncInbox(true, false);
      else if (act === 'reply') sendReply(a.dataset.id);
      else if (act === 'link') { const v = $('rLink').value; if (v) safe(() => call('email_link', { email_id: a.dataset.id, client_id: v }), 'Poruka povezana').then((ok) => { if (ok) refresh(true).then(() => openMailItem(a.dataset.id)); }); }
      else if (act === 'unlink') safe(() => call('email_link', { email_id: a.dataset.id, client_id: null }), 'Poruka odvojena').then((ok) => { if (ok) refresh(true).then(() => openMailItem(a.dataset.id)); });
      else if (act === 'mkclient') {
        const e = S.emails.find((x) => x.id === a.dataset.id); if (!e) return;
        $('mdrawer').hidden = true;
        openNew({ emailId: e.id, guess: e.fromName || '', email: e.fromEmail, note: 'Upit e-mailom: ' + (e.subject || '(bez predmeta)') + '\n' + e.preview });
      }
      else if (act === 'docdel') safe(() => call('doc_delete', { id: a.dataset.id }), 'Dokument obrisan').then((ok) => { if (ok) refresh(true); });
      else if (act === 'schedcancel') safe(() => call('sched_cancel', { id: a.dataset.id }), 'Zakazano slanje otkazano').then((ok) => { if (ok) refresh(true); });
      else if (act === 'remdone') safe(() => call('reminder_done', { email_id: a.dataset.id }), 'Podsjetnik odbačen').then((ok) => { if (ok) refresh(true); });
      else if (act === 'remsnooze') safe(() => call('reminder_done', { email_id: a.dataset.id, snooze_days: 2 }), 'Podsjetnik odgođen za 2 dana').then((ok) => { if (ok) refresh(true); });
      else if (act === 'remfollow') { S.lastFocus = a; openClient(a.dataset.cid, true); openMail('Follow-up bez'); }
      else if (act === 'sigsave') sigSave();
      else if (act === 'arsave') arSave();
      else if (act === 'reportprev') reportPreview(false);
      else if (act === 'reportprevm') reportPreview(true);
      else if (act === 'reportsendm') safe(() => call('report_send', { monthly: true }).then((r) => { if (r.ok === false) throw new Error(r.error || 'Slanje nije uspjelo.'); toast('Mjesečni izvještaj poslan na ' + r.to); }));
      else if (act === 'reportsend') safe(() => call('report_send', {}).then((r) => { if (r.ok === false) throw new Error(r.error || 'Slanje nije uspjelo.'); toast('Izvještaj poslan na ' + r.to); }));
      else if (act === 'tplsave') tplSave(a.closest('.tplrow'));
      else if (act === 'tplsuggest') tplSuggest(a.closest('.tplrow'));
      else if (act === 'tplrun') tplRun(a.closest('.tplrow'));
      else if (act === 'tpldel') { if (confirm('Obrisati predložak?')) safe(() => call('template_delete', { id: a.closest('.tplrow').dataset.tid }), 'Predložak obrisan').then((ok) => { if (ok) refresh(true).then(renderSettings); }); }
      else if (act === 'pwchange') pwChange();
      else if (act === 'usave') userSave(a.closest('tr'));
      else if (act === 'ucreate') userCreate();
      else if (act === 'mailtest') mailTest();
      return;
    }
    if (t.classList && t.classList.contains('overlay')) closeTop();
  });
  document.addEventListener('change', (ev) => {
    const id = ev.target.id;
    if (id === 'stSel') onStatusChange();
    else if (id === 'fStatus') { S.fStatus = ev.target.value; renderClients(); }
    else if (id === 'fOwner') { S.fOwner = ev.target.value; renderClients(); }
    else if (id === 'fKind') { S.fKind = ev.target.value; renderClients(); }
    else if (id === 'iKind') { const o = ev.target.value === 'osoba'; $('iContactW').hidden = o; $('iNameL').textContent = o ? 'Ime i prezime' : 'Naziv tvrtke'; }
    else if (ev.target.name === 'nKindR') applyNewKind();
    else if (ev.target.dataset && ev.target.dataset.f === 'send_mode') { const r = ev.target.closest('.tplrow'); r.querySelectorAll('[data-sch]').forEach((x) => { x.hidden = x.dataset.sch !== ev.target.value; }); }
    else if (id === 'mWhen') { const l = ev.target.value === 'later'; $('mAtW').hidden = !l; $('mSend').textContent = l ? 'Zakaži slanje' : 'Pošalji e-mail'; }
    else if (id === 'docFile') onDocFile(ev.target, false);
    else if (id === 'mFile') onDocFile(ev.target, true);
    else if (ev.target.dataset && ev.target.dataset.doc) { if (ev.target.checked) S.mailDocs.add(ev.target.dataset.doc); else S.mailDocs.delete(ev.target.dataset.doc); }
    else if (id === 'fSort') { S.sort = ev.target.value; renderClients(); }
    else if (id === 'iFilter') { S.iFilter = ev.target.value; renderInbox(); }
    else if (id === 'mTpl') { const c = byId(S.mailClient); const t = S.templates.find((x) => x.id === ev.target.value); if (c && t) { const f = fillTpl(t, c); $('mSubj').value = f.subject; $('mBody').value = f.body; applyTplSchedule(t); } else if (!ev.target.value) { $('mSubj').value = ''; $('mBody').value = ''; } }
  });
  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'fq') { S.q = ev.target.value; renderClients(); }
    else if (ev.target.id === 'iq') { S.iq = ev.target.value; renderInbox(); }
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && (!$('drawer').hidden || !$('mdrawer').hidden || !$('mNew').hidden || !$('mMail').hidden)) closeTop(); });
  $('fNew').addEventListener('submit', submitNew);
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TABS.includes(h) && h !== S.tab) { S.tab = h; renderAll(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });

  /* ---------- start ---------- */
  const h0 = location.hash.slice(1); if (TABS.includes(h0)) S.tab = h0;
  renderTabs(); renderAll();
  refresh(true).then(() => { if (S.tab === 'postavke') renderSettings(); if (S.tab === 'inbox') syncInbox(false, true); });
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 20000);
  setInterval(() => { if (document.visibilityState === 'visible' && S.tab === 'inbox') syncInbox(false, true); }, 120000);
}
})();
