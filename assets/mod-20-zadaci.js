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

