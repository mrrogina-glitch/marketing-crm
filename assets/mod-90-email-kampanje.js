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
  const mcLim = () => { const o = mcState().ov; const lim = o && o.rateDay !== o.rateNight ? '08–16 h: ' + o.rateDay + ', 16–08 h: ' + o.rateNight + (o.rateWeekend ? ', sub–ned: ' + o.rateWeekend : '') : ''; return { n: o ? o.perHour : 55, w: lim ? lim + ' na sat' : 'bez ograničenja termina' }; };
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
    let h = '<header><h3>Red slanja grupne pošte</h3><span class="muted">od 08 do 16 h najviše ' + (o.rateDay || o.perHour) + ' poruka na sat, od 16 do 08 h najviše ' + (o.rateNight || o.perHour) + (o.rateWeekend ? ', subotom i nedjeljom ' + o.rateWeekend : '') + ' · odgovori iz Inboxa i pojedinačni mailovi imaju prednost</span></header><div class="pad">' +
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

