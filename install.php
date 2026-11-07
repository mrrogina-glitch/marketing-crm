<?php
declare(strict_types=1);

require __DIR__ . '/lib/core.php';

app_boot();
send_security_headers(true);

function page(string $title, string $inner): void
{
    echo '<!doctype html><html lang="hr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<meta name="color-scheme" content="light dark"><title>' . htmlspecialchars($title) . '</title>'
        . '<link rel="stylesheet" href="assets/app.css"></head><body class="auth"><main class="auth-box">' . $inner . '</main></body></html>';
    exit;
}

$key = (string) cfg('install_key', '');
$given = (string) ($_POST['key'] ?? $_GET['key'] ?? '');
if ($key === '' || strpos($key, 'PROMIJENITE') === 0 || !hash_equals($key, $given)) {
    http_response_code(403);
    page('Instalacija', '<h1>Instalacija</h1><p>Upišite install_key iz config.php u adresu: <code>install.php?key=…</code></p>');
}

try {
    $count = (int) row('SELECT COUNT(*) AS c FROM users')['c'];
} catch (Throwable $e) {
    http_response_code(500);
    error_log('CRM install: ' . $e->getMessage());
    page('Instalacija', '<h1>Baza nije dostupna</h1><p>Provjerite podatke za bazu u config.php.</p>');
}
if ($count > 0) {
    http_response_code(404);
    page('Instalacija', '<h1>Već instalirano</h1><p>Aplikacija je postavljena. <a href="./">Prijava</a></p>');
}

$msg = '';
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $name = trim((string) ($_POST['name'] ?? ''));
    $email = strtolower(trim((string) ($_POST['email'] ?? '')));
    $pass = (string) ($_POST['password'] ?? '');
    if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $msg = 'Upišite ime i ispravnu e-mail adresu.';
    } elseif (mb_strlen($pass) < 10) {
        $msg = 'Lozinka mora imati najmanje 10 znakova.';
    } else {
        run('INSERT INTO users (name, email, pass_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
            [mb_substr($name, 0, 120), $email, password_hash($pass, PASSWORD_DEFAULT), 'admin', ms()]);
        page('Instalacija', '<h1>Gotovo</h1><p>Administratorski račun je napravljen.</p><p><a class="btn primary" href="./">Prijava</a></p>');
    }
}

$k = htmlspecialchars($given, ENT_QUOTES);
page('Instalacija', '<h1>Prvi administrator</h1><p>Baza je spremna. Napravite administratorski račun.</p>'
    . ($msg !== '' ? '<p class="msg">' . htmlspecialchars($msg) . '</p>' : '')
    . '<form method="post" class="stack"><input type="hidden" name="key" value="' . $k . '">'
    . '<label class="f">Ime i prezime<input name="name" required maxlength="120" autocomplete="name"></label>'
    . '<label class="f">E-mail<input name="email" type="email" required autocomplete="username"></label>'
    . '<label class="f">Lozinka (najmanje 10 znakova)<input name="password" type="password" required minlength="10" autocomplete="new-password"></label>'
    . '<button class="btn primary" type="submit">Napravi račun</button></form>');
