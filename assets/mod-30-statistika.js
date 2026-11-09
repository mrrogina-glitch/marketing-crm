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

