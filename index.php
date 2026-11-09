<?php
declare(strict_types=1);

require __DIR__ . '/lib/core.php';

app_boot();
send_security_headers(true);
header('Cache-Control: no-store');

$user = current_user();
$csrf = $user ? csrf_token() : '';
$v = static function (string $f): string {
    $p = __DIR__ . '/assets/' . $f;
    return 'assets/' . $f . '?v=' . (is_file($p) ? filemtime($p) : '0');
};
?><!doctype html>
<html lang="hr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex,nofollow">
<?php if ($user): ?><meta name="csrf" content="<?= htmlspecialchars($csrf, ENT_QUOTES) ?>"><?php endif; ?>
<title>VIP MARKET</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="<?= $v('app.css') ?>">
</head>
<?php if (!$user): ?>
<body class="auth" data-view="login">
<main class="auth-box">
  <div class="auth-logo"><img src="<?= $v('logo.png') ?>" alt="VIP grupa" width="380" height="167"></div>
  <h1 class="authname">VIP MARKET</h1>
  <p class="muted">Prijavite se svojim računom.</p>
  <form id="fLogin" class="stack" novalidate>
    <label class="f">E-mail<input id="lEmail" type="email" autocomplete="username" required autofocus></label>
    <label class="f">Lozinka<input id="lPass" type="password" autocomplete="current-password" required></label>
    <div class="msg" id="lMsg" role="alert"></div>
    <button class="btn primary" type="submit" id="lGo">Prijava</button>
  </form>
</main>
<script src="<?= $v('app.js') ?>"></script>
</body>
</html>
<?php return; endif; ?>
<body data-view="app">

<header class="top">
  <div class="in bar">
    <a class="brand" href="#pregled" aria-label="VIP MARKET">
      <svg viewBox="0 0 22 22" aria-hidden="true"><rect x="1" y="1" width="20" height="20" rx="3" fill="var(--accent)"/><path d="M6 7h10M6 11h10M6 15h6" stroke="var(--accent-ink)" stroke-width="1.8" stroke-linecap="round"/></svg>
      <span>VIP MARKET</span>
    </a>
    <nav class="tabs" role="tablist" aria-label="Odjeljci">
      <button class="tab" role="tab" data-tab="pregled" id="t-pregled">Pregled</button>
      <button class="tab" role="tab" data-tab="klijenti" id="t-klijenti">Klijenti</button>
      <button class="tab" role="tab" data-tab="aktivni" id="t-aktivni">Aktivni klijenti</button>
      <button class="tab" role="tab" data-tab="zadaci" id="t-zadaci">Zadaci</button>
      <button class="tab" role="tab" data-tab="inbox" id="t-inbox">Inbox <span class="badge" id="inboxBadge" hidden></span></button>
      <button class="tab" role="tab" data-tab="kampanje" id="t-kampanje">E-mail kampanje</button>
      <button class="tab" role="tab" data-tab="tim" id="t-tim">Tim</button>
      <button class="tab" role="tab" data-tab="postavke" id="t-postavke">Postavke</button>
    </nav>
    <div class="bar-r">
      <button class="btn primary" id="btnNew" data-act="new">Novi klijent</button>
      <div class="me"><span id="meName"></span><button class="btn sm" data-act="logout">Odjava</button></div>
    </div>
  </div>
</header>

<main class="in main">
  <div id="banner"></div>
  <section class="view" id="v-pregled" role="tabpanel" aria-labelledby="t-pregled"></section>

  <section class="view" id="v-klijenti" role="tabpanel" aria-labelledby="t-klijenti" hidden>
    <div class="toolbar">
      <label class="f">Pretraga<input id="fq" type="search" placeholder="Tvrtka, osoba, e-mail" autocomplete="off"></label>
      <label class="f">Status<select id="fStatus"></select></label>
      <label class="f">Prodavač<select id="fOwner"></select></label>
      <label class="f">Vrsta<select id="fKind"><option value="">Sve vrste</option><option value="tvrtka">Tvrtke</option><option value="osoba">Fizičke osobe</option></select></label>
      <label class="f">Djelatnost<select id="fIndustry"></select></label>
      <datalist id="industryList"></datalist>
      <label class="f">Poredak<select id="fSort">
        <option value="activity">Zadnja aktivnost</option>
        <option value="follow">Sljedeći kontakt</option>
        <option value="name">Naziv</option>
        <option value="value">Vrijednost</option>
      </select></label>
      <span class="count nums" id="fCount"></span>
      <span class="acts" id="clTools"></span>
    </div>
    <div class="clist" id="clist"></div>
  </section>

  <section class="view" id="v-inbox" role="tabpanel" aria-labelledby="t-inbox" hidden>
    <div class="toolbar toolbar-inbox">
      <label class="f">Pretraga<input id="iq" type="search" placeholder="Pošiljatelj, predmet, tekst" autocomplete="off"></label>
      <label class="f">Prikaz<select id="iFilter">
        <option value="all">Sve poruke (Inbox 1 i Inbox 2)</option>
        <option value="unread">Nepročitano</option>
        <option value="in">Primljeno</option>
        <option value="out">Poslano</option>
        <option value="box1" id="optBox1" hidden>Samo Inbox 1</option>
        <option value="box2" id="optBox2" hidden>Samo Inbox 2</option>
        <option value="nolink">Bez klijenta</option>
        <option value="sched">Zakazano slanje</option>
      </select></label>
      <div class="sync"><button class="btn" data-act="sync" id="btnSync">Osvježi poštu</button><span class="hint" id="syncInfo"></span></div>
    </div>
    <div class="clist" id="ilist"></div>
  </section>

  <section class="view" id="v-aktivni" role="tabpanel" aria-labelledby="t-aktivni" hidden></section>
  <section class="view" id="v-zadaci" role="tabpanel" aria-labelledby="t-zadaci" hidden></section>
  <section class="view" id="v-kampanje" role="tabpanel" aria-labelledby="t-kampanje" hidden></section>
  <section class="view" id="v-tim" role="tabpanel" aria-labelledby="t-tim" hidden></section>
  <section class="view" id="v-postavke" role="tabpanel" aria-labelledby="t-postavke" hidden></section>
</main>

<!-- client drawer -->
<div class="overlay right" id="drawer" hidden>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="dTitle" id="dSheet"></div>
</div>

<!-- mail reader -->
<div class="overlay right" id="mdrawer" hidden>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="rSubject" id="rSheet"></div>
</div>

<!-- new client -->
<div class="overlay center" id="mNew" hidden>
  <form class="sheet" id="fNew" role="dialog" aria-modal="true" aria-labelledby="nTitle" novalidate>
    <div class="sh-h"><h2 id="nTitle">Novi klijent</h2><button type="button" class="x" data-act="close" aria-label="Zatvori">×</button></div>
    <div class="sh-b">
      <p class="mailnote" id="nHint" hidden>Provjerite podatke iz poruke, odaberite vrstu klijenta i upišite prvu bilješku. Klijent se sprema tek kad potvrdite.</p>
      <fieldset class="kind" id="nKind">
        <legend>Vrsta klijenta <span class="req">*</span></legend>
        <label><input type="radio" name="nKindR" value="tvrtka" checked> Tvrtka</label>
        <label><input type="radio" name="nKindR" value="osoba"> Fizička osoba</label>
      </fieldset>
      <div class="grid2">
        <label class="f"><span><span id="nNameL">Naziv tvrtke</span> <span class="req">*</span></span><input id="nName" autocomplete="off"></label>
        <label class="f" id="nContactW"><span>Kontakt osoba <span class="req">*</span></span><input id="nContact" autocomplete="off"></label>
        <label class="f">OIB<input id="nOib" inputmode="numeric" maxlength="11" autocomplete="off" placeholder="neobavezno"></label>
        <label class="f">E-mail<input id="nEmail" type="email" autocomplete="off"></label>
        <label class="f">Telefon<input id="nPhone" type="tel" autocomplete="off"></label>
        <label class="f">Djelatnost<input id="nIndustry" list="industryList" maxlength="120" autocomplete="off" placeholder="upišite ili odaberite postojeću"></label>
        <div class="f"><span>Usluga (možete odabrati više)</span><div class="svcbox" id="nService"></div></div>
        <label class="f">Vrijednost (€)<input id="nValue" type="number" min="0" step="50" inputmode="numeric"></label>
        <label class="f">Vrsta vrijednosti<select id="nVKind"><option value="ponudeno">Ponuđeno</option><option value="ugovoreno">Ugovoreno</option></select></label>
        <label class="f">Status<select id="nStatus"></select></label>
        <label class="f">Prodavač<select id="nOwner"></select></label>
        <label class="f">Sljedeći kontakt<input id="nFollow" type="date"></label>
        <label class="f">Sat sljedećeg kontakta<input id="nFollowT" type="time"></label>
        <div class="f wide campbox"><label class="chk"><input type="checkbox" id="nCamp"> Aktivni: klijent ima aktivnu kampanju</label>
          <div class="grid2" id="nCampDates" hidden><label class="f">Kampanja od<input id="nCampStart" type="date"></label><label class="f">Aktivna do <span class="req">*</span><input id="nCampEnd" type="date"></label><label class="f">Vrijednost kampanje (€) <span class="req">*</span><input id="nCampValue" type="number" min="0" step="10" inputmode="decimal"></label></div></div>
        <label class="f wide"><span>Prva bilješka <span class="req">* obavezno</span></span>
          <textarea id="nNote" placeholder="Kako je kontakt nastao, što klijent traži, što je dogovoreno."></textarea></label>
      </div>
      <div class="msg" id="nMsg" role="alert"></div>
      <div class="row-btns end">
        <button type="button" class="btn" data-act="close">Odustani</button>
        <button type="submit" class="btn primary" id="nSave">Spremi klijenta</button>
      </div>
    </div>
  </form>
</div>

<!-- alati: duplikati i uvoz -->
<div class="overlay center" id="toolModal" hidden>
  <div class="sheet wide" role="dialog" aria-modal="true" aria-labelledby="toolModalT">
    <div class="sh-h"><div><h2 id="toolModalT"></h2></div><button type="button" class="x" data-tool="close" aria-label="Zatvori">×</button></div>
    <div class="sh-b"></div>
  </div>
</div>

<!-- e-mail kampanje: pregled poruke -->
<div class="overlay center" id="mcModal" hidden>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="mcModalT">
    <div class="sh-h"><div><h2 id="mcModalT">Pregled poruke</h2></div><button type="button" class="x" data-mc="pvclose" aria-label="Zatvori">×</button></div>
    <div class="sh-b"></div>
  </div>
</div>

<!-- new e-mail to client -->
<div class="overlay center" id="mMail" hidden>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="mTitle">
    <div class="sh-h"><div><h2 id="mTitle">E-mail klijentu</h2><div class="sub" id="mSub"></div></div><button type="button" class="x" data-act="close" aria-label="Zatvori">×</button></div>
    <div class="sh-b">
      <div class="grid2">
        <label class="f">Primatelj<input id="mTo" type="email" autocomplete="off"></label>
        <label class="f">Predložak<select id="mTpl"></select></label>
        <label class="f wide">Predmet<input id="mSubj" autocomplete="off"></label>
        <label class="f wide">Poruka<textarea id="mBody" class="tall"></textarea></label>
      </div>
      <div class="sigprev"><b>Potpis (dodaje se automatski)</b><pre id="mSig"></pre></div>
      <div class="attach" id="mDocs"></div>
      <div class="grid2">
        <label class="f">Slanje<select id="mWhen"><option value="now">Pošalji odmah</option><option value="later">Zakaži slanje</option></select></label>
        <label class="f" id="mAtW" hidden>Datum i vrijeme slanja<input id="mAt" type="datetime-local"></label>
        <label class="f">Podsjeti me ako klijent ne odgovori<select id="mRemind"><option value="">Ne podsjećaj</option><option value="2">nakon 2 dana</option><option value="3" selected>nakon 3 dana</option><option value="5">nakon 5 dana</option><option value="7">nakon 7 dana</option><option value="14">nakon 14 dana</option></select></label>
      </div>
      <p class="mailnote" id="mFrom"></p>
      <div class="msg" id="mMsg" role="alert"></div>
      <div class="row-btns end">
        <button type="button" class="btn" data-act="close">Odustani</button>
        <button type="button" class="btn primary" data-act="msend" id="mSend">Pošalji e-mail</button>
      </div>
    </div>
  </div>
</div>

<div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
<script src="<?= $v('app.js') ?>"></script>
</body>
</html>
