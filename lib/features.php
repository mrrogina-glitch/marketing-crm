<?php
declare(strict_types=1);

/**
 * Features built on top of the mailbox: signatures, documents (attachments), scheduled sending,
 * "no reply" reminders, out-of-hours auto reply and the weekly report.
 */

const DAY_MS = 86400000;

/* ---------- settings (small key/value store in the database) ---------- */

function setting_get(string $k, ?string $default = null): ?string
{
    $r = row('SELECT v FROM settings WHERE k = ?', [$k]);
    return $r ? (string) $r['v'] : $default;
}

function setting_set(string $k, string $v): void
{
    run('DELETE FROM settings WHERE k = ?', [$k]);
    run('INSERT INTO settings (k, v) VALUES (?, ?)', [$k, $v]);
}

/* ---------- working hours ---------- */

/** @return array{days:int[],start:int,end:int,label:string} start and end are minutes since midnight */
function work_cfg(): array
{
    $days = cfg('work.days', [1, 2, 3, 4, 5]);
    $days = is_array($days) ? array_map('intval', $days) : [1, 2, 3, 4, 5];
    $toMin = static function ($v, int $def): int {
        return preg_match('/^(\d{1,2}):(\d{2})$/', (string) $v, $m) ? ((int) $m[1]) * 60 + (int) $m[2] : $def;
    };
    $start = $toMin(cfg('work.start', '08:00'), 480);
    $end = $toMin(cfg('work.end', '16:00'), 960);
    $names = [1 => 'ponedjeljak', 2 => 'utorak', 3 => 'srijeda', 4 => 'četvrtak', 5 => 'petak', 6 => 'subota', 7 => 'nedjelja'];
    $first = $days ? ($names[min($days)] ?? '') : '';
    $last = $days ? ($names[max($days)] ?? '') : '';
    $fmt = static fn (int $m): string => sprintf('%02d:%02d', intdiv($m, 60), $m % 60);
    return ['days' => $days, 'start' => $start, 'end' => $end,
        'label' => $first . '–' . $last . ', ' . $fmt($start) . '–' . $fmt($end)];
}

function is_work_time(int $tsMs): bool
{
    $w = work_cfg();
    $ts = intdiv($tsMs, 1000);
    $mins = (int) date('G', $ts) * 60 + (int) date('i', $ts);
    return in_array((int) date('N', $ts), $w['days'], true) && $mins >= $w['start'] && $mins < $w['end'];
}

/* ---------- signature ---------- */

function company_name(): string
{
    return trim((string) cfg('mail.from_name', ''));
}

function default_signature(array $u): string
{
    $lines = [trim((string) $u['name'])];
    if (company_name() !== '') {
        $lines[] = company_name();
    }
    if (Mailer::fromEmail() !== '') {
        $lines[] = Mailer::fromEmail();
    }
    return implode("\n", $lines);
}

function effective_signature(array $u): string
{
    $s = trim((string) ($u['signature'] ?? ''));
    return $s !== '' ? $s : default_signature($u);
}

function with_signature(string $text, array $u): string
{
    return rtrim($text) . "\n\n" . effective_signature($u);
}

/* ---------- documents ---------- */

const DOC_MAX_BYTES = 10 * 1024 * 1024;
const MAIL_ATTACH_MAX_BYTES = 15 * 1024 * 1024;

function storage_dir(): string
{
    $dir = rtrim((string) cfg('app.storage', APP_ROOT . '/storage'), '/\\');
    if (!is_dir($dir)) {
        @mkdir($dir, 0750, true);
    }
    if (!is_file($dir . '/.htaccess')) {
        @file_put_contents($dir . '/.htaccess', "Require all denied\n");
    }
    if (!is_dir($dir) || !is_writable($dir)) {
        throw new ApiError('Mapa za dokumente nije dostupna za pisanje. Obavijestite administratora.', 500);
    }
    return $dir;
}

function safe_filename(string $name): string
{
    $name = str_replace('\\', '/', $name);
    $name = basename($name);
    $name = preg_replace('/[\x00-\x1F\x7F<>:"|?*]/u', '', $name) ?? '';
    $name = trim($name, " .\t");
    $name = mb_substr($name, 0, 150);
    return $name !== '' ? $name : 'datoteka';
}

function store_document(?int $clientId, ?int $emailId, string $name, string $mime, string $data, ?int $userId): int
{
    $stored = bin2hex(random_bytes(16));
    if (@file_put_contents(storage_dir() . '/' . $stored, $data, LOCK_EX) === false) {
        throw new ApiError('Spremanje datoteke nije uspjelo.', 500);
    }
    $mime = preg_match('#^[\w.+-]+/[\w.+-]+$#', $mime) ? mb_substr($mime, 0, 120) : 'application/octet-stream';
    run('INSERT INTO documents (client_id, email_id, filename, mime, size, stored, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [$clientId, $emailId, safe_filename($name), $mime, strlen($data), $stored, $userId, ms()]);
    return insert_id();
}

function doc_out(array $r): array
{
    return [
        'id' => (string) $r['id'],
        'clientId' => $r['client_id'] !== null ? (string) $r['client_id'] : null,
        'emailId' => $r['email_id'] !== null ? (string) $r['email_id'] : null,
        'name' => (string) $r['filename'],
        'size' => (int) $r['size'],
        'by' => $r['uploaded_by'] !== null ? (string) $r['uploaded_by'] : null,
        'createdAt' => (int) $r['created_at'],
    ];
}

function delete_document_rows(array $docs): void
{
    foreach ($docs as $d) {
        if (preg_match('/^[0-9a-f]{32}$/', (string) $d['stored'])) {
            @unlink(storage_dir() . '/' . $d['stored']);
        }
        run('DELETE FROM documents WHERE id = ?', [$d['id']]);
    }
}

/** Documents of incoming mail follow the mail when it is linked to a client or unlinked. */
function sync_document_clients(): void
{
    run('UPDATE documents SET client_id = (SELECT e.client_id FROM emails e WHERE e.id = documents.email_id) WHERE email_id IS NOT NULL');
}

/** @return list<array{0:string,1:string,2:string}> */
function load_attachments(array $docIds, ?int $clientId): array
{
    $ids = array_values(array_unique(array_filter(array_map('intval', $docIds))));
    if (count($ids) > 10) {
        throw new ApiError('Najviše 10 privitaka po poruci.');
    }
    $out = [];
    $total = 0;
    foreach ($ids as $id) {
        $d = row('SELECT * FROM documents WHERE id = ?', [$id]);
        if (!$d || ($clientId !== null && (int) $d['client_id'] !== $clientId)) {
            throw new ApiError('Odabrani privitak nije pronađen.');
        }
        $total += (int) $d['size'];
        if ($total > MAIL_ATTACH_MAX_BYTES) {
            throw new ApiError('Privici zajedno smiju imati najviše 15 MB.');
        }
        $data = preg_match('/^[0-9a-f]{32}$/', (string) $d['stored']) ? @file_get_contents(storage_dir() . '/' . $d['stored']) : false;
        if ($data === false) {
            throw new ApiError('Datoteka "' . $d['filename'] . '" nedostaje na poslužitelju.', 500);
        }
        $out[] = [(string) $d['filename'], (string) $d['mime'], $data];
    }
    return $out;
}

/* ---------- sending ---------- */

/**
 * Sends one message from the shared mailbox and records it (emails table and the Sent folder copy).
 * $u is the salesperson; null means a system message (auto reply).
 * The signature is NOT added here; callers add it with with_signature().
 * @return int id of the stored e-mail
 */
function send_and_store(?array $u, string $to, string $subject, string $text, ?int $clientId, ?string $inReplyTo = null, array $docIds = [], ?int $remindDays = null, bool $auto = false): int
{
    if (!Mailer::configured()) {
        throw new ApiError('E-mail još nije podešen. Administrator ga podešava u config.php.', 409);
    }
    if ($u !== null) {
        $hour = row("SELECT COUNT(*) AS c FROM emails WHERE user_id = ? AND direction = 'out' AND auto = 0 AND created_at > ?", [$u['id'], ms() - 3600 * 1000]);
        if ((int) $hour['c'] >= 60) {
            throw new ApiError('Dosegnuto je ograničenje od 60 e-mailova na sat.', 429);
        }
    }
    $attachments = $docIds ? load_attachments($docIds, $clientId) : [];
    $extra = $inReplyTo ? ['In-Reply-To' => $inReplyTo, 'References' => $inReplyTo] : [];
    if ($auto) {
        $extra['Auto-Submitted'] = 'auto-replied';
        $extra['X-Auto-Response-Suppress'] = 'All';
        $extra['Precedence'] = 'bulk';
    }
    try {
        $sent = Mailer::send($to, $subject, $text, $u ? (string) $u['name'] : null, $extra, $attachments);
    } catch (MailException $e) {
        error_log('CRM mail: ' . $e->getMessage());
        throw new ApiError('Slanje nije uspjelo. Provjerite adresu primatelja ili obavijestite administratora.', 502);
    }
    if ($clientId === null) {
        $clientId = client_for_email(strtolower($to));
    }
    $names = $attachments ? mb_substr(implode(' | ', array_map(static fn ($a) => $a[0], $attachments)), 0, 500) : null;
    $id = store_outgoing($sent['message_id'], $to, $subject, $text, $clientId, $u ? (int) $u['id'] : null,
        $inReplyTo ? trim($inReplyTo, '<> ') : null, Mailer::fromEmail(), $u ? (string) $u['name'] : company_name(), $names, $auto, $remindDays);
    sent_copy($sent['raw']);
    return $id;
}

/** Logs a sent client e-mail as a note (every contact must leave a trace) and fills in a missing client address. */
function record_client_email(array $c, array $u, string $to, string $subject, string $text, bool $bulk = false): void
{
    $t = ms();
    transaction(static function () use ($c, $u, $to, $subject, $text, $t, $bulk): void {
        run('INSERT INTO notes (client_id, author_id, type, subject, body, to_email, created_at, bulk) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$c['id'], $u['id'], 'email', $subject, $text, $to, $t, $bulk ? 1 : 0]);
        if ($c['email'] === '') {
            run('UPDATE clients SET email = ?, updated_at = ? WHERE id = ?', [$to, $t, $c['id']]);
        } else {
            run('UPDATE clients SET updated_at = ? WHERE id = ?', [$t, $c['id']]);
        }
    });
}

/* ---------- scheduled sending ---------- */

const BULK_BURST = 5;  // najviše toliko grupnih poruka po jednom pokretanju

/** Ograničenja grupne pošte: 45 na sat, termin 02–19 sati (config.php 'bulk' služi samo za testiranje). */
function bulk_cfg(string $k): int
{
    $def = ['per_hour' => 45, 'from' => 2, 'to' => 19];
    return (int) cfg('bulk.' . $k, $def[$k]);
}

function bulk_window_open(?int $tsMs = null): bool
{
    $h = (int) date('G', intdiv($tsMs ?? ms(), 1000));
    return $h >= bulk_cfg('from') && $h < bulk_cfg('to');
}

function bulk_sent_last_hour(): int
{
    return (int) row("SELECT COUNT(*) AS c FROM scheduled_emails WHERE bulk = 1 AND status = 'sent' AND sent_at > ?", [ms() - 3600000])['c'];
}

/** Koliko se grupnih poruka smije poslati upravo sada (0 izvan termina ili kad je sat pun). */
function bulk_quota_now(): int
{
    return bulk_window_open() ? max(0, bulk_cfg('per_hour') - bulk_sent_last_hour()) : 0;
}

/** Procjena kada će se poslati zadnja od $n grupnih poruka (ms). */
function bulk_eta(int $n): int
{
    $t = intdiv(ms(), 1000);
    if ($n <= 0) {
        return $t * 1000;
    }
    $left = $n;
    $first = true;
    for ($i = 0; $i < 24 * 60 && $left > 0; $i++) {
        if (bulk_window_open($t * 1000)) {
            $cap = $first ? max(0, bulk_cfg('per_hour') - bulk_sent_last_hour()) : bulk_cfg('per_hour');
            $left -= $cap;
            $first = false;
            if ($left <= 0) {
                $frac = max(1, $cap + $left) / max(1, $cap);
                return (int) (($t + 3600 * $frac) * 1000);
            }
            $t += 3600;
        } else {
            $d = new DateTimeImmutable('@' . $t);
            $d = $d->setTimezone(new DateTimeZone(date_default_timezone_get()));
            $next = $d->setTime(bulk_cfg('from'), 0);
            if ($next->getTimestamp() <= $t) {
                $next = $next->modify('+1 day');
            }
            $t = $next->getTimestamp();
            $first = false;
        }
    }
    return $t * 1000;
}

function scheduled_out(array $r): array
{
    return [
        'id' => (string) $r['id'],
        'userId' => (string) $r['user_id'],
        'clientId' => (string) $r['client_id'],
        'to' => (string) $r['to_email'],
        'subject' => (string) $r['subject'],
        'sendAt' => (int) $r['send_at'],
        'status' => (string) $r['status'],
        'error' => (string) ($r['error'] ?? ''),
    ];
}

/** Sends everything that is due. Safe to call often; each message is claimed before sending. */
function process_scheduled(): int
{
    run("UPDATE scheduled_emails SET status = 'failed', error = ? WHERE status = 'sending' AND send_at < ?",
        ['Slanje je prekinuto. Provjerite mapu Poslano i po potrebi zakažite ponovno.', ms() - 1800000]);
    $due = rows("SELECT * FROM scheduled_emails WHERE status = 'pending' AND bulk = 0 AND send_at <= ? ORDER BY send_at LIMIT 20", [ms()]);
    // grupna pošta: najviše bulk_cfg('per_hour') na sat i samo u terminu bulk_cfg('from')–bulk_cfg('to') sati
    $quota = min(BULK_BURST, bulk_quota_now());
    if ($quota > 0) {
        $due = array_merge($due, rows("SELECT * FROM scheduled_emails WHERE status = 'pending' AND bulk = 1 AND send_at <= ? ORDER BY send_at, id LIMIT " . (int) $quota, [ms()]));
    }
    $sent = 0;
    foreach ($due as $s) {
        if (run("UPDATE scheduled_emails SET status = 'sending' WHERE id = ? AND status = 'pending'", [$s['id']]) !== 1) {
            continue;
        }
        $fail = static function (string $why) use ($s): void {
            run("UPDATE scheduled_emails SET status = 'failed', error = ? WHERE id = ?", [mb_substr($why, 0, 250), $s['id']]);
        };
        $retry = static function (int $delayMs, bool $count, string $why) use ($s, $fail): void {
            $attempts = (int) $s['attempts'] + ($count ? 1 : 0);
            if ($attempts >= 3) {
                run("UPDATE scheduled_emails SET status = 'failed', attempts = ?, error = ? WHERE id = ?", [$attempts, mb_substr($why, 0, 250), $s['id']]);
                return;
            }
            run("UPDATE scheduled_emails SET status = 'pending', attempts = ?, send_at = ?, error = ? WHERE id = ?",
                [$attempts, ms() + $delayMs, mb_substr($why, 0, 250), $s['id']]);
        };
        $u = row('SELECT * FROM users WHERE id = ?', [$s['user_id']]);
        $c = row('SELECT * FROM clients WHERE id = ?', [$s['client_id']]);
        if (!$u || (int) $u['active'] !== 1 || !$c) {
            $fail('Korisnik ili klijent više ne postoji.');
            continue;
        }
        try {
            $docIds = array_filter(array_map('intval', explode(',', (string) $s['doc_ids'])));
            send_and_store($u, (string) $s['to_email'], (string) $s['subject'], with_signature((string) $s['body'], $u), (int) $c['id'], null, $docIds,
                $s['remind_days'] !== null ? (int) $s['remind_days'] : null);
            // mark as sent first: a failure while writing the note must never cause a second send
            run("UPDATE scheduled_emails SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?", [ms(), $s['id']]);
            $sent++;
            try {
                record_client_email($c, $u, (string) $s['to_email'], (string) $s['subject'], (string) $s['body'], (int) $s['bulk'] === 1);
            } catch (Throwable $e) {
                error_log('CRM scheduled note: ' . $e->getMessage());
            }
        } catch (ApiError $e) {
            if ($e->status === 429) {
                $retry(600000, false, $e->getMessage());
            } elseif ($e->status === 502) {
                $retry(300000, true, $e->getMessage());
            } else {
                $fail($e->getMessage());
            }
        } catch (Throwable $e) {
            error_log('CRM scheduled: ' . $e->getMessage());
            $retry(300000, true, 'Neočekivana greška pri slanju.');
        }
    }
    return $sent;
}

/* ---------- "no reply" reminders ---------- */

/**
 * Sent client mails that asked for a reminder, are old enough and got no reply.
 * @return list<array<string,mixed>>
 */
function reminders_due(?array $viewer = null): array
{
    $now = ms();
    $all = rows(
        "SELECT e.id, e.client_id, e.subject, e.msg_date, e.user_id, e.remind_days, e.remind_notified_at, c.name AS client_name, c.owner_id
           FROM emails e JOIN clients c ON c.id = e.client_id
          WHERE e.direction = 'out' AND e.auto = 0 AND e.remind_days IS NOT NULL AND e.remind_done_at IS NULL
            AND c.status NOT IN ('dobiven', 'izgubljen')
            AND e.msg_date + e.remind_days * " . DAY_MS . " <= " . (int) $now . "
            AND NOT EXISTS (SELECT 1 FROM emails r WHERE r.direction = 'in' AND r.client_id = e.client_id AND r.msg_date > e.msg_date)
            AND NOT EXISTS (SELECT 1 FROM emails o WHERE o.direction = 'out' AND o.auto = 0 AND o.client_id = e.client_id
                            AND (o.msg_date > e.msg_date OR (o.msg_date = e.msg_date AND o.id > e.id)))
          ORDER BY e.msg_date");
    if ($viewer !== null && $viewer['role'] !== 'admin') {
        $me = (int) $viewer['id'];
        $all = array_values(array_filter($all, static fn ($r) => (int) $r['owner_id'] === $me || (int) $r['user_id'] === $me));
    }
    return $all;
}

function reminder_out(array $r): array
{
    return [
        'id' => (string) $r['id'],
        'clientId' => (string) $r['client_id'],
        'subject' => (string) $r['subject'],
        'sentAt' => (int) $r['msg_date'],
        'userId' => $r['user_id'] !== null ? (string) $r['user_id'] : null,
        'days' => (int) floor((ms() - (int) $r['msg_date']) / DAY_MS),
    ];
}

/** One e-mail per salesperson with the clients that have not answered yet (sent once per reminder). */
function notify_reminders(): int
{
    $by = [];
    foreach (reminders_due() as $r) {
        if ($r['remind_notified_at'] !== null) {
            continue;
        }
        $uid = $r['owner_id'] !== null ? (int) $r['owner_id'] : (int) $r['user_id'];
        $by[$uid][] = $r;
    }
    $count = 0;
    $url = trim((string) cfg('app.url', ''));
    foreach ($by as $uid => $list) {
        $u = row('SELECT * FROM users WHERE id = ? AND active = 1', [$uid]);
        if (!$u || !Mailer::configured()) {
            continue;
        }
        $lines = [];
        foreach ($list as $r) {
            $days = (int) floor((ms() - (int) $r['msg_date']) / DAY_MS);
            $lines[] = '- ' . $r['client_name'] . ': "' . $r['subject'] . '", poslano ' . date('d.m.Y.', (int) ($r['msg_date'] / 1000)) . ' (prije ' . $days . ' d)';
        }
        $text = "Pozdrav " . explode(' ', trim((string) $u['name']))[0] . ",\n\nsljedeći klijenti nisu odgovorili na Vaš e-mail:\n\n" . implode("\n", $lines)
            . "\n\nU aplikaciji VIP MARKET (Pregled > Čekaju odgovor) možete im poslati podsjetnik, odgoditi ili odbaciti podsjetnik."
            . ($url !== '' ? "\n" . $url : '');
        try {
            Mailer::send((string) $u['email'], 'Podsjetnik: ' . count($list) . ' ' . (count($list) === 1 ? 'klijent nije odgovorio' : 'klijenata nije odgovorilo'), $text, null,
                ['Auto-Submitted' => 'auto-generated']);
        } catch (MailException $e) {
            error_log('CRM reminder mail: ' . $e->getMessage());
            continue;
        }
        foreach ($list as $r) {
            run('UPDATE emails SET remind_notified_at = ? WHERE id = ?', [ms(), $r['id']]);
        }
        $count++;
    }
    return $count;
}

/* ---------- out-of-hours auto reply ---------- */

function autoreply_defaults(): array
{
    $w = work_cfg();
    return [
        'enabled' => '1',
        'subject' => 'Automatski odgovor: {{predmet}}',
        'body' => "Poštovani,\n\nhvala Vam na poruci. Trenutno smo izvan radnog vremena (" . $w['label'] . "), a Vašu poruku smo zaprimili.\n\nOdgovorit ćemo Vam prvi sljedeći radni dan.\n\nLijep pozdrav,\n" . (company_name() !== '' ? company_name() : ''),
    ];
}

function autoreply_settings(): array
{
    $d = autoreply_defaults();
    return [
        'enabled' => setting_get('autoreply_enabled', $d['enabled']) === '1',
        'subject' => setting_get('autoreply_subject', $d['subject']),
        'body' => setting_get('autoreply_body', $d['body']),
    ];
}

/**
 * Replies once per sender per day to fresh mail that arrived outside working hours.
 * Never answers automatic mail, mailing lists, bounces, no-reply addresses or our own mailbox.
 * @param array<string,string> $h parsed lower-case headers of the incoming message
 */
function maybe_auto_reply(array $h, string $fromEmail, string $subject, string $messageId, int $dateMs, ?int $clientId): bool
{
    $cfgA = autoreply_settings();
    if (!$cfgA['enabled'] || !Mailer::configured() || !filter_var($fromEmail, FILTER_VALIDATE_EMAIL)) {
        return false;
    }
    if ($dateMs < ms() - 12 * 3600 * 1000 || is_work_time($dateMs)) {
        return false;
    }
    if (strtolower($fromEmail) === strtolower(Mailer::fromEmail())) {
        return false;
    }
    if (preg_match('/(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce|notification|newsletter)/i', $fromEmail)) {
        return false;
    }
    $as = strtolower(trim($h['auto-submitted'] ?? ''));
    if ($as !== '' && $as !== 'no') {
        return false;
    }
    if (preg_match('/^(bulk|list|junk|auto_reply)$/i', trim($h['precedence'] ?? ''))) {
        return false;
    }
    foreach (['list-id', 'list-unsubscribe', 'x-auto-response-suppress', 'x-autoreply', 'x-autorespond', 'x-failed-recipients'] as $k) {
        if (isset($h[$k])) {
            return false;
        }
    }
    if (isset($h['return-path']) && preg_match('/^<\s*>$/', trim($h['return-path']))) {
        return false;
    }
    $dup = row("SELECT id FROM emails WHERE direction = 'out' AND auto = 1 AND LOWER(to_email) = ? AND created_at > ?", [strtolower($fromEmail), ms() - DAY_MS]);
    if ($dup) {
        return false;
    }
    $subj = str_replace('{{predmet}}', $subject !== '' ? $subject : '(bez predmeta)', $cfgA['subject']);
    $subj = trim(preg_replace('/[\r\n]+/', ' ', $subj) ?? '');
    try {
        send_and_store(null, $fromEmail, mb_substr($subj, 0, 255), (string) $cfgA['body'], $clientId, '<' . $messageId . '>', [], null, true);
        return true;
    } catch (Throwable $e) {
        error_log('CRM auto reply: ' . $e->getMessage());
        return false;
    }
}

/* ---------- weekly report ---------- */

/** @return array{0:int,1:int,2:string} start (inclusive) and end (exclusive) in ms of the previous full Mon-Sun week, plus a label */
function report_period(?int $now = null, bool $monthly = false): array
{
    $tz = new DateTimeZone(date_default_timezone_get());
    $d = (new DateTimeImmutable('@' . ($now ?? time())))->setTimezone($tz);
    if ($monthly) {
        $firstThis = $d->modify('first day of this month')->setTime(0, 0);
        $from = $firstThis->modify('first day of previous month');
        return [$from->getTimestamp() * 1000, $firstThis->getTimestamp() * 1000, $from->format('m.Y.')];
    }
    $monThis = $d->modify('monday this week')->setTime(0, 0);
    $from = $monThis->modify('-7 days');
    $label = $from->format('d.m.') . ' – ' . $monThis->modify('-1 day')->format('d.m.Y.');
    return [$from->getTimestamp() * 1000, $monThis->getTimestamp() * 1000, $label];
}

function eur_text(float $v): string
{
    return number_format($v, 0, ',', '.') . ' €';
}

function report_text(?int $now = null, bool $monthly = false): array
{
    [$from, $to, $label] = report_period($now, $monthly);
    $title = $monthly ? 'Mjesečni izvještaj prodaje' : 'Tjedni izvještaj prodaje';
    $users = rows('SELECT id, name FROM users WHERE active = 1 ORDER BY name');
    $today = date('Y-m-d', $now ?? time());
    $lastNote = [];
    foreach (rows('SELECT client_id, MAX(created_at) AS m FROM notes GROUP BY client_id') as $r) {
        $lastNote[(int) $r['client_id']] = (int) $r['m'];
    }
    foreach (rows("SELECT client_id, MAX(msg_date) AS m FROM emails WHERE direction = 'in' AND client_id IS NOT NULL GROUP BY client_id") as $r) {
        $lastNote[(int) $r['client_id']] = max($lastNote[(int) $r['client_id']] ?? 0, (int) $r['m']);
    }
    $waiting = reminders_due();
    $cnt = static fn (string $sql, array $p): int => (int) (row($sql, $p)['c'] ?? 0);
    $tot = ['new' => 0, 'won' => 0, 'wonv' => 0.0, 'acts' => 0, 'sent' => 0, 'replies' => 0];
    $blocks = [];
    foreach ($users as $u) {
        $id = (int) $u['id'];
        $new = $cnt('SELECT COUNT(*) AS c FROM clients WHERE owner_id = ? AND created_at >= ? AND created_at < ?', [$id, $from, $to]);
        $acts = $cnt("SELECT COUNT(*) AS c FROM notes WHERE author_id = ? AND type IN ('note','call','meeting','status') AND created_at >= ? AND created_at < ?", [$id, $from, $to]);
        $calls = $cnt("SELECT COUNT(*) AS c FROM notes WHERE author_id = ? AND type = 'call' AND created_at >= ? AND created_at < ?", [$id, $from, $to]);
        $meets = $cnt("SELECT COUNT(*) AS c FROM notes WHERE author_id = ? AND type = 'meeting' AND created_at >= ? AND created_at < ?", [$id, $from, $to]);
        $sent = $cnt("SELECT COUNT(*) AS c FROM emails WHERE user_id = ? AND direction = 'out' AND auto = 0 AND msg_date >= ? AND msg_date < ?", [$id, $from, $to]);
        $rep = $cnt("SELECT COUNT(*) AS c FROM emails e JOIN clients c ON c.id = e.client_id WHERE c.owner_id = ? AND e.direction = 'in' AND e.msg_date >= ? AND e.msg_date < ?", [$id, $from, $to]);
        $won = row("SELECT COUNT(*) AS c, COALESCE(SUM(value), 0) AS v FROM clients WHERE owner_id = ? AND status = 'dobiven' AND won_at >= ? AND won_at < ?", [$id, $from, $to]);
        $open = row("SELECT COUNT(*) AS c, COALESCE(SUM(value), 0) AS v FROM clients WHERE owner_id = ? AND status IN ('novi','kontaktiran','ponuda','pregovori')", [$id]);
        $late = $cnt("SELECT COUNT(*) AS c FROM clients WHERE owner_id = ? AND status IN ('novi','kontaktiran','ponuda','pregovori') AND next_follow_up IS NOT NULL AND next_follow_up < ?", [$id, $today]);
        $stale = 0;
        foreach (rows("SELECT id, created_at FROM clients WHERE owner_id = ? AND status IN ('novi','kontaktiran','ponuda','pregovori')", [$id]) as $c) {
            $last = max($lastNote[(int) $c['id']] ?? 0, (int) $c['created_at']);
            if ($last < ($now ?? time()) * 1000 - 14 * DAY_MS) {
                $stale++;
            }
        }
        $wait = count(array_filter($waiting, static fn ($r) => (int) $r['owner_id'] === $id));
        $tot['new'] += $new;
        $tot['won'] += (int) $won['c'];
        $tot['wonv'] += (float) $won['v'];
        $tot['acts'] += $acts;
        $tot['sent'] += $sent;
        $tot['replies'] += $rep;
        $attention = [];
        if ($late) {
            $attention[] = $late . ' kasni s kontaktom';
        }
        if ($stale) {
            $attention[] = $stale . ' bez kontakta 14+ dana';
        }
        if ($wait) {
            $attention[] = $wait . ' čeka odgovor klijenta';
        }
        $done = [];
        foreach (rows("SELECT name, service, value FROM clients WHERE owner_id = ? AND status = 'dobiven' AND won_at >= ? AND won_at < ? ORDER BY won_at", [$id, $from, $to]) as $w) {
            $done[] = '    - ' . $w['name'] . ': ' . ($w['service'] !== '' ? $w['service'] : 'usluga nije upisana') . ((float) $w['value'] > 0 ? ' (' . eur_text((float) $w['value']) . ')' : '');
        }
        $blocks[] = $u['name'] . "\n"
            . '  izvršene usluge (' . count($done) . '):' . ($done ? "\n" . implode("\n", $done) : ' nema') . "\n"
            . '  novi klijenti: ' . $new . ', aktivnosti: ' . $acts . ' (pozivi ' . $calls . ', sastanci ' . $meets . ")\n"
            . '  e-mailovi poslano: ' . $sent . ', odgovora primljeno: ' . $rep . "\n"
            . '  dobiveno: ' . (int) $won['c'] . ((int) $won['c'] ? ' (' . eur_text((float) $won['v']) . ')' : '') . "\n"
            . '  u radu: ' . (int) $open['c'] . ' klijenata, ' . eur_text((float) $open['v']) . "\n"
            . '  pažnja: ' . ($attention ? implode(', ', $attention) : 'sve u redu');
    }
    $unlinked = $cnt("SELECT COUNT(*) AS c FROM emails WHERE deleted_at IS NULL AND direction = 'in' AND client_id IS NULL AND msg_date >= ? AND msg_date < ?", [$from, $to]);
    $company = company_name();
    $text = $title . ': ' . $label . "\n" . ($company !== '' ? $company . ' · VIP MARKET' : 'VIP MARKET') . "\n\n"
        . "UKUPNO\n"
        . '  novi klijenti: ' . $tot['new'] . "\n"
        . '  dobiveni poslovi: ' . $tot['won'] . ($tot['won'] ? ' (' . eur_text($tot['wonv']) . ')' : '') . "\n"
        . '  aktivnosti prodavača: ' . $tot['acts'] . "\n"
        . '  poslani e-mailovi: ' . $tot['sent'] . ', primljeni odgovori klijenata: ' . $tot['replies'] . "\n"
        . '  poruke u Inboxu bez klijenta: ' . $unlinked . "\n"
        . '  klijenti koji čekaju naš podsjetnik (bez odgovora): ' . count($waiting) . "\n\n"
        . "PO PRODAVAČIMA\n\n" . implode("\n\n", $blocks) . "\n";
    return ['subject' => $title . ': ' . $label, 'text' => $text];
}

function send_report(array $recipients, ?int $now = null, bool $monthly = false): int
{
    $r = report_text($now, $monthly);
    $n = 0;
    foreach ($recipients as $u) {
        Mailer::send((string) $u['email'], $r['subject'], $r['text'], null, ['Auto-Submitted' => 'auto-generated']);
        $n++;
    }
    return $n;
}

/** Monday from 08:00 (or later in the week if the cron was down) the report goes to all active administrators. */
function weekly_report_if_due(): bool
{
    if (setting_get('report_enabled', '1') !== '1' || !Mailer::configured()) {
        return false;
    }
    $week = date('o-\WW');
    if (meta_get('report_week') === $week) {
        return false;
    }
    if ((int) date('N') === 1 && (int) date('G') < 8) {
        return false;
    }
    $admins = rows("SELECT * FROM users WHERE role = 'admin' AND active = 1");
    if (!$admins) {
        return false;
    }
    try {
        send_report($admins);
    } catch (MailException $e) {
        error_log('CRM weekly report: ' . $e->getMessage());
        return false;
    }
    meta_set('report_week', $week);
    return true;
}

/** On the 1st of the month from 08:00 (or later if the cron was down) the report for the previous month goes to all active administrators. */
function monthly_report_if_due(): bool
{
    if (setting_get('report_enabled', '1') !== '1' || !Mailer::configured()) {
        return false;
    }
    $month = date('Y-m');
    if (meta_get('report_month') === null) {
        meta_set('report_month', $month); // first run after the update: wait for the next 1st of the month
        return false;
    }
    if (meta_get('report_month') === $month) {
        return false;
    }
    if ((int) date('j') === 1 && (int) date('G') < 8) {
        return false;
    }
    $admins = rows("SELECT * FROM users WHERE role = 'admin' AND active = 1");
    if (!$admins) {
        return false;
    }
    try {
        send_report($admins, null, true);
    } catch (MailException $e) {
        error_log('CRM monthly report: ' . $e->getMessage());
        return false;
    }
    meta_set('report_month', $month);
    return true;
}

/* ---------- background jobs ---------- */

/** Runs from cron.php and, throttled, from the app. */
/** Moves the client's current campaign into the history (if it has dates). Usluga i prodavač se bilježe uz kampanju. */
/* ---------- povijest prodavača klijenta ---------- */

function record_owner(int $clientId, ?int $ownerId, int $t): void
{
    if ($ownerId) {
        run('INSERT INTO owner_history (client_id, owner_id, from_at) VALUES (?, ?, ?)', [$clientId, $ownerId, $t]);
    }
}

/** Prodavač koji je vodio klijenta u zadanom trenutku (ms); prodaja se računa njemu. */
function owner_at(int $clientId, int $atMs, $fallback = null)
{
    static $cache = null;
    if ($cache === null) {
        $cache = [];
        foreach (rows('SELECT client_id, owner_id, from_at FROM owner_history ORDER BY from_at, id') as $r) {
            $cache[(int) $r['client_id']][] = [(int) $r['from_at'], (int) $r['owner_id']];
        }
    }
    $o = null;
    foreach ($cache[$clientId] ?? [] as [$from, $own]) {
        if ($from <= $atMs) {
            $o = $own;
        }
    }
    return $o ?? ($cache[$clientId][0][1] ?? $fallback);
}

function archive_campaign(array $c, int $userId): void
{
    if (empty($c['camp_end'])) {
        return;
    }
    run('INSERT INTO campaigns (client_id, start_date, end_date, value, created_by, created_at, service, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [$c['id'], $c['camp_start'] ?: null, $c['camp_end'], $c['camp_value'] ?? 0, $userId, ms(), (string) ($c['service'] ?? ''), $c['owner_id'] ?? null]);
}

/* ---------- dnevnik promjena ---------- */

function audit(?int $clientId, ?int $userId, string $action, string $details, string $clientName = ''): void
{
    if ($clientName === '' && $clientId) {
        $r = row('SELECT name FROM clients WHERE id = ?', [$clientId]);
        $clientName = $r ? (string) $r['name'] : '';
    }
    run('INSERT INTO audit_log (client_id, client_name, user_id, at, action, details) VALUES (?, ?, ?, ?, ?, ?)',
        [$clientId, mb_substr($clientName, 0, 190), $userId, ms(), $action, mb_substr($details, 0, 3000)]);
}

function user_name_of($id): string
{
    static $c = [];
    $id = (int) $id;
    if (!isset($c[$id])) {
        $r = row('SELECT name FROM users WHERE id = ?', [$id]);
        $c[$id] = $r ? (string) $r['name'] : '—';
    }
    return $c[$id];
}

/** Opis promjena između starog zapisa klijenta i novih vrijednosti. */
function client_diff(array $old, array $new): string
{
    $labels = ['kind' => 'Vrsta', 'name' => 'Naziv', 'contact' => 'Kontakt osoba', 'oib' => 'OIB', 'email' => 'E-mail', 'phone' => 'Telefon', 'service' => 'Usluga',
        'value' => 'Procijenjena vrijednost', 'owner_id' => 'Prodavač', 'next_follow_up' => 'Sljedeći kontakt',
        'camp_active' => 'Aktivna kampanja', 'camp_start' => 'Kampanja od', 'camp_end' => 'Kampanja do', 'camp_value' => 'Vrijednost kampanje'];
    $parts = [];
    foreach ($labels as $k => $label) {
        if (!array_key_exists($k, $new)) {
            continue;
        }
        $o = $old[$k] ?? '';
        $n = $new[$k];
        if (in_array($k, ['value', 'camp_value'], true)) {
            $o = (float) $o;
            $n = (float) $n;
        } elseif ($k === 'camp_active') {
            $o = (int) $o;
            $n = (int) $n;
        } else {
            $o = (string) ($o ?? '');
            $n = (string) ($n ?? '');
        }
        if ($o == $n) {
            continue;
        }
        $fmt = static function ($v) use ($k): string {
            if ($k === 'owner_id') {
                return user_name_of($v);
            }
            if ($k === 'camp_active') {
                return $v ? 'da' : 'ne';
            }
            if (in_array($k, ['value', 'camp_value'], true)) {
                return number_format((float) $v, 2, ',', '.') . ' €';
            }
            return $v === '' ? '(prazno)' : (string) $v;
        };
        $parts[] = $label . ': ' . $fmt($o) . ' → ' . $fmt($n);
    }
    return implode('; ', $parts);
}

/* ---------- zadaci ---------- */

function task_out(array $r): array
{
    return ['id' => (string) $r['id'], 'clientId' => $r['client_id'] !== null ? (string) $r['client_id'] : '', 'title' => (string) $r['title'],
        'due' => (string) ($r['due_date'] ?? ''), 'assigneeId' => (string) $r['assignee_id'], 'createdBy' => (string) $r['created_by'],
        'createdAt' => (int) $r['created_at'], 'doneAt' => $r['done_at'] !== null ? (int) $r['done_at'] : 0];
}

function tasks_for(array $u): array
{
    $since = ms() - 7 * DAY_MS;
    if ($u['role'] === 'admin') {
        $rs = rows('SELECT * FROM tasks WHERE done_at IS NULL OR done_at > ? ORDER BY id', [$since]);
    } else {
        $rs = rows('SELECT * FROM tasks WHERE (assignee_id = ? OR created_by = ?) AND (done_at IS NULL OR done_at > ?) ORDER BY id', [$u['id'], $u['id'], $since]);
    }
    return array_map('task_out', $rs);
}

/* ---------- prihod od kampanja ---------- */

/** Vrijednost kampanje pripada tjednu/mjesecu početka kampanje; ako klijent ima više usluga, dijeli se jednako. */
function revenue_report(array $u): array
{
    $admin = $u['role'] === 'admin';
    $from = date('Y-m-d', strtotime('-400 days'));
    $items = [];
    foreach (rows('SELECT client_id, start_date, end_date, value, service, owner_id FROM campaigns') as $r) {
        $d0 = ($r['start_date'] ?: $r['end_date']);
        $items[] = [$d0, (float) $r['value'], (string) $r['service'], $d0 ? owner_at((int) $r['client_id'], (int) (strtotime($d0 . ' 23:59:59') * 1000), $r['owner_id']) : $r['owner_id']];
    }
    foreach (rows('SELECT id, camp_start, camp_end, camp_value, service, owner_id FROM clients WHERE camp_active = 1') as $r) {
        $d1 = ($r['camp_start'] ?: $r['camp_end']);
        $items[] = [$d1, (float) $r['camp_value'], (string) $r['service'], $d1 ? owner_at((int) $r['id'], (int) (strtotime($d1 . ' 23:59:59') * 1000), $r['owner_id']) : $r['owner_id']];
    }
    $w = [];
    $m = [];
    foreach ($items as [$d, $v, $svc, $owner]) {
        if (!$d || $d < $from || $v <= 0) {
            continue;
        }
        if (!$admin && (int) $owner !== (int) $u['id']) {
            continue;
        }
        $list = array_values(array_filter(array_map('trim', explode(',', $svc)), static fn ($x) => $x !== ''));
        if (!$list) {
            $list = ['Bez usluge'];
        }
        $part = $v / count($list);
        $wk = date('Y-m-d', strtotime('monday this week', strtotime($d)));
        $mo = substr($d, 0, 7);
        foreach ($list as $s) {
            $o = (string) ($owner ?? '0');
            $kw = $wk . '|' . $o . '|' . $s;
            $km = $mo . '|' . $o . '|' . $s;
            $w[$kw] = ($w[$kw] ?? 0) + $part;
            $m[$km] = ($m[$km] ?? 0) + $part;
        }
    }
    $fmt = static function (array $a): array {
        $o = [];
        foreach ($a as $k => $v) {
            [$p, $own, $s] = explode('|', $k, 3);
            $o[] = ['p' => $p, 'u' => $own, 's' => $s, 'v' => round($v, 2)];
        }
        return $o;
    };
    return ['weekly' => $fmt($w), 'monthly' => $fmt($m), 'scope' => $admin ? 'all' : 'mine'];
}

const STAGE_LABELS = ['novi' => 'Novi kontakt', 'kontaktiran' => 'Kontaktiran', 'ponuda' => 'Ponuda poslana', 'pregovori' => 'Pregovori', 'aktivni' => 'Aktivni', 'dobiven' => 'Dobiven', 'izgubljen' => 'Izgubljen'];

/** Klijent s aktivnom kampanjom ima status Aktivni. */
function mark_client_active(array $c, int $userId, int $t): void
{
    if ($c['status'] === 'aktivni') {
        return;
    }
    run('UPDATE clients SET status = ?, updated_at = ? WHERE id = ?', ['aktivni', $t, $c['id']]);
    run('INSERT INTO notes (client_id, author_id, type, body, created_at) VALUES (?, ?, ?, ?, ?)',
        [$c['id'], $userId, 'status', STAGE_LABELS[$c['status']] . ' → Aktivni' . "\n" . 'Klijent ima aktivnu kampanju.', $t]);
}

/** Kampanje kojima je prošao datum završetka: u povijest, klijent postaje Izgubljen. */
function expire_campaigns(): int
{
    $n = 0;
    foreach (rows('SELECT * FROM clients WHERE camp_active = 1 AND camp_end IS NOT NULL AND camp_end < ?', [date('Y-m-d')]) as $c) {
        $t = ms();
        transaction(static function () use ($c, $t): void {
            archive_campaign($c, (int) $c['owner_id']);
            $lose = $c['status'] === 'aktivni'; // dobiven/izgubljen i ostali ručno postavljeni statusi ostaju
            run('UPDATE clients SET camp_active = 0, camp_start = NULL, camp_end = NULL, camp_value = 0, status = ?, updated_at = ? WHERE id = ?', [$lose ? 'izgubljen' : $c['status'], $t, $c['id']]);
            $why = 'Kampanja je završila ' . date('d.m.Y.', strtotime($c['camp_end'])) . ', vrijednost ' . number_format((float) $c['camp_value'], 2, ',', '.') . ' €.';
            audit((int) $c['id'], null, 'campaign', ($lose ? 'Status: Aktivni → Izgubljen. ' : '') . $why, (string) $c['name']);
            run('INSERT INTO notes (client_id, author_id, type, body, created_at) VALUES (?, ?, ?, ?, ?)',
                [$c['id'], $c['owner_id'], $lose ? 'status' : 'note', $lose ? STAGE_LABELS['aktivni'] . ' → Izgubljen' . "\n" . $why : $why, $t]);
        });
        $n++;
    }
    return $n;
}

function run_background_jobs(bool $force = false): array
{
    $last = (int) (meta_get('bg_last') ?? 0);
    if (!$force && $last > ms() - 55000) {
        return [];
    }
    meta_set('bg_last', (string) ms());
    $out = [];
    try {
        $out['expired'] = expire_campaigns();
        $out['scheduled'] = process_scheduled();
        $out['reminders'] = notify_reminders();
        $out['report'] = weekly_report_if_due();
        $out['report_month'] = monthly_report_if_due();
        $out['backup'] = backup_auto_if_due();
    } catch (Throwable $e) {
        error_log('CRM jobs: ' . $e->getMessage());
        $out['error'] = $e->getMessage();
    }
    return $out;
}


/* ---------- templates: sending time and campaigns (akcije) ---------- */

const CAMPAIGN_GROUPS = [
    'aktivni' => ['novi', 'kontaktiran', 'ponuda', 'pregovori', 'aktivni'],
    'dobiveni' => ['dobiven'],
    'neaktivni' => ['izgubljen'],
];

function template_out(array $t): array
{
    $aud = json_decode((string) ($t['audience'] ?? ''), true);
    $inp = json_decode((string) ($t['inputs'] ?? ''), true);
    return [
        'id' => (string) $t['id'],
        'name' => (string) $t['name'],
        'subject' => (string) $t['subject'],
        'body' => (string) $t['body'],
        'kind' => (string) $t['kind'],
        'sendMode' => (string) $t['send_mode'],
        'sendDays' => (int) $t['send_days'],
        'sendTime' => (string) $t['send_time'],
        'sendFixed' => $t['send_fixed'] !== null ? (int) $t['send_fixed'] : null,
        'audience' => is_array($aud) ? $aud : ['groups' => ['aktivni'], 'kind' => 'sve', 'owner' => ''],
        'inputs' => is_array($inp) ? $inp : (object) [],
    ];
}

/** Moment (ms) at which a template is meant to go out. manual = now. */
function template_send_at(array $t): int
{
    $now = ms();
    if ($t['send_mode'] === 'fixed' && $t['send_fixed'] !== null) {
        return (int) $t['send_fixed'];
    }
    if ($t['send_mode'] === 'delay') {
        [$h, $m] = array_map('intval', explode(':', (string) $t['send_time']) + [0, 0]);
        $d = new DateTimeImmutable('today', new DateTimeZone(date_default_timezone_get()));
        $at = $d->modify('+' . max(0, (int) $t['send_days']) . ' days')->setTime($h, $m)->getTimestamp() * 1000;
        return max($at, $now);
    }
    return $now;
}

function clean_audience($raw): array
{
    $raw = is_array($raw) ? $raw : [];
    $groups = array_values(array_intersect(array_map('strval', (array) ($raw['groups'] ?? [])), array_keys(CAMPAIGN_GROUPS)));
    $kind = in_array($raw['kind'] ?? '', ['tvrtka', 'osoba'], true) ? $raw['kind'] : 'sve';
    $owner = !empty($raw['owner']) ? (string) (int) $raw['owner'] : '';
    return ['groups' => $groups, 'kind' => $kind, 'owner' => $owner];
}

/** @return list<array> clients that have a valid, unique e-mail address and match the audience */
function campaign_recipients(array $aud): array
{
    $aud = clean_audience($aud);
    $stages = [];
    foreach ($aud['groups'] as $g) {
        $stages = array_merge($stages, CAMPAIGN_GROUPS[$g]);
    }
    if (!$stages) {
        return [];
    }
    $sql = 'SELECT * FROM clients WHERE status IN (' . implode(',', array_fill(0, count($stages), '?')) . ") AND email <> ''";
    $p = $stages;
    if ($aud['kind'] !== 'sve') {
        $sql .= ' AND kind = ?';
        $p[] = $aud['kind'];
    }
    if ($aud['owner'] !== '') {
        $sql .= ' AND owner_id = ?';
        $p[] = (int) $aud['owner'];
    }
    $seen = [];
    $out = [];
    foreach (rows($sql . ' ORDER BY name', $p) as $c) {
        $mail = strtolower(trim((string) $c['email']));
        if (!filter_var($mail, FILTER_VALIDATE_EMAIL) || isset($seen[$mail])) {
            continue;
        }
        $seen[$mail] = 1;
        $out[] = $c;
    }
    return $out;
}

function fill_template_text(string $text, array $c, string $myName): string
{
    $first = preg_split('/\s+/', trim((string) ($c['contact'] !== '' ? $c['contact'] : $c['name'])))[0] ?? '';
    $map = ['ime' => $first, 'tvrtka' => (string) $c['name'], 'usluga' => $c['service'] !== '' ? (string) $c['service'] : 'marketing', 'moje_ime' => $myName];
    return preg_replace_callback('/\{\{(\w+)\}\}/', static fn ($m) => $map[$m[1]] ?? '', $text);
}

/**
 * Queues one scheduled e-mail per recipient; the cron job sends them in batches (and respects the hourly limit).
 * The sender of each message is the client's owner (when active), otherwise $fallback.
 * @return array{queued:int, skipped:int, sendAt:int}
 */
function campaign_queue(array $t, array $fallback): array
{
    $at = template_send_at($t);
    if ($t['send_mode'] === 'fixed' && $at < ms() + 60000) {
        throw new ApiError('Točan datum i vrijeme slanja u predlošku je u prošlosti. Postavite novi.');
    }
    $aud = json_decode((string) $t['audience'], true) ?: [];
    $queued = 0;
    $skipped = 0;
    $batch = 'a' . $t['id'] . '-' . date('ymdHi');
    foreach (campaign_recipients($aud) as $c) {
        $sender = $c['owner_id'] !== null ? row('SELECT * FROM users WHERE id = ? AND active = 1', [$c['owner_id']]) : null;
        $sender = $sender ?: $fallback;
        $subject = mb_substr(fill_template_text((string) $t['subject'], $c, (string) $sender['name']), 0, 255);
        $body = fill_template_text((string) $t['body'], $c, (string) $sender['name']);
        if (row("SELECT id FROM scheduled_emails WHERE client_id = ? AND subject = ? AND status IN ('pending','sending','sent') AND created_at > ?", [$c['id'], $subject, ms() - 30 * DAY_MS])) {
            $skipped++;
            continue;
        }
        run('INSERT INTO scheduled_emails (user_id, client_id, to_email, subject, body, doc_ids, remind_days, send_at, status, attempts, created_at, bulk, batch)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, ?)',
            [$sender['id'], $c['id'], trim((string) $c['email']), $subject, $body, '', null, $at, 'pending', ms(), $batch]);
        $queued++;
    }
    return ['queued' => $queued, 'skipped' => $skipped, 'sendAt' => $at];
}


/** Popis poruka za Inbox; dolazne poruke na koje je odgovoreno nose tko je odgovorio i kada. */
function email_list_out(array $rowsIn): array
{
    $replies = [];
    foreach (rows("SELECT in_reply_to, user_id, msg_date FROM emails WHERE direction = 'out' AND in_reply_to IS NOT NULL AND in_reply_to <> '' AND deleted_at IS NULL ORDER BY msg_date, id") as $r) {
        $replies[trim((string) $r['in_reply_to'], "<> \t")] = [$r['user_id'], (int) $r['msg_date']];
    }
    $out = [];
    foreach ($rowsIn as $r) {
        $o = email_out($r);
        $k = trim((string) ($r['message_id'] ?? ''), "<> \t");
        if ($r['direction'] === 'in' && $k !== '' && isset($replies[$k]) && $replies[$k][0] !== null) {
            $o['repliedBy'] = (string) $replies[$k][0];
            $o['repliedAt'] = $replies[$k][1];
        }
        $out[] = $o;
    }
    return $out;
}
