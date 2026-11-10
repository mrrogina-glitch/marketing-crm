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

