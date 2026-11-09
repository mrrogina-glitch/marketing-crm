  /* ---------- events ---------- */
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    const go = t.closest('[data-gopen]'); if (go) { globalSearchClose(); $('gq').value = ''; openClient(go.dataset.gopen); return; }
    const gm = t.closest('[data-gmail]'); if (gm) { globalSearchClose(); $('gq').value = ''; openMailItem(gm.dataset.gmail); return; }
    if (!t.closest('.gsearch')) globalSearchClose();
    const tab = t.closest('[data-tab]'); if (tab) { setTab(tab.dataset.tab); return; }
    const per = t.closest('[data-period]'); if (per) { S.period = per.dataset.period; S.tmFrom = ''; S.tmTo = ''; renderTeam(); return; }
    const mdel = t.closest('[data-mdel]'); if (mdel) { ev.preventDefault(); ev.stopPropagation(); deleteMail(mdel.dataset.mdel, true); return; }
    const mailBtn = t.closest('[data-mail]'); if (mailBtn) { openMailItem(mailBtn.dataset.mail); return; }
    const op = t.closest('[data-open]'); if (op) { const oid = op.dataset.open; const kp = !!op.dataset.keep; if (byId(oid)) openClient(oid, kp); else ensureClient(oid).then((ok) => { if (ok) { renderAll(); openClient(oid, kp); } }); return; }
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
      else if (act === 'renew') renewCampaign();
      else if (act === 'campadd') addExtraCamp();
      else if (act === 'campdel') delExtraCamp(a.dataset.id);
      else if (act === 'taskadd') taskAdd(a);
      else if (act === 'maildel') deleteMail(a.dataset.id);
      else if (act === 'taskdone' || act === 'taskdel') taskAct(a);
      else if (act === 'taskopen') taskOpen(a.dataset.id);
      else if (act.indexOf('tk_') === 0) taskDetailAct(act, a);
      else if (act === 'tkfilter') { S.tkFilter = a.dataset.v; renderTasksTab(); }
      else if (act === 'goalsave') saveGoals();
      else if (act === 'tkmore') { S.tkMore = !S.tkMore; renderOverview(); }
      else if (act === 'revmore') { S.revMore = !S.revMore; renderRevenue(); }
      else if (act === 'revper') { S.revPeriod = a.dataset.v; renderRevenue(); }
      else if (act === 'mail') openMail('Prvi');
      else if (act === 'msend') sendMail();
      else if (act === 'del1') $('delConfirm').hidden = false;
      else if (act === 'del2') deleteClient();
      else if (act === 'tmapply') { const f = $('tmFrom').value, t2 = $('tmTo').value; if (!f || !t2 || f > t2) { toast('Upišite ispravno razdoblje (Od ne smije biti iza Do).', true); return; } S.tmFrom = f; S.tmTo = t2; S.period = 'custom'; renderTeam(); }
      else if (act === 'sync' || act === 'syncnow') syncInbox(true, false);
      else if (act === 'reply') sendReply(a.dataset.id);
      else if (act === 'rfdel') { (S.rFiles || []).splice(+a.dataset.i, 1); renderReplyFiles(); }
      else if (act === 'link') { const v = $('rLink').value; if (v) safe(() => call('email_link', { email_id: a.dataset.id, client_id: v }), 'Poruka povezana').then((ok) => { if (ok) refresh(true).then(() => openMailItem(a.dataset.id)); }); }
      else if (act === 'unlink') safe(() => call('email_link', { email_id: a.dataset.id, client_id: null }), 'Poruka odvojena').then((ok) => { if (ok) refresh(true).then(() => openMailItem(a.dataset.id)); });
      else if (act === 'mkclient') {
        const e = S.emails.find((x) => x.id === a.dataset.id); if (!e) return;
        $('mdrawer').hidden = true;
        openNew({ emailId: e.id, guess: e.fromName || '', email: e.replyTo || e.fromEmail, note: 'Upit e-mailom: ' + (e.subject || '(bez predmeta)') + '\n' + e.preview });
      }
      else if (act === 'take') { if (confirm('Preuzeti klijenta ' + (byId(S.openId) || {}).name + '? Od sada ga vodite vi, a prodaja se do sada vodi na prethodnog prodavača.')) safe(() => call('client_take', { id: S.openId }), 'Klijent preuzet').then(async (ok) => { if (ok) { await refresh(true); openClient(S.openId, true); } }); }
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
      else if (act === 'b2test') b2Test();
      else if (act === 'b2save') b2Save();
      else if (act === 'b2clear') b2Clear();
      else if (act === 'tplsave') tplSave(a.closest('.tplrow'));
      else if (act === 'tplsuggest') tplSuggest(a.closest('.tplrow'));
      else if (act === 'tplrun') tplRun(a.closest('.tplrow'));
      else if (act === 'tpldel') { if (confirm('Obrisati predložak?')) safe(() => call('template_delete', { id: a.closest('.tplrow').dataset.tid }), 'Predložak obrisan').then((ok) => { if (ok) refresh(true).then(renderSettings); }); }
      else if (act === 'pwchange') pwChange();
      else if (act === 'usave') userSave(a.closest('tr'));
      else if (act === 'ucreate') userCreate();
      else if (act === 'mailtest') mailTest(1);
      else if (act === 'mailtest2') mailTest(2);
      else if (act === 'bkrun') runBackup();
      else if (act === 'secsave') secSave();
      else if (act === 'ipunblock') ipUnblock(a.dataset.ip);
      else if (act === 'aldone') alertDone(a.dataset.id);
      else if (act === 'alrenew') alertRenew(a.dataset.id);
      else if (act === 'alextend') alertExtend(a.dataset.id);
      else if (act === 'rquick') replyInsert(a.dataset.id);
      else if (act === 'rtplshow') { $('rTplRow').hidden = !$('rTplRow').hidden; if (!$('rTplRow').hidden) $('rTplName').focus(); }
      else if (act === 'rtplsave') replySaveTpl();
      else if (act === 'plsave') plSave();
      else if (act === 'plcancel') toolClose();
      else if (act === 'dncadd') dncAdd();
      else if (act === 'dncrm') dncRemove(a.dataset.id);
      else if (act === 'dnccl') dncClient(a.dataset.id);
      else if (act === 'dupopen') dupOpen();
      else if (act === 'impopen') impOpen();
      else if (act === 'poolopen') poolOpen();
      return;
    }
    if (t.classList && t.classList.contains('overlay')) closeTop();
  });
  document.addEventListener('change', (ev) => {
    if (ev.target && ev.target.id === 'rFile') { S.rFiles = (S.rFiles || []).concat(Array.from(ev.target.files)); ev.target.value = ''; renderReplyFiles(); return; }
    const id = ev.target.id;
    if (id === 'stSel') onStatusChange();
    else if (id === 'fStatus') { S.fStatus = ev.target.value; renderClients(); }
    else if (id === 'fOwner') { S.fOwner = ev.target.value; renderClients(); }
    else if (id === 'fKind') { S.fKind = ev.target.value; renderClients(); }
    else if (id === 'fIndustry') { S.fIndustry = ev.target.value; renderClients(); }
    else if (id === 'fVK') { S.fVK = ev.target.value; renderClients(); }
    else if (id === 'fNotes') { S.fNotes = ev.target.checked; renderClients(); }
    else if (id === 'tkWho') { S.tkWho = ev.target.value; document.activeElement.blur(); renderTasksTab(); }
    else if (id === 'revUser') { S.revUser = ev.target.value; renderRevenue(); }
    else if (id === 'iKind') { const o = ev.target.value === 'osoba'; $('iContactW').hidden = o; $('iNameL').textContent = o ? 'Ime i prezime' : 'Naziv tvrtke'; }
    else if (ev.target.name === 'nKindR') applyNewKind();
    else if (ev.target.dataset && ev.target.dataset.f === 'send_mode') { const r = ev.target.closest('.tplrow'); r.querySelectorAll('[data-sch]').forEach((x) => { x.hidden = x.dataset.sch !== ev.target.value; }); }
    else if (id === 'rTpl') replyApplyTpl();
    else if (id === 'cCampType') campTypeChanged(ev.target, 'cCampStart', 'cCampEnd');
    else if (id === 'nCampType') campTypeChanged(ev.target, 'nCampStart', 'nCampEnd');
    else if (id === 'rType') campTypeChanged(ev.target, 'rStart', 'rEnd');
    else if (id === 'xType') campTypeChanged(ev.target, 'xStart', 'xEnd');
    else if (id === 'cMulti') setMulti(ev.target.checked);
    else if (id === 'cCamp' || id === 'iCamp' || id === 'nCamp') { const p = id[0]; $(p + 'CampDates').hidden = !ev.target.checked; if (ev.target.checked && !$(p + 'CampStart').value) $(p + 'CampStart').value = today(); }
    else if (id === 'mWhen') { const l = ev.target.value === 'later'; $('mAtW').hidden = !l; $('mSend').textContent = l ? 'Zakaži slanje' : 'Pošalji e-mail'; }
    else if (id === 'docFile') onDocFile(ev.target, false);
    else if (id === 'contractFile') onContractFile(ev.target);
    else if (id === 'iContract') { $('iContractW').hidden = !ev.target.checked; }
    else if (id === 'mFile') onDocFile(ev.target, true);
    else if (ev.target.dataset && ev.target.dataset.doc) { if (ev.target.checked) S.mailDocs.add(ev.target.dataset.doc); else S.mailDocs.delete(ev.target.dataset.doc); }
    else if (id === 'fSort') { S.sort = ev.target.value; renderClients(); }
    else if (id === 'iFilter') { S.iFilter = ev.target.value; renderInbox(); }
    else if (id === 'mTpl') { const c = byId(S.mailClient); const t = S.templates.find((x) => x.id === ev.target.value); if (c && t) { const f = fillTpl(t, c); $('mSubj').value = f.subject; $('mBody').value = f.body; applyTplSchedule(t); } else if (!ev.target.value) { $('mSubj').value = ''; $('mBody').value = ''; } }
  });
  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'fq') { S.q = ev.target.value; renderClients(); }
    if (ev.target.id === 'fVMin') { S.fVMin = ev.target.value; renderClients(); }
    if (ev.target.id === 'fVMax') { S.fVMax = ev.target.value; renderClients(); }
    else if (ev.target.id === 'iq') { S.iq = ev.target.value; renderInbox(); }
    else if (ev.target.id === 'nName' || ev.target.id === 'nOib' || ev.target.id === 'nEmail') checkDupes();
    else if (ev.target.id === 'gq') { clearTimeout(gTimer); const v = ev.target.value; gTimer = setTimeout(() => globalSearch(v), 250); }
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && (!$('drawer').hidden || !$('mdrawer').hidden || !$('mNew').hidden || !$('mMail').hidden || !$('toolModal').hidden)) closeTop(); });
  $('toolModal').addEventListener('click', toolClick);
  $('fNew').addEventListener('submit', submitNew);
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TABS.includes(h) && h !== S.tab && !(S.loaded && !tabAllowed(h))) { S.tab = h; renderAll(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });

  /* ---------- start ---------- */
  const h0 = location.hash.slice(1); if (TABS.includes(h0)) S.tab = h0;
  renderTabs(); renderAll();
  refresh(true).then(() => { if (S.tab === 'postavke') renderSettings(); if (S.tab === 'inbox') syncInbox(false, true); });
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 20000);
  setInterval(() => { if (document.visibilityState === 'visible' && S.tab === 'pregled') { loadUsage(); if (isAdmin()) loadRevenue(true); } if (document.visibilityState === 'visible' && S.tab === 'tim') loadAudit(); }, 60000);
  setInterval(() => { if (document.visibilityState === 'visible' && S.tab === 'inbox') syncInbox(false, true); }, 120000);
  /* vrijeme u aplikaciji: otvorena i prijavljena aplikacija javlja se svakih 45 s */
  const presencePing = () => { if (S.me && S.csrf) call('ping', {}).catch(() => {}); };
  setInterval(presencePing, 45000);
  setTimeout(presencePing, 3000);
}
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'nVKind') { const r = document.getElementById('nValReq'); if (r) r.hidden = !e.target.value; }
});

document.addEventListener('change', (e) => {
  const t = e.target; if (!t) return;
  if (t.id === 'nCamp' || t.id === 'cCamp') {
    const sel = document.getElementById(t.id === 'nCamp' ? 'nVKind' : 'noteVKind');
    if (sel && t.checked) { sel.value = 'ugovoreno'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  if ((t.id === 'nVKind' || t.id === 'noteVKind') && t.value === 'ponudeno') {
    const cb = document.getElementById(t.id === 'nVKind' ? 'nCamp' : 'cCamp');
    if (cb && cb.checked) { t.value = 'ugovoreno'; const tt = document.getElementById('toast'); if (tt) { tt.textContent = 'Klijent s aktivnom kampanjom mora imati status Ugovoreno.'; tt.className = 'toast bad'; tt.hidden = false; setTimeout(() => { tt.hidden = true; }, 4500); } }
  }
});
})();
