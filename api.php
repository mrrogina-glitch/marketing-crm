<?php
declare(strict_types=1);

require __DIR__ . '/lib/core.php';
require __DIR__ . '/lib/mail.php';
require __DIR__ . '/lib/imap.php';
require __DIR__ . '/lib/features.php';

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
        'value' => (float) $r['value'],
        'status' => (string) $r['status'],
        'ownerId' => $r['owner_id'] !== null ? (string) $r['owner_id'] : null,
        'nextFollowUp' => $r['next_follow_up'] ? (string) $r['next_follow_up'] : '',
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
    ];
}

function load_email(string $id): array
{
    $e = row('SELECT * FROM emails WHERE id = ?', [(int) $id]);
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
            $recent = row('SELECT COUNT(*) AS c FROM login_attempts WHERE ip = ? AND created_at > ?', [$ip, ms() - 15 * 60 * 1000]);
            if ((int) $recent['c'] >= 8) {
                throw new ApiError('Previše neuspjelih pokušaja. Pokušajte ponovno za 15 minuta.', 429);
            }
            $email = strtolower(trim((string) ($in['email'] ?? '')));
            $pass = (string) ($in['password'] ?? '');
            $u = $email !== '' ? row('SELECT * FROM users WHERE email = ?', [$email]) : null;
            $hash = $u ? (string) $u['pass_hash'] : password_hash('x', PASSWORD_DEFAULT);
            $ok = password_verify($pass, $hash) && $u && (int) $u['active'] === 1;
            if (!$ok) {
                run('INSERT INTO login_attempts (ip, created_at) VALUES (?, ?)', [$ip, ms()]);
                run('DELETE FROM login_attempts WHERE created_at < ?', [ms() - 24 * 3600 * 1000]);
                throw new ApiError('E-mail ili lozinka nisu točni.', 401);
            }
            start_session();
            session_regenerate_id(true);
            $_SESSION['uid'] = (int) $u['id'];
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
            if (password_needs_rehash((string) $u['pass_hash'], PASSWORD_DEFAULT)) {
                run('UPDATE users SET pass_hash = ? WHERE id = ?', [password_hash($pass, PASSWORD_DEFAULT), $u['id']]);
            }
            run('UPDATE users SET last_login = ? WHERE id = ?', [ms(), $u['id']]);
            out(['ok' => true]);
        }

        case 'logout': {
            need_post();
            start_session();
            if (csrf_ok()) {
                $_SESSION = [];
                session_destroy();
            }
            out(['ok' => true]);
        }

        case 'bootstrap': {
            $u = need_user();
            $a = row('SELECT COUNT(*) AS c, COALESCE(MAX(updated_at), 0) AS m, COALESCE(SUM(value), 0) AS s FROM clients');
            $b = row('SELECT COUNT(*) AS c, COALESCE(MAX(id), 0) AS m FROM notes');
            $em = row('SELECT COUNT(*) AS c, COALESCE(MAX(id), 0) AS m, COALESCE(SUM(CASE WHEN read_at IS NULL THEN 0 ELSE 1 END), 0) AS r, COALESCE(SUM(COALESCE(client_id, 0)), 0) AS k FROM emails');
            $usersOut = users_out($u);
            $imapOn = imap_cfg() !== null;
            $lastSync = (int) (meta_get('imap_last_sync') ?? 0);
            $lastErr = (string) (meta_get('imap_last_error') ?? '');
            $dc = row('SELECT COUNT(*) AS c, COALESCE(MAX(id), 0) AS m FROM documents');
            $templates = array_map(static fn ($t) => ['id' => (string) $t['id'], 'name' => (string) $t['name'], 'subject' => (string) $t['subject'], 'body' => (string) $t['body']],
                rows('SELECT id, name, subject, body FROM templates ORDER BY sort_order, id'));
            $scheduled = array_map('scheduled_out', rows("SELECT * FROM scheduled_emails WHERE status IN ('pending', 'sending') OR (status = 'failed' AND send_at > ?) ORDER BY send_at LIMIT 300", [ms() - 7 * DAY_MS]));
            $reminders = array_map('reminder_out', reminders_due($u));
            $settings = null;
            if ($u['role'] === 'admin') {
                $ar = autoreply_settings();
                $settings = ['autoreply' => $ar, 'reportEnabled' => setting_get('report_enabled', '1') === '1', 'workHours' => work_cfg()['label']];
            }
            $sig = trim((string) ($u['signature'] ?? ''));
            $rev = md5(json_encode([$a, $b, $em, $dc, $usersOut, $u['role'], $u['name'], $sig, $templates, $scheduled, $reminders, $settings, Mailer::configured(), $imapOn, $lastSync, $lastErr !== '']));
            $base = ['rev' => $rev, 'csrf' => csrf_token()];
            if (isset($_GET['rev']) && hash_equals($rev, (string) $_GET['rev'])) {
                out($base + ['unchanged' => true]);
            }
            $clients = array_map('client_out', rows('SELECT * FROM clients ORDER BY id'));
            $notes = array_map('note_out', rows('SELECT id, client_id, author_id, type, subject, body, to_email, created_at FROM notes ORDER BY created_at DESC, id DESC LIMIT 20000'));
            out($base + [
                'me' => ['id' => (string) $u['id'], 'name' => (string) $u['name'], 'email' => (string) $u['email'], 'role' => (string) $u['role'],
                    'signature' => $sig, 'signatureEffective' => effective_signature($u)],
                'users' => $usersOut,
                'clients' => $clients,
                'notes' => $notes,
                'emails' => array_map('email_out', rows('SELECT id, direction, from_email, from_name, to_email, subject, preview, attachments, auto, msg_date, client_id, read_at FROM emails ORDER BY msg_date DESC, id DESC LIMIT 600')),
                'docs' => array_map('doc_out', rows('SELECT * FROM documents ORDER BY id DESC LIMIT 3000')),
                'templates' => $templates,
                'scheduled' => $scheduled,
                'reminders' => $reminders,
                'settings' => $settings,
                'mail' => [
                    'enabled' => Mailer::configured(),
                    'from' => Mailer::fromEmail(),
                    'imap' => $imapOn,
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
            $service = f_str($in, 'service', 120, 'Usluga');
            $value = f_value($in['value'] ?? 0);
            $status = f_status($in['status'] ?? 'novi');
            $owner = active_user_id($in['owner_id'] ?? null, (int) $u['id']);
            $fu = f_date($in['next_follow_up'] ?? '');
            $note = f_text($in, 'note', 'Prva bilješka');
            $mailId = !empty($in['email_id']) ? (int) load_email((string) $in['email_id'])['id'] : null;
            $t = ms();
            $id = transaction(static function () use ($kind, $oib, $name, $contact, $email, $phone, $service, $value, $status, $owner, $fu, $note, $t, $u): int {
                run('INSERT INTO clients (kind, oib, name, contact, email, phone, service, value, status, owner_id, next_follow_up, won_at, created_by, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [$kind, $oib, $name, $contact, $email, $phone, $service, $value, $status, $owner, $fu, $status === 'dobiven' ? $t : null, $u['id'], $t, $t]);
                $cid = insert_id();
                run('INSERT INTO notes (client_id, author_id, type, body, created_at) VALUES (?, ?, ?, ?, ?)', [$cid, $u['id'], 'note', $note, $t]);
                return $cid;
            });
            link_emails_to_client($id, strtolower($email));
            if ($mailId !== null) {
                run('UPDATE emails SET client_id = ? WHERE id = ? AND client_id IS NULL', [$id, $mailId]);
                sync_document_clients();
            }
            out(['ok' => true, 'id' => (string) $id]);
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
            $service = f_str($in, 'service', 120, 'Usluga');
            $value = f_value($in['value'] ?? 0);
            $owner = active_user_id($in['owner_id'] ?? null, (int) ($c['owner_id'] ?? $u['id']));
            $fu = f_date($in['next_follow_up'] ?? '');
            run('UPDATE clients SET kind = ?, oib = ?, name = ?, contact = ?, email = ?, phone = ?, service = ?, value = ?, owner_id = ?, next_follow_up = ?, updated_at = ? WHERE id = ?',
                [$kind, $oib, $name, $contact, $email, $phone, $service, $value, $owner, $fu, ms(), $c['id']]);
            link_emails_to_client((int) $c['id'], strtolower($email));
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
                run('DELETE FROM clients WHERE id = ?', [$c['id']]);
            });
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
            transaction(static function () use ($c, $u, $type, $text, $fu, $t): void {
                run('INSERT INTO notes (client_id, author_id, type, body, created_at) VALUES (?, ?, ?, ?, ?)', [$c['id'], $u['id'], $type, $text, $t]);
                if ($fu) {
                    run('UPDATE clients SET next_follow_up = ?, updated_at = ? WHERE id = ?', [$fu, $t, $c['id']]);
                } else {
                    run('UPDATE clients SET updated_at = ? WHERE id = ?', [$t, $c['id']]);
                }
            });
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
            $t = ms();
            $label = ['novi' => 'Novi kontakt', 'kontaktiran' => 'Kontaktiran', 'ponuda' => 'Ponuda poslana', 'pregovori' => 'Pregovori', 'dobiven' => 'Dobiven', 'izgubljen' => 'Izgubljen'];
            transaction(static function () use ($c, $u, $new, $text, $t, $label): void {
                run('UPDATE clients SET status = ?, won_at = ?, updated_at = ? WHERE id = ?',
                    [$new, $new === 'dobiven' ? $t : $c['won_at'], $t, $c['id']]);
                run('INSERT INTO notes (client_id, author_id, type, body, created_at) VALUES (?, ?, ?, ?, ?)',
                    [$c['id'], $u['id'], 'status', $label[$c['status']] . ' → ' . $label[$new] . "\n" . $text, $t]);
            });
            out(['ok' => true]);
        }

        case 'email_send': {
            $u = need_write();
            $in = body();
            $c = load_client((string) ($in['client_id'] ?? ''));
            $to = f_email($in, 'to', true);
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
            out(['ok' => true, 'new' => $r['new'], 'skipped' => $r['skipped']]);
        }

        case 'mail_test': {
            $u = need_write();
            need_admin($u);
            try {
                Mailer::send((string) $u['email'], 'Probni e-mail iz Prodajnog stola', "Ako ovo čitate, slanje e-maila radi.\n\nPoslano: " . date('d.m.Y. H:i'), (string) $u['name']);
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
            out(['ok' => true]);
        }

        case 'signature_save': {
            $u = need_write();
            $sig = f_str(body(), 'signature', 1000, 'Potpis');
            run('UPDATE users SET signature = ? WHERE id = ?', [$sig !== '' ? $sig : null, $u['id']]);
            out(['ok' => true]);
        }

        case 'template_save': {
            $u = need_write();
            need_admin($u);
            $in = body();
            $name = f_str($in, 'name', 120, 'Naziv predloška', true);
            $subject = f_str($in, 'subject', 255, 'Predmet', true);
            $text = f_str($in, 'body', 10000, 'Tekst predloška', true);
            if (!empty($in['id'])) {
                if (run('UPDATE templates SET name = ?, subject = ?, body = ?, updated_at = ? WHERE id = ?', [$name, $subject, $text, ms(), (int) $in['id']]) === 0 && !row('SELECT id FROM templates WHERE id = ?', [(int) $in['id']])) {
                    throw new ApiError('Predložak ne postoji.', 404);
                }
            } else {
                $max = row('SELECT COALESCE(MAX(sort_order), 0) AS m FROM templates');
                run('INSERT INTO templates (name, subject, body, sort_order, updated_at) VALUES (?, ?, ?, ?, ?)', [$name, $subject, $text, (int) $max['m'] + 1, ms()]);
            }
            out(['ok' => true]);
        }

        case 'template_delete': {
            $u = need_write();
            need_admin($u);
            run('DELETE FROM templates WHERE id = ?', [(int) (body()['id'] ?? 0)]);
            out(['ok' => true]);
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
