<?php
declare(strict_types=1);

require __DIR__ . '/lib/core.php';
require __DIR__ . '/lib/mail.php';
require __DIR__ . '/lib/imap.php';
require __DIR__ . '/lib/features.php';
require __DIR__ . '/lib/backup.php';
require __DIR__ . '/lib/security.php';
require __DIR__ . '/lib/growth.php';
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
        return [0, null, null, '0.00'];
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
    return [1, $start, $end, f_value($in['camp_value'])];
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
        'service' => (string) $r['service'],
        'industry' => (string) ($r['industry'] ?? ''),
        'value' => (float) $r['value'],
        'valueKind' => (string) (($r['value_kind'] ?? '') === 'ugovoreno' ? 'ugovoreno' : 'ponudeno'),
        'status' => (string) $r['status'],
        'ownerId' => $r['owner_id'] !== null ? (string) $r['owner_id'] : null,
        'nextFollowUp' => $r['next_follow_up'] ? (string) $r['next_follow_up'] : '',
        'campActive' => (int) ($r['camp_active'] ?? 0) === 1,
        'campStart' => !empty($r['camp_start']) ? (string) $r['camp_start'] : '',
        'campEnd' => !empty($r['camp_end']) ? (string) $r['camp_end'] : '',
        'campValue' => (float) ($r['camp_value'] ?? 0),
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
    return ['host' => $host, 'port' => $port, 'secure' => $secure, 'user' => $user, 'folder' => $folder, 'pass' => $pass];
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

        case 'security_overview': {
            $u = need_user();
            need_admin($u);
            run('DELETE FROM ip_blocks WHERE until_at <= ?', [ms()]);
            out(['twofa' => setting_get('twofa_enabled', '1') === '1', 'twofaActive' => twofa_required(), 'mailOk' => Mailer::configured(),
                'blocks' => array_map(static fn ($b) => ['ip' => (string) $b['ip'], 'until' => (int) $b['until_at'], 'reason' => (string) $b['reason'], 'at' => (int) $b['created_at']], rows('SELECT * FROM ip_blocks ORDER BY created_at DESC LIMIT 100')),
                'trusted' => (int) row('SELECT COUNT(*) AS c FROM trusted_devices WHERE expires_at > ?', [ms()])['c']]);
        }

        case 'security_save': {
            $u = need_write();
            need_admin($u);
            $in = body();
            setting_set('twofa_enabled', !empty($in['twofa']) ? '1' : '0');
            if (!empty($in['revoke_trusted'])) {
                run('DELETE FROM trusted_devices');
            }
            audit(null, (int) $u['id'], 'security', 'Prijava u dva koraka: ' . (!empty($in['twofa']) ? 'uključena' : 'isključena') . (!empty($in['revoke_trusted']) ? ', pouzdani uređaji poništeni' : ''));
            out(['ok' => true]);
        }

        case 'ip_unblock': {
            $u = need_write();
            need_admin($u);
            $ip = substr((string) (body()['ip'] ?? ''), 0, 45);
            run('DELETE FROM ip_blocks WHERE ip = ?', [$ip]);
            run('DELETE FROM login_attempts WHERE ip = ?', [$ip]);
            audit(null, (int) $u['id'], 'security', 'Odblokirana IP adresa ' . $ip);
            out(['ok' => true]);
        }

        case 'usage': {
            $u = need_user();
            need_admin($u);
            out(['usage' => usage_report()]);
        }

        case 'revenue': {
            $u = need_user();
            out(revenue_report($u));
        }

        case 'audit_list': {
            $u = need_user();
            need_admin($u);
            $cid = (int) ($_GET['client_id'] ?? 0);
            $lim = max(1, min(500, (int) ($_GET['limit'] ?? 150)));
            $rs = $cid ? rows('SELECT * FROM audit_log WHERE client_id = ? ORDER BY at DESC, id DESC LIMIT ' . $lim, [$cid])
                       : rows('SELECT * FROM audit_log ORDER BY at DESC, id DESC LIMIT ' . $lim);
            out(['entries' => array_map(static fn ($r) => ['id' => (string) $r['id'], 'clientId' => $r['client_id'] !== null ? (string) $r['client_id'] : '', 'client' => (string) $r['client_name'],
                'user' => $r['user_id'] !== null ? user_name_of($r['user_id']) : 'Sustav', 'at' => (int) $r['at'], 'action' => (string) $r['action'], 'details' => (string) $r['details']], $rs)]);
        }

        case 'task_create': {
            $u = need_write();
            $in = body();
            $title = f_str($in, 'title', 300, 'Zadatak', true);
            $descr = f_str($in, 'descr', 4000, 'Opis zadatka');
            $due = f_date($in['due'] ?? '');
            if ($due === null) {
                throw new ApiError('Odaberite rok zadatka.');
            }
            $cid = null;
            $cname = '';
            if (!empty($in['client_id'])) {
                $c = load_client((string) $in['client_id']);
                $cid = (int) $c['id'];
                $cname = (string) $c['name'];
            }
            $assignee = active_user_id($in['assignee_id'] ?? null, (int) $u['id']);
            run('INSERT INTO tasks (client_id, title, descr, due_date, assignee_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [$cid, $title, $descr, $due, $assignee, $u['id'], ms()]);
            $tid = insert_id();
            audit($cid, (int) $u['id'], 'task', 'Zadatak: ' . $title . ' (rok ' . date('d.m.Y.', strtotime($due)) . ', ' . user_name_of($assignee) . ')', $cname);
            if ($assignee !== (int) $u['id']) {
                $body = $u['name'] . ' vam je zadao zadatak: ' . $title . "\nRok: " . date('d.m.Y.', strtotime($due)) . ($cname !== '' ? "\nKlijent: " . $cname : '') . ($descr !== '' ? "\n\n" . $descr : '');
                alert_create($assignee, $cid, 'task', 'Novi zadatak: ' . $title, $body, null, 'tk:' . $tid);
                alert_mail($assignee, 'Novi zadatak: ' . $title, $body);
            }
            out(['ok' => true, 'id' => (string) $tid]);
        }

        case 'task_take':
        case 'task_note':
        case 'task_done':
        case 'task_delete': {
            $u = need_write();
            $in = body();
            $t = row('SELECT * FROM tasks WHERE id = ?', [(int) ($in['id'] ?? 0)]);
            if (!$t || !task_visible($u, $t)) {
                throw new ApiError('Zadatak ne postoji.', 404);
            }
            $cid = $t['client_id'] !== null ? (int) $t['client_id'] : null;
            $now = ms();
            if ($action === 'task_delete') {
                if ($u['role'] !== 'admin' && (int) $t['created_by'] !== (int) $u['id']) {
                    throw new ApiError('Zadatak može obrisati administrator ili autor zadatka.', 403);
                }
                run('DELETE FROM task_notes WHERE task_id = ?', [$t['id']]);
                run('DELETE FROM tasks WHERE id = ?', [$t['id']]);
                audit($cid, (int) $u['id'], 'task', 'Zadatak obrisan: ' . $t['title']);
            } elseif ($action === 'task_take') {
                if ($t['done_at'] !== null) {
                    throw new ApiError('Zadatak je već završen.');
                }
                if (!empty($t['taken_at'])) {
                    throw new ApiError('Zadatak je već preuzet.');
                }
                run('UPDATE tasks SET taken_at = ?, taken_by = ? WHERE id = ?', [$now, $u['id'], $t['id']]);
                audit($cid, (int) $u['id'], 'task', 'Zadatak preuzet: ' . $t['title']);
                if ((int) $t['created_by'] !== (int) $u['id']) {
                    alert_create((int) $t['created_by'], $cid, 'task', 'Zadatak preuzet: ' . $t['title'], $u['name'] . ' je preuzeo/la zadatak.', null, 'tt:' . $t['id']);
                }
            } elseif ($action === 'task_note') {
                $txt = f_text($in, 'body', 'Bilješka');
                run('INSERT INTO task_notes (task_id, user_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)', [$t['id'], $u['id'], 'note', $txt, $now]);
                audit($cid, (int) $u['id'], 'task', 'Bilješka uz zadatak: ' . $t['title']);
            } else {
                $done = !empty($in['done']);
                $txt = trim((string) ($in['body'] ?? ''));
                if ($done) {
                    if ($t['done_at'] !== null) {
                        throw new ApiError('Zadatak je već završen.');
                    }
                    if ($txt !== '') {
                        $txt = f_text($in, 'body', 'Bilješka');
                        run('INSERT INTO task_notes (task_id, user_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)', [$t['id'], $u['id'], 'close', $txt, $now]);
                    }
                    run('UPDATE tasks SET done_at = ?, done_by = ? WHERE id = ?', [$now, $u['id'], $t['id']]);
                    audit($cid, (int) $u['id'], 'task', 'Zadatak završen: ' . $t['title']);
                    if ((int) $t['created_by'] !== (int) $u['id']) {
                        alert_create((int) $t['created_by'], $cid, 'task', 'Zadatak završen: ' . $t['title'], $u['name'] . ' je završio/la zadatak.' . ($txt !== '' ? "\n" . $txt : ''), null, 'td:' . $t['id']);
                    }
                } else {
                    run('UPDATE tasks SET done_at = NULL, done_by = NULL WHERE id = ?', [$t['id']]);
                    audit($cid, (int) $u['id'], 'task', 'Zadatak ponovno otvoren: ' . $t['title']);
                }
            }
            out(['ok' => true]);
        }

        case 'email_delete': {
            $u = need_write();
            $e = load_email((string) (body()['id'] ?? ''));
            $own = $e['client_id'] !== null ? row('SELECT owner_id FROM clients WHERE id = ?', [$e['client_id']]) : null;
            $allowed = $u['role'] === 'admin' || (int) ($e['user_id'] ?? 0) === (int) $u['id'] || ($own && (int) $own['owner_id'] === (int) $u['id'])
                || ($e['client_id'] === null && $e['direction'] === 'in');
            if (!$allowed) {
                throw new ApiError('Poruku može obrisati administrator, pošiljatelj ili prodavač klijenta.', 403);
            }
            delete_document_rows(rows('SELECT id, stored FROM documents WHERE email_id = ?', [$e['id']]));
            run("UPDATE emails SET deleted_at = ?, client_id = NULL, remind_done_at = COALESCE(remind_done_at, ?), subject = '', body = '', preview = '', attachments = NULL, from_name = '', reply_to = '', in_reply_to = NULL WHERE id = ?", [ms(), ms(), $e['id']]);
            audit($e['client_id'] !== null ? (int) $e['client_id'] : null, (int) $u['id'], 'email', 'Obrisana poruka: ' . ((string) $e['subject'] !== '' ? $e['subject'] : '(bez predmeta)') . ' (' . ($e['direction'] === 'in' ? 'od ' . $e['from_email'] : 'za ' . $e['to_email']) . ')');
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
            $clients = array_map('client_out', rows('SELECT * FROM clients ORDER BY id'));
            $notes = array_map('note_out', rows('SELECT id, client_id, author_id, type, subject, body, to_email, created_at, bulk FROM notes ORDER BY created_at DESC, id DESC LIMIT 20000'));
            out($base + [
                'me' => ['id' => (string) $u['id'], 'name' => (string) $u['name'], 'email' => (string) $u['email'], 'role' => (string) $u['role'],
                    'signature' => $sig, 'signatureEffective' => effective_signature($u)],
                'users' => $usersOut,
                'clients' => $clients,
                'notes' => $notes,
                'emails' => email_list_out(rows('SELECT id, message_id, direction, from_email, from_name, to_email, subject, preview, attachments, auto, msg_date, client_id, read_at, mailbox FROM emails WHERE deleted_at IS NULL ORDER BY msg_date DESC, id DESC LIMIT 600')),
                'tasks' => $tasks,
                'approvals' => $u['role'] === 'admin' ? pending_approvals() : [],
                'alerts' => $alertsOut,
                'dnc' => array_map(static fn ($r) => (string) $r['email'], rows('SELECT email FROM do_not_contact')),
                'ownerHist' => array_map(static fn ($r) => [(string) $r['client_id'], (int) $r['from_at'], (string) $r['owner_id']], rows('SELECT client_id, owner_id, from_at FROM owner_history ORDER BY from_at, id')),
                'campaigns' => array_map(static fn ($r) => ['id' => (string) $r['id'], 'clientId' => (string) $r['client_id'], 'start' => (string) ($r['start_date'] ?? ''), 'end' => (string) $r['end_date'], 'value' => (float) $r['value']], rows('SELECT * FROM campaigns ORDER BY end_date DESC, id DESC LIMIT 3000')),
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
                    'imap2Cfg' => $u['role'] === 'admin' ? imap2_public() : null,
                    'lastSync2' => $last2,
                    'error2' => $u['role'] === 'admin' ? $err2 : ($err2 !== '' ? 'error' : ''),
                    'lastSync' => $lastSync,
                    'error' => $u['role'] === 'admin' ? $lastErr : ($lastErr !== '' ? 'error' : ''),
                ],
            ]);
        }

        case 'client_create': {
            $u = need_write();
            $in = body();
            $kind = f_kind($in);
            $name = f_str($in, 'name', 190, $kind === 'osoba' ? 'Ime i prezime' : 'Naziv tvrtke', true);
            $contact = $kind === 'osoba' ? $name : f_str($in, 'contact', 190, 'Kontakt osoba', true);
            $oib = f_oib($in);
            $email = f_email($in, 'email');
            $phone = f_str($in, 'phone', 60, 'Telefon');
            $service = f_services($in['service'] ?? '');
            $industry = f_str($in, 'industry', 120, 'Djelatnost');
            $value = f_value($in['value'] ?? 0);
            $vkind = (($in['value_kind'] ?? '') === 'ugovoreno') ? 'ugovoreno' : 'ponudeno';
            $status = f_status($in['status'] ?? 'novi');
            $owner = active_user_id($in['owner_id'] ?? null, (int) $u['id']);
            $fu = f_date($in['next_follow_up'] ?? '');
            [$campA, $campS, $campE, $campV] = f_campaign($in);
            if ($campA === 1) {
                $status = 'aktivni';
            }
            $note = f_text($in, 'note', 'Prva bilješka');
            $mailId = !empty($in['email_id']) ? (int) load_email((string) $in['email_id'])['id'] : null;
            $t = ms();
            $id = transaction(static function () use ($kind, $oib, $name, $contact, $email, $phone, $service, $industry, $value, $vkind, $status, $owner, $fu, $note, $t, $u, $campA, $campS, $campE, $campV): int {
                run('INSERT INTO clients (kind, oib, name, contact, email, phone, service, industry, value, value_kind, status, owner_id, next_follow_up, won_at, created_by, created_at, updated_at, camp_active, camp_start, camp_end, camp_value)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [$kind, $oib, $name, $contact, $email, $phone, $service, $industry, $value, $vkind, $status, $owner, $fu, $status === 'dobiven' ? $t : null, $u['id'], $t, $t, $campA, $campS, $campE, $campV]);
                $cid = insert_id();
                record_owner($cid, (int) $owner, $t);
                run('INSERT INTO notes (client_id, author_id, type, body, created_at) VALUES (?, ?, ?, ?, ?)', [$cid, $u['id'], 'note', $note, $t]);
                return $cid;
            });
            link_emails_to_client($id, strtolower($email));
            if ($mailId !== null) {
                run('UPDATE emails SET client_id = ? WHERE id = ? AND client_id IS NULL', [$id, $mailId]);
                sync_document_clients();
            }
            audit($id, (int) $u['id'], 'create', 'Klijent kreiran, status: ' . (STAGE_LABELS[$status] ?? $status) . ($campA ? ', kampanja do ' . date('d.m.Y.', strtotime($campE)) . ' (' . number_format((float) $campV, 2, ',', '.') . ' €)' : ''), $name);
            out(['ok' => true, 'id' => (string) $id]);
        }

        case 'campaign_renew': {
            $u = need_write();
            $in = body();
            $c = load_client((string) ($in['client_id'] ?? ''));
            [, $ns, $ne, $nv] = f_campaign(['camp_active' => 1, 'camp_start' => $in['start'] ?? '', 'camp_end' => $in['end'] ?? '', 'camp_value' => $in['value'] ?? '']);
            if ((int) $c['camp_active'] === 1 && !empty($c['camp_end']) && $c['camp_end'] >= date('Y-m-d')) {
                throw new ApiError('Kampanja još traje. Nova se upisuje nakon završetka ili odznačite Aktivni.');
            }
            $t = ms();
            transaction(static function () use ($c, $u, $ns, $ne, $nv, $t): void {
                archive_campaign($c, (int) $u['id']);
                run('UPDATE clients SET camp_active = 1, camp_start = ?, camp_end = ?, camp_value = ?, updated_at = ? WHERE id = ?', [$ns, $ne, $nv, $t, $c['id']]);
                mark_client_active($c, (int) $u['id'], $t);
                run('INSERT INTO notes (client_id, author_id, type, body, created_at) VALUES (?, ?, ?, ?, ?)',
                    [$c['id'], $u['id'], 'note', 'Nova kampanja: ' . date('d.m.Y.', strtotime($ns)) . ' – ' . date('d.m.Y.', strtotime($ne)) . ', vrijednost ' . number_format((float) $nv, 2, ',', '.') . ' €', $t]);
            });
            audit((int) $c['id'], (int) $u['id'], 'campaign', 'Nova kampanja: ' . date('d.m.Y.', strtotime($ns)) . ' – ' . date('d.m.Y.', strtotime($ne)) . ', ' . number_format((float) $nv, 2, ',', '.') . ' €', (string) $c['name']);
            out(['ok' => true]);
        }

        case 'client_update': {
            $u = need_write();
            $in = body();
            $c = load_client((string) ($in['id'] ?? ''));
            $kind = f_kind($in, (string) ($c['kind'] ?? 'tvrtka'));
            $name = f_str($in, 'name', 190, $kind === 'osoba' ? 'Ime i prezime' : 'Naziv tvrtke', true);
            $contact = $kind === 'osoba' ? $name : f_str($in, 'contact', 190, 'Kontakt osoba', true);
            $oib = f_oib($in);
            $email = f_email($in, 'email');
            $phone = f_str($in, 'phone', 60, 'Telefon');
            $service = f_services($in['service'] ?? '');
            $industry = array_key_exists('industry', $in) ? f_str($in, 'industry', 120, 'Djelatnost') : (string) ($c['industry'] ?? '');
            $value = array_key_exists('value', $in) ? f_value($in['value']) : (float) $c['value'];
            $owner = active_user_id($in['owner_id'] ?? null, (int) ($c['owner_id'] ?? $u['id']));
            $fu = array_key_exists('next_follow_up', $in) ? f_date($in['next_follow_up']) : ($c['next_follow_up'] ?: null);
            run('UPDATE clients SET kind = ?, oib = ?, name = ?, contact = ?, email = ?, phone = ?, service = ?, industry = ?, value = ?, owner_id = ?, next_follow_up = ?, updated_at = ? WHERE id = ?',
                [$kind, $oib, $name, $contact, $email, $phone, $service, $industry, $value, $owner, $fu, ms(), $c['id']]);
            if ((int) $owner !== (int) $c['owner_id']) {
                record_owner((int) $c['id'], (int) $owner, ms());
            }
            $newVals = ['kind' => $kind, 'name' => $name, 'contact' => $contact, 'oib' => $oib, 'email' => $email, 'phone' => $phone, 'service' => $service, 'industry' => $industry, 'value' => $value, 'owner_id' => $owner, 'next_follow_up' => $fu];
            if (array_key_exists('camp_active', $in)) {
                [$campA, $campS, $campE, $campV] = f_campaign($in);
                $newVals += ['camp_active' => $campA, 'camp_start' => $campS, 'camp_end' => $campE, 'camp_value' => $campV];
                if ($campA === 0 && (int) $c['camp_active'] === 1) {
                    archive_campaign($c, (int) $u['id']); // kampanja je završena ili prekinuta: ostaje u povijesti
                }
                run('UPDATE clients SET camp_active = ?, camp_start = ?, camp_end = ?, camp_value = ? WHERE id = ?', [$campA, $campS, $campE, $campV, $c['id']]);
                if ($campA === 1) {
                    mark_client_active($c, (int) $u['id'], ms());
                }
            }
            link_emails_to_client((int) $c['id'], strtolower($email));
            $diff = client_diff($c, $newVals);
            if ($diff !== '') {
                audit((int) $c['id'], (int) $u['id'], 'update', $diff, $name);
            }
            out(['ok' => true]);
        }

        case 'client_take': {
            $u = need_write();
            $in = body();
            $c = load_client((string) ($in['id'] ?? ''));
            if ((int) $c['owner_id'] === (int) $u['id']) {
                throw new ApiError('Ovaj klijent je već vaš.');
            }
            $t = ms();
            $from = user_name_of((int) $c['owner_id']);
            transaction(static function () use ($c, $u, $t, $from): void {
                run('UPDATE clients SET owner_id = ?, updated_at = ? WHERE id = ?', [$u['id'], $t, $c['id']]);
                record_owner((int) $c['id'], (int) $u['id'], $t);
                run('INSERT INTO notes (client_id, author_id, type, body, created_at) VALUES (?, ?, ?, ?, ?)',
                    [$c['id'], $u['id'], 'note', 'Klijenta je preuzeo/la ' . $u['name'] . ' (prethodni prodavač: ' . $from . ').', $t]);
            });
            audit((int) $c['id'], (int) $u['id'], 'update', 'Prodavač: ' . $from . ' → ' . $u['name'] . ' (preuzimanje)', (string) $c['name']);
            out(['ok' => true]);
        }

        case 'client_delete': {
            $u = need_write();
            $c = load_client((string) (body()['id'] ?? ''));
            if ($u['role'] !== 'admin' && (int) $c['owner_id'] !== (int) $u['id']) {
                throw new ApiError('Klijenta može obrisati administrator ili njegov prodavač.', 403);
            }
            delete_document_rows(rows('SELECT id, stored FROM documents WHERE client_id = ?', [$c['id']]));
            transaction(static function () use ($c): void {
                run("UPDATE scheduled_emails SET status = 'cancelled' WHERE client_id = ? AND status = 'pending'", [$c['id']]);
                run('UPDATE emails SET client_id = NULL WHERE client_id = ?', [$c['id']]);
                run('DELETE FROM notes WHERE client_id = ?', [$c['id']]);
                run('DELETE FROM campaigns WHERE client_id = ?', [$c['id']]);
                run('DELETE FROM task_notes WHERE task_id IN (SELECT id FROM tasks WHERE client_id = ?)', [$c['id']]);
                run('DELETE FROM tasks WHERE client_id = ?', [$c['id']]);
                run('DELETE FROM clients WHERE id = ?', [$c['id']]);
            });
            audit((int) $c['id'], (int) $u['id'], 'delete', 'Klijent obrisan (status: ' . (STAGE_LABELS[$c['status']] ?? $c['status']) . ', vrijednost ' . number_format((float) $c['value'], 2, ',', '.') . ' €)', (string) $c['name']);
            out(['ok' => true]);
        }

        case 'note_add': {
            $u = need_write();
            $in = body();
            $c = load_client((string) ($in['client_id'] ?? ''));
            $type = (string) ($in['type'] ?? 'note');
            if (!in_array($type, ['note', 'call', 'meeting'], true)) {
                throw new ApiError('Vrsta bilješke nije ispravna.');
            }
            $text = f_text($in, 'text', 'Bilješka');
            $fu = f_date($in['next_follow_up'] ?? '');
            $t = ms();
            // vrijednost: ponuđeno ili ugovoreno (neobavezno, mijenja se samo ako je poslana)
            $setValue = array_key_exists('value', $in) && trim((string) $in['value']) !== '';
            $value = $setValue ? f_value($in['value']) : (float) $c['value'];
            $vkind = (($in['value_kind'] ?? '') === 'ugovoreno') ? 'ugovoreno' : ((($in['value_kind'] ?? '') === 'ponudeno') ? 'ponudeno' : (string) ($c['value_kind'] ?: 'ponudeno'));
            $valueChanged = $setValue && ((float) $value !== (float) $c['value'] || $vkind !== (string) ($c['value_kind'] ?: 'ponudeno'));
            if ($valueChanged) {
                $text .= "\nVrijednost: " . number_format((float) $value, 2, ',', '.') . ' € (' . ($vkind === 'ugovoreno' ? 'Ugovoreno' : 'Ponuđeno') . ')';
            }
            $camp = null;
            if (array_key_exists('camp_active', $in)) {
                $camp = f_campaign($in);
            }
            transaction(static function () use ($c, $u, $type, $text, $fu, $t, $valueChanged, $value, $vkind, $camp): void {
                run('INSERT INTO notes (client_id, author_id, type, body, created_at) VALUES (?, ?, ?, ?, ?)', [$c['id'], $u['id'], $type, $text, $t]);
                if ($fu) {
                    run('UPDATE clients SET next_follow_up = ?, updated_at = ? WHERE id = ?', [$fu, $t, $c['id']]);
                } else {
                    run('UPDATE clients SET updated_at = ? WHERE id = ?', [$t, $c['id']]);
                }
                if ($valueChanged) {
                    run('UPDATE clients SET value = ?, value_kind = ? WHERE id = ?', [$value, $vkind, $c['id']]);
                }
                if ($camp !== null) {
                    [$campA, $campS, $campE, $campV] = $camp;
                    if ($campA === 0 && (int) $c['camp_active'] === 1) {
                        archive_campaign($c, (int) $u['id']);
                    }
                    run('UPDATE clients SET camp_active = ?, camp_start = ?, camp_end = ?, camp_value = ? WHERE id = ?', [$campA, $campS, $campE, $campV, $c['id']]);
                    if ($campA === 1) {
                        mark_client_active($c, (int) $u['id'], $t);
                    }
                }
            });
            $new = [];
            if ($fu) {
                $new['next_follow_up'] = $fu;
            }
            if ($valueChanged) {
                $new['value'] = $value;
            }
            if ($camp !== null) {
                $new += ['camp_active' => $camp[0], 'camp_start' => $camp[1], 'camp_end' => $camp[2], 'camp_value' => $camp[3]];
            }
            $diff = $new ? client_diff($c, $new) : '';
            if ($valueChanged && $vkind !== (string) ($c['value_kind'] ?: 'ponudeno')) {
                $diff = trim($diff . ' Vrsta vrijednosti: ' . ($vkind === 'ugovoreno' ? 'Ugovoreno' : 'Ponuđeno'));
            }
            if ($diff !== '') {
                audit((int) $c['id'], (int) $u['id'], 'update', $diff, (string) $c['name']);
            }
            out(['ok' => true]);
        }

        case 'status_change': {
            $u = need_write();
            $in = body();
            $c = load_client((string) ($in['client_id'] ?? ''));
            $new = f_status($in['status'] ?? '');
            $text = f_text($in, 'text', 'Razlog promjene');
            if ($new === $c['status']) {
                throw new ApiError('Status je već postavljen.');
            }
            if ($new === 'aktivni' && (int) $c['camp_active'] !== 1) {
                throw new ApiError('Status Aktivni postavlja se označavanjem opcije "Aktivni" uz upis kampanje (termin i vrijednost).');
            }
            $t = ms();
            $label = ['novi' => 'Novi kontakt', 'kontaktiran' => 'Kontaktiran', 'ponuda' => 'Ponuda poslana', 'pregovori' => 'Pregovori', 'aktivni' => 'Aktivni', 'dobiven' => 'Dobiven', 'izgubljen' => 'Izgubljen'];
            transaction(static function () use ($c, $u, $new, $text, $t, $label): void {
                run('UPDATE clients SET status = ?, won_at = ?, updated_at = ? WHERE id = ?',
                    [$new, $new === 'dobiven' ? $t : $c['won_at'], $t, $c['id']]);
                run('INSERT INTO notes (client_id, author_id, type, body, created_at) VALUES (?, ?, ?, ?, ?)',
                    [$c['id'], $u['id'], 'status', $label[$c['status']] . ' → ' . $label[$new] . "\n" . $text, $t]);
            });
            audit((int) $c['id'], (int) $u['id'], 'status', 'Status: ' . $label[$c['status']] . ' → ' . $label[$new] . ' (' . $text . ')', (string) $c['name']);
            out(['ok' => true]);
        }

        case 'email_send': {
            $u = need_write();
            $in = body();
            $c = load_client((string) ($in['client_id'] ?? ''));
            $to = f_email($in, 'to', true);
            if (dnc_has($to) && !($u['role'] === 'admin' && !empty($in['force']))) {
                throw new ApiError('Ova adresa je na popisu "ne kontaktirati" (odjava ili zahtjev klijenta). ' . ($u['role'] === 'admin' ? 'Administrator može poslati poruku uz potvrdu.' : 'Poruka nije poslana.'), 409);
            }
            $subject = f_str($in, 'subject', 255, 'Predmet', true);
            if (preg_match('/[\r\n]/', $subject)) {
                throw new ApiError('Predmet mora biti u jednom retku.');
            }
            $text = f_str($in, 'body', 20000, 'Poruka', true);
            $docIds = is_array($in['doc_ids'] ?? null) ? array_map('intval', $in['doc_ids']) : [];
            $remind = null;
            if (isset($in['remind_days']) && $in['remind_days'] !== '' && $in['remind_days'] !== null) {
                $remind = (int) $in['remind_days'];
                if ($remind < 1 || $remind > 60) {
                    throw new ApiError('Podsjetnik može biti za 1 do 60 dana.');
                }
            }
            if (!empty($in['send_at'])) {
                $at = (int) $in['send_at'];
                if ($at < ms() + 60000 || $at > ms() + 366 * DAY_MS) {
                    throw new ApiError('Vrijeme slanja mora biti u budućnosti (najviše godinu dana unaprijed).');
                }
                if (!Mailer::configured()) {
                    throw new ApiError('E-mail još nije podešen. Administrator ga podešava u config.php.', 409);
                }
                if ($docIds) {
                    load_attachments($docIds, (int) $c['id']); // validate now, fail early
                }
                run('INSERT INTO scheduled_emails (user_id, client_id, to_email, subject, body, doc_ids, remind_days, send_at, status, attempts, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
                    [$u['id'], $c['id'], $to, $subject, $text, implode(',', array_unique($docIds)), $remind, $at, 'pending', ms()]);
                out(['ok' => true, 'scheduled' => true, 'sendAt' => $at]);
            }
            send_and_store($u, $to, $subject, with_signature($text, $u), (int) $c['id'], null, $docIds, $remind);
            record_client_email($c, $u, $to, $subject, $text);
            out(['ok' => true]);
        }

        case 'sched_cancel': {
            $u = need_write();
            $s = row('SELECT * FROM scheduled_emails WHERE id = ?', [(int) (body()['id'] ?? 0)]);
            if (!$s) {
                throw new ApiError('Zakazana poruka ne postoji.', 404);
            }
            if ($u['role'] !== 'admin' && (int) $s['user_id'] !== (int) $u['id']) {
                throw new ApiError('Zakazanu poruku može otkazati autor ili administrator.', 403);
            }
            if (run("UPDATE scheduled_emails SET status = 'cancelled' WHERE id = ? AND status IN ('pending', 'failed')", [$s['id']]) !== 1) {
                throw new ApiError('Poruka je već poslana ili se upravo šalje.', 409);
            }
            out(['ok' => true]);
        }

        case 'reminder_done': {
            $u = need_write();
            $in = body();
            $e = load_email((string) ($in['email_id'] ?? ''));
            $snooze = (int) ($in['snooze_days'] ?? 0);
            if ($snooze > 0) {
                $waited = (int) ceil((ms() - (int) $e['msg_date']) / DAY_MS);
                run('UPDATE emails SET remind_days = ?, remind_notified_at = NULL WHERE id = ?', [$waited + min($snooze, 30), $e['id']]);
            } else {
                run('UPDATE emails SET remind_done_at = ? WHERE id = ?', [ms(), $e['id']]);
            }
            out(['ok' => true]);
        }

        case 'email_reply': {
            $u = need_write();
            $in = body();
            $orig = load_email((string) ($in['email_id'] ?? ''));
            if ($orig['direction'] === 'in') {
                $to = (string) ($orig['reply_to'] !== '' ? $orig['reply_to'] : $orig['from_email']);
            } else {
                $to = '';
                foreach (preg_split('/[,;]+/', (string) $orig['to_email']) as $cand) {
                    if (preg_match('/<([^>]+)>/', $cand, $m)) {
                        $cand = $m[1];
                    }
                    $cand = trim($cand);
                    if (filter_var($cand, FILTER_VALIDATE_EMAIL)) {
                        $to = $cand;
                        break;
                    }
                }
            }
            if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
                throw new ApiError('Poruka nema ispravnu adresu za odgovor.');
            }
            $text = f_str($in, 'body', 20000, 'Odgovor', true);
            $subject = preg_match('/^\s*(re|odg)\s*:/i', (string) $orig['subject']) ? (string) $orig['subject'] : 'Re: ' . $orig['subject'];
            $quoted = array_slice(preg_split('/\r?\n/', (string) $orig['body']), 0, 40);
            $full = with_signature($text, $u) . "\n\n" . 'Dana ' . date('d.m.Y. \u H:i', (int) ($orig['msg_date'] / 1000)) . ' ' . trim(($orig['from_name'] !== '' ? $orig['from_name'] . ' ' : '') . '<' . $orig['from_email'] . '>') . " je napisao/la:\n"
                . implode("\n", array_map(static fn ($l) => '> ' . $l, $quoted));
            $cid = $orig['client_id'] !== null ? (int) $orig['client_id'] : null;
            $docIds = is_array($in['doc_ids'] ?? null) ? array_map('intval', $in['doc_ids']) : [];
            send_and_store($u, $to, mb_substr($subject, 0, 255), $full, $cid, '<' . $orig['message_id'] . '>', $cid ? $docIds : []);
            $t = ms();
            transaction(static function () use ($orig, $cid, $u, $to, $subject, $text, $t): void {
                run('UPDATE emails SET read_at = COALESCE(read_at, ?) WHERE id = ?', [$t, $orig['id']]);
                if ($cid) {
                    run('INSERT INTO notes (client_id, author_id, type, subject, body, to_email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [$cid, $u['id'], 'email', mb_substr($subject, 0, 255), $text, $to, $t]);
                    run('UPDATE clients SET updated_at = ? WHERE id = ?', [$t, $cid]);
                }
            });
            out(['ok' => true]);
        }

        case 'email_open': {
            $u = need_write();
            $e = load_email((string) (body()['id'] ?? ''));
            if ($e['read_at'] === null) {
                run('UPDATE emails SET read_at = ? WHERE id = ?', [ms(), $e['id']]);
            }
            $o = email_out($e);
            $o['read'] = true;
            $o['body'] = (string) $e['body'];
            $o['replyTo'] = (string) $e['reply_to'];
            $o['docs'] = array_map('doc_out', rows('SELECT * FROM documents WHERE email_id = ? ORDER BY id', [$e['id']]));
            out(['ok' => true, 'email' => $o]);
        }

        case 'email_link': {
            $u = need_write();
            $in = body();
            $e = load_email((string) ($in['email_id'] ?? ''));
            $cid = null;
            if (!empty($in['client_id'])) {
                $cid = (int) load_client((string) $in['client_id'])['id'];
            }
            run('UPDATE emails SET client_id = ? WHERE id = ?', [$cid, $e['id']]);
            sync_document_clients();
            out(['ok' => true]);
        }

        case 'inbox_sync': {
            $u = need_write();
            if (imap_cfg() === null) {
                throw new ApiError('Primanje pošte još nije podešeno u config.php.', 409);
            }
            $force = !empty(body()['force']);
            run_background_jobs();
            $last = (int) (meta_get('imap_last_sync') ?? 0);
            if (!$force && $last > ms() - 20000) {
                out(['ok' => true, 'new' => 0, 'cached' => true]);
            }
            try {
                $r = sync_inbox();
            } catch (MailException $e) {
                error_log('CRM sync: ' . $e->getMessage());
                out(['ok' => false, 'error' => $u['role'] === 'admin' ? $e->getMessage() : 'Osvježavanje pošte nije uspjelo. Obavijestite administratora.']);
            }
            $new2 = 0;
            if (imap_cfg(2) !== null) {
                try {
                    $new2 = sync_inbox(2)['new'];
                } catch (MailException $e) {
                    error_log('CRM sync 2: ' . $e->getMessage());
                }
            }
            out(['ok' => true, 'new' => $r['new'] + $new2, 'skipped' => $r['skipped']]);
        }

        case 'imap2_test': {
            $u = need_write();
            need_admin($u);
            $c = imap2_from_input(body());
            try {
                $im = new ImapClient($c);
                try {
                    $im->select($c['folder']);
                } finally {
                    $im->close();
                }
            } catch (Throwable $e) {
                out(['ok' => false, 'error' => $e->getMessage()]);
            }
            out(['ok' => true]);
        }

        case 'imap2_save': {
            $u = need_write();
            need_admin($u);
            $c = imap2_from_input(body());
            $prev = imap_cfg(2);
            $changed = $prev === null || strtolower((string) $prev['user']) !== strtolower($c['user']) || $prev['host'] !== $c['host'] || $prev['folder'] !== $c['folder'];
            $store = $c;
            $store['pass_enc'] = imap2_encrypt($c['pass']);
            unset($store['pass']);
            setting_set('imap2', json_encode($store));
            if ($changed) {
                foreach (['imap_last_uid_2', 'imap_uidvalidity_2', 'imap_last_sync_2', 'imap_last_error_2'] as $k) {
                    run('DELETE FROM meta WHERE k = ?', [$k]);
                }
            }
            out(['ok' => true]);
        }

        case 'imap2_clear': {
            $u = need_write();
            need_admin($u);
            run("DELETE FROM settings WHERE k = 'imap2'");
            foreach (['imap_last_uid_2', 'imap_uidvalidity_2', 'imap_last_sync_2', 'imap_last_error_2'] as $k) {
                run('DELETE FROM meta WHERE k = ?', [$k]);
            }
            out(['ok' => true]);
        }

        case 'mail_test': {
            $u = need_write();
            need_admin($u);
            try {
                Mailer::send((string) $u['email'], 'Probni e-mail iz VIP MARKET-a', "Ako ovo čitate, slanje e-maila radi.\n\nPoslano: " . date('d.m.Y. H:i'), (string) $u['name']);
            } catch (MailException $e) {
                out(['ok' => false, 'error' => $e->getMessage()]);
            }
            out(['ok' => true, 'to' => (string) $u['email']]);
        }

        case 'doc_upload': {
            if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
                throw new ApiError('Metoda nije dopuštena.', 405);
            }
            $u = need_user();
            if (!csrf_ok()) {
                throw new ApiError('Sigurnosna provjera nije uspjela. Osvježite stranicu.', 403);
            }
            if (!$_POST && !$_FILES && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
                throw new ApiError('Datoteka je prevelika za ovaj poslužitelj (najviše 10 MB, a poslužitelj možda dopušta manje).', 413);
            }
            $c = load_client((string) ($_POST['client_id'] ?? ''));
            $f = $_FILES['file'] ?? null;
            if (!$f || !is_array($f) || is_array($f['name'])) {
                throw new ApiError('Datoteka nije primljena.');
            }
            if ($f['error'] === UPLOAD_ERR_INI_SIZE || $f['error'] === UPLOAD_ERR_FORM_SIZE || (int) $f['size'] > DOC_MAX_BYTES) {
                throw new ApiError('Datoteka je prevelika (najviše 10 MB).', 413);
            }
            if ($f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file((string) $f['tmp_name'])) {
                throw new ApiError('Učitavanje datoteke nije uspjelo.');
            }
            $data = file_get_contents((string) $f['tmp_name']);
            if ($data === false || $data === '') {
                throw new ApiError('Datoteka je prazna.');
            }
            $id = store_document((int) $c['id'], null, (string) $f['name'], (string) ($f['type'] ?? ''), $data, (int) $u['id']);
            run('UPDATE clients SET updated_at = ? WHERE id = ?', [ms(), $c['id']]);
            audit((int) $c['id'], (int) $u['id'], 'doc', 'Dodan dokument: ' . (string) $f['name'], (string) $c['name']);
            out(['ok' => true, 'id' => (string) $id]);
        }

        case 'doc_download': {
            need_user();
            $d = row('SELECT * FROM documents WHERE id = ?', [(int) ($_GET['id'] ?? 0)]);
            if (!$d || !preg_match('/^[0-9a-f]{32}$/', (string) $d['stored'])) {
                throw new ApiError('Dokument ne postoji.', 404);
            }
            $path = storage_dir() . '/' . $d['stored'];
            if (!is_file($path)) {
                throw new ApiError('Datoteka nedostaje na poslužitelju.', 404);
            }
            header_remove('Content-Type');
            header('Content-Type: application/octet-stream');
            header('Content-Length: ' . filesize($path));
            $ascii = preg_replace('/[^\x20-\x7E]|["\\%]/', '_', (string) $d['filename']);
            header('Content-Disposition: attachment; filename="' . $ascii . '"; filename*=UTF-8\'\'' . rawurlencode((string) $d['filename']));
            header('Cache-Control: private, no-store');
            readfile($path);
            exit;
        }

        case 'doc_delete': {
            $u = need_write();
            $d = row('SELECT * FROM documents WHERE id = ?', [(int) (body()['id'] ?? 0)]);
            if (!$d) {
                throw new ApiError('Dokument ne postoji.', 404);
            }
            $c = $d['client_id'] !== null ? row('SELECT owner_id FROM clients WHERE id = ?', [$d['client_id']]) : null;
            $allowed = $u['role'] === 'admin' || (int) ($d['uploaded_by'] ?? 0) === (int) $u['id'] || ($c && (int) $c['owner_id'] === (int) $u['id']);
            if (!$allowed) {
                throw new ApiError('Dokument može obrisati administrator, onaj tko ga je učitao ili prodavač klijenta.', 403);
            }
            delete_document_rows([$d]);
            if ($d['client_id'] !== null) {
                audit((int) $d['client_id'], (int) $u['id'], 'doc', 'Obrisan dokument: ' . (string) $d['filename']);
            }
            out(['ok' => true]);
        }

        case 'signature_save': {
            $u = need_write();
            $sig = f_str(body(), 'signature', 1000, 'Potpis');
            run('UPDATE users SET signature = ? WHERE id = ?', [$sig !== '' ? $sig : null, $u['id']]);
            out(['ok' => true]);
        }

        case 'mail_overview': {
            $u = need_user();
            out(['ok' => true] + mail_overview($u));
        }

        case 'spell_check': {
            $u = need_write();
            $in = body();
            $subject = (string) ($in['subject'] ?? '');
            $text = (string) ($in['body'] ?? '');
            if (mb_strlen($text) > 20000 || mb_strlen($subject) > 500) {
                throw new ApiError('Tekst je predug za provjeru.');
            }
            $a = hr_spell_scan($subject);
            $b = hr_spell_scan($text);
            $res = ['ok' => true, 'issues' => array_merge($a['issues'], $b['issues']), 'subject' => $a['fixed'], 'body' => $b['fixed'], 'ai' => null];
            if (!empty($in['ai']) && ai_enabled() && trim($text) !== '') {
                ai_rate_check((int) $u['id']);
                $res['ai'] = ai_proofread($b['fixed']);
            }
            out($res);
        }

        case 'ai_draft': {
            $u = need_write();
            $in = body();
            $client = !empty($in['client_id']) ? load_client((string) $in['client_id']) : null;
            ai_rate_check((int) $u['id']);
            out(['ok' => true] + ai_draft($in + ['single' => $client !== null], $u, $client));
        }

        case 'bulk_preview': {
            $u = need_write();
            $in = body();
            $r = bulk_clients($u, is_array($in['audience'] ?? null) ? $in['audience'] : []);
            $stat = [];
            foreach (rows("SELECT client_id, COUNT(*) AS c, MAX(created_at) AS m FROM notes WHERE type = 'email' GROUP BY client_id") as $x) {
                $stat[(int) $x['client_id']] = [(int) $x['c'], (int) $x['m']];
            }
            $list = array_map(static fn ($c) => ['id' => (string) $c['id'], 'name' => (string) $c['name'], 'email' => (string) $c['email'], 'status' => (string) $c['status'],
                'owner' => user_name_of($c['owner_id']), 'mails' => $stat[(int) $c['id']][0] ?? 0, 'last' => $stat[(int) $c['id']][1] ?? null], array_slice($r['clients'], 0, 1000));
            $n = count($r['clients']);
            out(['ok' => true, 'clients' => $list, 'total' => $n, 'noEmail' => $r['noEmail'], 'dnc' => $r['dnc'] ?? 0, 'eta' => bulk_eta(bulk_pending_count() + $n)]);
        }

        case 'bulk_preview_msg': {
            $u = need_write();
            $in = body();
            $subject = f_str($in, 'subject', 255, 'Predmet', true);
            $text = f_str($in, 'body', 20000, 'Poruka', true);
            $ids = array_values(array_filter(array_map('intval', is_array($in['ids'] ?? null) ? $in['ids'] : [])));
            $cl = [];
            foreach ($ids as $id) {
                $c = row('SELECT * FROM clients WHERE id = ?', [$id]);
                if ($c && ($u['role'] === 'admin' || (int) $c['owner_id'] === (int) $u['id']) && filter_var(trim((string) $c['email']), FILTER_VALIDATE_EMAIL)) {
                    $cl[] = $c;
                }
            }
            out(['ok' => true, 'total' => count($cl), 'samples' => bulk_samples($subject, $text, $cl, $u, 5), 'needsApproval' => $u['role'] !== 'admin']);
        }

        case 'bulk_send': {
            $u = need_write();
            $in = body();
            if (!Mailer::configured()) {
                throw new ApiError('E-mail još nije podešen. Administrator ga podešava u config.php.', 409);
            }
            $subject = f_str($in, 'subject', 255, 'Predmet', true);
            if (preg_match('/[\r\n]/', $subject)) {
                throw new ApiError('Predmet mora biti u jednom retku.');
            }
            $text = f_str($in, 'body', 20000, 'Poruka', true);
            $ids = array_values(array_filter(array_map('intval', is_array($in['ids'] ?? null) ? $in['ids'] : [])));
            if (!$ids) {
                throw new ApiError('Odaberite barem jednog primatelja.');
            }
            $at = null;
            if (!empty($in['send_at'])) {
                $at = (int) $in['send_at'];
                if ($at < ms() + 60000 || $at > ms() + 366 * DAY_MS) {
                    throw new ApiError('Vrijeme slanja mora biti u budućnosti (najviše godinu dana unaprijed).');
                }
            }
            $r = transaction(static fn () => bulk_queue($u, $ids, $subject, $text, $at));
            if ($r['queued'] === 0) {
                throw new ApiError('Nijedna poruka nije stavljena u red' . ($r['skipped'] ? ' (primatelji su već dobili poruku s istim predmetom u zadnjih 30 dana ili nemaju ispravnu adresu).' : '.'));
            }
            if ($r['needsApproval']) {
                audit(null, (int) $u['id'], 'update', 'Grupna e-mail poruka čeka odobrenje: "' . $subject . '" (' . $r['queued'] . ' primatelja)', '');
            }
            out(['ok' => true] + $r + ['eta' => bulk_eta(bulk_pending_count())]);
        }

        case 'batch_detail': {
            $u = need_write();
            $b = row('SELECT * FROM mail_batches WHERE batch = ?', [(string) (body()['batch'] ?? '')]);
            if (!$b || ($u['role'] !== 'admin' && (int) $b['user_id'] !== (int) $u['id'])) {
                throw new ApiError('Slanje ne postoji.', 404);
            }
            $rowsx = rows('SELECT s.client_id, s.to_email, s.subject, s.body, s.user_id FROM scheduled_emails s WHERE s.batch = ? ORDER BY s.id', [$b['batch']]);
            $samples = [];
            foreach (array_slice($rowsx, 0, 5) as $r) {
                $su = row('SELECT * FROM users WHERE id = ?', [$r['user_id']]);
                $c = row('SELECT name FROM clients WHERE id = ?', [$r['client_id']]);
                $samples[] = ['to' => (string) $r['to_email'], 'name' => (string) ($c['name'] ?? ''), 'sender' => (string) ($su['name'] ?? ''), 'subject' => (string) $r['subject'],
                    'body' => $su ? with_signature((string) $r['body'], $su) : (string) $r['body']];
            }
            $names = [];
            foreach ($rowsx as $r) {
                $c = row('SELECT name FROM clients WHERE id = ?', [$r['client_id']]);
                $names[] = ($c['name'] ?? '?') . ' <' . $r['to_email'] . '>';
            }
            out(['ok' => true, 'batch' => (string) $b['batch'], 'by' => user_name_of($b['user_id']), 'status' => (string) $b['status'], 'sendAt' => (int) $b['send_at'], 'total' => count($rowsx), 'samples' => $samples, 'recipients' => array_slice($names, 0, 300)]);
        }

        case 'batch_decide': {
            $u = need_write();
            need_admin($u);
            $in = body();
            $b = row('SELECT * FROM mail_batches WHERE batch = ?', [(string) ($in['batch'] ?? '')]);
            if (!$b) {
                throw new ApiError('Slanje ne postoji.', 404);
            }
            if ($b['status'] !== 'awaiting') {
                throw new ApiError('O ovom slanju je već odlučeno.', 409);
            }
            $approve = ($in['decision'] ?? '') === 'approve';
            transaction(static function () use ($b, $u, $approve): void {
                run("UPDATE scheduled_emails SET status = ? WHERE batch = ? AND status = 'awaiting'", [$approve ? 'pending' : 'cancelled', $b['batch']]);
                run('UPDATE mail_batches SET status = ?, decided_by = ?, decided_at = ? WHERE batch = ?', [$approve ? 'approved' : 'rejected', $u['id'], ms(), $b['batch']]);
            });
            audit(null, (int) $u['id'], 'update', ($approve ? 'Odobreno' : 'Odbijeno') . ' grupno slanje: "' . $b['subject'] . '" (' . user_name_of($b['user_id']) . ', ' . $b['total'] . ' primatelja)', '');
            out(['ok' => true]);
        }

        case 'bulk_cancel': {
            $u = need_write();
            $batch = (string) (body()['batch'] ?? '');
            $sql = "UPDATE scheduled_emails SET status = 'cancelled' WHERE batch = ? AND bulk = 1 AND status IN ('awaiting','pending','failed')";
            $p = [$batch];
            if ($u['role'] !== 'admin') {
                $sql .= ' AND user_id = ?';
                $p[] = $u['id'];
            }
            $n = run($sql, $p);
            run("UPDATE mail_batches SET status = 'cancelled' WHERE batch = ? AND status = 'awaiting'" . ($u['role'] !== 'admin' ? ' AND user_id = ' . (int) $u['id'] : ''), [$batch]);
            out(['ok' => true, 'cancelled' => $n]);
        }

        case 'template_save': {
            $u = need_write();
            need_admin($u);
            $in = body();
            $name = f_str($in, 'name', 120, 'Naziv predloška', true);
            $subject = f_str($in, 'subject', 255, 'Predmet', true);
            $text = f_str($in, 'body', 10000, 'Tekst predloška', true);
            $kind = ($in['kind'] ?? '') === 'akcija' ? 'akcija' : 'email';
            $mode = in_array($in['send_mode'] ?? '', ['delay', 'fixed'], true) ? $in['send_mode'] : 'manual';
            $days = max(0, min(60, (int) ($in['send_days'] ?? 1)));
            $time = preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', (string) ($in['send_time'] ?? '')) ? (string) $in['send_time'] : '09:00';
            $fixed = $mode === 'fixed' && !empty($in['send_fixed']) ? (int) $in['send_fixed'] : null;
            if ($mode === 'fixed' && $fixed === null) {
                throw new ApiError('Odaberite datum i vrijeme slanja.');
            }
            $aud = $kind === 'akcija' ? clean_audience($in['audience'] ?? []) : ['groups' => [], 'kind' => 'sve', 'owner' => ''];
            if ($kind === 'akcija' && !$aud['groups']) {
                throw new ApiError('Odaberite barem jednu skupinu primatelja.');
            }
            $inputs = [];
            foreach ((is_array($in['inputs'] ?? null) ? $in['inputs'] : []) as $k => $v) {
                if (in_array($k, ['naziv', 'ponuda', 'popust', 'rok', 'kontakt', 'ton'], true) && is_string($v)) {
                    $inputs[$k] = mb_substr(trim($v), 0, 1000);
                }
            }
            $vals = [$name, $subject, $text, $kind, $mode, $days, $time, $fixed, json_encode($aud), json_encode($inputs ?: new stdClass()), ms()];
            if (!empty($in['id'])) {
                if (run('UPDATE templates SET name = ?, subject = ?, body = ?, kind = ?, send_mode = ?, send_days = ?, send_time = ?, send_fixed = ?, audience = ?, inputs = ?, updated_at = ? WHERE id = ?', array_merge($vals, [(int) $in['id']])) === 0 && !row('SELECT id FROM templates WHERE id = ?', [(int) $in['id']])) {
                    throw new ApiError('Predložak ne postoji.', 404);
                }
            } else {
                $max = row('SELECT COALESCE(MAX(sort_order), 0) AS m FROM templates');
                run('INSERT INTO templates (name, subject, body, kind, send_mode, send_days, send_time, send_fixed, audience, inputs, updated_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', array_merge($vals, [(int) $max['m'] + 1]));
            }
            out(['ok' => true]);
        }

        case 'campaign_preview': {
            $u = need_write();
            need_admin($u);
            $in = body();
            $list = campaign_recipients(is_array($in['audience'] ?? null) ? $in['audience'] : []);
            out(['ok' => true, 'count' => count($list), 'sample' => array_map(static fn ($c) => (string) $c['name'], array_slice($list, 0, 8))]);
        }

        case 'campaign_send': {
            $u = need_write();
            need_admin($u);
            if (!Mailer::configured()) {
                throw new ApiError('E-mail još nije podešen. Administrator ga podešava u config.php.', 409);
            }
            $t = row("SELECT * FROM templates WHERE id = ? AND kind = 'akcija'", [(int) (body()['id'] ?? 0)]);
            if (!$t) {
                throw new ApiError('Akcija ne postoji. Najprije je spremite.', 404);
            }
            $r = transaction(static fn () => campaign_queue($t, $u));
            out(['ok' => true] + $r);
        }

        case 'template_delete': {
            $u = need_write();
            need_admin($u);
            run('DELETE FROM templates WHERE id = ?', [(int) (body()['id'] ?? 0)]);
            out(['ok' => true]);
        }

        case 'backup_list': {
            $u = need_user();
            need_admin($u);
            out(['backups' => backup_list(), 'keep' => BACKUP_KEEP, 'doneToday' => backup_today_exists()]);
        }

        case 'backup_run': {
            $u = need_write();
            need_admin($u);
            $r = backup_create((string) $u['name']);
            out(['ok' => true, 'name' => $r['name'], 'backups' => backup_list(), 'keep' => BACKUP_KEEP, 'doneToday' => true]);
        }

        case 'backup_download': {
            $u = need_user();
            need_admin($u);
            $f = (string) ($_GET['f'] ?? '');
            if (!preg_match('/^crm-backup-\d{8}-\d{6}\.json\.gz$/', $f) || !is_file(backup_dir() . '/' . $f)) {
                throw new ApiError('Kopija ne postoji.', 404);
            }
            $path = backup_dir() . '/' . $f;
            audit(null, (int) $u['id'], 'backup', 'Preuzeta sigurnosna kopija: ' . $f);
            header_remove('Content-Type');
            header('Content-Type: application/gzip');
            header('Content-Length: ' . filesize($path));
            header('Content-Disposition: attachment; filename="' . $f . '"');
            header('Cache-Control: private, no-store');
            readfile($path);
            exit;
        }

        case 'alert_done': {
            $u = need_write();
            $id = (int) (body()['id'] ?? 0);
            run('UPDATE alerts SET done_at = ? WHERE id = ? AND user_id = ? AND done_at IS NULL', [ms(), $id, $u['id']]);
            out(['ok' => true]);
        }

        case 'dnc_list': {
            need_user();
            out(['list' => array_map(static fn ($r) => ['id' => (string) $r['id'], 'email' => (string) $r['email'], 'client' => $r['client_id'] !== null ? (string) $r['client_id'] : '', 'reason' => (string) $r['reason'],
                'source' => (string) $r['source'], 'at' => (int) $r['created_at']], rows('SELECT * FROM do_not_contact ORDER BY created_at DESC, id DESC LIMIT 2000'))]);
        }

        case 'dnc_add': {
            $u = need_write();
            $in = body();
            $email = strtolower(f_email($in, 'email', true));
            $reason = f_str($in, 'reason', 190, 'Razlog') ?: 'Dodano ručno';
            if (!dnc_add($email, $reason, 'manual', (int) $u['id'])) {
                throw new ApiError('Adresa je već na popisu.', 409);
            }
            out(['ok' => true]);
        }

        case 'dnc_remove': {
            $u = need_write();
            need_admin($u);
            $r = row('SELECT * FROM do_not_contact WHERE id = ?', [(int) (body()['id'] ?? 0)]);
            if (!$r) {
                throw new ApiError('Zapis ne postoji.', 404);
            }
            run('DELETE FROM do_not_contact WHERE id = ?', [$r['id']]);
            audit($r['client_id'] !== null ? (int) $r['client_id'] : null, (int) $u['id'], 'dnc', 'Uklonjen s popisa ne kontaktirati: ' . $r['email']);
            out(['ok' => true]);
        }

        case 'dup_scan': {
            $u = need_user();
            need_admin($u);
            $groups = dup_groups();
            $cl = [];
            foreach ($groups as $g) {
                foreach ($g['ids'] as $id) {
                    $cl[$id] = true;
                }
            }
            $info = [];
            if ($cl) {
                $in = implode(',', array_map('intval', array_keys($cl)));
                foreach (rows('SELECT * FROM clients WHERE id IN (' . $in . ')') as $c) {
                    $cnt = row('SELECT (SELECT COUNT(*) FROM notes WHERE client_id = ?) AS n, (SELECT COUNT(*) FROM emails WHERE client_id = ?) AS e, (SELECT COUNT(*) FROM documents WHERE client_id = ?) AS d', [$c['id'], $c['id'], $c['id']]);
                    $info[(string) $c['id']] = ['id' => (string) $c['id'], 'name' => (string) $c['name'], 'oib' => (string) $c['oib'], 'email' => (string) $c['email'], 'phone' => (string) $c['phone'],
                        'status' => (string) $c['status'], 'owner' => user_name_of($c['owner_id']), 'notes' => (int) $cnt['n'], 'emails' => (int) $cnt['e'], 'docs' => (int) $cnt['d'], 'created' => (int) $c['created_at']];
                }
            }
            out(['groups' => array_map(static fn ($g) => ['reasons' => $g['reasons'], 'clients' => array_map(static fn ($i) => $info[$i], $g['ids'])], array_slice($groups, 0, 200)), 'total' => count($groups)]);
        }

        case 'client_merge': {
            $u = need_write();
            need_admin($u);
            $in = body();
            $r = clients_merge((int) ($in['keep'] ?? 0), is_array($in['remove'] ?? null) ? $in['remove'] : [], (int) $u['id']);
            out(['ok' => true] + $r);
        }

        case 'dup_ignore': {
            $u = need_write();
            need_admin($u);
            $ids = array_values(array_unique(array_map('intval', (array) (body()['ids'] ?? []))));
            sort($ids);
            $k = implode(',', array_map('strval', $ids));
            $cur = json_decode((string) setting_get('dup_ignored', '[]'), true) ?: [];
            $cur[] = $k;
            setting_set('dup_ignored', json_encode(array_values(array_unique($cur))));
            out(['ok' => true]);
        }

        case 'import_preview': {
            if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
                throw new ApiError('Metoda nije dopuštena.', 405);
            }
            $u = need_user();
            need_admin($u);
            if (!csrf_ok()) {
                throw new ApiError('Sigurnosna provjera nije uspjela. Osvježite stranicu.', 403);
            }
            $f = $_FILES['file'] ?? null;
            if (!$f || $f['error'] !== UPLOAD_ERR_OK) {
                throw new ApiError('Datoteka nije učitana (najviše 5 MB).', 400);
            }
            if ($f['size'] > 5 * 1024 * 1024) {
                throw new ApiError('Datoteka je prevelika (najviše 5 MB).', 413);
            }
            $ext = strtolower(pathinfo((string) $f['name'], PATHINFO_EXTENSION));
            if (!in_array($ext, ['xlsx', 'csv', 'txt'], true)) {
                throw new ApiError('Podržani su .xlsx i .csv. Stariji .xls spremite kao .xlsx ili CSV.', 400);
            }
            [$data, $heads, $fields] = import_parse((string) $f['tmp_name'], $ext === 'xlsx' ? 'xlsx' : 'csv');
            $chk = import_check($data);
            $token = bin2hex(random_bytes(16));
            file_put_contents(storage_dir() . '/import-' . $token . '.json', json_encode(['name' => (string) $f['name'], 'rows' => $chk, 'at' => ms(), 'user' => (int) $u['id']], JSON_UNESCAPED_UNICODE), LOCK_EX);
            foreach (glob(storage_dir() . '/import-*.json') ?: [] as $old) {
                if (filemtime($old) < time() - 86400) {
                    @unlink($old);
                }
            }
            $ok = $dup = $bad = 0;
            foreach ($chk as $r) {
                if ($r['errors']) {
                    $bad++;
                } elseif ($r['dup']) {
                    $dup++;
                } else {
                    $ok++;
                }
            }
            $pick = static fn (array $r) => ['row' => $r['row'], 'name' => (string) ($r['rec']['name'] ?? ''), 'email' => (string) ($r['rec']['email'] ?? ''), 'errors' => $r['errors'], 'dup' => $r['dup'], 'notes' => $r['notes']];
            out(['token' => $token, 'file' => (string) $f['name'], 'columns' => array_map(null, $fields, $heads), 'total' => count($chk), 'ok' => $ok, 'dup' => $dup, 'bad' => $bad,
                'badRows' => array_map($pick, array_slice(array_values(array_filter($chk, static fn ($r) => $r['errors'])), 0, 100)),
                'dupRows' => array_map($pick, array_slice(array_values(array_filter($chk, static fn ($r) => !$r['errors'] && $r['dup'])), 0, 100)),
                'okRows' => array_map($pick, array_slice(array_values(array_filter($chk, static fn ($r) => !$r['errors'] && !$r['dup'])), 0, 30))]);
        }

        case 'import_commit': {
            $u = need_write();
            need_admin($u);
            $in = body();
            $tok = (string) ($in['token'] ?? '');
            if (!preg_match('/^[0-9a-f]{32}$/', $tok) || !is_file(storage_dir() . '/import-' . $tok . '.json')) {
                throw new ApiError('Pregled uvoza je istekao. Učitajte datoteku ponovno.', 404);
            }
            $j = json_decode((string) file_get_contents(storage_dir() . '/import-' . $tok . '.json'), true);
            $owner = active_user_id($in['owner_id'] ?? null, (int) $u['id']);
            $withDup = ($in['mode'] ?? 'skip') === 'all';
            $statusMap = ['novi' => 'novi', 'novi kontakt' => 'novi', 'kontaktiran' => 'kontaktiran', 'ponuda' => 'ponuda', 'ponuda poslana' => 'ponuda', 'pregovori' => 'pregovori', 'aktivni' => 'aktivni', 'dobiven' => 'dobiven', 'izgubljen' => 'izgubljen'];
            $made = $skipDup = $skipBad = 0;
            $t = ms();
            transaction(static function () use ($j, $owner, $withDup, $statusMap, $u, $t, &$made, &$skipDup, &$skipBad): void {
                foreach ($j['rows'] as $r) {
                    if ($r['errors']) {
                        $skipBad++;
                        continue;
                    }
                    if ($r['dup'] && !$withDup) {
                        $skipDup++;
                        continue;
                    }
                    $rec = $r['rec'];
                    $kindRaw = mb_strtolower((string) ($rec['kind'] ?? ''));
                    $kind = preg_match('/osob|fiz/u', $kindRaw) ? 'osoba' : 'tvrtka';
                    $name = mb_substr((string) $rec['name'], 0, 190);
                    $contact = $kind === 'osoba' ? $name : mb_substr((string) ($rec['contact'] ?? ''), 0, 190);
                    $status = $statusMap[mb_strtolower((string) ($rec['status'] ?? ''))] ?? 'novi';
                    $val = (string) ($rec['value'] ?? '');
                    $val = num_hr($val);
                    $svc = f_services((string) ($rec['service'] ?? ''));
                    $ind = mb_substr(trim((string) ($rec['industry'] ?? '')), 0, 120);
                    $note = 'Uvezeno iz datoteke ' . mb_substr((string) $j['name'], 0, 80) . '.' . (!empty($rec['note']) ? "\n" . mb_substr((string) $rec['note'], 0, 1500) : '');
                    run('INSERT INTO clients (kind, oib, name, contact, email, phone, service, industry, value, status, owner_id, next_follow_up, won_at, created_by, created_at, updated_at, camp_active, camp_start, camp_end, camp_value)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 0, NULL, NULL, 0)',
                        [$kind, (string) ($rec['oib_fixed'] ?? ''), $name, $contact, strtolower((string) ($rec['email'] ?? '')), mb_substr((string) ($rec['phone'] ?? ''), 0, 60), $svc, $ind, $val, $status, $owner, $status === 'dobiven' ? $t : null, $u['id'], $t, $t]);
                    $cid = insert_id();
                    record_owner($cid, (int) $owner, $t);
                    run('INSERT INTO notes (client_id, author_id, type, body, created_at) VALUES (?, ?, ?, ?, ?)', [$cid, $u['id'], 'note', $note, $t]);
                    $made++;
                }
            });
            @unlink(storage_dir() . '/import-' . $tok . '.json');
            audit(null, (int) $u['id'], 'import', 'Uvoz iz datoteke ' . $j['name'] . ': uvezeno ' . $made . ', preskočeno duplikata ' . $skipDup . ', s greškom ' . $skipBad);
            out(['ok' => true, 'created' => $made, 'skippedDup' => $skipDup, 'skippedBad' => $skipBad]);
        }

        case 'settings_save': {
            $u = need_write();
            need_admin($u);
            $in = body();
            $subject = f_str($in, 'ar_subject', 200, 'Predmet automatskog odgovora', true);
            if (preg_match('/[\r\n]/', $subject)) {
                throw new ApiError('Predmet mora biti u jednom retku.');
            }
            $text = f_str($in, 'ar_body', 3000, 'Tekst automatskog odgovora', true);
            setting_set('autoreply_enabled', !empty($in['ar_enabled']) ? '1' : '0');
            setting_set('autoreply_subject', $subject);
            setting_set('autoreply_body', $text);
            setting_set('report_enabled', !empty($in['report_enabled']) ? '1' : '0');
            out(['ok' => true]);
        }

        case 'report_preview': {
            need_user();
            need_admin(current_user());
            out(['ok' => true] + report_text(null, ($_GET['period'] ?? '') === 'month'));
        }

        case 'report_send': {
            $u = need_write();
            need_admin($u);
            if (!Mailer::configured()) {
                throw new ApiError('E-mail još nije podešen.', 409);
            }
            try {
                send_report([$u], null, !empty(body()['monthly']));
            } catch (MailException $e) {
                out(['ok' => false, 'error' => $e->getMessage()]);
            }
            out(['ok' => true, 'to' => (string) $u['email']]);
        }

        case 'user_create': {
            $u = need_write();
            need_admin($u);
            $in = body();
            $name = f_str($in, 'name', 120, 'Ime', true);
            $email = strtolower(f_email($in, 'email', true));
            $pass = (string) ($in['password'] ?? '');
            check_password_strength($pass);
            $role = in_array($in['role'] ?? '', ['admin', 'sales'], true) ? $in['role'] : 'sales';
            if (row('SELECT id FROM users WHERE email = ?', [$email])) {
                throw new ApiError('Korisnik s tom e-mail adresom već postoji.');
            }
            run('INSERT INTO users (name, email, pass_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
                [$name, $email, password_hash($pass, PASSWORD_DEFAULT), $role, ms()]);
            out(['ok' => true]);
        }

        case 'user_update': {
            $u = need_write();
            need_admin($u);
            $in = body();
            $t = row('SELECT * FROM users WHERE id = ?', [(int) ($in['id'] ?? 0)]);
            if (!$t) {
                throw new ApiError('Korisnik ne postoji.', 404);
            }
            $name = f_str($in, 'name', 120, 'Ime', true);
            $email = strtolower(f_email($in, 'email', true));
            $role = in_array($in['role'] ?? '', ['admin', 'sales'], true) ? $in['role'] : $t['role'];
            $active = !empty($in['active']) ? 1 : 0;
            if (row('SELECT id FROM users WHERE email = ? AND id <> ?', [$email, $t['id']])) {
                throw new ApiError('Ta e-mail adresa već pripada drugom korisniku.');
            }
            if ((int) $t['id'] === (int) $u['id'] && ($role !== 'admin' || !$active)) {
                throw new ApiError('Ne možete sami sebi ukloniti administratorska prava ili račun deaktivirati.');
            }
            $pass = (string) ($in['password'] ?? '');
            if ($pass !== '') {
                check_password_strength($pass);
                run('UPDATE users SET pass_hash = ? WHERE id = ?', [password_hash($pass, PASSWORD_DEFAULT), $t['id']]);
                trusted_revoke((int) $t['id']);
                audit(null, (int) $u['id'], 'security', 'Administrator je resetirao lozinku korisniku ' . $t['name']);
            }
            run('UPDATE users SET name = ?, email = ?, role = ?, active = ? WHERE id = ?', [$name, $email, $role, $active, $t['id']]);
            out(['ok' => true]);
        }

        case 'password_change': {
            $u = need_write();
            $in = body();
            $full = row('SELECT pass_hash FROM users WHERE id = ?', [$u['id']]);
            if (!password_verify((string) ($in['current'] ?? ''), (string) $full['pass_hash'])) {
                throw new ApiError('Trenutna lozinka nije točna.');
            }
            $new = (string) ($in['password'] ?? '');
            check_password_strength($new);
            run('UPDATE users SET pass_hash = ? WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), $u['id']]);
            trusted_revoke((int) $u['id']);
            out(['ok' => true]);
        }

        default:
            throw new ApiError('Nepoznata radnja.', 404);
    }
} catch (ApiError $e) {
    out(['error' => $e->getMessage()], $e->status);
} catch (Throwable $e) {
    error_log('CRM error: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    out(['error' => 'Greška na poslužitelju. Pokušajte ponovno.'], 500);
}
