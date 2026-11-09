<?php
declare(strict_types=1);

/* ---------- obavijesti (alerts) ---------- */

function alert_create(int $userId, ?int $clientId, string $kind, string $title, string $body, ?array $data = null, ?string $dedupe = null): bool
{
    if ($dedupe !== null && row('SELECT id FROM alerts WHERE dedupe = ?', [$dedupe])) {
        return false;
    }
    run('INSERT INTO alerts (user_id, client_id, kind, title, body, data, dedupe, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [$userId, $clientId, $kind, mb_substr($title, 0, 190), mb_substr($body, 0, 3000), $data ? json_encode($data, JSON_UNESCAPED_UNICODE) : null, $dedupe, ms()]);
    return true;
}

function alerts_for(array $u): array
{
    $rs = rows('SELECT * FROM alerts WHERE user_id = ? AND done_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 100', [$u['id']]);
    return array_map(static fn ($a) => ['id' => (string) $a['id'], 'clientId' => $a['client_id'] !== null ? (string) $a['client_id'] : '', 'kind' => (string) $a['kind'],
        'title' => (string) $a['title'], 'body' => (string) $a['body'], 'data' => $a['data'] ? json_decode((string) $a['data'], true) : null, 'at' => (int) $a['created_at']], $rs);
}

function alert_mail(int $userId, string $subject, string $text): void
{
    if (!Mailer::configured()) {
        return;
    }
    $u = row('SELECT * FROM users WHERE id = ? AND active = 1', [$userId]);
    if (!$u) {
        return;
    }
    $url = trim((string) cfg('app.url', ''));
    try {
        Mailer::send((string) $u['email'], $subject, 'Pozdrav ' . explode(' ', trim((string) $u['name']))[0] . ",\n\n" . $text . ($url !== '' ? "\n\n" . $url : ''), null, ['Auto-Submitted' => 'auto-generated']);
    } catch (Throwable $e) {
        error_log('CRM alert mail: ' . $e->getMessage());
    }
}

/* ---------- podsjetnik: klijent dugo nije kontaktiran (30 / 60 / 90 / 120 dana) ---------- */

const CONTACT_LEVELS = [30, 60, 90, 120];

/** Zadnji kontakt = zadnji poziv, sastanak, poslani ili primljeni e-mail; inače datum unosa klijenta. */
function contact_reminders_run(): int
{
    $last = (int) (meta_get('contact_rem_last') ?? 0);
    if ($last > ms() - 3600000) {
        return 0;
    }
    meta_set('contact_rem_last', (string) ms());
    $now = ms();
    $dnc = dnc_set();
    $lastNote = [];
    foreach (rows("SELECT client_id, MAX(created_at) AS m FROM notes WHERE type IN ('call','meeting','email') GROUP BY client_id") as $r) {
        $lastNote[(int) $r['client_id']] = (int) $r['m'];
    }
    foreach (rows("SELECT client_id, MAX(msg_date) AS m FROM emails WHERE client_id IS NOT NULL AND deleted_at IS NULL GROUP BY client_id") as $r) {
        $lastNote[(int) $r['client_id']] = max($lastNote[(int) $r['client_id']] ?? 0, (int) $r['m']);
    }
    $by = [];
    foreach (rows("SELECT id, name, owner_id, email, created_at FROM clients WHERE status <> 'izgubljen' AND owner_id IS NOT NULL") as $c) {
        if ($c['email'] !== '' && isset($dnc[strtolower((string) $c['email'])])) {
            continue;
        }
        $lc = max((int) $c['created_at'], $lastNote[(int) $c['id']] ?? 0);
        $days = (int) floor(($now - $lc) / DAY_MS);
        $level = 0;
        foreach (CONTACT_LEVELS as $l) {
            if ($days >= $l) {
                $level = $l;
            }
        }
        if ($level === 0) {
            continue;
        }
        $nth = array_search($level, CONTACT_LEVELS, true) + 1;
        $title = 'Bez kontakta ' . $days . ' dana: ' . $c['name'];
        $body = $nth . '. podsjetnik (' . $level . ' dana). Zadnji kontakt: ' . date('d.m.Y.', (int) ($lc / 1000)) . '. Javite se klijentu ili upišite bilješku o kontaktu.';
        if (alert_create((int) $c['owner_id'], (int) $c['id'], 'contact' . $level, $title, $body, ['days' => $days, 'level' => $level], 'cr:' . $c['id'] . ':' . $level . ':' . $lc)) {
            $by[(int) $c['owner_id']][] = '- ' . $c['name'] . ': ' . $days . ' dana bez kontakta (' . $nth . '. podsjetnik)';
        }
    }
    $n = 0;
    foreach ($by as $uid => $lines) {
        $more = count($lines) > 40 ? "\n... i još " . (count($lines) - 40) . ' klijenata (vidi Pregled > Obavijesti)' : '';
        alert_mail($uid, 'Podsjetnik: ' . count($lines) . ' ' . (count($lines) === 1 ? 'klijent' : 'klijenata') . ' dugo nije kontaktirano',
            "sljedeći klijenti dugo nisu kontaktirani:\n\n" . implode("\n", array_slice($lines, 0, 40)) . $more);
        $n += count($lines);
    }
    return $n;
}

/* ---------- istek kampanje: obavijest s prijedlogom obnove ---------- */

function campaign_renewal_proposal(array $c): array
{
    $start = strtotime((string) $c['camp_start']) ?: strtotime((string) $c['camp_end']);
    $end = strtotime((string) $c['camp_end']);
    $len = max(1, (int) round(($end - $start) / 86400));
    $ns = max(strtotime(date('Y-m-d')), $end + 86400);
    return ['start' => date('Y-m-d', $ns), 'end' => date('Y-m-d', $ns + $len * 86400), 'value' => (string) number_format((float) $c['camp_value'], 2, '.', ''), 'days' => $len];
}

function campaign_expired_notify(array $c, bool $lost): void
{
    $uid = (int) $c['owner_id'];
    if ($uid <= 0) {
        return;
    }
    $p = campaign_renewal_proposal($c);
    $val = number_format((float) $c['camp_value'], 2, ',', '.') . ' €';
    $body = 'Kampanja je završila ' . date('d.m.Y.', strtotime((string) $c['camp_end'])) . ', vrijednost ' . $val . '.' . ($lost ? ' Klijent je prebačen u status Izgubljen.' : '')
        . "\nPrijedlog obnove: " . date('d.m.Y.', strtotime($p['start'])) . ' – ' . date('d.m.Y.', strtotime($p['end'])) . ' (' . $p['days'] . ' dana), vrijednost ' . $val . '. Javite se klijentu s ponudom za nastavak.';
    if (alert_create($uid, (int) $c['id'], 'camp_end', 'Kampanja istekla: ' . $c['name'], $body, $p, 'ce:' . $c['id'] . ':' . $c['camp_end'])) {
        alert_mail($uid, 'Istekla kampanja: ' . $c['name'], 'kampanja klijenta "' . $c['name'] . "\" je istekla.\n\n" . $body . "\n\nU aplikaciji (Pregled > Obavijesti) obnovu možete upisati jednim klikom.");
    }
}


/** Tjedan dana prije isteka: podsjetnik prodavaču s prijedlogom produljenja (isti broj dana kao dosadašnja kampanja). */
function campaign_soon_notify(): int
{
    $n = 0;
    $from = date('Y-m-d');
    $to = date('Y-m-d', strtotime('+7 days'));
    foreach (rows('SELECT * FROM clients WHERE camp_active = 1 AND camp_end IS NOT NULL AND camp_end >= ? AND camp_end <= ?', [$from, $to]) as $c) {
        $uid = (int) $c['owner_id'];
        if ($uid <= 0) {
            continue;
        }
        $left = (int) round((strtotime((string) $c['camp_end']) - strtotime($from)) / 86400);
        $len = campaign_renewal_proposal($c)['days'];
        $newEnd = date('Y-m-d', strtotime((string) $c['camp_end'] . ' +' . $len . ' days'));
        $val = number_format((float) $c['camp_value'], 2, ',', '.') . ' €';
        $when = $left === 0 ? 'ističe danas' : ($left === 1 ? 'ističe sutra' : 'ističe za ' . $left . ' dana');
        $body = 'Kampanja ' . $when . ' (' . date('d.m.Y.', strtotime((string) $c['camp_end'])) . '), vrijednost ' . $val . '.'
            . "\nProduljenje: do " . date('d.m.Y.', strtotime($newEnd)) . ' (+' . $len . ' dana). Javite se klijentu prije isteka.';
        if (alert_create($uid, (int) $c['id'], 'camp_soon', 'Kampanja uskoro ističe: ' . $c['name'], $body, ['newEnd' => $newEnd, 'days' => $len, 'end' => (string) $c['camp_end']], 'cs:' . $c['id'] . ':' . $c['camp_end'])) {
            alert_mail($uid, 'Kampanja uskoro ističe: ' . $c['name'], 'kampanja klijenta "' . $c['name'] . "\" " . $when . ".\n\n" . $body . "\n\nU aplikaciji (Pregled > Obavijesti) kampanju možete produljiti jednim klikom.");
            $n++;
        }
    }
    return $n;
}

/* ---------- ne kontaktirati / odjava ---------- */

function dnc_set(): array
{
    static $c = null;
    $c = [];
    foreach (rows('SELECT email FROM do_not_contact') as $r) {
        $c[strtolower((string) $r['email'])] = true;
    }
    return $c;
}

function dnc_has(string $email): bool
{
    $email = strtolower(trim($email));
    return $email !== '' && (bool) row('SELECT id FROM do_not_contact WHERE email = ?', [$email]);
}

function dnc_add(string $email, string $reason, string $source, ?int $by = null): bool
{
    $email = strtolower(trim($email));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || dnc_has($email)) {
        return false;
    }
    $c = row('SELECT id, name, owner_id FROM clients WHERE LOWER(email) = ? LIMIT 1', [$email]);
    run('INSERT INTO do_not_contact (email, client_id, reason, source, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [$email, $c ? (int) $c['id'] : null, mb_substr($reason, 0, 190), $source, $by, ms()]);
    run("UPDATE scheduled_emails SET status = 'cancelled', error = 'Na popisu ne kontaktirati' WHERE LOWER(to_email) = ? AND bulk = 1 AND status IN ('pending','awaiting')", [$email]);
    foreach (rows('SELECT id, name, owner_id FROM clients WHERE LOWER(email) = ?', [$email]) as $cl) {
        $author = (int) ($by ?? $cl['owner_id'] ?? 0);
        if ($author > 0) {
            run('INSERT INTO notes (client_id, author_id, type, body, created_at) VALUES (?, ?, ?, ?, ?)',
                [$cl['id'], $author, 'note', 'Ne kontaktirati: ' . $reason . ' (' . $email . ')', ms()]);
        }
        audit((int) $cl['id'], $by, 'dnc', 'Dodan na popis ne kontaktirati: ' . $reason, (string) $cl['name']);
        if ($source === 'link' && $cl['owner_id']) {
            alert_create((int) $cl['owner_id'], (int) $cl['id'], 'unsub', 'Odjava iz poruka: ' . $cl['name'], 'Klijent se odjavio s grupnih e-mailova. Ne šaljite mu marketinške poruke.', null, 'un:' . $cl['id'] . ':' . $email);
        }
    }
    return true;
}

function unsub_secret(): string
{
    $s = meta_get('unsub_secret');
    if (!$s) {
        $s = bin2hex(random_bytes(32));
        meta_set('unsub_secret', $s);
    }
    return $s;
}

function unsub_token(string $email): string
{
    $email = strtolower(trim($email));
    $e = rtrim(strtr(base64_encode($email), '+/', '-_'), '=');
    return $e . '.' . substr(hash_hmac('sha256', $email, unsub_secret()), 0, 32);
}

function unsub_parse(string $t): ?string
{
    if (!preg_match('/^([A-Za-z0-9_-]+)\.([0-9a-f]{32})$/', $t, $m)) {
        return null;
    }
    $email = base64_decode(strtr($m[1], '-_', '+/'), true);
    if ($email === false || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return null;
    }
    return hash_equals(substr(hash_hmac('sha256', $email, unsub_secret()), 0, 32), $m[2]) ? $email : null;
}

function app_base_url(): string
{
    $u = rtrim(trim((string) cfg('app.url', '')), '/');
    if ($u === '') {
        $u = (string) (meta_get('base_url') ?? '');
    }
    return $u;
}

function unsub_url(string $email): ?string
{
    $b = app_base_url();
    return $b === '' ? null : $b . '/unsubscribe.php?t=' . unsub_token($email);
}

/** Tekst i zaglavlja za grupne poruke. */
function bulk_footer(string $email): array
{
    $url = unsub_url($email);
    if ($url === null) {
        return ['', []];
    }
    return ["\n\n--\nAko ne želite primati naše marketinške poruke, odjavite se ovdje: " . $url,
        ['List-Unsubscribe' => '<' . $url . '>', 'List-Unsubscribe-Post' => 'List-Unsubscribe=One-Click']];
}
