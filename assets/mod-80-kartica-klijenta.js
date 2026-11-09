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

