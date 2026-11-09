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

