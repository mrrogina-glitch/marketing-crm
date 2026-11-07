<?php
declare(strict_types=1);

// Javna stranica za odjavu iz grupnih e-mailova (veza iz poruke, jedan klik).
require __DIR__ . '/lib/core.php';
require __DIR__ . '/lib/mail.php';
require __DIR__ . '/lib/features.php';
require __DIR__ . '/lib/backup.php';
require __DIR__ . '/lib/growth.php';

app_boot();
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');

$tok = (string) ($_GET['t'] ?? $_POST['t'] ?? '');
$email = null;
$state = 'bad';
try {
    $email = unsub_parse($tok);
    if ($email !== null) {
        $state = 'ask';
        if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
            dnc_add($email, 'Odjava putem poveznice u e-mailu', 'link');
            $state = 'done';
        } elseif (dnc_has($email)) {
            $state = 'done';
        }
    }
} catch (Throwable $e) {
    error_log('CRM unsubscribe: ' . $e->getMessage());
    $state = 'err';
}
$h = static fn (string $s): string => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
$mask = $email !== null ? (function (string $e): string {
    [$l, $d] = explode('@', $e, 2);
    return mb_substr($l, 0, 2) . str_repeat('*', max(1, mb_strlen($l) - 2)) . '@' . $d;
})($email) : '';
?><!doctype html>
<html lang="hr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>Odjava s popisa</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f3f5f8;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#14213d}
.c{background:#fff;max-width:440px;margin:16px;padding:32px;border-radius:16px;box-shadow:0 10px 30px rgba(20,33,61,.12)}
h1{margin:0 0 12px;font-size:22px}p{margin:8px 0;color:#445}
button{margin-top:18px;width:100%;padding:13px;border:0;border-radius:10px;background:#0f766e;color:#fff;font-size:16px;font-weight:600;cursor:pointer}
.ok{color:#0f766e;font-weight:600}
</style></head><body><div class="c">
<?php if ($state === 'ask'): ?>
<h1>Odjava s popisa</h1>
<p>Adresa: <b><?= $h($mask) ?></b></p>
<p>Potvrdite da više ne želite primati naše marketinške poruke.</p>
<form method="post" action="unsubscribe.php"><input type="hidden" name="t" value="<?= $h($tok) ?>"><button type="submit">Odjavi me</button></form>
<?php elseif ($state === 'done'): ?>
<h1>Odjavljeni ste</h1>
<p class="ok">Adresa <?= $h($mask) ?> uklonjena je s našeg popisa za slanje poruka.</p>
<p>Više Vam nećemo slati marketinške poruke. Hvala Vam.</p>
<?php elseif ($state === 'err'): ?>
<h1>Greška</h1><p>Odjavu trenutno nije moguće provesti. Pokušajte kasnije ili nam odgovorite na e-mail.</p>
<?php else: ?>
<h1>Veza nije valjana</h1><p>Poveznica za odjavu je neispravna ili je istekla. Odgovorite na naš e-mail i uklonit ćemo Vas s popisa.</p>
<?php endif; ?>
</div></body></html>
