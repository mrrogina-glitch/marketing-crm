  /* ---------- shell ---------- */
  function renderBanner() {
    let h = '';
    if (S.offline) h = '<div class="banner" role="status">Nema veze s poslužiteljem. Pokušavam ponovno.</div>';
    else if (S.loaded && !S.mail.enabled) h = '<div class="banner info" role="status">Slanje e-maila još nije podešeno. ' + (isAdmin() ? 'Upišite podatke sandučića u config.php.' : 'Obavijestite administratora.') + '</div>';
    else if (S.loaded && S.mail.error) h = '<div class="banner" role="status">Zadnje osvježavanje pošte nije uspjelo.' + (isAdmin() && S.mail.error !== 'error' ? ' ' + esc(S.mail.error) : '') + '</div>';
    if (S.loaded && isAdmin() && (S.approvals || []).length) h += '<div class="banner info" role="status">Grupne e-mail poruke čekaju vaše odobrenje: <b>' + S.approvals.length + '</b> (' + esc(S.approvals.map((a) => a.user).filter((v, i, x) => x.indexOf(v) === i).join(', ')) + '). <button class="btn sm" data-goto="kampanje">Pregledaj i odobri</button></div>';
    $('banner').innerHTML = h;
  }
  const ADMIN_TABS = ['tim'];
  const tabAllowed = (t) => ADMIN_TABS.indexOf(t) < 0 || isAdmin();
  function renderTabs() {
    if (S.loaded) {
      ADMIN_TABS.forEach((t) => { $('t-' + t).hidden = !isAdmin(); });
      $('t-postavke').textContent = isAdmin() ? 'Postavke' : 'Moj račun';
      if (!tabAllowed(S.tab)) { S.tab = 'pregled'; try { location.hash = 'pregled'; } catch (e) { /* ignore */ } }
    }
    { const n = (S.tasks || []).filter((t) => !t.doneAt && t.assigneeId === S.me.id).length; const el = $('t-zadaci'); if (el.dataset.b !== String(n)) { el.dataset.b = String(n); el.innerHTML = 'Zadaci' + (n ? ' <span class="badge">' + n + '</span>' : ''); } }
    { const n = isAdmin() ? (S.approvals || []).length : 0; const el = $('t-kampanje'); if (el.dataset.b !== String(n)) { el.dataset.b = String(n); el.innerHTML = 'E-mail kampanje' + (n ? ' <span class="badge">' + n + '</span>' : ''); } }
    TABS.forEach((t) => { $('t-' + t).setAttribute('aria-selected', String(S.tab === t)); $('v-' + t).hidden = S.tab !== t; });
    const n = unreadCount(); const b = $('inboxBadge');
    b.hidden = n === 0; b.textContent = n > 99 ? '99+' : String(n);
    $('meName').textContent = S.me.name || '';
    if ($('bkTop')) $('bkTop').hidden = !isAdmin();
  }
  function renderAll() {
    renderBanner(); renderTabs();
    if (S.tab === 'pregled') renderOverview();
    else if (S.tab === 'klijenti') renderClients();
    else if (S.tab === 'inbox') renderInbox();
    else if (S.tab === 'aktivni') renderActive();
    else if (S.tab === 'zadaci') renderTasksTab();
    else if (S.tab === 'kampanje') renderCampaigns();
    else if (S.tab === 'tim') renderTeam();
    else if (S.tab === 'postavke') { const r = $('v-postavke'); if (!r.contains(document.activeElement) || !r.innerHTML) renderSettings(); }
  }
  function setTab(t) {
    if (TABS.indexOf(t) < 0 || (S.loaded && !tabAllowed(t))) return;
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


