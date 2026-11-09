<?php
declare(strict_types=1);

/* ---------- duplikati klijenata i uvoz iz Excela/CSV-a ---------- */

function name_key(string $n): string
{
    $n = mb_strtolower($n);
    $n = strtr($n, ['č' => 'c', 'ć' => 'c', 'ž' => 'z', 'š' => 's', 'đ' => 'd', 'dž' => 'dz', 'ä' => 'a', 'ö' => 'o', 'ü' => 'u']);
    $n = preg_replace('/[^a-z0-9 ]+/u', ' ', $n) ?? '';
    $drop = ['doo', 'jdoo', 'dd', 'obrt', 'vl', 'vlasnik', 'ltd', 'gmbh', 'd', 'o', 'j', 'sa', 'za', 'i'];
    $w = array_values(array_filter(preg_split('/\s+/', trim($n)) ?: [], static fn ($x) => $x !== '' && !in_array($x, $drop, true)));
    return implode(' ', $w);
}

function phone_key(string $p): string
{
    $d = preg_replace('/\D+/', '', $p) ?? '';
    $d = preg_replace('/^(00)?385/', '0', $d) ?? $d;
    return strlen($d) >= 8 ? ltrim($d, '0') : '';
}

/** @return list<array{ids:list<string>,reasons:list<string>}> */
function dup_groups(): array
{
    $cl = rows('SELECT id, name, oib, email, phone FROM clients ORDER BY id');
    $parent = [];
    $find = function (int $x) use (&$parent, &$find): int {
        while ($parent[$x] !== $x) {
            $parent[$x] = $parent[$parent[$x]];
            $x = $parent[$x];
        }
        return $x;
    };
    $maps = ['OIB' => [], 'e-mail' => [], 'telefon' => [], 'naziv' => []];
    $why = [];
    foreach ($cl as $c) {
        $id = (int) $c['id'];
        $parent[$id] = $id;
        $keys = ['OIB' => (string) $c['oib'], 'e-mail' => strtolower(trim((string) $c['email'])), 'telefon' => phone_key((string) $c['phone']), 'naziv' => name_key((string) $c['name'])];
        if (mb_strlen($keys['naziv']) < 4) {
            $keys['naziv'] = '';
        }
        foreach ($keys as $t => $k) {
            if ($k === '') {
                continue;
            }
            if (isset($maps[$t][$k])) {
                $a = $find($maps[$t][$k]);
                $b = $find($id);
                if ($a !== $b) {
                    $parent[$b] = $a;
                }
                $why[$a][$t] = true;
                $why[$id][$t] = true;
            } else {
                $maps[$t][$k] = $id;
            }
        }
    }
    $g = [];
    foreach ($cl as $c) {
        $g[$find((int) $c['id'])][] = (string) $c['id'];
    }
    $ignored = json_decode((string) (setting_get('dup_ignored', '[]')), true) ?: [];
    $out = [];
    foreach ($g as $root => $ids) {
        if (count($ids) < 2 || in_array(implode(',', $ids), $ignored, true)) {
            continue;
        }
        $reasons = [];
        foreach ($ids as $i) {
            foreach (array_keys($why[(int) $i] ?? []) as $t) {
                $reasons[$t] = true;
            }
        }
        $out[] = ['ids' => $ids, 'reasons' => array_keys($reasons)];
    }
    return $out;
}

function tables_with_client_id(): array
{
    $pdo = db();
    $t = [];
    if ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite') {
        foreach ($pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")->fetchAll(PDO::FETCH_COLUMN) as $n) {
            foreach ($pdo->query('PRAGMA table_info(`' . $n . '`)')->fetchAll() as $col) {
                if ($col['name'] === 'client_id') {
                    $t[] = (string) $n;
                }
            }
        }
    } else {
        $t = $pdo->query("SELECT table_name FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'client_id'")->fetchAll(PDO::FETCH_COLUMN);
    }
    return array_values(array_filter(array_map('strval', $t), static fn ($n) => preg_match('/^[A-Za-z0-9_]+$/', $n) === 1 && $n !== 'owner_history'));
}

function clients_merge(int $keepId, array $removeIds, int $userId): array
{
    $removeIds = array_values(array_unique(array_filter(array_map('intval', $removeIds), static fn ($i) => $i > 0 && $i !== $keepId)));
    if (!$removeIds) {
        throw new ApiError('Odaberite barem jednog klijenta za spajanje.');
    }
    $keep = row('SELECT * FROM clients WHERE id = ?', [$keepId]);
    if (!$keep) {
        throw new ApiError('Glavni klijent ne postoji.', 404);
    }
    $tables = tables_with_client_id();
    $moved = 0;
    transaction(static function () use ($keep, $keepId, $removeIds, $tables, $userId, &$moved): void {
        foreach ($removeIds as $rid) {
            $r = row('SELECT * FROM clients WHERE id = ?', [$rid]);
            if (!$r) {
                continue;
            }
            $fill = [];
            foreach (['oib', 'email', 'phone', 'contact', 'service', 'industry'] as $f) {
                if ((string) ($keep[$f] ?? '') === '' && (string) ($r[$f] ?? '') !== '') {
                    $fill[$f] = $r[$f];
                    $keep[$f] = $r[$f];
                }
            }
            if ((int) $keep['camp_active'] === 0 && (int) $r['camp_active'] === 1) {
                foreach (['camp_active', 'camp_start', 'camp_end', 'camp_value', 'camp_type', 'camp_months'] as $f) {
                    $fill[$f] = $r[$f];
                    $keep[$f] = $r[$f];
                }
            }
            if ($fill) {
                $set = implode(', ', array_map(static fn ($f) => $f . ' = ?', array_keys($fill)));
                run('UPDATE clients SET ' . $set . ', updated_at = ? WHERE id = ?', array_merge(array_values($fill), [ms(), $keepId]));
            }
            foreach ($tables as $t) {
                $moved += (int) run('UPDATE `' . $t . '` SET client_id = ? WHERE client_id = ?', [$keepId, $rid]);
            }
            run('DELETE FROM owner_history WHERE client_id = ?', [$rid]);
            run('INSERT INTO notes (client_id, author_id, type, body, created_at) VALUES (?, ?, ?, ?, ?)',
                [$keepId, $userId, 'note', 'Spojen duplikat: ' . $r['name'] . ($r['email'] !== '' ? ' (' . $r['email'] . ')' : '') . '. Bilješke, zadaci, e-mailovi i dokumenti prebačeni na ovog klijenta.', ms()]);
            audit($keepId, $userId, 'merge', 'Spojen duplikat: ' . $r['name'] . ' (ID ' . $rid . ')', (string) $keep['name']);
            run('DELETE FROM clients WHERE id = ?', [$rid]);
        }
    });
    return ['merged' => count($removeIds), 'moved' => $moved];
}

/* ---------- čitanje datoteke ---------- */

function col_index(string $ref): int
{
    $n = 0;
    foreach (str_split(strtoupper(preg_replace('/\d+/', '', $ref) ?? '')) as $ch) {
        $n = $n * 26 + (ord($ch) - 64);
    }
    return $n - 1;
}

function read_xlsx(string $path): array
{
    if (!class_exists('ZipArchive')) {
        throw new ApiError('Poslužitelj ne podržava čitanje .xlsx datoteka. Spremite tablicu kao CSV.', 501);
    }
    $z = new ZipArchive();
    if ($z->open($path) !== true) {
        throw new ApiError('Datoteka nije valjana .xlsx tablica.');
    }
    $ss = [];
    $x = $z->getFromName('xl/sharedStrings.xml');
    if ($x !== false) {
        $sx = @simplexml_load_string($x, 'SimpleXMLElement', LIBXML_NONET);
        if ($sx) {
            foreach ($sx->si as $si) {
                $t = '';
                if (isset($si->t)) {
                    $t = (string) $si->t;
                } else {
                    foreach ($si->r as $r) {
                        $t .= (string) $r->t;
                    }
                }
                $ss[] = $t;
            }
        }
    }
    $sheet = null;
    foreach (['xl/worksheets/sheet1.xml'] as $n) {
        $sheet = $z->getFromName($n);
    }
    if ($sheet === false || $sheet === null) {
        for ($i = 0; $i < $z->numFiles; $i++) {
            $n = (string) $z->getNameIndex($i);
            if (preg_match('#^xl/worksheets/[^/]+\.xml$#', $n)) {
                $sheet = $z->getFromIndex($i);
                break;
            }
        }
    }
    $z->close();
    if (!$sheet) {
        throw new ApiError('U datoteci nema radnog lista.');
    }
    $sx = @simplexml_load_string((string) $sheet, 'SimpleXMLElement', LIBXML_NONET);
    if (!$sx) {
        throw new ApiError('Radni list nije moguće pročitati.');
    }
    $rows = [];
    foreach ($sx->sheetData->row as $r) {
        $line = [];
        foreach ($r->c as $c) {
            $i = col_index((string) $c['r']);
            $t = (string) $c['t'];
            if ($t === 's') {
                $v = $ss[(int) $c->v] ?? '';
            } elseif ($t === 'inlineStr') {
                $v = (string) $c->is->t;
            } else {
                $v = (string) $c->v;
                if ($t === '' && $v !== '' && is_numeric($v) && preg_match('/^-?\d+\.\d+E[+-]?\d+$/i', $v)) {
                    $v = rtrim(rtrim(sprintf('%.0f', (float) $v), '0'), '.');
                }
            }
            $line[$i] = trim($v);
        }
        if ($line) {
            $max = max(array_keys($line));
            $row = [];
            for ($k = 0; $k <= $max; $k++) {
                $row[] = $line[$k] ?? '';
            }
            $rows[] = $row;
        }
        if (count($rows) > 5001) {
            break;
        }
    }
    return $rows;
}

function read_csv_file(string $path): array
{
    $raw = (string) file_get_contents($path);
    if (str_starts_with($raw, "\xEF\xBB\xBF")) {
        $raw = substr($raw, 3);
    }
    if (!mb_check_encoding($raw, 'UTF-8')) {
        $raw = mb_convert_encoding($raw, 'UTF-8', 'Windows-1250');
    }
    $first = strtok($raw, "\n") ?: '';
    $delim = substr_count($first, ';') >= substr_count($first, ',') ? ';' : ',';
    if (substr_count($first, "\t") > substr_count($first, $delim)) {
        $delim = "\t";
    }
    $fh = fopen('php://memory', 'w+');
    fwrite($fh, $raw);
    rewind($fh);
    $rows = [];
    while (($r = fgetcsv($fh, 0, $delim, '"', '')) !== false) {
        if ($r === [null]) {
            continue;
        }
        $rows[] = array_map(static fn ($v) => trim((string) $v), $r);
        if (count($rows) > 5001) {
            break;
        }
    }
    fclose($fh);
    return $rows;
}

const IMPORT_MAP = [
    'name' => ['naziv', 'nazivtvrtke', 'tvrtka', 'ime', 'imeiprezime', 'klijent', 'firma', 'name', 'company', 'nazivklijenta', 'nazivpoduzeca'],
    'contact' => ['kontakt', 'kontaktosoba', 'osoba', 'contact', 'kontaktnaosoba'],
    'oib' => ['oib'],
    'address' => ['adresa', 'lokacija', 'address', 'adresasjedišta', 'sjedište'],
    'email' => ['email', 'e-mail', 'mail', 'emailadresa', 'e-mailadresa', 'epošta', 'eposta'],
    'phone' => ['telefon', 'tel', 'mobitel', 'gsm', 'phone', 'mob', 'brojtelefona'],
    'service' => ['usluga', 'usluge', 'service'],
    'industry' => ['djelatnost', 'djelatnosti', 'industry', 'branša', 'bransa', 'sektor', 'nacekod', 'nacedjelatnost'],
    'value' => ['vrijednost', 'iznos', 'value', 'cijena'],
    'status' => ['status', 'faza'],
    'note' => ['napomena', 'bilješka', 'biljeska', 'opis', 'note', 'komentar'],
    'kind' => ['vrsta', 'tip', 'kind', 'vrstaklijenta'],
];

function import_header_key(string $h): string
{
    $h = mb_strtolower(trim($h));
    return preg_replace('/[^a-z0-9šđčćž@-]+/u', '', $h) ?? '';
}

function import_parse(string $path, string $ext): array
{
    $rows = $ext === 'xlsx' ? read_xlsx($path) : read_csv_file($path);
    if (count($rows) < 2) {
        throw new ApiError('Datoteka nema podataka (potreban je zaglavlje i barem jedan redak).');
    }
    if (count($rows) > 5001) {
        throw new ApiError('Najviše 5000 redaka po uvozu. Podijelite datoteku.');
    }
    $head = $rows[0];
    $map = [];
    foreach ($head as $i => $h) {
        $k = import_header_key((string) $h);
        foreach (IMPORT_MAP as $field => $syn) {
            if (!isset($map[$field]) && in_array($k, array_map('import_header_key', $syn), true)) {
                $map[$field] = $i;
            }
        }
    }
    if (!isset($map['name'])) {
        throw new ApiError('Nije pronađen stupac naziva. Prvi redak mora imati zaglavlja (npr. Naziv, Kontakt, OIB, E-mail, Telefon).');
    }
    $data = [];
    foreach (array_slice($rows, 1) as $n => $r) {
        $rec = [];
        foreach ($map as $f => $i) {
            $rec[$f] = trim((string) ($r[$i] ?? ''));
        }
        if (implode('', $rec) === '') {
            continue;
        }
        $rec['_row'] = $n + 2;
        $data[] = $rec;
    }
    return [$data, array_map(static fn ($f) => (string) ($head[$map[$f]] ?? ''), array_keys($map)), array_keys($map)];
}

function valid_oib(string $v): bool
{
    if (!preg_match('/^\d{11}$/', $v)) {
        return false;
    }
    $a = 10;
    for ($i = 0; $i < 10; $i++) {
        $a = ($a + (int) $v[$i]) % 10;
        if ($a === 0) {
            $a = 10;
        }
        $a = ($a * 2) % 11;
    }
    $c = 11 - $a;
    if ($c === 10) {
        $c = 0;
    }
    return $c === (int) $v[10];
}

/** Provjera redaka: greške i duplikati (u bazi i unutar datoteke). */
function import_check(array $data): array
{
    $ex = ['oib' => [], 'email' => [], 'phone' => [], 'name' => []];
    foreach (rows('SELECT id, name, oib, email, phone FROM clients') as $c) {
        if ($c['oib'] !== '') {
            $ex['oib'][$c['oib']] = $c;
        }
        if ($c['email'] !== '') {
            $ex['email'][strtolower(trim((string) $c['email']))] = $c;
        }
        if (($pk = phone_key((string) $c['phone'])) !== '') {
            $ex['phone'][$pk] = $c;
        }
        if (mb_strlen($nk = name_key((string) $c['name'])) >= 4) {
            $ex['name'][$nk] = $c;
        }
    }
    $seen = ['oib' => [], 'email' => [], 'phone' => [], 'name' => []];
    $dnc = dnc_set();
    $out = [];
    foreach ($data as $r) {
        $err = [];
        $dup = null;
        $name = $r['name'] ?? '';
        if ($name === '') {
            $err[] = 'nedostaje naziv';
        } elseif (mb_strlen($name) > 190) {
            $err[] = 'naziv je predug';
        }
        $email = strtolower(trim($r['email'] ?? ''));
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $err[] = 'neispravan e-mail';
        }
        $oib = preg_replace('/\s+/', '', $r['oib'] ?? '') ?? '';
        if (preg_match('/^\d{1,10}$/', $oib)) {
            $oib = str_pad($oib, 11, '0', STR_PAD_LEFT); // Excel je izbrisao početne nule
        }
        if ($oib !== '' && !valid_oib($oib)) {
            $err[] = 'neispravan OIB';
        }
        $status = mb_strtolower($r['status'] ?? '');
        $statusMap = ['novi' => 'novi', 'novi kontakt' => 'novi', 'kontaktiran' => 'kontaktiran', 'ponuda' => 'ponuda', 'ponuda poslana' => 'ponuda', 'pregovori' => 'pregovori', 'aktivni' => 'aktivni', 'dobiven' => 'dobiven', 'izgubljen' => 'izgubljen'];
        if ($status !== '' && !isset($statusMap[$status])) {
            $err[] = 'nepoznat status "' . $r['status'] . '"';
        }
        $val = $r['value'] ?? '';
        if ($val !== '' && !preg_match('/^-?[\d.,\s]+$/', $val)) {
            $err[] = 'neispravna vrijednost';
        }
        $keys = ['oib' => $oib, 'email' => $email, 'phone' => phone_key($r['phone'] ?? ''), 'name' => name_key($name)];
        if (mb_strlen($keys['name']) < 4) {
            $keys['name'] = '';
        }
        $note = [];
        foreach ($keys as $t => $k) {
            if ($k === '' || $dup) {
                continue;
            }
            if (isset($ex[$t][$k])) {
                $dup = ['type' => $t, 'where' => 'baza', 'id' => (string) $ex[$t][$k]['id'], 'name' => (string) $ex[$t][$k]['name']];
            } elseif (isset($seen[$t][$k])) {
                $dup = ['type' => $t, 'where' => 'datoteka', 'id' => '', 'name' => 'redak ' . $seen[$t][$k]];
            }
        }
        foreach ($keys as $t => $k) {
            if ($k !== '' && !isset($seen[$t][$k])) {
                $seen[$t][$k] = $r['_row'];
            }
        }
        if ($email !== '' && isset($dnc[$email])) {
            $note[] = 'na popisu ne kontaktirati';
        }
        $out[] = ['row' => (int) $r['_row'], 'rec' => $r + ['oib_fixed' => $oib], 'errors' => $err, 'dup' => $dup, 'notes' => $note];
    }
    return $out;
}

function num_hr(string $v): float
{
    $v = preg_replace('/[\s\x{00A0}€]/u', '', $v) ?? '';
    if (str_contains($v, ',') && str_contains($v, '.')) {
        $v = str_replace('.', '', $v);
        $v = str_replace(',', '.', $v);
    } elseif (str_contains($v, ',')) {
        $v = str_replace(',', '.', $v);
    } elseif (preg_match('/^\d{1,3}(\.\d{3})+$/', $v)) {
        $v = str_replace('.', '', $v);
    }
    return is_numeric($v) ? max(0.0, min(999999999.0, (float) $v)) : 0.0;
}
