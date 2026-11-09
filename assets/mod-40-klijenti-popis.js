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

