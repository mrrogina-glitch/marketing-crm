<?php
declare(strict_types=1);

/* E-mail kampanje: provjera hrvatskog pravopisa, AI pisanje i grupno slanje s ograničenjima. */

/* ---------- provjera pravopisa (hrvatski) ---------- */

/** Riječi koje su bez kvačica uvijek pogrešne (nisu druga ispravna riječ). */
const HR_DICT = [
    'cemo' => 'ćemo', 'cete' => 'ćete', 'zelim' => 'želim', 'zelimo' => 'želimo', 'zelite' => 'želite', 'zelis' => 'želiš',
    'mozete' => 'možete', 'mozemo' => 'možemo', 'mozes' => 'možeš', 'moze' => 'može', 'ucinak' => 'učinak', 'ucinkovito' => 'učinkovito',
    'ucinkovita' => 'učinkovita', 'ucinkovit' => 'učinkovit', 'ocekujemo' => 'očekujemo', 'ocekujem' => 'očekujem', 'cekam' => 'čekam',
    'cekamo' => 'čekamo', 'cestitamo' => 'čestitamo', 'cestitam' => 'čestitam', 'trazite' => 'tražite', 'trazim' => 'tražim', 'trazimo' => 'tražimo',
    'postovani' => 'poštovani', 'postovana' => 'poštovana', 'postovano' => 'poštovano', 'postovanje' => 'poštovanje', 'postovanjem' => 'poštovanjem',
    'srdacan' => 'srdačan', 'srdacno' => 'srdačno', 'srdacni' => 'srdačni', 'cim' => 'čim', 'jos' => 'još', 'pocetak' => 'početak',
    'pocetku' => 'početku', 'cesto' => 'često', 'cetvrtak' => 'četvrtak', 'predlazemo' => 'predlažemo', 'predlazem' => 'predlažem',
    'tocno' => 'točno', 'tocka' => 'točka', 'izmedju' => 'između', 'medju' => 'među', 'poslje' => 'poslije', 'naprimjer' => 'na primjer',
    'nedostupan' => 'nedostupan', 'sastajemo' => 'sastajemo', 'cijenu' => 'cijenu', 'ponuda' => 'ponuda', 'pozdrav' => 'pozdrav',
    'zahvaljujemo' => 'zahvaljujemo', 'zahvalni' => 'zahvalni', 'dodatnih' => 'dodatnih', 'nasa' => 'naša', 'nase' => 'naše', 'nasu' => 'našu',
    'vasa' => 'Vaša', 'vase' => 'Vaše', 'vasu' => 'Vašu', 'vasem' => 'Vašem', 'vasoj' => 'Vašoj', 'vasih' => 'Vaših', 'vasim' => 'Vašim', 'vas' => null,
    'pruzamo' => 'pružamo', 'pruzati' => 'pružati', 'pomazemo' => 'pomažemo', 'pomazem' => 'pomažem', 'kontaktirajte' => 'kontaktirajte',
    'cinjenica' => 'činjenica', 'poslovni' => 'poslovni', 'rjesenje' => 'rješenje', 'rjesenja' => 'rješenja', 'kljuc' => 'ključ', 'kljucni' => 'ključni',
    'cestitke' => 'čestitke', 'zadovoljstvo' => 'zadovoljstvo', 'sretan' => 'sretan', 'proslost' => 'prošlost', 'prosli' => 'prošli', 'prosle' => 'prošle',
];

const HR_ABBR = ['tj', 'npr', 'itd', 'itsl', 'dr', 'mr', 'sl', 'tzv', 'br', 'ul', 'usp', 'str', 'god', 'kn', 'eur', 'oko', 'tel', 'mob', 'vl', 'prof', 'ing', 'mag', 'dipl', 'sv', 'apr', 'ca', 'o'];

function hr_match_case(string $orig, string $fix): string
{
    if ($orig !== '' && mb_strtoupper($orig) === $orig && mb_strlen($orig) > 1) {
        return mb_strtoupper($fix);
    }
    if ($orig !== '' && mb_strtoupper(mb_substr($orig, 0, 1)) === mb_substr($orig, 0, 1)) {
        return mb_strtoupper(mb_substr($fix, 0, 1)) . mb_substr($fix, 1);
    }
    return $fix;
}

/**
 * Pravila za najčešće pogreške u poslovnoj korespondenciji.
 * @return array{issues:list<array{kind:string,found:string,fix:?string,msg:string}>,fixed:string}
 */
function hr_spell_scan(string $text): array
{
    $text = str_replace(["\r\n", "\r"], "\n", $text);
    // oznake {{ime}} ne diramo
    $ph = [];
    $masked = preg_replace_callback('/\{\{\w+\}\}/u', static function ($m) use (&$ph) {
        $ph[] = $m[0];
        return "\u{E000}" . (count($ph) - 1) . "\u{E001}";
    }, $text);
    $issues = [];
    $add = static function (string $kind, string $found, ?string $fix, string $msg) use (&$issues): void {
        $key = $kind . '|' . $found;
        foreach ($issues as $i) {
            if ($i['kind'] . '|' . $i['found'] === $key) {
                return;
            }
        }
        $issues[] = ['kind' => $kind, 'found' => $found, 'fix' => $fix, 'msg' => $msg];
    };

    // 1) riječi bez kvačica / uobičajene pogrešne riječi
    foreach (HR_DICT as $bad => $good) {
        if ($good === null || $bad === mb_strtolower($good)) {
            continue;
        }
        $masked = preg_replace_callback('/(?<![\p{L}\x{E000}])' . preg_quote($bad, '/') . '(?![\p{L}])/iu', static function ($m) use ($good, $add) {
            $fix = hr_match_case($m[0], $good);
            $add('pravopis', $m[0], $fix, 'Pogrešno pisanje (nedostaju kvačice ili je riječ pogrešna).');
            return $fix;
        }, $masked);
    }
    // 2) rastavljeno/sastavljeno pisanje
    $rules = [
        ['/(?<![\p{L}])ne\s+(ću|ćeš|će|ćemo|ćete)(?![\p{L}])/iu', static fn ($m) => 'ne' . mb_strtolower($m[1]), 'Niječni oblik pomoćnog glagola pišemo skupa (neću, nećeš, neće…).'],
        ['/(?<![\p{L}])nemo(gu|žeš|že|žemo|žete|gnu)(?![\p{L}])/iu', static fn ($m) => 'ne mo' . $m[1], 'Glagol „moći" u niječnom obliku piše se rastavljeno (ne mogu, ne možete…).'],
        ['/(?<![\p{L}])nebi(?![\p{L}])/iu', static fn ($m) => 'ne bi', 'Pišemo rastavljeno: ne bi.'],
        ['/(?<![\p{L}])bi\s+(smo|ste)(?![\p{L}])/iu', static fn ($m) => 'bi' . mb_strtolower($m[1]), 'Pišemo skupa: bismo, biste.'],
        ['/(?<![\p{L}])(ne)\s+(ce)(?![\p{L}])/iu', static fn ($m) => 'neće', 'Pišemo: neće.'],
    ];
    foreach ($rules as [$re, $fn, $msg]) {
        $masked = preg_replace_callback($re, static function ($m) use ($fn, $add, $msg) {
            $fix = hr_match_case($m[0], (string) $fn($m));
            $add('pravopis', $m[0], $fix, $msg);
            return $fix;
        }, $masked);
    }
    // 3) razmaci i interpunkcija
    $n = 0;
    $masked = preg_replace('/(?<=\S)[ ]{2,}(?=\S)/u', ' ', $masked, -1, $n);
    if ($n) {
        $add('razmak', 'dvostruki razmak', 'jedan razmak', 'Dvostruki razmak.');
    }
    $masked = preg_replace('/[ \t]+([,.;:!?])/u', '$1', $masked, -1, $n);
    if ($n) {
        $add('razmak', 'razmak ispred znaka', 'bez razmaka', 'Ispred zareza, točke i drugih znakova nema razmaka.');
    }
    $masked = preg_replace('/(?<=\p{L}),(?=\p{L})/u', ', ', $masked, -1, $n);
    if ($n) {
        $add('razmak', 'zarez bez razmaka', 'zarez i razmak', 'Iza zareza dolazi razmak.');
    }
    $masked = preg_replace('/(?<=\p{Ll}{2})\.(?=\p{Lu}\p{Ll})/u', '. ', $masked, -1, $n);
    if ($n) {
        $add('razmak', 'točka bez razmaka', 'točka i razmak', 'Iza točke dolazi razmak.');
    }
    // 4) veliko početno slovo na početku rečenice
    $masked = preg_replace_callback('/(\p{L}+)([.!?])([ ]+)(\p{Ll})/u', static function ($m) use ($add) {
        if (in_array(mb_strtolower($m[1]), HR_ABBR, true) || mb_strlen($m[1]) <= 1) {
            return $m[0];
        }
        $add('velikoslovo', $m[2] . ' ' . $m[4], $m[2] . ' ' . mb_strtoupper($m[4]), 'Rečenica počinje velikim slovom.');
        return $m[1] . $m[2] . $m[3] . mb_strtoupper($m[4]);
    }, $masked);
    // 5) ponovljene riječi (samo upozorenje)
    if (preg_match_all('/(?<![\p{L}])(\p{L}{2,})\s+\1(?![\p{L}])/iu', $masked, $mm)) {
        foreach ($mm[0] as $w) {
            $add('ponavljanje', $w, null, 'Ponovljena riječ — provjerite je li namjerno.');
        }
    }
    $fixed = preg_replace_callback("/\u{E000}(\d+)\u{E001}/u", static fn ($m) => $ph[(int) $m[1]] ?? '', $masked);
    return ['issues' => $issues, 'fixed' => $fixed];
}

/* ---------- AI (Anthropic API) ---------- */

function ai_enabled(): bool
{
    return trim((string) cfg('ai.key', '')) !== '';
}

function ai_rate_check(int $userId): void
{
    $k = 'ai_' . $userId . '_' . date('YmdH');
    $n = (int) (meta_get($k) ?? 0);
    if ($n >= 30) {
        throw new ApiError('Dosegnuto je ograničenje od 30 AI zahtjeva na sat. Pokušajte kasnije.', 429);
    }
    meta_set($k, (string) ($n + 1));
}

function ai_complete(string $system, string $user, int $maxTokens = 1200): string
{
    if (!ai_enabled()) {
        throw new ApiError('AI pisanje nije uključeno. Administrator mora upisati AI ključ u config.php (odjeljak "ai").', 409);
    }
    $payload = json_encode([
        'model' => (string) cfg('ai.model', 'claude-sonnet-5-5'),
        'max_tokens' => $maxTokens,
        'system' => $system,
        'messages' => [['role' => 'user', 'content' => $user]],
    ], JSON_UNESCAPED_UNICODE);
    $headers = ['Content-Type: application/json', 'x-api-key: ' . trim((string) cfg('ai.key')), 'anthropic-version: 2023-06-01'];
    $url = (string) cfg('ai.url', 'https://api.anthropic.com/v1/messages');
    $raw = false;
    $code = 0;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $payload, CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_CONNECTTIMEOUT => 10]);
        $raw = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
    } else {
        $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => implode("\r\n", $headers), 'content' => $payload, 'timeout' => 60, 'ignore_errors' => true]]);
        $raw = @file_get_contents($url, false, $ctx);
        $code = 200;
    }
    $d = is_string($raw) ? json_decode($raw, true) : null;
    if (!is_array($d) || $code >= 400) {
        error_log('CRM AI: HTTP ' . $code . ' ' . (is_string($raw) ? mb_substr($raw, 0, 300) : 'no response'));
        throw new ApiError('AI trenutno nije dostupan. Pokušajte ponovno za nekoliko minuta ili napišite tekst ručno.', 502);
    }
    $text = '';
    foreach ($d['content'] ?? [] as $part) {
        if (($part['type'] ?? '') === 'text') {
            $text .= (string) $part['text'];
        }
    }
    $text = trim($text);
    if ($text === '') {
        throw new ApiError('AI nije vratio tekst. Pokušajte ponovno.', 502);
    }
    return $text;
}

const AI_PURPOSES = [
    'prvi' => 'prvi kontakt s potencijalnim klijentom (predstavljanje agencije i prijedlog kratkog razgovora)',
    'ponuda' => 'slanje ponude nakon razgovora',
    'followup' => 'uljudna provjera nakon poslane ponude ili bez odgovora',
    'izgubljen' => 'ponovno javljanje klijentu s kojim je suradnja ranije završila ili nije ostvarena (bez pritiska, uz novu ponudu)',
    'zahvala' => 'zahvala na razgovoru ili suradnji',
    'drugo' => 'poruka prema uputi koja slijedi',
];

/** @return array{subject:string, body:string} */
function ai_draft(array $in, array $u, ?array $client): array
{
    $purpose = AI_PURPOSES[$in['purpose'] ?? ''] ?? AI_PURPOSES['drugo'];
    $hint = trim((string) ($in['hint'] ?? ''));
    $group = empty($in['single']);
    $system = "Ti si iskusan copywriter za poslovnu komunikaciju na hrvatskom jeziku za marketinšku agenciju (radijski oglasi, PR objave na portalima, baner oglašavanje).\n"
        . "Piši uljudno, profesionalno, toplo i sažeto (najviše 150 riječi), bez pritiska i bez pretjeranih obećanja. Ne izmišljaj činjenice, cijene, popuste ni rokove koje korisnik nije naveo.\n"
        . "Piši standardnim hrvatskim jezikom s ispravnim pravopisom i kvačicama (č, ć, š, ž, đ). Obraćaj se s \"Vi\" (velikim početnim slovom: Vi, Vas, Vam, Vaš). Rečenice moraju biti gramatički ispravne.\n"
        . "Počni pozdravom \"Poštovani/a {{ime}},\" i završi s \"Lijep pozdrav,\" — bez imena i potpisa jer se potpis dodaje automatski.\n"
        . ($group
            ? "Poruka ide većem broju primatelja pa koristi samo ove oznake gdje je prirodno: {{ime}}, {{tvrtka}}, {{usluga}}, {{moje_ime}}. Oznake ostavi doslovno.\n"
            : "Poruka ide jednoj osobi. Koristi stvarne podatke naveđene u nastavku, a ne oznake.\n")
        . "Odgovori ISKLJUČIVO valjanim JSON-om oblika {\"subject\":\"...\",\"body\":\"...\"} bez dodatnog teksta; novi redovi u tekstu pišu se kao \\n.";
    $user = 'Svrha poruke: ' . $purpose . ".\n";
    if ($hint !== '') {
        $user .= 'Dodatna uputa korisnika: ' . mb_substr($hint, 0, 1200) . "\n";
    }
    if (!$group && $client) {
        $user .= 'Primatelj: ' . $client['name'] . ($client['contact'] !== '' && $client['kind'] !== 'osoba' ? ', kontakt osoba ' . $client['contact'] : '')
            . ($client['service'] !== '' ? ', zanimanje za uslugu: ' . $client['service'] : '') . ".\nPošiljatelj: " . $u['name'] . ".\n";
    }
    $raw = ai_complete($system, $user, 900);
    $raw = trim(preg_replace('/^```(?:json)?|```$/m', '', $raw));
    $j = json_decode($raw, true);
    if (!is_array($j) && preg_match('/\{.*\}/s', $raw, $m)) {
        $j = json_decode($m[0], true);
    }
    if (!is_array($j) || !isset($j['body'])) {
        throw new ApiError('AI je vratio neočekivan odgovor. Pokušajte ponovno.', 502);
    }
    $subject = trim(str_replace(["\r", "\n"], ' ', (string) ($j['subject'] ?? '')));
    $body = trim((string) $j['body']);
    // lokalna provjera pravopisa nad AI tekstom
    return ['subject' => hr_spell_scan($subject)['fixed'], 'body' => hr_spell_scan($body)['fixed']];
}

function ai_proofread(string $text): string
{
    $system = "Ti si lektor hrvatskog jezika. Ispravi SAMO pravopisne, gramatičke i interpunkcijske pogreške u tekstu poslovnog e-maila (kvačice, veliko/malo slovo, sastavljeno/rastavljeno pisanje, padeže, zareze). "
        . "Ne mijenjaj značenje, stil ni duljinu, zadrži sve prijelome redaka i oznake poput {{ime}} i {{tvrtka}}. Obraćanje s Vi/Vas/Vam/Vaš zadrži velikim početnim slovom. Vrati samo ispravljeni tekst, bez objašnjenja.";
    return ai_complete($system, $text, 1500);
}

/* ---------- grupno slanje ---------- */

function bulk_clients(array $u, array $aud): array
{
    $stages = array_values(array_intersect(array_map('strval', (array) ($aud['statuses'] ?? [])), STAGES));
    if (!$stages) {
        return ['clients' => [], 'noEmail' => 0];
    }
    $sql = 'SELECT * FROM clients WHERE status IN (' . implode(',', array_fill(0, count($stages), '?')) . ')';
    $p = $stages;
    if (in_array($aud['kind'] ?? '', ['tvrtka', 'osoba'], true)) {
        $sql .= ' AND kind = ?';
        $p[] = $aud['kind'];
    }
    $owner = $u['role'] === 'admin' ? (string) (int) ($aud['owner'] ?? 0) : (string) $u['id'];
    if ($owner !== '0') {
        $sql .= ' AND owner_id = ?';
        $p[] = (int) $owner;
    }
    $seen = [];
    $out = [];
    $noEmail = 0;
    foreach (rows($sql . ' ORDER BY name', $p) as $c) {
        $mail = strtolower(trim((string) $c['email']));
        if (!filter_var($mail, FILTER_VALIDATE_EMAIL)) {
            $noEmail++;
            continue;
        }
        if (isset($seen[$mail])) {
            continue;
        }
        $seen[$mail] = 1;
        $out[] = $c;
    }
    return ['clients' => $out, 'noEmail' => $noEmail];
}

function bulk_pending_count(?array $u = null): int
{
    $sql = "SELECT COUNT(*) AS c FROM scheduled_emails WHERE bulk = 1 AND status IN ('pending','sending')";
    $p = [];
    if ($u && $u['role'] !== 'admin') {
        $sql .= ' AND user_id = ?';
        $p[] = $u['id'];
    }
    return (int) row($sql, $p)['c'];
}

/** @param list<int> $ids */
function bulk_queue(array $u, array $ids, string $subjectT, string $bodyT): array
{
    $batch = 'g' . date('ymdHis') . dechex(random_int(16, 255));
    $queued = 0;
    $skipped = 0;
    $denied = 0;
    $now = ms();
    foreach (array_slice(array_values(array_unique($ids)), 0, 1000) as $id) {
        $c = row('SELECT * FROM clients WHERE id = ?', [$id]);
        $mail = $c ? trim((string) $c['email']) : '';
        if (!$c || !filter_var($mail, FILTER_VALIDATE_EMAIL)) {
            $skipped++;
            continue;
        }
        if ($u['role'] !== 'admin' && (int) $c['owner_id'] !== (int) $u['id']) {
            $denied++;
            continue;
        }
        $sender = $c['owner_id'] !== null ? row('SELECT * FROM users WHERE id = ? AND active = 1', [$c['owner_id']]) : null;
        $sender = $sender ?: $u;
        $subject = mb_substr(fill_template_text($subjectT, $c, (string) $sender['name']), 0, 255);
        $body = fill_template_text($bodyT, $c, (string) $sender['name']);
        if (row("SELECT id FROM scheduled_emails WHERE client_id = ? AND subject = ? AND status IN ('pending','sending','sent') AND created_at > ?", [$c['id'], $subject, $now - 30 * DAY_MS])) {
            $skipped++;
            continue;
        }
        run('INSERT INTO scheduled_emails (user_id, client_id, to_email, subject, body, doc_ids, remind_days, send_at, status, attempts, created_at, bulk, batch)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, ?)',
            [$sender['id'], $c['id'], $mail, $subject, $body, '', null, $now, 'pending', $now, $batch]);
        $queued++;
    }
    return ['queued' => $queued, 'skipped' => $skipped, 'denied' => $denied, 'batch' => $batch];
}

function mail_overview(array $u): array
{
    $mine = $u['role'] === 'admin' ? '' : ' AND user_id = ' . (int) $u['id'];
    $batches = [];
    foreach (rows("SELECT batch, MIN(created_at) AS created, MIN(subject) AS subject, COUNT(*) AS total,
            SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
            SUM(CASE WHEN status IN ('pending','sending') THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
        FROM scheduled_emails WHERE bulk = 1 AND batch IS NOT NULL AND created_at > ? $mine GROUP BY batch ORDER BY MIN(created_at) DESC LIMIT 30", [ms() - 60 * DAY_MS]) as $b) {
        $batches[] = ['batch' => (string) $b['batch'], 'created' => (int) $b['created'], 'subject' => (string) $b['subject'], 'total' => (int) $b['total'],
            'sent' => (int) $b['sent'], 'pending' => (int) $b['pending'], 'failed' => (int) $b['failed'], 'cancelled' => (int) $b['cancelled']];
    }
    $pending = bulk_pending_count();
    return [
        'perHour' => bulk_cfg('per_hour'),
        'window' => sprintf('%02d:00–%02d:00', bulk_cfg('from'), bulk_cfg('to')),
        'windowOpen' => bulk_window_open(),
        'sentLastHour' => bulk_sent_last_hour(),
        'pending' => $pending,
        'eta' => $pending > 0 ? bulk_eta($pending) : null,
        'ai' => ai_enabled(),
        'batches' => $batches,
    ];
}
