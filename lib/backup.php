<?php
declare(strict_types=1);

/* ---------- sigurnosna kopija baze (backup) ---------- */

const BACKUP_KEEP = 5;
const BACKUP_AUTO_AFTER_MS = 86400000; // 24 h

function backup_dir(): string
{
    $dir = storage_dir() . '/backups';
    if (!is_dir($dir)) {
        @mkdir($dir, 0750, true);
    }
    if (!is_file($dir . '/.htaccess')) {
        @file_put_contents($dir . '/.htaccess', "Require all denied\n");
    }
    if (!is_dir($dir) || !is_writable($dir)) {
        throw new ApiError('Mapa za sigurnosne kopije nije dostupna za pisanje.', 500);
    }
    return $dir;
}

/** @return list<array{name:string,at:int,size:int}> najnovija prva */
function backup_list(): array
{
    $dir = backup_dir();
    $out = [];
    foreach (glob($dir . '/crm-backup-*.json.gz') ?: [] as $f) {
        if (preg_match('/^crm-backup-(\d{8})-(\d{6})\.json\.gz$/', basename($f), $m)) {
            $d = DateTime::createFromFormat('Ymd-His', $m[1] . '-' . $m[2], new DateTimeZone(date_default_timezone_get()));
            $out[] = ['name' => basename($f), 'at' => $d ? $d->getTimestamp() * 1000 : (int) filemtime($f) * 1000, 'size' => (int) filesize($f)];
        }
    }
    usort($out, static fn ($a, $b) => $b['at'] <=> $a['at'] ?: strcmp($b['name'], $a['name']));
    return $out;
}

function backup_tables(PDO $pdo): array
{
    if ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite') {
        $t = $pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")->fetchAll(PDO::FETCH_COLUMN);
    } else {
        $t = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
    }
    return array_values(array_filter(array_map('strval', $t), static fn ($n) => preg_match('/^[A-Za-z0-9_]+$/', $n) === 1));
}

function backup_today_exists(): bool
{
    $today = date('Ymd');
    foreach (backup_list() as $b) {
        if (str_starts_with($b['name'], 'crm-backup-' . $today . '-')) {
            return true;
        }
    }
    return false;
}

/**
 * Pravi cjelovitu kopiju svih tablica (JSON, gzip). Dopušteno je najviše jednom dnevno;
 * nakon uspješne kopije brišu se sve osim zadnjih BACKUP_KEEP.
 */
function backup_create(string $by = 'auto'): array
{
    $dir = backup_dir();
    $lock = fopen($dir . '/.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
        throw new ApiError('Sigurnosna kopija je već u tijeku.', 409);
    }
    try {
        if (backup_today_exists()) {
            throw new ApiError('Današnja sigurnosna kopija već postoji. Kopiju je moguće napraviti samo jednom dnevno.', 409);
        }
        $pdo = db();
        $name = 'crm-backup-' . date('Ymd-His') . '.json.gz';
        $tmp = $dir . '/.tmp-' . bin2hex(random_bytes(6));
        $gz = gzopen($tmp, 'wb6');
        if (!$gz) {
            throw new ApiError('Datoteku kopije nije moguće stvoriti.', 500);
        }
        $counts = [];
        try {
            gzwrite($gz, '{"app":"vip-market","created":' . json_encode(date('c')) . ',"tables":{');
            $first = true;
            foreach (backup_tables($pdo) as $t) {
                gzwrite($gz, ($first ? '' : ',') . json_encode($t) . ':[');
                $first = false;
                $n = 0;
                $off = 0;
                while (true) {
                    $rs = $pdo->query('SELECT * FROM `' . $t . '` LIMIT 500 OFFSET ' . $off)->fetchAll(PDO::FETCH_ASSOC);
                    if (!$rs) {
                        break;
                    }
                    foreach ($rs as $r) {
                        $j = json_encode($r, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR);
                        gzwrite($gz, ($n ? ',' : '') . $j);
                        $n++;
                    }
                    $off += 500;
                }
                gzwrite($gz, ']');
                $counts[$t] = $n;
            }
            gzwrite($gz, '}}');
        } finally {
            gzclose($gz);
        }
        // provjera da se kopija može pročitati
        $chk = json_decode((string) @file_get_contents('compress.zlib://' . $tmp), true);
        if (!is_array($chk) || !isset($chk['tables'])) {
            @unlink($tmp);
            throw new ApiError('Provjera sigurnosne kopije nije uspjela.', 500);
        }
        @chmod($tmp, 0640);
        if (!@rename($tmp, $dir . '/' . $name)) {
            @unlink($tmp);
            throw new ApiError('Spremanje sigurnosne kopije nije uspjelo.', 500);
        }
        // zadrži samo zadnjih BACKUP_KEEP
        foreach (array_slice(backup_list(), BACKUP_KEEP) as $old) {
            @unlink($dir . '/' . $old['name']);
        }
        meta_set('backup_last', (string) ms());
        $rows = array_sum($counts);
        try {
            audit(null, null, 'backup', ($by === 'auto' ? 'Automatska' : 'Ručna (' . $by . ')') . ' sigurnosna kopija: ' . $name . ', ' . count($counts) . ' tablica, ' . $rows . ' zapisa');
        } catch (Throwable $e) {
            // zapisnik nije ključan
        }
        return ['name' => $name, 'tables' => count($counts), 'rows' => $rows];
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

/** Automatski: ako zadnja kopija ne postoji ili je starija od 24 h. */
function backup_auto_if_due(): ?array
{
    $list = backup_list();
    $last = $list ? $list[0]['at'] : 0;
    if ($last > ms() - BACKUP_AUTO_AFTER_MS) {
        return null;
    }
    // ne pokušavaj češće od svakih 30 min ako nešto ne uspijeva
    $try = (int) (meta_get('backup_try') ?? 0);
    if ($try > ms() - 1800000) {
        return null;
    }
    meta_set('backup_try', (string) ms());
    try {
        return backup_create('auto');
    } catch (ApiError $e) {
        return null;
    }
}
