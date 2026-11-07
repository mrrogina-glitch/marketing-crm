<?php
declare(strict_types=1);

/* ---------- sigurnost prijave: dva koraka (kod e-mailom) i blokada IP adresa ---------- */

const LOGIN_FAILS_BLOCK = 5;               // uzastopnih neuspjelih prijava do blokade
const IP_BLOCK_MS = 86400000;              // 24 h
const TWOFA_CODE_TTL_MS = 600000;          // kod vrijedi 10 min
const TWOFA_TRUST_DAYS = 30;

function twofa_required(): bool
{
    $c = cfg('security', []);
    if (is_array($c) && array_key_exists('twofa', $c) && !$c['twofa']) {
        return false; // nužna isključenost u config.php ako e-mail zakaže
    }
    return setting_get('twofa_enabled', '1') === '1' && Mailer::configured();
}

function ip_block_get(string $ip): ?array
{
    $r = row('SELECT * FROM ip_blocks WHERE ip = ?', [$ip]);
    if (!$r) {
        return null;
    }
    if ((int) $r['until_at'] <= ms()) {
        run('DELETE FROM ip_blocks WHERE ip = ?', [$ip]);
        return null;
    }
    return $r;
}

function ip_block_message(array $b): string
{
    return 'Vaša IP adresa je blokirana do ' . date('d.m.Y. H:i', (int) ($b['until_at'] / 1000)) . ' zbog sumnjivih pokušaja prijave. Obratite se administratoru.';
}

function ip_block_add(string $ip, string $reason, ?string $email = null): void
{
    $until = ms() + IP_BLOCK_MS;
    run('DELETE FROM ip_blocks WHERE ip = ?', [$ip]);
    run('INSERT INTO ip_blocks (ip, until_at, reason, created_at) VALUES (?, ?, ?, ?)', [$ip, $until, mb_substr($reason, 0, 190), ms()]);
    $txt = 'Blokirana IP adresa ' . $ip . ' do ' . date('d.m.Y. H:i', (int) ($until / 1000)) . '. Razlog: ' . $reason . ($email ? ' (račun: ' . mb_substr($email, 0, 80) . ')' : '');
    try {
        audit(null, null, 'security', $txt);
        foreach (rows("SELECT id, email, name FROM users WHERE role = 'admin' AND active = 1") as $a) {
            alert_create((int) $a['id'], null, 'security', 'Blokirana IP adresa ' . $ip, $txt . "\nOdblokirati je možete u Postavke > Sigurnost.", null, 'sec:' . $ip . ':' . $until);
            if (Mailer::configured()) {
                try {
                    Mailer::send((string) $a['email'], 'Sigurnosno upozorenje: blokirana IP adresa', $txt . "\n\nOdblokirati je možete u aplikaciji (Postavke > Sigurnost).", null, ['Auto-Submitted' => 'auto-generated']);
                } catch (Throwable $e) {
                    error_log('CRM security mail: ' . $e->getMessage());
                }
            }
        }
    } catch (Throwable $e) {
        error_log('CRM security: ' . $e->getMessage());
    }
}

/** Zapis neuspjele prijave; vraća true ako je IP upravo blokirana. */
function login_fail(string $ip, string $email): bool
{
    run('INSERT INTO login_attempts (ip, email, created_at) VALUES (?, ?, ?)', [$ip, mb_substr($email, 0, 190), ms()]);
    run('DELETE FROM login_attempts WHERE created_at < ?', [ms() - IP_BLOCK_MS]);
    $n = (int) row('SELECT COUNT(*) AS c FROM login_attempts WHERE ip = ?', [$ip])['c'];
    if ($n >= LOGIN_FAILS_BLOCK) {
        ip_block_add($ip, $n . ' uzastopnih neuspjelih prijava', $email);
        run('DELETE FROM login_attempts WHERE ip = ?', [$ip]);
        return true;
    }
    return false;
}

function login_success_clear(string $ip): void
{
    run('DELETE FROM login_attempts WHERE ip = ?', [$ip]);
}

/** Pokušaj probijanja: injekcije, nevaljani tipovi, predugi unosi. */
function login_suspicious(array $in): ?string
{
    $email = $in['email'] ?? '';
    $pass = $in['password'] ?? '';
    if (!is_string($email) || !is_string($pass)) {
        return 'neispravan tip podataka u prijavi';
    }
    if (strlen($email) > 190 || strlen($pass) > 1024) {
        return 'prekomjerno dugi podaci u prijavi';
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) && $email !== ''
        && preg_match('/(\'|"|--|;|\/\*|<\s*script|\bunion\b|\bselect\b|\bsleep\s*\(|\bor\b\s+\d+\s*=\s*\d+|\.\.\/|%00|\$\{|\bdrop\b)/i', $email)) {
        return 'obrazac napada (SQL/XSS) u polju e-mail';
    }
    return null;
}

function mask_email(string $e): string
{
    [$l, $d] = array_pad(explode('@', $e, 2), 2, '');
    return mb_substr($l, 0, 2) . str_repeat('*', max(1, mb_strlen($l) - 2)) . '@' . $d;
}

/* ---------- pouzdani uređaji ---------- */

function trusted_cookie_set(int $userId): void
{
    $tok = bin2hex(random_bytes(32));
    $exp = ms() + TWOFA_TRUST_DAYS * 86400000;
    run('INSERT INTO trusted_devices (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)', [$userId, hash('sha256', $tok), ms(), $exp]);
    run('DELETE FROM trusted_devices WHERE expires_at < ?', [ms()]);
    setcookie('crmtd', $tok, ['expires' => (int) ($exp / 1000), 'path' => '/', 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Lax']);
}

function trusted_device_ok(int $userId): bool
{
    $tok = (string) ($_COOKIE['crmtd'] ?? '');
    if (!preg_match('/^[0-9a-f]{64}$/', $tok)) {
        return false;
    }
    return (bool) row('SELECT id FROM trusted_devices WHERE user_id = ? AND token_hash = ? AND expires_at > ?', [$userId, hash('sha256', $tok), ms()]);
}

function trusted_revoke(int $userId): void
{
    run('DELETE FROM trusted_devices WHERE user_id = ?', [$userId]);
}

/* ---------- kod za potvrdu ---------- */

function twofa_send_code(array $u): void
{
    $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    $salt = bin2hex(random_bytes(8));
    run('UPDATE login_codes SET used = 1 WHERE user_id = ? AND used = 0', [$u['id']]);
    run('INSERT INTO login_codes (user_id, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?)',
        [$u['id'], $salt . ':' . hash('sha256', $salt . $code . $u['id']), ms() + TWOFA_CODE_TTL_MS, ms()]);
    $text = "Vaš kod za prijavu u VIP MARKET: " . $code . "\n\nKod vrijedi 10 minuta. Ako se niste pokušali prijaviti, zanemarite ovu poruku i promijenite lozinku.\n\nIP adresa prijave: " . client_ip() . "\nVrijeme: " . date('d.m.Y. H:i');
    try {
        Mailer::send((string) $u['email'], 'VIP MARKET: kod za prijavu ' . $code, $text, null, ['Auto-Submitted' => 'auto-generated', 'X-Auto-Response-Suppress' => 'All']);
    } catch (MailException $e) {
        error_log('CRM 2FA mail: ' . $e->getMessage());
        throw new ApiError('Kod za potvrdu nije moguće poslati. Obratite se administratoru.', 502);
    }
}

/** @return bool kod ispravan */
function twofa_check_code(int $userId, string $code): bool
{
    $r = row('SELECT * FROM login_codes WHERE user_id = ? AND used = 0 ORDER BY id DESC LIMIT 1', [$userId]);
    if (!$r || (int) $r['expires_at'] < ms()) {
        throw new ApiError('Kod je istekao. Zatražite novi kod.', 410);
    }
    if ((int) $r['tries'] >= 5) {
        run('UPDATE login_codes SET used = 1 WHERE id = ?', [$r['id']]);
        throw new ApiError('Previše pogrešnih unosa koda. Prijavite se ponovno.', 429);
    }
    [$salt, $h] = array_pad(explode(':', (string) $r['code_hash'], 2), 2, '');
    if (preg_match('/^\d{6}$/', $code) && hash_equals($h, hash('sha256', $salt . $code . $userId))) {
        run('UPDATE login_codes SET used = 1 WHERE id = ?', [$r['id']]);
        return true;
    }
    run('UPDATE login_codes SET tries = tries + 1 WHERE id = ?', [$r['id']]);
    return false;
}

function finish_login(array $u): void
{
    start_session();
    session_regenerate_id(true);
    unset($_SESSION['pend_uid'], $_SESSION['pend_at']);
    $_SESSION['uid'] = (int) $u['id'];
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
    run('UPDATE users SET last_login = ? WHERE id = ?', [ms(), $u['id']]);
    open_user_session($u);
}
