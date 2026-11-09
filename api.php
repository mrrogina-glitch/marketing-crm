<?php
declare(strict_types=1);

require __DIR__ . '/lib/core.php';
require __DIR__ . '/lib/mail.php';
require __DIR__ . '/lib/imap.php';
require __DIR__ . '/lib/features.php';
require __DIR__ . '/lib/backup.php';
require __DIR__ . '/lib/security.php';
require __DIR__ . '/lib/growth.php';
require __DIR__ . '/lib/pipeline.php';
require __DIR__ . '/lib/dup.php';
require __DIR__ . '/lib/mailcamp.php';

app_boot();
send_security_headers(false);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function out($data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function body(): array
{
    static $b = null;
    if ($b !== null) {
        return $b;
    }
    $raw = file_get_contents('php://input');
    $d = ($raw === '' || $raw === false) ? [] : json_decode($raw, true);
    if (!is_array($d)) {
        throw new ApiError('Neispravan zahtjev.');
    }
    return $b = $d;
}

function need_post(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        throw new ApiError('Metoda nije dopuštena.', 405);
    }
    if (stripos((string) ($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json') !== 0) {
        throw new ApiError('Neispravan zahtjev.', 415);
    }
}

function need_user(): array
{
    $u = current_user();
    if (!$u) {
        throw new ApiError('Sesija je istekla. Prijavite se ponovno.', 401);
    }
    return $u;
}

function need_write(): array
{
    need_post();
    $u = need_user();
    if (!csrf_ok()) {
        throw new ApiError('Sigurnosna provjera nije uspjela. Osvježite stranicu.', 403);
    }
    return $u;
}

function need_admin(array $u): void
{
    if ($u['role'] !== 'admin') {
        throw new ApiError('Ovo može samo administrator.', 403);
    }
}

/* ---------- output shapes ---------- */

/** @return array{0:int,1:?string,2:?string,3:string} camp_active, camp_start, camp_end, camp_value from the request */
function f_campaign(array $in): array
{
    if (empty($in['camp_active'])) {
        return [0, null, null, '0.00', 'jednokratno'];
    }
    $end = f_date($in['camp_end'] ?? '');
    if ($end === null) {
        throw new ApiError('Za aktivnog klijenta odaberite točan datum do kada je kampanja aktivna.');
    }
    $start = f_date($in['camp_start'] ?? '') ?? date('Y-m-d');
    if ($start > $end) {
        throw new ApiError('Početak kampanje ne može biti nakon datuma završetka.');
    }
    if (!isset($in['camp_value']) || trim((string) $in['camp_value']) === '') {
        throw new ApiError('Upišite novčanu vrijednost kampanje.');
    }
    return [1, $start, $end, f_value($in['camp_value']), (($in['camp_type'] ?? '') === 'godisnji') ? 'godisnji' : 'jednokratno'];
}

/** Sat sljedećeg kontakta (HH:MM) ili null. */
function f_time($v): ?string
{
    $v = trim((string) $v);
    if ($v === '') {
        return null;
    }
    if (!preg_match('/^([01]\d|2[0-3]):([0-5]\d)$/', $v)) {
        throw new ApiError('Sat sljedećeg kontakta nije ispravan.');
    }
    return $v;
}

const SERVICE_OPTIONS = ['Radio SPOT', 'Radio Emisija', 'PR Portali', 'Baner'];

/** Usluga: jedna ili više opcija, spremljeno kao "Radio SPOT, Baner". */
function f_services($v): string
{
    $items = is_array($v) ? $v : explode(',', (string) $v);
    $out = [];
    foreach ($items as $i) {
        $i = trim((string) $i);
        if ($i === '') {
            continue;
        }
        if (!in_array($i, SERVICE_OPTIONS, true)) {
            throw new ApiError('Usluga nije ispravna.');
        }
        $out[$i] = true;
    }
    return implode(', ', array_filter(SERVICE_OPTIONS, static fn ($o) => isset($out[$o])));
}

function client_out(array $r): array
{
    return [
        'id' => (string) $r['id'],
        'kind' => (string) ($r['kind'] ?? 'tvrtka'),
        'oib' => (string) ($r['oib'] ?? ''),
        'name' => (string) $r['name'],
        'contact' => (string) $r['contact'],
        'email' => (string) $r['email'],
        'phone' => (string) $r['phone'],
        'email2' => (string) ($r['email2'] ?? ''),
        'address' => (string) ($r['address'] ?? ''),
        'service' => (string) $r['service'],
        'industry' => (string) ($r['industry'] ?? ''),
        'value' => (float) $r['value'],
        'valueKind' => (string) (($r['value_kind'] ?? '') === 'ugovoreno' ? 'ugovoreno' : 'ponudeno'),
        'status' => (string) $r['status'],
        'ownerId' => $r['owner_id'] !== null ? (string) $r['owner_id'] : null,
        'hasContract' => (int) ($r['has_contract'] ?? 0) === 1,
        'contractEnd' => ((int) ($r['has_contract'] ?? 0) === 1 && !empty($r['contract_end'])) ? (string) $r['contract_end'] : '',
        'nextFollowUp' => $r['next_follow_up'] ? (string) $r['next_follow_up'] : '',
        'nextFollowTime' => ($r['next_follow_up'] && !empty($r['next_follow_time'])) ? (string) $r['next_follow_time'] : '',
        'campActive' => (int) ($r['camp_active'] ?? 0) === 1,
        'campStart' => !empty($r['camp_start']) ? (string) $r['camp_start'] : '',
        'campEnd' => !empty($r['camp_end']) ? (string) $r['camp_end'] : '',
        'campValue' => (float) ($r['camp_value'] ?? 0),
        'campType' => (string) (($r['camp_type'] ?? '') === 'godisnji' ? 'godisnji' : 'jednokratno'),
        'campMonths' => camp_months_val($r['camp_months'] ?? 12),
        'multiCamp' => (int) ($r['multi_camp'] ?? 0) === 1,
        'createdAt' => (int) $r['created_at'],
        'updatedAt' => (int) $r['updated_at'],
        'wonAt' => $r['won_at'] !== null ? (int) $r['won_at'] : null,
    ];
}

function note_out(array $r): array
{
    return [
        'id' => (string) $r['id'],
        'clientId' => (string) $r['client_id'],
        'authorId' => (string) $r['author_id'],
        'type' => (string) $r['type'],
        'subject' => $r['subject'] !== null ? (string) $r['subject'] : '',
        'to' => $r['to_email'] !== null ? (string) $r['to_email'] : '',
        'bulk' => (int) ($r['bulk'] ?? 0) === 1,
        'text' => (string) $r['body'],
        'createdAt' => (int) $r['created_at'],
    ];
}

function users_out(array $viewer): array
{
    $admin = $viewer['role'] === 'admin';
    return array_map(static function (array $u) use ($admin): array {
        $o = ['id' => (string) $u['id'], 'name' => (string) $u['name'], 'role' => (string) $u['role'], 'active' => (int) $u['active'] === 1];
        if ($admin) {
            $o['email'] = (string) $u['email'];
        }
        return $o;
    }, rows('SELECT id, name, email, role, active FROM users ORDER BY name'));
}

/** Arhiva: izgubljeni klijenti bez prodavača i bez ikakvih povezanih podataka. Ne šalju se u bootstrap (previše ih je). */
function pool_sql(string $a = 'clients'): string
{
    return $a . ".owner_id IS NULL AND " . $a . ".status = 'izgubljen' AND NOT EXISTS (SELECT 1 FROM emails pe WHERE pe.client_id = " . $a . ".id) AND NOT EXISTS (SELECT 1 FROM tasks pt WHERE pt.client_id = " . $a . ".id) AND NOT EXISTS (SELECT 1 FROM documents pd WHERE pd.client_id = " . $a . ".id) AND NOT EXISTS (SELECT 1 FROM campaigns pc WHERE pc.client_id = " . $a . ".id)";
}

function load_client(string $id): array
{
    $c = row('SELECT * FROM clients WHERE id = ?', [(int) $id]);
    if (!$c) {
        throw new ApiError('Klijent ne postoji.', 404);
    }
    return $c;
}

/** Inbox 2 settings for the Postavke form (never includes the password). */
function imap2_public(): array
{
    $c = imap_cfg(2);
    $stored = imap2_stored() !== null;
    return [
        'host' => (string) ($c['host'] ?? ''),
        'port' => (int) ($c['port'] ?? 993),
        'secure' => (string) ($c['secure'] ?? 'ssl'),
        'user' => (string) ($c['user'] ?? ''),
        'folder' => (string) ($c['folder'] ?? 'INBOX'),
        'smtpHost' => (string) ((imap2_stored()['smtp_host'] ?? '') ?: ($c['host'] ?? '')),
        'smtpPort' => (int) ((imap2_stored()['smtp_port'] ?? 0) ?: 465),
        'smtpSecure' => (string) ((imap2_stored()['smtp_secure'] ?? '') ?: 'ssl'),
        'fromName' => (string) (imap2_stored()['from_name'] ?? ''),
        'hasPass' => $c !== null && (string) ($c['pass'] ?? '') !== '',
        'source' => $c === null ? '' : ($stored ? 'settings' : 'config'),
    ];
}

/** Validates the Inbox 2 form; an empty password keeps the saved one. */
function imap2_from_input(array $in): array
{
    $host = strtolower(trim((string) ($in['host'] ?? '')));
    if (!preg_match('/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/', $host)) {
        throw new ApiError('Upišite ispravan naziv IMAP poslužitelja (npr. mail.vip-grupa.eu).');
    }
    $port = (int) ($in['port'] ?? 993);
    if ($port < 1 || $port > 65535) {
        throw new ApiError('Port mora biti između 1 i 65535.');
    }
    $secure = in_array($in['secure'] ?? '', ['ssl', 'tls', 'none'], true) ? $in['secure'] : 'ssl';
    $user = trim((string) ($in['user'] ?? ''));
    if ($user === '' || mb_strlen($user) > 190 || preg_match('/[\r\n]/', $user)) {
        throw new ApiError('Upišite korisničko ime (e-mail adresu sandučića).');
    }
    $folder = trim((string) ($in['folder'] ?? '')) ?: 'INBOX';
    if (mb_strlen($folder) > 120 || preg_match('/[\r\n"\\\\]/', $folder)) {
        throw new ApiError('Naziv mape nije ispravan.');
    }
    $pass = (string) ($in['pass'] ?? '');
    $old = imap_cfg(2);
    if ($pass === '' && $old !== null && strtolower((string) $old['user']) === strtolower($user)) {
        $pass = (string) ($old['pass'] ?? '');
    }
    if ($pass === '') {
        throw new ApiError('Upišite lozinku sandučića.');
    }
    $smtpHost = strtolower(trim((string) ($in['smtp_host'] ?? ''))) ?: $host;
    if (!preg_match('/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/', $smtpHost)) {
        throw new ApiError('Upišite ispravan naziv SMTP poslužitelja.');
    }
    $smtpPort = (int) ($in['smtp_port'] ?? 465) ?: 465;
    if ($smtpPort < 1 || $smtpPort > 65535) {
        throw new ApiError('SMTP port mora biti između 1 i 65535.');
    }
    $smtpSecure = in_array($in['smtp_secure'] ?? '', ['ssl', 'tls', 'none'], true) ? $in['smtp_secure'] : 'ssl';
    $fromName = trim(str_replace(["\r", "\n"], ' ', (string) ($in['from_name'] ?? '')));
    if (mb_strlen($fromName) > 80) {
        throw new ApiError('Naziv pošiljatelja je predug.');
    }
    return ['host' => $host, 'port' => $port, 'secure' => $secure, 'user' => $user, 'folder' => $folder, 'pass' => $pass,
        'smtp_host' => $smtpHost, 'smtp_port' => $smtpPort, 'smtp_secure' => $smtpSecure, 'from_name' => $fromName];
}

function email_out(array $r): array
{
    return [
        'id' => (string) $r['id'],
        'dir' => (string) $r['direction'],
        'fromEmail' => (string) $r['from_email'],
        'fromName' => (string) $r['from_name'],
        'to' => (string) $r['to_email'],
        'subject' => (string) $r['subject'],
        'preview' => (string) $r['preview'],
        'att' => (string) ($r['attachments'] ?? ''),
        'auto' => (int) ($r['auto'] ?? 0) === 1,
        'date' => (int) $r['msg_date'],
        'clientId' => $r['client_id'] !== null ? (string) $r['client_id'] : null,
        'read' => $r['read_at'] !== null,
        'box' => (int) ($r['mailbox'] ?? 1),
    ];
}

function load_email(string $id): array
{
    $e = row('SELECT * FROM emails WHERE id = ? AND deleted_at IS NULL', [(int) $id]);
    if (!$e) {
        throw new ApiError('Poruka ne postoji.', 404);
    }
    return $e;
}

function active_user_id($v, int $default): int
{
    if ($v === null || $v === '') {
        return $default;
    }
    $u = row('SELECT id FROM users WHERE id = ? AND active = 1', [(int) $v]);
    if (!$u) {
        throw new ApiError('Odabrani prodavač ne postoji ili nije aktivan.');
    }
    return (int) $u['id'];
}

function check_password_strength(string $p): void
{
    if (mb_strlen($p) < 10) {
        throw new ApiError('Lozinka mora imati najmanje 10 znakova.');
    }
    if (mb_strlen($p) > 200) {
        throw new ApiError('Lozinka je preduga.');
    }
}

/* ---------- routing ---------- */

try {
    $action = (string) ($_GET['a'] ?? '');

    switch ($action) {
        case 'login': {
            need_post();
            $in = body();
            $ip = client_ip();
            if ($blk = ip_block_get($ip)) {
                throw new ApiError(ip_block_message($blk), 403);
            }
            if ($why = login_suspicious($in)) {
                ip_block_add($ip, 'Pokušaj probijanja prijave: ' . $why, is_string($in['email'] ?? null) ? (string) $in['email'] : '');
                throw new ApiError('Prijava je odbijena. Vaša IP adresa je blokirana na 24 sata.', 403);
            }
            $email = strtolower(trim((string) ($in['email'] ?? '')));
            $pass = (string) ($in['password'] ?? '');
            $u = $email !== '' ? row('SELECT * FROM users WHERE email = ?', [$email]) : null;
            $hash = $u ? (string) $u['pass_hash'] : password_hash('x', PASSWORD_DEFAULT);
            $ok = password_verify($pass, $hash) && $u && (int) $u['active'] === 1;
            if (!$ok) {
                if (login_fail($ip, $email)) {
                    throw new ApiError('Previše neuspjelih pokušaja. Vaša IP adresa je blokirana na 24 sata.', 403);
                }
                throw new ApiError('E-mail ili lozinka nisu točni.', 401);
            }
            if (password_needs_rehash((string) $u['pass_hash'], PASSWORD_DEFAULT)) {
                run('UPDATE users SET pass_hash = ? WHERE id = ?', [password_hash($pass, PASSWORD_DEFAULT), $u['id']]);
            }
            if (twofa_required() && !trusted_device_ok((int) $u['id'])) {
                start_session();
                session_regenerate_id(true);
                $_SESSION['pend_uid'] = (int) $u['id'];
                $_SESSION['pend_at'] = ms();
                twofa_send_code($u);
                out(['ok' => true, 'twofa' => true, 'email' => mask_email((string) $u['email'])]);
            }
            login_success_clear($ip);
            finish_login($u);
            out(['ok' => true]);
        }

        case 'login_verify': {
            need_post();
            $in = body();
            $ip = client_ip();
            if ($blk = ip_block_get($ip)) {
                throw new ApiError(ip_block_message($blk), 403);
            }
            start_session();
            $uid = (int) ($_SESSION['pend_uid'] ?? 0);
            if ($uid <= 0 || (int) ($_SESSION['pend_at'] ?? 0) < ms() - 15 * 60000) {
                throw new ApiError('Prijava je istekla. Prijavite se ponovno.', 401);
            }
            $u = row('SELECT * FROM users WHERE id = ? AND active = 1', [$uid]);
            if (!$u) {
                throw new ApiError('Prijava nije moguća.', 401);
            }
            $code = preg_replace('/\D/', '', (string) ($in['code'] ?? ''));
            if (!twofa_check_code($uid, (string) $code)) {
                if (login_fail($ip, (string) $u['email'])) {
                    unset($_SESSION['pend_uid']);
                    throw new ApiError('Previše neuspjelih pokušaja. Vaša IP adresa je blokirana na 24 sata.', 403);
                }
                throw new ApiError('Kod nije ispravan.', 401);
            }
            login_success_clear($ip);
            finish_login($u);
            if (!empty($in['remember'])) {
                trusted_cookie_set((int) $u['id']);
            }
            out(['ok' => true]);
        }

        case 'login_resend': {
            need_post();
            start_session();
            $uid = (int) ($_SESSION['pend_uid'] ?? 0);
            $u = $uid > 0 ? row('SELECT * FROM users WHERE id = ? AND active = 1', [$uid]) : null;
            if (!$u || (int) ($_SESSION['pend_at'] ?? 0) < ms() - 15 * 60000) {
                throw new ApiError('Prijava je istekla. Prijavite se ponovno.', 401);
            }
            $last = row('SELECT created_at FROM login_codes WHERE user_id = ? ORDER BY id DESC LIMIT 1', [$uid]);
            if ($last && (int) $last['created_at'] > ms() - 45000) {
                throw new ApiError('Novi kod možete zatražiti nakon 45 sekundi.', 429);
            }
            if ((int) row('SELECT COUNT(*) AS c FROM login_codes WHERE user_id = ? AND created_at > ?', [$uid, ms() - 3600000])['c'] >= 5) {
                throw new ApiError('Previše zahtjeva za kod. Pokušajte kasnije.', 429);
            }
            twofa_send_code($u);
            out(['ok' => true]);
        }

        case 'logout': {
            need_post();
            start_session();
            if (csrf_ok()) {
                close_user_session('logout');
                $_SESSION = [];
                session_destroy();
            }
            out(['ok' => true]);
        }

        case 'bootstrap': {
            $u = need_user();
            expire_campaigns();
            $a = row('SELECT COUNT(*) AS c, COALESCE(MAX(updated_at), 0) AS m, COALESCE(SUM(value), 0) AS s FROM clients');
            $cg = row('SELECT COUNT(*) AS c, COALESCE(MAX(id), 0) AS m FROM campaigns');
            $b = row('SELECT COUNT(*) AS c, COALESCE(MAX(id), 0) AS m FROM notes');
            $em = row('SELECT COUNT(*) AS c, COALESCE(MAX(id), 0) AS m, COALESCE(SUM(CASE WHEN read_at IS NULL THEN 0 ELSE 1 END), 0) AS r, COALESCE(SUM(COALESCE(client_id, 0)), 0) AS k FROM emails WHERE deleted_at IS NULL');
            $usersOut = users_out($u);
            $imapOn = imap_cfg() !== null;
            $lastSync = (int) (meta_get('imap_last_sync') ?? 0);
            $lastErr = (string) (meta_get('imap_last_error') ?? '');
            $box2 = imap_cfg(2) !== null;
            $last2 = (int) (meta_get('imap_last_sync_2') ?? 0);
            $err2 = (string) (meta_get('imap_last_error_2') ?? '');
            $dc = row('SELECT COUNT(*) AS c, COALESCE(MAX(id), 0) AS m FROM documents');
            $tasks = tasks_for($u);
            $templates = array_map('template_out', rows('SELECT * FROM templates ORDER BY sort_order, id'));
            $scheduled = array_map('scheduled_out', rows("SELECT * FROM scheduled_emails WHERE bulk = 0 AND (status IN ('pending', 'sending') OR (status = 'failed' AND send_at > ?)) ORDER BY send_at LIMIT 300", [ms() - 7 * DAY_MS]));
            $reminders = array_map('reminder_out', reminders_due($u));
            $settings = null;
            if ($u['role'] === 'admin') {
                $ar = autoreply_settings();
                $settings = ['autoreply' => $ar, 'reportEnabled' => setting_get('report_enabled', '1') === '1', 'workHours' => work_cfg()['label']];
            }
            $sig = trim((string) ($u['signature'] ?? ''));
            $alertsOut = alerts_for($u);
            $dncN = row('SELECT COUNT(*) AS c, COALESCE(MAX(id), 0) AS m FROM do_not_contact');
            if ($u['role'] === 'admin' && !(string) cfg('app.url', '') && preg_match('/^[A-Za-z0-9.-]+(:\d+)?$/', (string) ($_SERVER['HTTP_HOST'] ?? '')) && meta_get('base_url') === null) {
                meta_set('base_url', (is_https() ? 'https://' : 'http://') . $_SERVER['HTTP_HOST']);
            }
            $rev = md5(json_encode([$alertsOut, $dncN, $u['role'] === 'admin' ? pending_approvals() : [], $tasks, count(rows('SELECT id FROM owner_history')), $a, $cg, $b, $em, $dc, $usersOut, $u['role'], $u['name'], $sig, $templates, $scheduled, $reminders, $settings, Mailer::configured(), $imapOn, $lastSync, $lastErr !== '', $box2, $last2, $err2 !== '', setting_get('imap2')]));
            $base = ['rev' => $rev, 'csrf' => csrf_token()];
            if (isset($_GET['rev']) && hash_equals($rev, (string) $_GET['rev'])) {
                out($base + ['unchanged' => true]);
            }
            $clients = array_map('client_out', rows('SELECT * FROM clients WHERE NOT (' . pool_sql() . ') ORDER BY id'));
            $poolN = (int) (row('SELECT COUNT(*) AS c FROM clients WHERE ' . pool_sql())['c'] ?? 0);
            $notes = array_map('note_out', rows('SELECT id, client_id, author_id, type, subject, body, to_email, created_at, bulk FROM notes n WHERE NOT EXISTS (SELECT 1 FROM clients pc2 WHERE pc2.id = n.client_id AND ' . pool_sql('pc2') . ') ORDER BY created_at DESC, id DESC LIMIT 20000'));
            out($base + [
                'me' => ['id' => (string) $u['id'], 'name' => (string) $u['name'], 'email' => (string) $u['email'], 'role' => (string) $u['role'],
                    'signature' => $sig, 'signatureEffective' => effective_signature($u)],
                'users' => $usersOut,
                'clients' => $clients,
                'pool' => $poolN,
                'notes' => $notes,
                'emails' => email_list_out(rows('SELECT id, message_id, direction, from_email, from_name, to_email, subject, preview, attachments, auto, msg_date, client_id, read_at, mailbox FROM emails WHERE deleted_at IS NULL ORDER BY msg_date DESC, id DESC LIMIT 600')),
                'tasks' => $tasks,
                'approvals' => $u['role'] === 'admin' ? pending_approvals() : [],
                'alerts' => $alertsOut,
                'dnc' => array_map(static fn ($r) => (string) $r['email'], rows('SELECT email FROM do_not_contact')),
                'ownerHist' => array_map(static fn ($r) => [(string) $r['client_id'], (int) $r['from_at'], (string) $r['owner_id']], rows('SELECT client_id, owner_id, from_at FROM owner_history ORDER BY from_at, id')),
                'campaigns' => array_map(static fn ($r) => ['id' => (string) $r['id'], 'clientId' => (string) $r['client_id'], 'start' => (string) ($r['start_date'] ?? ''), 'end' => (string) $r['end_date'], 'value' => (float) $r['value'], 'title' => (string) ($r['title'] ?? ''), 'type' => (string) (($r['camp_type'] ?? '') === 'godisnji' ? 'godisnji' : 'jednokratno'), 'months' => camp_months_val($r['camp_months'] ?? 12)], rows('SELECT * FROM campaigns ORDER BY end_date DESC, id DESC LIMIT 3000')),
                'docs' => array_map('doc_out', rows('SELECT * FROM documents ORDER BY id DESC LIMIT 3000')),
                'templates' => $templates,
                'scheduled' => $scheduled,
                'reminders' => $reminders,
                'settings' => $settings,
                'mail' => [
                    'enabled' => Mailer::configured(),
                    'from' => Mailer::fromEmail(),
                    'imap' => $imapOn,
                    'imap2' => $box2,
                    'from2' => $box2 ? (string) (imap_cfg(2)['user'] ?? '') : '',
                    'imap2Cfg' => $u['role'] === 'admin' ? imap2_public() : null,
                    'lastSync2' => $last2,
                    'error2' => $u['role'] === 'admin' ? $err2 : ($err2 !== '' ? 'error' : ''),
                    'lastSync' => $lastSync,
                    'error' => $u['role'] === 'admin' ? $lastErr : ($lastErr !== '' ? 'error' : ''),
                ],
            ]);
        }

        case 'task_create':
        case 'task_assign':
        case 'task_take':
        case 'task_note':
        case 'task_done':
        case 'task_delete':
            require __DIR__ . '/lib/api_tasks.php';
            break;

        case 'pool_list':
        case 'pool_segments':
        case 'pool_campaign':
        case 'client_get':
        case 'client_create':
        case 'client_multi':
        case 'campaign_add':
        case 'campaign_remove':
        case 'campaign_extend':
        case 'search':
        case 'campaign_renew':
        case 'client_update':
        case 'client_take':
        case 'client_delete':
        case 'note_add':
        case 'status_change':
        case 'dup_scan':
        case 'client_merge':
        case 'dup_ignore':
        case 'import_preview':
        case 'import_commit':
            require __DIR__ . '/lib/api_clients.php';
            break;

        case 'email_delete':
        case 'email_send':
        case 'sched_cancel':
        case 'reminder_done':
        case 'email_reply':
        case 'email_open':
        case 'email_link':
        case 'inbox_sync':
        case 'imap2_test':
        case 'imap2_diag':
        case 'imap2_save':
        case 'imap2_clear':
        case 'mail_test':
        case 'doc_upload':
        case 'doc_download':
        case 'doc_delete':
        case 'signature_save':
        case 'mail_overview':
        case 'spell_check':
        case 'ai_draft':
        case 'bulk_preview':
        case 'bulk_preview_msg':
        case 'bulk_send':
        case 'batch_detail':
        case 'batch_decide':
        case 'bulk_cancel':
        case 'template_save':
        case 'template_quick':
        case 'campaign_preview':
        case 'campaign_send':
        case 'template_delete':
        case 'dnc_list':
        case 'dnc_add':
        case 'dnc_remove':
            require __DIR__ . '/lib/api_mail.php';
            break;

        case 'security_overview':
        case 'security_save':
        case 'ip_unblock':
        case 'usage':
        case 'ping':
        case 'user_stats':
        case 'pipeline':
        case 'revenue':
        case 'audit_list':
        case 'goals':
        case 'goals_save':
        case 'backup_list':
        case 'backup_run':
        case 'backup_latest':
        case 'backup_download':
        case 'alert_done':
        case 'settings_save':
        case 'report_preview':
        case 'report_send':
        case 'user_create':
        case 'user_update':
        case 'password_change':
            require __DIR__ . '/lib/api_admin.php';
            break;

        default:
            throw new ApiError('Nepoznata radnja.', 404);
    }
} catch (ApiError $e) {
    out(['error' => $e->getMessage()], $e->status);
} catch (Throwable $e) {
    error_log('CRM error: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    out(['error' => 'Greška na poslužitelju. Pokušajte ponovno.'], 500);
}
