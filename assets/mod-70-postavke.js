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
  async function mailTest(box) {
    const m = $('mtMsg'); m.textContent = 'Šaljem…';
    try { const r = await call('mail_test', { box: box || 1 }); m.style.color = r.ok ? 'var(--good)' : 'var(--bad)'; m.textContent = r.ok ? 'Probni e-mail poslan na ' + r.to + (r.from ? ' (pošiljatelj ' + r.from + ')' : '') + '.' : 'Slanje nije uspjelo: ' + r.error; }
    catch (e) { m.style.color = 'var(--bad)'; m.textContent = e.message; }
  }

