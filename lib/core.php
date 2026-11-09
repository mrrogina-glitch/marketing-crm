<?php
declare(strict_types=1);

if (!defined('APP_ROOT')) {
    define('APP_ROOT', dirname(__DIR__));
}

const STAGES = ['novi', 'kontaktiran', 'ponuda', 'pregovori', 'aktivni', 'dobiven', 'izgubljen'];
const NOTE_TYPES = ['note', 'call', 'meeting', 'email', 'status'];

final class ApiError extends RuntimeException
{
    public int $status;

    public function __construct(string $message, int $status = 400)
    {
        parent::__construct($message);
        $this->status = $status;
    }
}

/* ---------- config ---------- */

function cfg(?string $path = null, $default = null)
{
    static $c = null;
    if ($c === null) {
        $f = APP_ROOT . '/config.php';
        if (!is_file($f)) {
            http_response_code(500);
            header('Content-Type: text/plain; charset=utf-8');
            exit("Nedostaje config.php. Kopirajte config.sample.php u config.php i upišite podatke baze.\n");
        }
        $c = require $f;
    }
    if ($path === null) {
        return $c;
    }
    $v = $c;
    foreach (explode('.', $path) as $k) {
        if (!is_array($v) || !array_key_exists($k, $v)) {
            return $default;
        }
        $v = $v[$k];
    }
    return $v;
}

function app_boot(): void
{
    date_default_timezone_set((string) cfg('app.timezone', 'Europe/Zagreb'));
    mb_internal_encoding('UTF-8');
    mt_srand();
}

function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

function send_security_headers(bool $csp = true): void
{
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: same-origin');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
    if ($csp) {
        header("Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    }
    if (is_https()) {
        header('Strict-Transport-Security: max-age=31536000');
    }
}

/* ---------- database ---------- */

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $d = cfg('db');
    $dsn = $d['dsn'] ?? ('mysql:host=' . $d['host'] . ';dbname=' . $d['name'] . ';charset=' . ($d['charset'] ?? 'utf8mb4'));
    $pdo = new PDO($dsn, $d['user'] ?? null, $d['pass'] ?? null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    migrate($pdo);
    return $pdo;
}

/**
 * Versioned schema. Add a new numbered step at the end to change the database;
 * it is applied automatically the first time the updated code runs on the server.
 */
function migrate(PDO $pdo): void
{
    $sqlite = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
    $pk = $sqlite ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY';
    $opt = $sqlite ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    $big = $sqlite ? 'INTEGER' : 'BIGINT UNSIGNED';

    $pdo->exec("CREATE TABLE IF NOT EXISTS meta (k VARCHAR(64) NOT NULL PRIMARY KEY, v VARCHAR(255) NOT NULL)$opt");
    $row = $pdo->query("SELECT v FROM meta WHERE k = 'schema'")->fetch();
    $ver = $row ? (int) $row['v'] : 0;

    $steps = [
        1 => [
            "CREATE TABLE users (
                id $pk,
                name VARCHAR(120) NOT NULL,
                email VARCHAR(190) NOT NULL,
                pass_hash VARCHAR(255) NOT NULL,
                role VARCHAR(16) NOT NULL DEFAULT 'sales',
                active TINYINT NOT NULL DEFAULT 1,
                created_at $big NOT NULL,
                last_login $big NULL
            )$opt",
            "CREATE UNIQUE INDEX ux_users_email ON users (email)",
            "CREATE TABLE clients (
                id $pk,
                name VARCHAR(190) NOT NULL,
                contact VARCHAR(190) NOT NULL DEFAULT '',
                email VARCHAR(190) NOT NULL DEFAULT '',
                phone VARCHAR(60) NOT NULL DEFAULT '',
                service VARCHAR(120) NOT NULL DEFAULT '',
                value DECIMAL(12,2) NOT NULL DEFAULT 0,
                status VARCHAR(20) NOT NULL DEFAULT 'novi',
                owner_id $big NULL,
                next_follow_up DATE NULL,
                won_at $big NULL,
                created_by $big NULL,
                created_at $big NOT NULL,
                updated_at $big NOT NULL
            )$opt",
            "CREATE INDEX ix_clients_owner ON clients (owner_id)",
            "CREATE INDEX ix_clients_status ON clients (status)",
            "CREATE TABLE notes (
                id $pk,
                client_id $big NOT NULL,
                author_id $big NOT NULL,
                type VARCHAR(12) NOT NULL DEFAULT 'note',
                subject VARCHAR(255) NULL,
                body TEXT NOT NULL,
                to_email VARCHAR(190) NULL,
                created_at $big NOT NULL
            )$opt",
            "CREATE INDEX ix_notes_client ON notes (client_id, created_at)",
            "CREATE INDEX ix_notes_author ON notes (author_id, created_at)",
            "CREATE TABLE login_attempts (
                id $pk,
                ip VARCHAR(45) NOT NULL,
                created_at $big NOT NULL
            )$opt",
            "CREATE INDEX ix_login_ip ON login_attempts (ip, created_at)",
        ],
        2 => [
            "CREATE TABLE emails (
                id $pk,
                direction VARCHAR(3) NOT NULL,
                uid $big NULL,
                message_id VARCHAR(190) NOT NULL,
                in_reply_to VARCHAR(190) NULL,
                from_email VARCHAR(190) NOT NULL DEFAULT '',
                from_name VARCHAR(190) NOT NULL DEFAULT '',
                reply_to VARCHAR(190) NOT NULL DEFAULT '',
                to_email VARCHAR(190) NOT NULL DEFAULT '',
                subject VARCHAR(255) NOT NULL DEFAULT '',
                body " . ($sqlite ? 'TEXT' : 'MEDIUMTEXT') . " NOT NULL,
                preview VARCHAR(255) NOT NULL DEFAULT '',
                attachments VARCHAR(500) NULL,
                msg_date $big NOT NULL,
                client_id $big NULL,
                user_id $big NULL,
                read_at $big NULL,
                created_at $big NOT NULL
            )$opt",
            "CREATE UNIQUE INDEX ux_emails_mid ON emails (message_id)",
            "CREATE INDEX ix_emails_date ON emails (msg_date)",
            "CREATE INDEX ix_emails_client ON emails (client_id)",
            "CREATE INDEX ix_emails_from ON emails (from_email)",
        ],
        3 => [
            "ALTER TABLE clients ADD kind VARCHAR(8) NOT NULL DEFAULT 'tvrtka'",
            "ALTER TABLE clients ADD oib VARCHAR(20) NOT NULL DEFAULT ''",
            "ALTER TABLE users ADD signature TEXT NULL",
            "ALTER TABLE emails ADD auto TINYINT NOT NULL DEFAULT 0",
            "ALTER TABLE emails ADD remind_days INT NULL",
            "ALTER TABLE emails ADD remind_done_at $big NULL",
            "ALTER TABLE emails ADD remind_notified_at $big NULL",
            "CREATE TABLE settings (k VARCHAR(64) NOT NULL PRIMARY KEY, v TEXT NOT NULL)$opt",
            "CREATE TABLE templates (
                id $pk,
                name VARCHAR(120) NOT NULL,
                subject VARCHAR(255) NOT NULL,
                body TEXT NOT NULL,
                sort_order INT NOT NULL DEFAULT 0,
                updated_at $big NOT NULL
            )$opt",
            "CREATE TABLE scheduled_emails (
                id $pk,
                user_id $big NOT NULL,
                client_id $big NOT NULL,
                to_email VARCHAR(190) NOT NULL,
                subject VARCHAR(255) NOT NULL,
                body TEXT NOT NULL,
                doc_ids VARCHAR(255) NOT NULL DEFAULT '',
                remind_days INT NULL,
                send_at $big NOT NULL,
                status VARCHAR(10) NOT NULL DEFAULT 'pending',
                attempts INT NOT NULL DEFAULT 0,
                error VARCHAR(255) NULL,
                created_at $big NOT NULL,
                sent_at $big NULL
            )$opt",
            "CREATE INDEX ix_sched_due ON scheduled_emails (status, send_at)",
            "CREATE TABLE documents (
                id $pk,
                client_id $big NULL,
                email_id $big NULL,
                filename VARCHAR(190) NOT NULL,
                mime VARCHAR(120) NOT NULL DEFAULT 'application/octet-stream',
                size INT NOT NULL DEFAULT 0,
                stored VARCHAR(64) NOT NULL,
                uploaded_by $big NULL,
                created_at $big NOT NULL
            )$opt",
            "CREATE INDEX ix_docs_client ON documents (client_id)",
            "CREATE INDEX ix_docs_email ON documents (email_id)",
            static function (PDO $pdo): void {
                $ins = $pdo->prepare('INSERT INTO templates (name, subject, body, sort_order, updated_at) VALUES (?, ?, ?, ?, ?)');
                foreach (default_templates() as $i => $t) {
                    $ins->execute([$t[0], $t[1], $t[2], $i + 1, (int) (microtime(true) * 1000)]);
                }
            },
        ],
        4 => [
            "ALTER TABLE templates ADD kind VARCHAR(8) NOT NULL DEFAULT 'email'",
            "ALTER TABLE templates ADD send_mode VARCHAR(8) NOT NULL DEFAULT 'manual'",
            "ALTER TABLE templates ADD send_days INT NOT NULL DEFAULT 1",
            "ALTER TABLE templates ADD send_time VARCHAR(5) NOT NULL DEFAULT '09:00'",
            "ALTER TABLE templates ADD send_fixed $big NULL",
            "ALTER TABLE templates ADD audience VARCHAR(500) NOT NULL DEFAULT ''",
            "ALTER TABLE templates ADD inputs TEXT NULL",
        ],
        5 => [
            "ALTER TABLE emails ADD mailbox INT NOT NULL DEFAULT 1",
        ],
        6 => [
            "ALTER TABLE clients ADD camp_active TINYINT NOT NULL DEFAULT 0",
            "ALTER TABLE clients ADD camp_start DATE NULL",
            "ALTER TABLE clients ADD camp_end DATE NULL",
        ],
        15 => [
            "ALTER TABLE login_attempts ADD email VARCHAR(190) NULL",
            "CREATE TABLE ip_blocks (ip VARCHAR(45) NOT NULL PRIMARY KEY, until_at $big NOT NULL, reason VARCHAR(190) NOT NULL DEFAULT '', created_at $big NOT NULL)$opt",
            "CREATE TABLE login_codes (id $pk, user_id $big NOT NULL, code_hash VARCHAR(160) NOT NULL, expires_at $big NOT NULL, tries INT NOT NULL DEFAULT 0, used TINYINT NOT NULL DEFAULT 0, created_at $big NOT NULL)$opt",
            "CREATE INDEX ix_login_codes_user ON login_codes (user_id, created_at)",
            "CREATE TABLE trusted_devices (id $pk, user_id $big NOT NULL, token_hash VARCHAR(64) NOT NULL, created_at $big NOT NULL, expires_at $big NOT NULL)$opt",
            "CREATE INDEX ix_trusted_tok ON trusted_devices (token_hash)",
            "CREATE TABLE do_not_contact (id $pk, email VARCHAR(190) NOT NULL, client_id $big NULL, reason VARCHAR(190) NOT NULL DEFAULT '', source VARCHAR(12) NOT NULL DEFAULT 'manual', created_by $big NULL, created_at $big NOT NULL)$opt",
            "CREATE UNIQUE INDEX ux_dnc_email ON do_not_contact (email)",
            "CREATE TABLE alerts (id $pk, user_id $big NOT NULL, client_id $big NULL, kind VARCHAR(16) NOT NULL, title VARCHAR(190) NOT NULL, body TEXT NOT NULL, data TEXT NULL, dedupe VARCHAR(100) NULL, created_at $big NOT NULL, done_at $big NULL)$opt",
            "CREATE INDEX ix_alerts_user ON alerts (user_id, done_at)",
            "CREATE UNIQUE INDEX ux_alerts_dedupe ON alerts (dedupe)",
        ],
        21 => [
            "CREATE TABLE user_presence (user_id $big NOT NULL, day DATE NOT NULL, secs INT NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day))$opt",
        ],
        20 => [
            "ALTER TABLE clients ADD has_contract TINYINT NOT NULL DEFAULT 0",
            "ALTER TABLE clients ADD contract_end DATE NULL",
            "ALTER TABLE documents ADD is_contract TINYINT NOT NULL DEFAULT 0",
        ],
        19 => [
            "ALTER TABLE clients ADD next_follow_time VARCHAR(5) NULL",
        ],
        18 => [
            "ALTER TABLE clients ADD value_kind VARCHAR(10) NOT NULL DEFAULT 'ponudeno'",
        ],
        17 => [
            "ALTER TABLE tasks ADD descr TEXT NULL",
            "ALTER TABLE tasks ADD taken_at $big NULL",
            "ALTER TABLE tasks ADD taken_by $big NULL",
            "ALTER TABLE tasks ADD done_by $big NULL",
            "CREATE TABLE task_notes (id $pk, task_id $big NOT NULL, user_id $big NOT NULL, kind VARCHAR(8) NOT NULL DEFAULT 'note', body TEXT NOT NULL, created_at $big NOT NULL)$opt",
            "CREATE INDEX ix_task_notes ON task_notes (task_id, created_at)",
        ],
        16 => [
            "ALTER TABLE clients ADD industry VARCHAR(120) NOT NULL DEFAULT ''",
        ],
        14 => [
            "CREATE TABLE mail_batches (batch VARCHAR(24) NOT NULL PRIMARY KEY, user_id $big NOT NULL, subject VARCHAR(255) NOT NULL, body TEXT NOT NULL, total INT NOT NULL DEFAULT 0, send_at $big NOT NULL, status VARCHAR(12) NOT NULL DEFAULT 'approved', created_at $big NOT NULL, decided_by $big NULL, decided_at $big NULL)$opt",
        ],
        13 => [
            "ALTER TABLE scheduled_emails ADD bulk TINYINT NOT NULL DEFAULT 0",
            "ALTER TABLE scheduled_emails ADD batch VARCHAR(24) NULL",
            "ALTER TABLE notes ADD bulk TINYINT NOT NULL DEFAULT 0",
            "CREATE INDEX ix_sched_bulk ON scheduled_emails (bulk, status, sent_at)",
            static function (PDO $pdo): void {
                $ins = $pdo->prepare('INSERT INTO templates (name, subject, body, sort_order, updated_at) VALUES (?, ?, ?, ?, ?)');
                foreach (campaign_templates() as $i => $t) {
                    $ins->execute([$t[0], $t[1], $t[2], 20 + $i, (int) (microtime(true) * 1000)]);
                }
            },
        ],
        12 => [
            "CREATE TABLE owner_history (id $pk, client_id $big NOT NULL, owner_id $big NOT NULL, from_at $big NOT NULL)$opt",
            "CREATE INDEX ix_ownerhist_client ON owner_history (client_id, from_at)",
            "INSERT INTO owner_history (client_id, owner_id, from_at) SELECT id, owner_id, created_at FROM clients WHERE owner_id IS NOT NULL",
        ],
        11 => [
            "ALTER TABLE emails ADD deleted_at $big NULL",
        ],
        10 => [
            "CREATE TABLE tasks (id $pk, client_id $big NULL, title VARCHAR(300) NOT NULL, due_date DATE NULL, assignee_id $big NOT NULL, created_by $big NOT NULL, created_at $big NOT NULL, done_at $big NULL)$opt",
            "CREATE INDEX ix_tasks_assignee ON tasks (assignee_id, done_at)",
            "CREATE INDEX ix_tasks_client ON tasks (client_id)",
            "CREATE TABLE audit_log (id $pk, client_id $big NULL, client_name VARCHAR(190) NOT NULL DEFAULT '', user_id $big NULL, at $big NOT NULL, action VARCHAR(20) NOT NULL, details TEXT NOT NULL)$opt",
            "CREATE INDEX ix_audit_client ON audit_log (client_id, at)",
            "CREATE INDEX ix_audit_at ON audit_log (at)",
            "ALTER TABLE campaigns ADD service VARCHAR(120) NOT NULL DEFAULT ''",
            "ALTER TABLE campaigns ADD owner_id $big NULL",
            "UPDATE campaigns SET service = COALESCE((SELECT service FROM clients WHERE clients.id = campaigns.client_id), ''), owner_id = (SELECT owner_id FROM clients WHERE clients.id = campaigns.client_id)",
        ],
        9 => [
            "UPDATE clients SET service = ''",
        ],
        8 => [
            "CREATE TABLE user_sessions (id $pk, user_id $big NOT NULL, login_at $big NOT NULL, last_seen_at $big NOT NULL, logout_at $big NULL, end_reason VARCHAR(10) NULL)$opt",
            "CREATE INDEX ix_usess_user ON user_sessions (user_id, login_at)",
            "CREATE TABLE user_activity (id $pk, user_id $big NOT NULL, day DATE NOT NULL, ms $big NOT NULL DEFAULT 0)$opt",
            "CREATE UNIQUE INDEX ux_uact ON user_activity (user_id, day)",
        ],
        7 => [
            "ALTER TABLE clients ADD camp_value DECIMAL(12,2) NOT NULL DEFAULT 0",
            "CREATE TABLE campaigns (
                id $pk,
                client_id $big NOT NULL,
                start_date DATE NULL,
                end_date DATE NOT NULL,
                value DECIMAL(12,2) NOT NULL DEFAULT 0,
                created_by $big NULL,
                created_at $big NOT NULL
            )$opt",
            "CREATE INDEX ix_campaigns_client ON campaigns (client_id)",
        ],
    ];

    ksort($steps);
    foreach ($steps as $n => $sqls) {
        if ($n <= $ver) {
            continue;
        }
        foreach ($sqls as $s) {
            try {
                if ($s instanceof Closure) {
                    $s($pdo);
                } else {
                    $pdo->exec($s);
                }
            } catch (PDOException $e) {
                // makes an interrupted update safe to run again
                if (!preg_match('/duplicate column|already exists|duplicate key name/i', $e->getMessage())) {
                    throw $e;
                }
            }
        }
        $pdo->exec("DELETE FROM meta WHERE k = 'schema'");
        $pdo->exec("INSERT INTO meta (k, v) VALUES ('schema', '" . (int) $n . "')");
    }
}

/** Ready-made e-mail templates seeded on first install. Placeholders: {{ime}} {{tvrtka}} {{usluga}} {{moje_ime}}. The signature is appended automatically. */
function default_templates(): array
{
    return [
        ['Prvi kontakt', 'Više upita za {{tvrtka}} kroz marketing',
            "Poštovani/a {{ime}},\n\nzovem se {{moje_ime}} i javljam Vam se iz marketinške agencije. Tvrtkama poput {{tvrtka}} pomažemo da dobiju više upita, a početak je obično usluga: {{usluga}}.\n\nMogu li Vam predložiti kratki razgovor od 15 minuta ovaj tjedan?\n\nLijep pozdrav,"],
        ['Ponuda', 'Ponuda: {{usluga}} za {{tvrtka}}',
            "Poštovani/a {{ime}},\n\nhvala Vam na razgovoru. Prema dogovoru šaljem Vam ponudu za uslugu: {{usluga}}.\n\nPonuda sadrži opseg usluge, rokove i cijenu. Ako je potrebno, rado ću prilagoditi opseg Vašem proračunu. Ponuda vrijedi 30 dana od datuma slanja.\n\nKada Vam odgovara kratki poziv da prođemo kroz sve stavke?\n\nLijep pozdrav,"],
        ['Follow-up nakon ponude', 'Jeste li stigli pogledati ponudu?',
            "Poštovani/a {{ime}},\n\njavljam se kratko u vezi s ponudom koju sam Vam poslao/la. Ako imate pitanja ili želite promijeniti opseg, slobodno mi se javite, rado ću je prilagoditi.\n\nLijep pozdrav,"],
        ['Follow-up bez odgovora', 'Kratka provjera: {{tvrtka}}',
            "Poštovani/a {{ime}},\n\nnisam siguran/na je li Vam moja prethodna poruka stigla, pa Vam se javljam još jednom. Ako trenutno nije pravi trenutak, slobodno mi recite pa ću se javiti kasnije.\n\nLijep pozdrav,"],
        ['Zahvala nakon sastanka', 'Hvala na razgovoru, {{tvrtka}}',
            "Poštovani/a {{ime}},\n\nhvala Vam na izdvojenom vremenu. Ukratko, dogovorili smo sljedeće:\n\n- \n- \n\nSljedeći korak je moj: poslat ću Vam prijedlog do dogovorenog roka.\n\nLijep pozdrav,"],
        ['Zahvala na suradnji', 'Hvala na povjerenju, {{tvrtka}}',
            "Poštovani/a {{ime}},\n\nzahvaljujemo Vam na povjerenju. Veselimo se suradnji na usluzi: {{usluga}}.\n\nU idućim danima javit ćemo Vam se s popisom potrebnih materijala i terminom početnog sastanka.\n\nLijep pozdrav,"],
    ];
}

/** Predlošci za e-mail kampanje: početni mail i izgubljeni klijenti. */
function campaign_templates(): array
{
    return [
        ['Početni mail (predstavljanje)', 'Predstavljanje suradnje: {{tvrtka}}',
            "Poštovani/a {{ime}},\n\nzovem se {{moje_ime}} i javljam Vam se iz marketinške agencije. Tvrtkama poput {{tvrtka}} pomažemo da kroz radijske oglase, PR objave na portalima i baner oglašavanje dođu do novih kupaca.\n\nRado bih Vam u kratkom razgovoru predstavio/la mogućnosti koje bi bile korisne za Vaše poslovanje. Ako Vam odgovara, javite mi termin koji Vam je prikladan.\n\nUnaprijed zahvaljujem na odgovoru.\n\nLijep pozdrav,"],
        ['Izgubljeni klijent: ponovni kontakt', 'Ponovno se javljamo, {{tvrtka}}',
            "Poštovani/a {{ime}},\n\nprošlo je neko vrijeme otkako smo posljednji put razgovarali o usluzi: {{usluga}}. Razumijemo da tada vrijeme možda nije bilo prikladno, no željeli bismo Vas upoznati s novostima u našoj ponudi.\n\nAko Vas suradnja u međuvremenu zanima, rado ćemo pripremiti novu, prilagođenu ponudu bez ikakvih obveza.\n\nHvala Vam na vremenu i veselimo se Vašem odgovoru.\n\nLijep pozdrav,"],
        ['Izgubljeni klijent: ponuda za povratak', 'Nova ponuda za {{tvrtka}}',
            "Poštovani/a {{ime}},\n\ncijenimo što ste nam ranije ukazali povjerenje te Vam se javljamo s prijedlogom za novu suradnju. Za {{tvrtka}} pripremili smo prilagođenu ponudu za uslugu: {{usluga}}.\n\nAko želite, odgovorite na ovu poruku ili nas nazovite pa ćemo dogovoriti razgovor u terminu koji Vam odgovara.\n\nLijep pozdrav,"],
        ['Izgubljeni klijent: kratka provjera', 'Je li suradnja sada aktualna, {{tvrtka}}?',
            "Poštovani/a {{ime}},\n\nkratko Vam se javljam kako bih provjerio/la je li oglašavanje trenutačno tema u Vašem poslovanju. Ako jest, rado ćemo Vam poslati pregled mogućnosti i okvirne cijene.\n\nAko nije, hvala Vam na dosadašnjem vremenu i slobodno nam se javite kada Vam zatreba podrška.\n\nLijep pozdrav,"],
    ];
}

/** Runs $fn inside a database transaction. */
function transaction(callable $fn)
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $r = $fn();
        $pdo->commit();
        return $r;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}

function row(string $sql, array $p = []): ?array
{
    $s = db()->prepare($sql);
    $s->execute($p);
    $r = $s->fetch();
    return $r === false ? null : $r;
}

function rows(string $sql, array $p = []): array
{
    $s = db()->prepare($sql);
    $s->execute($p);
    return $s->fetchAll();
}

function run(string $sql, array $p = []): int
{
    $s = db()->prepare($sql);
    $s->execute($p);
    return $s->rowCount();
}

function insert_id(): int
{
    return (int) db()->lastInsertId();
}

function ms(): int
{
    return (int) floor(microtime(true) * 1000);
}

function meta_get(string $k): ?string
{
    $r = row('SELECT v FROM meta WHERE k = ?', [$k]);
    return $r ? (string) $r['v'] : null;
}

function meta_set(string $k, string $v): void
{
    run('DELETE FROM meta WHERE k = ?', [$k]);
    run('INSERT INTO meta (k, v) VALUES (?, ?)', [$k, mb_substr($v, 0, 250)]);
}

/* ---------- session and auth ---------- */

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    ini_set('session.use_strict_mode', '1');
    ini_set('session.gc_maxlifetime', '43200');
    session_name('crmsid');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function current_user(): ?array
{
    static $cache = false;
    if ($cache !== false) {
        return $cache;
    }
    start_session();
    $id = $_SESSION['uid'] ?? null;
    $u = null;
    if ($id) {
        $u = row('SELECT id, name, email, role, active, signature FROM users WHERE id = ?', [(int) $id]);
        if (!$u || (int) $u['active'] !== 1) {
            $u = null;
            unset($_SESSION['uid']);
        } elseif ($u['role'] !== 'admin' && !track_activity($u)) {
            $u = null;
        }
    }
    return $cache = $u;
}

const IDLE_LIMIT_MS = 15 * 60 * 1000;

/** Korisnici (ne admin): odjava nakon 15 min bez rada i zbrajanje vremena rada. Vrijeme se broji samo za zahtjeve koje sučelje označi kao aktivne (X-Active). */
function track_activity(array $u): bool
{
    $now = ms();
    $last = (int) ($_SESSION['last_act'] ?? $now);
    if ($now - $last > IDLE_LIMIT_MS) {
        close_user_session('idle', $last);
        $_SESSION = [];
        session_destroy();
        return false;
    }
    if (!empty($_SERVER['HTTP_X_ACTIVE'])) {
        $delta = $now - $last;
        if ($delta > 0 && $delta <= 90000) {
            $day = date('Y-m-d');
            $has = row('SELECT id FROM user_activity WHERE user_id = ? AND day = ?', [$u['id'], $day]);
            if ($has) {
                run('UPDATE user_activity SET ms = ms + ? WHERE id = ?', [$delta, $has['id']]);
            } else {
                run('INSERT INTO user_activity (user_id, day, ms) VALUES (?, ?, ?)', [$u['id'], $day, $delta]);
            }
        }
        $_SESSION['last_act'] = $now;
        if (!empty($_SESSION['usid'])) {
            run('UPDATE user_sessions SET last_seen_at = ? WHERE id = ?', [$now, (int) $_SESSION['usid']]);
        }
    }
    return true;
}

function open_user_session(array $u): void
{
    $now = ms();
    $_SESSION['last_act'] = $now;
    unset($_SESSION['usid']);
    if ($u['role'] !== 'admin') {
        run('INSERT INTO user_sessions (user_id, login_at, last_seen_at) VALUES (?, ?, ?)', [$u['id'], $now, $now]);
        $_SESSION['usid'] = insert_id();
    }
}

function close_user_session(string $reason, ?int $at = null): void
{
    if (!empty($_SESSION['usid'])) {
        run('UPDATE user_sessions SET logout_at = ?, end_reason = ? WHERE id = ? AND logout_at IS NULL', [$at ?? ms(), $reason, (int) $_SESSION['usid']]);
        unset($_SESSION['usid']);
    }
}

/** Statistika korištenja za administratora. */
function usage_report(): array
{
    $today = date('Y-m-d');
    $mon = date('Y-m-d', strtotime('monday this week'));
    $from7 = date('Y-m-d', strtotime('-6 days'));
    $out = [];
    foreach (rows("SELECT id, name, role FROM users WHERE active = 1 AND role <> 'admin' ORDER BY name") as $u) {
        $days = [];
        for ($i = 6; $i >= 0; $i--) {
            $days[date('Y-m-d', strtotime("-$i days"))] = 0;
        }
        $week = 0;
        $todayMs = 0;
        foreach (rows('SELECT day, ms FROM user_activity WHERE user_id = ? AND day >= ?', [$u['id'], min($mon, $from7)]) as $r) {
            $d = (string) $r['day'];
            if (isset($days[$d])) {
                $days[$d] = (int) $r['ms'];
            }
            if ($d >= $mon) {
                $week += (int) $r['ms'];
            }
            if ($d === $today) {
                $todayMs = (int) $r['ms'];
            }
        }
        $ls = row('SELECT login_at, last_seen_at, logout_at FROM user_sessions WHERE user_id = ? ORDER BY login_at DESC LIMIT 1', [$u['id']]);
        $logins = rows('SELECT login_at, last_seen_at, logout_at, end_reason FROM user_sessions WHERE user_id = ? ORDER BY login_at DESC LIMIT 5', [$u['id']]);
        $out[] = [
            'id' => (string) $u['id'],
            'name' => (string) $u['name'],
            'todayMs' => $todayMs,
            'weekMs' => $week,
            'lastLogin' => $ls ? (int) $ls['login_at'] : 0,
            'lastSeen' => $ls ? (int) $ls['last_seen_at'] : 0,
            'online' => $ls && empty($ls['logout_at']) && (int) $ls['last_seen_at'] > ms() - 3 * 60000,
            'days' => array_map(static fn ($d, $v) => ['d' => $d, 'ms' => $v], array_keys($days), array_values($days)),
            'logins' => array_map(static fn ($r) => ['at' => (int) $r['login_at'], 'end' => $r['logout_at'] ? (int) $r['logout_at'] : 0, 'why' => (string) ($r['end_reason'] ?? ''), 'seen' => (int) $r['last_seen_at']], $logins),
        ];
    }
    return $out;
}

function csrf_token(): string
{
    start_session();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function csrf_ok(): bool
{
    start_session();
    $t = $_SESSION['csrf'] ?? '';
    return $t !== '' && hash_equals($t, (string) ($_SERVER['HTTP_X_CSRF'] ?? ''));
}

function client_ip(): string
{
    return substr((string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'), 0, 45);
}

/* ---------- validation ---------- */

function f_str(array $in, string $k, int $max, string $label, bool $required = false): string
{
    $v = $in[$k] ?? '';
    $v = (is_string($v) || is_numeric($v)) ? trim((string) $v) : '';
    if ($required && $v === '') {
        throw new ApiError("$label je obavezno.");
    }
    if (mb_strlen($v) > $max) {
        throw new ApiError("$label je predugo (najviše $max znakova).");
    }
    return $v;
}

function f_email(array $in, string $k, bool $required = false): string
{
    $v = f_str($in, $k, 190, 'E-mail', $required);
    if ($v !== '' && !filter_var($v, FILTER_VALIDATE_EMAIL)) {
        throw new ApiError('E-mail adresa nije ispravna.');
    }
    return $v;
}

function f_date($v): ?string
{
    $v = is_string($v) ? trim($v) : '';
    if ($v === '') {
        return null;
    }
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $m) || !checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
        throw new ApiError('Datum nije ispravan.');
    }
    return $v;
}

function f_value($v): string
{
    if ($v === '' || $v === null) {
        return '0';
    }
    if (!is_numeric($v) || (float) $v < 0 || (float) $v > 999999999) {
        throw new ApiError('Vrijednost nije ispravna.');
    }
    return number_format((float) $v, 2, '.', '');
}

function f_status($v): string
{
    if (!is_string($v) || !in_array($v, STAGES, true)) {
        throw new ApiError('Status nije ispravan.');
    }
    return $v;
}

function f_text(array $in, string $k, string $label): string
{
    $v = f_str($in, $k, 5000, $label, true);
    if (mb_strlen($v) < 3) {
        throw new ApiError("$label je obavezna. Upišite barem nekoliko riječi.");
    }
    return $v;
}

function f_kind(array $in, string $default = 'tvrtka'): string
{
    $v = $in['kind'] ?? $default;
    if (!is_string($v) || !in_array($v, ['tvrtka', 'osoba'], true)) {
        throw new ApiError('Odaberite vrstu klijenta: tvrtka ili fizička osoba.');
    }
    return $v;
}

/** OIB: 11 digits with the ISO 7064 (MOD 11,10) check digit; empty is allowed. */
function f_oib(array $in): string
{
    $v = f_str($in, 'oib', 20, 'OIB');
    if ($v === '') {
        return '';
    }
    if (!preg_match('/^\d{11}$/', $v)) {
        throw new ApiError('OIB mora imati točno 11 znamenki.');
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
    if ($c !== (int) $v[10]) {
        throw new ApiError('OIB nije ispravan.');
    }
    return $v;
}
