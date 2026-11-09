<?php
declare(strict_types=1);

/* ---------- lijevak Pregovori → Ugovoreno ---------- */

/**
 * Vrijednost klijenta je ili "pregovori" (value_kind = ponudeno) ili "ugovoreno".
 * Trajanje = dani od prve bilješke s oznakom (Pregovori)/(Ponuđeno) do prve bilješke s oznakom (Ugovoreno);
 * ako nema bilješki, koristi se datum unosa klijenta odnosno zadnje promjene.
 */
function pipeline_report(array $u): array
{
    $admin = $u['role'] === 'admin';
    $own = $admin ? '' : ' AND c.owner_id = ' . (int) $u['id'];
    $now = ms();
    $cl = rows("SELECT c.id, c.name, c.value, c.value_kind, c.status, c.owner_id, c.created_at, c.updated_at FROM clients c
        WHERE c.owner_id IS NOT NULL AND c.status <> 'izgubljen' AND c.value > 0" . $own);
    $firstNeg = [];
    foreach (rows("SELECT client_id, MIN(created_at) AS m FROM notes WHERE body LIKE '%(Pregovori)%' OR body LIKE '%(Ponuđeno)%' GROUP BY client_id") as $r) {
        $firstNeg[(int) $r['client_id']] = (int) $r['m'];
    }
    $firstCon = [];
    foreach (rows("SELECT client_id, MIN(created_at) AS m FROM notes WHERE body LIKE '%(Ugovoreno)%' GROUP BY client_id") as $r) {
        $firstCon[(int) $r['client_id']] = (int) $r['m'];
    }
    $by = [];
    $tot = ['neg' => ['n' => 0, 'v' => 0.0, 'age' => 0, 'ageN' => 0], 'con' => ['n' => 0, 'v' => 0.0, 'days' => 0, 'daysN' => 0]];
    $recent = [];
    foreach ($cl as $c) {
        $id = (int) $c['id'];
        $o = (string) $c['owner_id'];
        $by[$o] ??= ['neg' => ['n' => 0, 'v' => 0.0], 'con' => ['n' => 0, 'v' => 0.0]];
        $v = (float) $c['value'];
        if (($c['value_kind'] ?? '') === 'ugovoreno') {
            $tot['con']['n']++;
            $tot['con']['v'] += $v;
            $by[$o]['con']['n']++;
            $by[$o]['con']['v'] += $v;
            $from = $firstNeg[$id] ?? (int) $c['created_at'];
            $to = $firstCon[$id] ?? (int) $c['updated_at'];
            if ($to >= $from) {
                $d = (int) floor(($to - $from) / DAY_MS);
                $tot['con']['days'] += $d;
                $tot['con']['daysN']++;
                $recent[] = ['id' => (string) $id, 'name' => (string) $c['name'], 'value' => $v, 'days' => $d, 'at' => $to, 'owner' => $o];
            }
        } else {
            $tot['neg']['n']++;
            $tot['neg']['v'] += $v;
            $by[$o]['neg']['n']++;
            $by[$o]['neg']['v'] += $v;
            $from = $firstNeg[$id] ?? (int) $c['created_at'];
            $tot['neg']['age'] += (int) floor(($now - $from) / DAY_MS);
            $tot['neg']['ageN']++;
        }
    }
    usort($recent, static fn ($a, $b) => $b['at'] <=> $a['at']);
    $all = $tot['neg']['n'] + $tot['con']['n'];
    $allV = $tot['neg']['v'] + $tot['con']['v'];
    return [
        'negotiating' => ['count' => $tot['neg']['n'], 'value' => round($tot['neg']['v'], 2), 'avgAgeDays' => $tot['neg']['ageN'] ? (int) round($tot['neg']['age'] / $tot['neg']['ageN']) : 0],
        'contracted' => ['count' => $tot['con']['n'], 'value' => round($tot['con']['v'], 2), 'avgDaysToContract' => $tot['con']['daysN'] ? (int) round($tot['con']['days'] / $tot['con']['daysN']) : 0],
        'conversionCount' => $all ? round($tot['con']['n'] * 100 / $all, 1) : 0,
        'conversionValue' => $allV > 0 ? round($tot['con']['v'] * 100 / $allV, 1) : 0,
        'byOwner' => $admin ? $by : (object) [],
        'recent' => array_slice($recent, 0, 8),
        'scope' => $admin ? 'all' : 'mine',
    ];
}

/* ---------- podsjetnik: klijent u pregovorima 5 dana bez kontakta ---------- */

const NEGOTIATION_STALE_DAYS = 5;

function negotiation_reminders_run(): int
{
    $last = (int) (meta_get('neg_rem_last') ?? 0);
    if ($last > ms() - 1800000) {
        return 0;
    }
    meta_set('neg_rem_last', (string) ms());
    $now = ms();
    $dnc = dnc_set();
    $lastNote = [];
    foreach (rows("SELECT client_id, MAX(created_at) AS m FROM notes WHERE type IN ('call','meeting','email','note') GROUP BY client_id") as $r) {
        $lastNote[(int) $r['client_id']] = (int) $r['m'];
    }
    foreach (rows('SELECT client_id, MAX(msg_date) AS m FROM emails WHERE client_id IS NOT NULL AND deleted_at IS NULL GROUP BY client_id') as $r) {
        $lastNote[(int) $r['client_id']] = max($lastNote[(int) $r['client_id']] ?? 0, (int) $r['m']);
    }
    $by = [];
    $cs = rows("SELECT id, name, owner_id, email, created_at FROM clients WHERE owner_id IS NOT NULL
        AND ((status = 'pregovori') OR (value_kind = 'ponudeno' AND value > 0 AND status NOT IN ('aktivni', 'dobiven', 'izgubljen')))");
    foreach ($cs as $c) {
        if ($c['email'] !== '' && isset($dnc[strtolower((string) $c['email'])])) {
            continue;
        }
        $lc = max((int) $c['created_at'], $lastNote[(int) $c['id']] ?? 0);
        $days = (int) floor(($now - $lc) / DAY_MS);
        if ($days < NEGOTIATION_STALE_DAYS) {
            continue;
        }
        $step = (int) floor($days / NEGOTIATION_STALE_DAYS);
        $title = 'Pregovori bez kontakta ' . $days . ' dana: ' . $c['name'];
        $body = 'Klijent je u pregovorima, a zadnji kontakt je bio ' . date('d.m.Y.', (int) ($lc / 1000)) . ' (' . $days . ' dana). Javite se klijentu ili upišite bilješku.';
        if (alert_create((int) $c['owner_id'], (int) $c['id'], 'neg_stale', $title, $body, ['days' => $days], 'ns:' . $c['id'] . ':' . $step . ':' . $lc)) {
            $by[(int) $c['owner_id']][] = '- ' . $c['name'] . ': ' . $days . ' dana bez kontakta';
        }
    }
    $n = 0;
    foreach ($by as $uid => $lines) {
        alert_mail($uid, 'Pregovori: ' . count($lines) . ' ' . (count($lines) === 1 ? 'klijent' : 'klijenata') . ' bez kontakta ' . NEGOTIATION_STALE_DAYS . '+ dana',
            "sljedeći klijenti su u pregovorima, a nisu kontaktirani " . NEGOTIATION_STALE_DAYS . " ili više dana:\n\n" . implode("\n", array_slice($lines, 0, 40)));
        $n += count($lines);
    }
    return $n;
}

/* ---------- ugovori: upozorenja 90 / 60 / 30 / 7 dana prije isteka ---------- */

const CONTRACT_WARN_DAYS = [90, 60, 30, 7];

function contract_renewal_data(array $c): array
{
    $months = camp_months_val($c['camp_months'] ?? 12);
    $godisnji = ($c['camp_type'] ?? '') === 'godisnji';
    $start = date('Y-m-d', strtotime((string) $c['camp_end'] . ' +1 day'));
    if ($godisnji) {
        $end = date('Y-m-d', strtotime($start . ' +' . $months . ' months -1 day'));
        $monthly = round((float) $c['camp_value'] / $months, 2);
    } else {
        $len = campaign_renewal_proposal($c)['days'];
        $end = date('Y-m-d', strtotime($start . ' +' . $len . ' days'));
        $monthly = (float) $c['camp_value'];
    }
    return ['start' => $start, 'end' => $end, 'type' => $godisnji ? 'godisnji' : 'jednokratno', 'months' => $months, 'monthly' => $monthly, 'value' => (float) $c['camp_value']];
}

function campaign_soon_notify(): int
{
    $n = 0;
    $from = date('Y-m-d');
    $to = date('Y-m-d', strtotime('+' . max(CONTRACT_WARN_DAYS) . ' days'));
    foreach (rows('SELECT * FROM clients WHERE camp_active = 1 AND camp_end IS NOT NULL AND camp_end >= ? AND camp_end <= ?', [$from, $to]) as $c) {
        $uid = (int) $c['owner_id'];
        if ($uid <= 0) {
            continue;
        }
        $left = (int) round((strtotime((string) $c['camp_end']) - strtotime($from)) / 86400);
        $level = 0;
        foreach (array_reverse(CONTRACT_WARN_DAYS) as $l) { // najmanja razina koja vrijedi
            if ($left <= $l) {
                $level = $l;
                break;
            }
        }
        if ($level === 0) {
            continue;
        }
        $p = contract_renewal_data($c);
        $val = number_format((float) $c['camp_value'], 2, ',', '.') . ' €';
        $when = $left === 0 ? 'ističe danas' : ($left === 1 ? 'ističe sutra' : 'ističe za ' . $left . ' dana');
        $what = $p['type'] === 'godisnji' ? 'Ugovor' : 'Kampanja';
        $body = $what . ' ' . $when . ' (' . date('d.m.Y.', strtotime((string) $c['camp_end'])) . '), vrijednost ' . $val . '.'
            . "\nProduljenje: " . date('d.m.Y.', strtotime($p['start'])) . ' – ' . date('d.m.Y.', strtotime($p['end']))
            . ($p['type'] === 'godisnji' ? ' (' . $p['months'] . ' mj. × ' . number_format($p['monthly'], 2, ',', '.') . ' €)' : '') . '. Javite se klijentu prije isteka.';
        if (alert_create($uid, (int) $c['id'], 'camp_soon', $what . ' ističe za ' . $left . ' d: ' . $c['name'], $body, $p + ['end0' => (string) $c['camp_end'], 'left' => $left], 'cs:' . $c['id'] . ':' . $c['camp_end'] . ':' . $level)) {
            alert_mail($uid, $what . ' uskoro ističe: ' . $c['name'], 'klijent "' . $c['name'] . "\": " . $body . "\n\nU aplikaciji (Pregled > Obavijesti) možete kliknuti Produži, a podaci su već unaprijed popunjeni.");
            $n++;
        }
    }
    return $n;
}


/* ---------- arhiva izgubljenih: segmenti po gradu / djelatnosti i kampanja "povratak" ---------- */

/** Grad iz adrese: "Ulica 1, 10000 Zagreb" -> "Zagreb". */
function addr_city(string $addr): string
{
    $a = trim($addr);
    if ($a === '') {
        return '';
    }
    if (preg_match('/\b\d{5}\s+([^,;\n]+?)\s*$/u', $a, $m)) {
        return mb_convert_case(trim($m[1]), MB_CASE_TITLE, 'UTF-8');
    }
    $parts = preg_split('/\s*[,;]\s*/u', $a);
    $last = trim((string) end($parts));
    return mb_strlen($last) >= 2 && !preg_match('/\d/u', $last) ? mb_convert_case($last, MB_CASE_TITLE, 'UTF-8') : '';
}

/** @return list<array{id:int,city:string,industry:string}> arhiva s ispravnom e-mail adresom */
function pool_candidates(): array
{
    $out = [];
    foreach (rows('SELECT id, email, address, industry FROM clients WHERE ' . pool_sql() . " AND email <> ''") as $r) {
        if (filter_var(trim((string) $r['email']), FILTER_VALIDATE_EMAIL)) {
            $out[] = ['id' => (int) $r['id'], 'city' => addr_city((string) $r['address']), 'industry' => trim((string) $r['industry'])];
        }
    }
    return $out;
}

function pool_segments(): array
{
    $cities = [];
    $inds = [];
    $all = pool_candidates();
    foreach ($all as $c) {
        $k = $c['city'] !== '' ? $c['city'] : '(bez grada)';
        $cities[$k] = ($cities[$k] ?? 0) + 1;
        if ($c['industry'] !== '') {
            $inds[$c['industry']] = ($inds[$c['industry']] ?? 0) + 1;
        }
    }
    arsort($cities);
    arsort($inds);
    $fmt = static function (array $a, int $n): array {
        $o = [];
        foreach (array_slice($a, 0, $n, true) as $k => $v) {
            $o[] = ['name' => (string) $k, 'count' => $v];
        }
        return $o;
    };
    return ['total' => count($all), 'cities' => $fmt($cities, 80), 'industries' => $fmt($inds, 40)];
}

/** @return list<int> */
function pool_segment_ids(string $city, string $industry, int $limit): array
{
    $ids = [];
    foreach (pool_candidates() as $c) {
        if ($city !== '' && ($city === '(bez grada)' ? $c['city'] !== '' : mb_strtolower($c['city']) !== mb_strtolower($city))) {
            continue;
        }
        if ($industry !== '' && mb_strtolower($c['industry']) !== mb_strtolower($industry)) {
            continue;
        }
        $ids[] = $c['id'];
        if (count($ids) >= $limit) {
            break;
        }
    }
    return $ids;
}
