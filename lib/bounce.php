<?php
declare(strict_types=1);

/* Vraćene poruke ("Mail delivery failed: returning message to sender"):
 *  - neispravna adresa  → bilješka na klijentu, zadatak prodavačima (podjednako), brisanje nakon 30 dana ako se ne ispravi
 *  - probijena kvota slanja → ista poruka se ponovno šalje za 2 sata, uz razmak da se kvota ponovno ne probije */

const BOUNCE_FIX_DAYS = 30;
const BOUNCE_RESEND_DELAY_MS = 2 * 3600 * 1000;
const BOUNCE_RESEND_GAP_MS = 120000;   // najviše 30 ponovljenih poruka na sat (ispod najmanje kvote)
const BOUNCE_RESEND_MAX = 3;
const BOUNCE_SCAN_DAYS = 90;

function bounce_is_subject(string $subject): bool
{
    return (bool) preg_match('/mail delivery failed|returning message to sender|undelivered mail returned|delivery status notification \(failure\)|failure notice|returned mail:/i', $subject);
}

/** Vlastite adrese koje nikad nisu "neispravna adresa klijenta". @return list<string> */
function bounce_own_addresses(): array
{
    $own = [strtolower(Mailer::fromEmail())];
    $i2 = function_exists('mail_identity') ? mail_identity(2) : null;
    if (is_array($i2) && !empty($i2['from_email'])) {
        $own[] = strtolower((string) $i2['from_email']);
    }
    return array_values(array_filter($own));
}

/** @return array{to:string,subject:string,kind:string,reason:string} */
function bounce_parse(string $body): array
{
    $own = bounce_own_addresses();
    $ok = static function (string $e) use ($own): bool {
        $e = strtolower(trim($e, " \t<>.,;:()\"'"));
        return filter_var($e, FILTER_VALIDATE_EMAIL) && !in_array($e, $own, true) && !preg_match('/^(mailer-daemon|postmaster)@/', $e);
    };
    $to = '';
    $pats = ['/following address\(es\) failed:\s*(?:\R\s*)*([^\s<>]+@[^\s<>]+|<[^>]+>)/i', '/Final-Recipient:\s*rfc822;\s*(\S+)/i', '/RCPT TO:\s*<([^>]+)>/i', '/<([^<>\s]+@[^<>\s]+)>:\s/'];
    foreach ($pats as $p) {
        if (preg_match_all($p, $body, $m)) {
            foreach ($m[1] as $cand) {
                if ($ok($cand)) {
                    $to = strtolower(trim($cand, " \t<>.,;:()\"'"));
                    break 2;
                }
            }
        }
    }
    if ($to === '' && preg_match_all('/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/', $body, $m)) {
        foreach ($m[0] as $cand) {
            if ($ok($cand)) {
                $to = strtolower($cand);
                break;
            }
        }
    }
    $subject = '';
    if (preg_match('/^Subject:[ \t]*(.+)$/mi', $body, $m)) {
        $subject = trim(Mime::decodeHeader(trim($m[1])));
    }
    $low = strtolower($body);
    $kind = 'other';
    $reason = '';
    if (preg_match('/exceeded the max(imum)? (number of )?(emails?|defers)|max(imum)? (number of )?(emails?|defers and failures).{0,40}per hour|hourly (send|email|message)\w* limit|sending limit|rate limit|too many (messages|emails|connections|recipients)|(emails?|messages?) per hour|quota.{0,30}(sending|outgoing|per (hour|day))/i', $low)) {
        $kind = 'quota';
        $reason = 'probijena kvota slanja e-mailova';
    } elseif (preg_match('/spam|blacklist|blocklist|blocked|reputation|policy|rejected due to|dnsbl|spamhaus|not authenticated|sender verify|mailbox (is )?full|over ?quota|quota exceeded|storage|insufficient/i', $low)) {
        $kind = 'other';
    } elseif (preg_match('/user unknown|unknown user|no such user|does not exist|doesn\'t exist|not exist|invalid (recipient|address|mailbox)|unrouteable|unroutable|no mx|host or domain name not found|domain (not found|does not exist)|name or service not known|recipient (address )?rejected|address rejected|mailbox (unavailable|not found)|account (is )?(disabled|inactive|closed)|550[ -]5\.1\.[0-9]|5\.1\.[1-3]|5\.4\.4|550 |551 |553 |permanent error/i', $low)) {
        $kind = 'invalid';
        $reason = 'adresa ne postoji ili nije ispravna';
        if (preg_match('/(5\d\d[ -]5\.\d\.\d[^\n]{0,160})/', $body, $m)) {
            $reason = trim($m[1]);
        }
    }
    return ['to' => $to, 'subject' => $subject, 'kind' => $kind, 'reason' => mb_substr($reason, 0, 240)];
}

function bounce_enabled(): bool
{
    return setting_get('bounce_enabled', '0') === '1';
}

/** Suha provjera: klasifikacija vraćenih poruka u Inboxu, bez zapisivanja. */
function bounce_preview(): array
{
    $since = ms() - BOUNCE_SCAN_DAYS * DAY_MS;
    $mails = rows("SELECT e.* FROM emails e WHERE e.direction = 'in' AND e.deleted_at IS NULL AND e.msg_date > ?
                      AND (e.subject LIKE '%delivery failed%' OR e.subject LIKE '%returning message%' OR e.subject LIKE '%Undelivered Mail%' OR e.subject LIKE '%Delivery Status Notification%' OR e.subject LIKE '%failure notice%' OR e.subject LIKE '%Returned mail%')
                      AND NOT EXISTS (SELECT 1 FROM bounce_cases b WHERE b.email_id = e.id) ORDER BY e.msg_date DESC LIMIT 400", [$since]);
    $sum = ['invalid' => 0, 'invalid_in_db' => 0, 'quota' => 0, 'other' => 0, 'noaddr' => 0];
    $sample = [];
    $reasons = [];
    foreach ($mails as $e) {
        if (!bounce_is_subject((string) $e['subject'])) {
            continue;
        }
        $p = bounce_parse((string) $e['body']);
        if ($p['to'] === '') {
            $sum['noaddr']++;
            continue;
        }
        $sum[$p['kind']]++;
        $inDb = $p['kind'] === 'invalid' && row('SELECT id FROM clients WHERE LOWER(email) = ? OR LOWER(email2) = ?', [$p['to'], $p['to']]) ? 1 : 0;
        $sum['invalid_in_db'] += $inDb;
        $rk = $p['kind'] . ': ' . preg_replace('/[\w.+\-]+@[\w.\-]+/', '<adresa>', mb_substr($p['reason'] !== '' ? $p['reason'] : '-', 0, 80));
        $reasons[$rk] = ($reasons[$rk] ?? 0) + 1;
        if (count($sample) < 8) {
            $sample[] = ['to' => mask_email($p['to']), 'kind' => $p['kind'], 'subject' => mb_substr($p['subject'], 0, 60), 'inDb' => $inDb, 'ageH' => (int) round((ms() - (int) $e['msg_date']) / 3600000)];
        }
    }
    arsort($reasons);
    return ['total' => count($mails), 'summary' => $sum, 'reasons' => array_slice($reasons, 0, 12, true), 'sample' => $sample, 'enabled' => bounce_enabled()];
}

function bounce_admin_id(): int
{
    $r = row("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1");
    return $r ? (int) $r['id'] : 1;
}

/** Prodavač s najmanje dosadašnjih zadataka ove vrste (podjednaka raspodjela). */
function bounce_pick_assignee(): int
{
    $s = rows("SELECT id FROM users WHERE role = 'sales' AND active = 1 ORDER BY id");
    if (!$s) {
        return bounce_admin_id();
    }
    $best = (int) $s[0]['id'];
    $bestN = PHP_INT_MAX;
    foreach ($s as $u) {
        $n = (int) row('SELECT COUNT(*) AS c FROM bounce_cases WHERE assignee_id = ?', [$u['id']])['c'];
        if ($n < $bestN) {
            $bestN = $n;
            $best = (int) $u['id'];
        }
    }
    return $best;
}

function bad_email_open(string $email): bool
{
    return $email !== '' && (bool) row("SELECT id FROM bounce_cases WHERE status = 'open' AND kind = 'invalid' AND LOWER(bad_email) = ?", [strtolower($email)]);
}

/** Pregledava Inbox, obrađuje nove vraćene poruke, provjerava ispravke i rokove. @return array<string,int> */
function bounce_run(): array
{
    $out = ['new' => 0, 'invalid' => 0, 'resent' => 0, 'fixed' => 0, 'deleted' => 0];
    if (!bounce_enabled()) {
        return $out;
    }
    $since = ms() - BOUNCE_SCAN_DAYS * DAY_MS;
    $mails = rows("SELECT e.* FROM emails e WHERE e.direction = 'in' AND e.deleted_at IS NULL AND e.msg_date > ?
                      AND (e.subject LIKE '%delivery failed%' OR e.subject LIKE '%returning message%' OR e.subject LIKE '%Undelivered Mail%' OR e.subject LIKE '%Delivery Status Notification%' OR e.subject LIKE '%failure notice%' OR e.subject LIKE '%Returned mail%')
                      AND NOT EXISTS (SELECT 1 FROM bounce_cases b WHERE b.email_id = e.id) ORDER BY e.msg_date LIMIT 100", [$since]);
    foreach ($mails as $e) {
        if (!bounce_is_subject((string) $e['subject'])) {
            continue;
        }
        try {
            transaction(static function () use ($e, &$out): void {
                $p = bounce_parse((string) $e['body']);
                $out['new']++;
                if ($p['to'] === '' || $p['kind'] === 'other') {
                    run('INSERT INTO bounce_cases (email_id, client_id, kind, bad_email, orig_subject, status, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?)',
                        [$e['id'], 'other', $p['to'], mb_substr($p['subject'], 0, 255), 'ignored', ms()]);
                    return;
                }
                if ($p['kind'] === 'quota') {
                    $out['resent'] += bounce_handle_quota($e, $p) ? 1 : 0;
                    return;
                }
                $out['invalid'] += bounce_handle_invalid($e, $p);
            });
        } catch (Throwable $ex) {
            error_log('CRM bounce: ' . $ex->getMessage());
            try {
                run('INSERT INTO bounce_cases (email_id, client_id, kind, bad_email, status, created_at) VALUES (?, NULL, ?, ?, ?, ?)', [$e['id'], 'other', '', 'error', ms()]);
            } catch (Throwable $ex2) {
            }
        }
    }
    $out['fixed'] = bounce_check_fixed();
    $out['deleted'] = bounce_expire();
    return $out;
}

/** Neispravna adresa: bilješka, zadatak (podjednako po prodavačima), otkazivanje poruka na čekanju. */
function bounce_handle_invalid(array $e, array $p): int
{
    $bad = $p['to'];
    $now = ms();
    $deadline = $now + BOUNCE_FIX_DAYS * DAY_MS;
    $clients = rows('SELECT * FROM clients WHERE LOWER(email) = ? OR LOWER(email2) = ?', [$bad, $bad]);
    if (!$clients) {
        run('INSERT INTO bounce_cases (email_id, client_id, kind, bad_email, orig_subject, status, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?)',
            [$e['id'], 'invalid', $bad, mb_substr($p['subject'], 0, 255), 'noclient', $now]);
        return 0;
    }
    run("UPDATE scheduled_emails SET status = 'cancelled', error = 'Neispravna adresa' WHERE LOWER(to_email) = ? AND status IN ('pending','awaiting')", [$bad]);
    $n = 0;
    $first = true;
    foreach ($clients as $c) {
        if (row("SELECT id FROM bounce_cases WHERE client_id = ? AND LOWER(bad_email) = ? AND status = 'open'", [$c['id'], $bad])) {
            if ($first) {
                run('INSERT INTO bounce_cases (email_id, client_id, kind, bad_email, orig_subject, status, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?)',
                    [$e['id'], 'invalid', $bad, mb_substr($p['subject'], 0, 255), 'ignored', $now]);
                $first = false;
            }
            continue;
        }
        $assignee = bounce_pick_assignee();
        $due = date('Y-m-d', intdiv($now, 1000) + 7 * 86400);
        $title = 'Provjeriti i ispraviti e-mail: ' . $c['name'];
        $descr = 'Poruka na adresu ' . $bad . ' je vraćena (' . ($p['reason'] !== '' ? $p['reason'] : 'neispravna adresa') . "). Provjerite ispravnu adresu klijenta i upišite je u karticu klijenta.\n"
            . 'Ako se adresa ne ispravi do ' . date('d.m.Y.', intdiv($deadline, 1000)) . ', klijent se briše iz baze.';
        run('INSERT INTO tasks (client_id, title, descr, due_date, assignee_id, created_by, created_at, repeat_every) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$c['id'], $title, $descr, $due, $assignee, bounce_admin_id(), $now, '']);
        $tid = insert_id();
        run('INSERT INTO bounce_cases (email_id, client_id, kind, bad_email, orig_subject, task_id, assignee_id, status, created_at, deadline_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$first ? $e['id'] : null, $c['id'], 'invalid', $bad, mb_substr($p['subject'], 0, 255), $tid, $assignee, 'open', $now, $deadline]);
        $first = false;
        run('INSERT INTO notes (client_id, author_id, type, subject, body, to_email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$c['id'], bounce_admin_id(), 'note', null, 'Automatska bilješka: e-mail adresa ' . $bad . ' je neispravna (poruka je vraćena: ' . ($p['reason'] !== '' ? $p['reason'] : 'Mail delivery failed') . '). Zadatak za provjeru dodijeljen: ' . user_name_of($assignee) . '. Rok za ispravak: ' . date('d.m.Y.', intdiv($deadline, 1000)) . ', nakon toga se klijent briše iz baze.', null, $now]);
        audit((int) $c['id'], null, 'task', 'Neispravna e-mail adresa ' . $bad . ': zadatak za ' . user_name_of($assignee), (string) $c['name']);
        $body = 'Klijent "' . $c['name'] . '": poruka na adresu ' . $bad . " je vraćena kao neispravna.\n\nProvjerite adresu i ispravite je u kartici klijenta. Ako se ne ispravi u " . BOUNCE_FIX_DAYS . ' dana, klijent se briše iz baze.';
        alert_create($assignee, (int) $c['id'], 'task', 'Neispravan e-mail: ' . $c['name'], $body, null, 'bn:' . $tid);
        alert_mail($assignee, 'Neispravan e-mail klijenta: ' . $c['name'], $body);
        $n++;
    }
    return $n;
}

/** Probijena kvota slanja: ista poruka se šalje ponovno za 2 sata, s razmakom između ponovljenih poruka. */
function bounce_handle_quota(array $e, array $p): bool
{
    $now = ms();
    $to = $p['to'];
    $subj = $p['subject'];
    $record = static function (string $status, ?int $clientId) use ($e, $to, $subj, $now): void {
        run('INSERT INTO bounce_cases (email_id, client_id, kind, bad_email, orig_subject, status, created_at, resend_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$e['id'], $clientId, 'quota', $to, mb_substr($subj, 0, 255), $status, $now, $status === 'resent' ? $now : null]);
    };
    if ($subj === '' && $to !== '') {
        // povratna poruka često ne sadrži zaglavlja izvorne poruke: izvorna poruka se traži po primatelju (zadnja poslana prije povrata)
        $os = row("SELECT subject FROM scheduled_emails WHERE LOWER(to_email) = ? AND status = 'sent' AND sent_at <= ? AND sent_at > ? ORDER BY sent_at DESC LIMIT 1", [$to, (int) $e['msg_date'] + 60000, $now - 4 * DAY_MS]);
        $oe = $os ? null : row("SELECT subject FROM emails WHERE direction = 'out' AND auto = 0 AND LOWER(to_email) = ? AND msg_date <= ? AND msg_date > ? ORDER BY msg_date DESC LIMIT 1", [$to, (int) $e['msg_date'] + 60000, $now - 4 * DAY_MS]);
        $subj = $os ? (string) $os['subject'] : ($oe ? (string) $oe['subject'] : '');
    }
    if ($subj === '' || (int) $e['msg_date'] < $now - 3 * DAY_MS) {
        $record('ignored', null);
        return false;
    }
    $tries = (int) row("SELECT COUNT(*) AS c FROM bounce_cases WHERE kind = 'quota' AND status = 'resent' AND LOWER(bad_email) = ? AND orig_subject = ?", [$to, mb_substr($subj, 0, 255)])['c'];
    if ($tries >= BOUNCE_RESEND_MAX) {
        $record('ignored', null);
        return false;
    }
    if (row("SELECT id FROM scheduled_emails WHERE LOWER(to_email) = ? AND subject = ? AND status IN ('pending','awaiting','sending')", [$to, $subj])) {
        $record('ignored', null); // već čeka na slanje
        return false;
    }
    if (row("SELECT id FROM emails WHERE direction = 'out' AND auto = 0 AND LOWER(to_email) = ? AND subject = ? AND msg_date > ?", [$to, $subj, (int) $e['msg_date']])) {
        $record('ignored', null); // poruka je u međuvremenu poslana ručno
        return false;
    }
    $lo = $now - 4 * DAY_MS;
    $orig = row("SELECT * FROM scheduled_emails WHERE LOWER(to_email) = ? AND subject = ? AND status = 'sent' AND sent_at > ? ORDER BY sent_at DESC LIMIT 1", [$to, $subj, $lo]);
    $at = max((int) $e['msg_date'], $now) + BOUNCE_RESEND_DELAY_MS;
    $last = row("SELECT MAX(send_at) AS m FROM scheduled_emails WHERE batch LIKE 'q%' AND status IN ('pending','sending')");
    if ($last && $last['m'] !== null && (int) $last['m'] + BOUNCE_RESEND_GAP_MS > $at) {
        $at = (int) $last['m'] + BOUNCE_RESEND_GAP_MS;
    }
    $batch = 'q' . date('ymdHi', intdiv($now, 1000));
    if ($orig) {
        run('INSERT INTO scheduled_emails (user_id, client_id, to_email, subject, body, doc_ids, remind_days, send_at, status, attempts, created_at, bulk, batch, is_final)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0)',
            [$orig['user_id'], $orig['client_id'], $orig['to_email'], $orig['subject'], $orig['body'], $orig['doc_ids'], $orig['remind_days'], $at, 'pending', $now, $orig['bulk'], $batch]);
        $cid = (int) $orig['client_id'];
    } else {
        $o = row("SELECT * FROM emails WHERE direction = 'out' AND auto = 0 AND LOWER(to_email) = ? AND subject = ? AND msg_date > ? ORDER BY msg_date DESC LIMIT 1", [$to, $subj, $lo]);
        $cid = $o ? ($o['client_id'] !== null ? (int) $o['client_id'] : (client_for_email($to) ?? 0)) : 0;
        if (!$o || $o['user_id'] === null || $cid === 0) {
            $record('ignored', null);
            return false;
        }
        run('INSERT INTO scheduled_emails (user_id, client_id, to_email, subject, body, doc_ids, remind_days, send_at, status, attempts, created_at, bulk, batch, is_final)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, 1)',
            [$o['user_id'], $cid, $to, $subj, $o['body'], '', null, $at, 'pending', $now, $batch]);
    }
    $record('resent', $cid);
    run('INSERT INTO notes (client_id, author_id, type, subject, body, to_email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [$cid, bounce_admin_id(), 'note', null, 'Automatska bilješka: poruka "' . $subj . '" nije isporučena jer je probijena kvota slanja. Ista poruka će se ponovno poslati ' . date('d.m.Y. H:i', intdiv($at, 1000)) . '.', null, $now]);
    return true;
}

/** Zadatak je ispunjen kad je adresa u kartici klijenta promijenjena. */
function bounce_check_fixed(): int
{
    $n = 0;
    foreach (rows("SELECT * FROM bounce_cases WHERE status = 'open'") as $b) {
        $c = $b['client_id'] !== null ? row('SELECT id, email, email2 FROM clients WHERE id = ?', [$b['client_id']]) : null;
        $bad = strtolower((string) $b['bad_email']);
        if ($c && strtolower(trim((string) $c['email'])) !== $bad && strtolower(trim((string) $c['email2'])) !== $bad) {
            run("UPDATE bounce_cases SET status = 'fixed', resolved_at = ? WHERE id = ?", [ms(), $b['id']]);
            if ($b['task_id'] !== null) {
                run('UPDATE tasks SET done_at = ? WHERE id = ? AND done_at IS NULL', [ms(), $b['task_id']]);
            }
            $n++;
        } elseif (!$c) {
            run("UPDATE bounce_cases SET status = 'gone', resolved_at = ? WHERE id = ?", [ms(), $b['id']]);
        }
    }
    return $n;
}

/** Adresa nije ispravljena u 30 dana: klijent se briše iz baze (zaštićeni klijenti se samo prijavljuju administratoru). */
function bounce_expire(): int
{
    $n = 0;
    foreach (rows("SELECT * FROM bounce_cases WHERE status = 'open' AND deadline_at IS NOT NULL AND deadline_at <= ? LIMIT 50", [ms()]) as $b) {
        $c = row('SELECT * FROM clients WHERE id = ?', [$b['client_id']]);
        if (!$c) {
            run("UPDATE bounce_cases SET status = 'gone', resolved_at = ? WHERE id = ?", [ms(), $b['id']]);
            continue;
        }
        $bad = strtolower((string) $b['bad_email']);
        $other = strtolower(trim((string) $c['email'])) === $bad ? trim((string) $c['email2']) : trim((string) $c['email']);
        if ($other !== '' && strtolower($other) !== $bad) {
            // klijent ima drugu ispravnu adresu: briše se samo neispravna
            if (strtolower(trim((string) $c['email'])) === $bad) {
                run('UPDATE clients SET email = email2, email2 = ?, updated_at = ? WHERE id = ?', ['', ms(), $c['id']]);
            } else {
                run('UPDATE clients SET email2 = ?, updated_at = ? WHERE id = ?', ['', ms(), $c['id']]);
            }
            run("UPDATE bounce_cases SET status = 'cleared', resolved_at = ? WHERE id = ?", [ms(), $b['id']]);
            if ($b['task_id'] !== null) {
                run('UPDATE tasks SET done_at = ? WHERE id = ? AND done_at IS NULL', [ms(), $b['task_id']]);
            }
            audit((int) $c['id'], null, 'update', 'Neispravna adresa ' . $bad . ' uklonjena nakon ' . BOUNCE_FIX_DAYS . ' dana', (string) $c['name']);
            continue;
        }
        if ((int) $c['camp_active'] === 1 || $c['value_kind'] === 'ugovoreno' || $c['status'] === 'dobiven') {
            run("UPDATE bounce_cases SET status = 'protected', resolved_at = ? WHERE id = ?", [ms(), $b['id']]);
            foreach (rows("SELECT id FROM users WHERE role = 'admin' AND active = 1") as $a) {
                alert_create((int) $a['id'], (int) $c['id'], 'task', 'Neispravan e-mail nije ispravljen: ' . $c['name'], 'Klijent "' . $c['name'] . '" ima ugovor, aktivnu kampanju ili je dobiven, pa nije obrisan automatski. Adresa ' . $bad . ' još nije ispravljena.', null, 'bp:' . $b['id']);
            }
            continue;
        }
        delete_document_rows(rows('SELECT id, stored FROM documents WHERE client_id = ?', [$c['id']]));
        transaction(static function () use ($c): void {
            run("UPDATE scheduled_emails SET status = 'cancelled' WHERE client_id = ? AND status IN ('pending','awaiting')", [$c['id']]);
            run('UPDATE emails SET client_id = NULL WHERE client_id = ?', [$c['id']]);
            run('DELETE FROM notes WHERE client_id = ?', [$c['id']]);
            run('DELETE FROM campaigns WHERE client_id = ?', [$c['id']]);
            run('DELETE FROM task_notes WHERE task_id IN (SELECT id FROM tasks WHERE client_id = ?)', [$c['id']]);
            run('DELETE FROM tasks WHERE client_id = ?', [$c['id']]);
            run('DELETE FROM clients WHERE id = ?', [$c['id']]);
        });
        run("UPDATE bounce_cases SET status = 'deleted', resolved_at = ?, task_id = NULL WHERE id = ?", [ms(), $b['id']]);
        audit((int) $c['id'], null, 'delete', 'Klijent obrisan automatski: e-mail adresa ' . $bad . ' nije ispravljena u ' . BOUNCE_FIX_DAYS . ' dana', (string) $c['name']);
        $n++;
    }
    return $n;
}
