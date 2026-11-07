<?php
declare(strict_types=1);

/**
 * Small IMAP client over sockets (no PHP imap extension needed) plus a MIME reader.
 * Settings: config.php, section "imap" (falls back to the "mail" credentials).
 */

/* ---------- Inbox 2: podaci spremljeni iz Postavki (lozinka je šifrirana) ---------- */

function imap2_key(): string
{
    return hash('sha256', 'imap2|' . (string) cfg('db.pass', '') . '|' . (string) cfg('install_key', ''), true);
}

function imap2_encrypt(string $plain): string
{
    if (!function_exists('openssl_encrypt')) {
        throw new ApiError('Poslužitelj nema OpenSSL pa se lozinka ne može sigurno spremiti. Upišite je u config.php.', 500);
    }
    $iv = random_bytes(16);
    return base64_encode($iv . openssl_encrypt($plain, 'aes-256-cbc', imap2_key(), OPENSSL_RAW_DATA, $iv));
}

function imap2_decrypt(string $enc): string
{
    $raw = base64_decode($enc, true);
    if ($raw === false || strlen($raw) < 17 || !function_exists('openssl_decrypt')) {
        return '';
    }
    $r = openssl_decrypt(substr($raw, 16), 'aes-256-cbc', imap2_key(), OPENSSL_RAW_DATA, substr($raw, 0, 16));
    return $r === false ? '' : $r;
}

/** Inbox 2 settings saved through the Postavke page, or null. Includes the decrypted password. */
function imap2_stored(): ?array
{
    $j = setting_get('imap2');
    $d = $j ? json_decode($j, true) : null;
    if (!is_array($d) || empty($d['host']) || empty($d['user'])) {
        return null;
    }
    $d['pass'] = imap2_decrypt((string) ($d['pass_enc'] ?? ''));
    unset($d['pass_enc']);
    return $d;
}

/** $box 1 = glavni sandučić (config 'imap'), 2 = dodatni sandučić samo za primanje (config 'imap2'). */
function imap_cfg(int $box = 1): ?array
{
    if ($box === 2) {
        $i2 = imap2_stored() ?? cfg('imap2');
        if (!is_array($i2) || empty($i2['user']) || empty($i2['pass'])) {
            return null;
        }
        $base = cfg('imap');
        $i2 += is_array($base) ? array_diff_key($base, ['user' => 1, 'pass' => 1, 'folder' => 1, 'sent_folder' => 1]) : [];
        $i2['folder'] = $i2['folder'] ?? 'INBOX';
        $i2['sent_folder'] = '';
        return empty($i2['host']) ? null : $i2;
    }
    $i = cfg('imap');
    $m = cfg('mail');
    if (!is_array($i) || empty($i['host'])) {
        return null;
    }
    $i['user'] = $i['user'] ?? ($m['user'] ?? '');
    $i['pass'] = $i['pass'] ?? ($m['pass'] ?? '');
    if (($i['user'] ?? '') === '') {
        return null;
    }
    return $i;
}

final class ImapClient
{
    /** @var resource */
    private $fp;
    private int $n = 0;

    public function __construct(array $c)
    {
        $secure = (string) ($c['secure'] ?? 'ssl');
        $verify = ($c['verify_peer'] ?? true) !== false;
        $ctx = stream_context_create(['ssl' => ['verify_peer' => $verify, 'verify_peer_name' => $verify, 'SNI_enabled' => true]]);
        $remote = ($secure === 'ssl' ? 'ssl://' : 'tcp://') . $c['host'] . ':' . (int) ($c['port'] ?? 993);
        $fp = @stream_socket_client($remote, $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx);
        if (!$fp) {
            throw new MailException("Povezivanje na IMAP poslužitelj nije uspjelo: $errstr ($errno)");
        }
        $this->fp = $fp;
        stream_set_timeout($this->fp, 30);
        $greet = $this->line();
        if (strpos($greet, '* OK') !== 0 && strpos($greet, '* PREAUTH') !== 0) {
            throw new MailException('IMAP pozdrav nije u redu: ' . trim($greet));
        }
        if ($secure === 'tls') {
            $this->command('STARTTLS');
            if (!@stream_socket_enable_crypto($this->fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                throw new MailException('TLS veza (STARTTLS) za IMAP nije uspostavljena.');
            }
        }
        $r = $this->command('LOGIN ' . self::quote((string) $c['user']) . ' ' . self::quote((string) $c['pass']), false);
        if ($r['status'] !== 'OK') {
            throw new MailException('IMAP prijava nije uspjela: ' . $r['text']);
        }
    }

    public static function quote(string $s): string
    {
        return '"' . str_replace(['\\', '"', "\r", "\n"], ['\\\\', '\\"', '', ''], $s) . '"';
    }

    private function line(): string
    {
        $l = fgets($this->fp, 65536);
        if ($l === false) {
            throw new MailException('IMAP veza je prekinuta.');
        }
        return $l;
    }

    /**
     * @return array{status:string,text:string,untagged:array<int,array{line:string,lits:array<int,string>}>}
     */
    public function command(string $cmd, bool $mustBeOk = true): array
    {
        $tag = 'A' . (++$this->n);
        fwrite($this->fp, $tag . ' ' . $cmd . "\r\n");
        $untagged = [];
        while (true) {
            $first = $this->line();
            if (strpos($first, $tag . ' ') === 0) {
                $parts = explode(' ', rtrim($first), 3);
                $status = strtoupper($parts[1] ?? 'BAD');
                $text = $parts[2] ?? '';
                if ($mustBeOk && $status !== 'OK') {
                    throw new MailException('IMAP naredba nije uspjela: ' . $text);
                }
                return ['status' => $status, 'text' => $text, 'untagged' => $untagged];
            }
            $item = ['line' => rtrim($first, "\r\n"), 'lits' => []];
            $l = $first;
            while (preg_match('/\{(\d+)\}\r?\n$/', $l, $m)) {
                $len = (int) $m[1];
                $buf = '';
                while (strlen($buf) < $len) {
                    $chunk = fread($this->fp, $len - strlen($buf));
                    if ($chunk === false || $chunk === '') {
                        throw new MailException('IMAP veza je prekinuta tijekom čitanja poruke.');
                    }
                    $buf .= $chunk;
                }
                $item['lits'][] = $buf;
                $l = $this->line();
                $item['line'] .= ' ' . rtrim($l, "\r\n");
            }
            $untagged[] = $item;
        }
    }

    /** @return array{uidvalidity:int} */
    public function select(string $folder): array
    {
        $r = $this->command('SELECT ' . self::quote($folder));
        $v = 0;
        foreach ($r['untagged'] as $u) {
            if (preg_match('/UIDVALIDITY (\d+)/i', $u['line'], $m)) {
                $v = (int) $m[1];
            }
        }
        return ['uidvalidity' => $v];
    }

    /** @return int[] */
    public function uidSearch(string $criteria): array
    {
        $r = $this->command('UID SEARCH ' . $criteria);
        $uids = [];
        foreach ($r['untagged'] as $u) {
            if (preg_match('/^\* SEARCH ?(.*)$/', $u['line'], $m) && trim($m[1]) !== '') {
                foreach (preg_split('/\s+/', trim($m[1])) as $x) {
                    $uids[] = (int) $x;
                }
            }
        }
        sort($uids);
        return $uids;
    }

    /** @return array{uid:int,seen:bool,raw:string}|null */
    public function fetchMessage(int $uid, int $maxBytes): ?array
    {
        $r = $this->command('UID FETCH ' . $uid . ' (UID FLAGS BODY.PEEK[]<0.' . $maxBytes . '>)');
        foreach ($r['untagged'] as $u) {
            if (preg_match('/^\* \d+ FETCH/i', $u['line']) && isset($u['lits'][0])) {
                $seen = (bool) preg_match('/FLAGS \([^)]*\\\\Seen/i', $u['line']);
                return ['uid' => $uid, 'seen' => $seen, 'raw' => $u['lits'][0]];
            }
        }
        return null;
    }

    public function append(string $folder, string $raw): void
    {
        $tag = 'A' . (++$this->n);
        fwrite($this->fp, $tag . ' APPEND ' . self::quote($folder) . ' (\\Seen) {' . strlen($raw) . "}\r\n");
        $l = $this->line();
        if (strpos($l, '+') !== 0) {
            throw new MailException('IMAP APPEND odbijen: ' . trim($l));
        }
        fwrite($this->fp, $raw . "\r\n");
        while (true) {
            $l = $this->line();
            if (strpos($l, $tag . ' ') === 0) {
                if (stripos($l, $tag . ' OK') !== 0) {
                    throw new MailException('IMAP APPEND nije uspio: ' . trim($l));
                }
                return;
            }
        }
    }

    public function close(): void
    {
        if (is_resource($this->fp)) {
            @fwrite($this->fp, 'A' . (++$this->n) . " LOGOUT\r\n");
            @fclose($this->fp);
        }
    }
}

final class Mime
{
    /** @return array{headers:array<string,string>,text:string,html:string,attachments:string[],files:list<array{name:string,type:string,data:string}>} */
    public static function parse(string $raw): array
    {
        [$h, $b] = self::split($raw);
        $headers = self::headers($h);
        $out = ['headers' => $headers, 'text' => '', 'html' => '', 'attachments' => [], 'files' => []];
        self::walk($headers, $b, $out, 0);
        return $out;
    }

    public static function decodeHeader(string $s): string
    {
        $s = trim($s);
        if ($s === '' || strpos($s, '=?') === false) {
            return $s;
        }
        $d = @iconv_mime_decode($s, 2, 'UTF-8');
        if ($d === false) {
            $d = @mb_decode_mimeheader($s);
        }
        return trim((string) $d);
    }

    /** @return array{0:string,1:string} name, email */
    public static function address(string $v): array
    {
        $v = self::decodeHeader($v);
        if (preg_match('/^\s*"?([^"<]*?)"?\s*<([^>]+)>/', $v, $m)) {
            return [trim($m[1]), strtolower(trim($m[2]))];
        }
        if (preg_match('/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+/i', $v, $m)) {
            return ['', strtolower($m[0])];
        }
        return ['', ''];
    }

    private static function split(string $s): array
    {
        if (preg_match('/\r?\n\r?\n/', $s, $m, PREG_OFFSET_CAPTURE)) {
            return [substr($s, 0, $m[0][1]), substr($s, $m[0][1] + strlen($m[0][0]))];
        }
        return [$s, ''];
    }

    private static function headers(string $h): array
    {
        $h = preg_replace('/\r?\n[ \t]+/', ' ', $h);
        $out = [];
        foreach (preg_split('/\r?\n/', (string) $h) as $line) {
            $p = strpos($line, ':');
            if ($p === false || $p === 0) {
                continue;
            }
            $k = strtolower(trim(substr($line, 0, $p)));
            if (!isset($out[$k])) {
                $out[$k] = trim(substr($line, $p + 1));
            }
        }
        return $out;
    }

    /** @return array{type:string,params:array<string,string>} */
    private static function params(string $v): array
    {
        $parts = explode(';', $v);
        $type = strtolower(trim((string) array_shift($parts)));
        $params = [];
        foreach ($parts as $p) {
            if (preg_match('/^\s*([\w\-*]+)\s*=\s*"?([^"]*)"?\s*$/', $p, $m)) {
                $params[strtolower($m[1])] = $m[2];
            }
        }
        return ['type' => $type, 'params' => $params];
    }

    private static function walk(array $headers, string $body, array &$out, int $depth): void
    {
        if ($depth > 6) {
            return;
        }
        $ct = self::params($headers['content-type'] ?? 'text/plain');
        $type = $ct['type'] !== '' ? $ct['type'] : 'text/plain';
        $disp = self::params($headers['content-disposition'] ?? '');

        if (strpos($type, 'multipart/') === 0 && !empty($ct['params']['boundary'])) {
            $delim = '--' . $ct['params']['boundary'];
            $pieces = preg_split('/(?:^|\r?\n)(' . preg_quote($delim, '/') . '(?:--)?)[ \t]*(?=\r?\n|$)/', $body, -1, PREG_SPLIT_DELIM_CAPTURE);
            for ($i = 1; $i < count($pieces); $i += 2) {
                if (substr($pieces[$i], -2) === '--') {
                    break;
                }
                $seg = preg_replace('/^\r?\n/', '', (string) ($pieces[$i + 1] ?? ''));
                [$ph, $pb] = self::split($seg);
                self::walk(self::headers($ph), $pb, $out, $depth + 1);
            }
            return;
        }

        $fname = self::paramValue($disp['params'], 'filename') ?: self::paramValue($ct['params'], 'name');
        if ($disp['type'] === 'attachment' || ($fname !== '' && $type !== 'text/plain' && $type !== 'text/html') || strpos($type, 'message/') === 0) {
            $label = $fname !== '' ? self::decodeHeader($fname) : $type;
            $out['attachments'][] = $label;
            self::keepFile($out, $headers, $body, $label, $type, $disp['type'], $fname === '');
            return;
        }
        if ($type !== 'text/plain' && $type !== 'text/html') {
            if ($fname !== '') {
                $label = self::decodeHeader($fname);
                $out['attachments'][] = $label;
                self::keepFile($out, $headers, $body, $label, $type, $disp['type'], false);
            }
            return;
        }
        $key = $type === 'text/html' ? 'html' : 'text';
        if ($out[$key] !== '') {
            return;
        }
        $enc = strtolower(trim($headers['content-transfer-encoding'] ?? '7bit'));
        if ($enc === 'base64') {
            $body = (string) base64_decode(preg_replace('/\s+/', '', $body), false);
        } elseif ($enc === 'quoted-printable') {
            $body = quoted_printable_decode($body);
        }
        $cs = strtolower($ct['params']['charset'] ?? 'utf-8');
        if ($cs !== 'utf-8' && $cs !== 'us-ascii') {
            try {
                $body = mb_convert_encoding($body, 'UTF-8', $cs);
            } catch (Throwable $e) {
                $conv = @iconv($cs, 'UTF-8//IGNORE', $body);
                $body = $conv !== false ? $conv : $body;
            }
        }
        if (!mb_check_encoding($body, 'UTF-8')) {
            $body = mb_convert_encoding($body, 'UTF-8', 'UTF-8');
        }
        $out[$key] = $body;
    }

    /** Reads a header parameter, including the RFC 2231 form name*=UTF-8''%C5%A1. */
    private static function paramValue(array $params, string $key): string
    {
        if (isset($params[$key])) {
            return (string) $params[$key];
        }
        if (isset($params[$key . '*']) && preg_match("/^([\w-]*)'[\w-]*'(.*)$/", (string) $params[$key . '*'], $m)) {
            $v = rawurldecode($m[2]);
            $cs = strtolower($m[1]);
            if ($cs !== '' && $cs !== 'utf-8') {
                $v = (string) @iconv($cs, 'UTF-8//IGNORE', $v);
            }
            return $v;
        }
        return '';
    }

    /** Keeps the decoded content of an attachment (not small inline pictures such as signature logos). */
    private static function keepFile(array &$out, array $headers, string $body, string $label, string $type, string $disposition, bool $nameless): void
    {
        if (count($out['files']) >= 10 || ($disposition === 'inline' && strpos($type, 'image/') === 0)) {
            return;
        }
        $enc = strtolower(trim($headers['content-transfer-encoding'] ?? '7bit'));
        if ($enc === 'base64') {
            $data = (string) base64_decode(preg_replace('/\s+/', '', $body), false);
        } elseif ($enc === 'quoted-printable') {
            $data = quoted_printable_decode($body);
        } else {
            $data = $body;
        }
        if ($data === '' || strlen($data) > DOC_MAX_BYTES) {
            return;
        }
        if ($nameless) {
            $label = 'privitak-' . (count($out['files']) + 1) . (strpos($type, 'message/') === 0 ? '.eml' : '');
        }
        $out['files'][] = ['name' => $label, 'type' => $type, 'data' => $data];
    }

    public static function htmlToText(string $html): string
    {
        $t = preg_replace('#<(style|script|head)[^>]*>.*?</\1>#is', '', $html);
        $t = preg_replace('#<br\s*/?>|</p>|</div>|</tr>|</li>|</h[1-6]>#i', "\n", (string) $t);
        $t = strip_tags((string) $t);
        $t = html_entity_decode($t, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $t = preg_replace("/[ \t\xC2\xA0]+/", ' ', $t);
        $t = preg_replace("/ ?\n ?/", "\n", (string) $t);
        return trim((string) preg_replace("/\n{3,}/", "\n\n", (string) $t));
    }
}

/* ---------- storing and syncing ---------- */

function client_for_email(string $email): ?int
{
    if ($email === '') {
        return null;
    }
    $r = row('SELECT id FROM clients WHERE LOWER(email) = ? ORDER BY id LIMIT 1', [strtolower($email)]);
    return $r ? (int) $r['id'] : null;
}

/** After a client gets an e-mail address, attach earlier unmatched mail from that sender. */
function link_emails_to_client(int $clientId, string $email): void
{
    if ($email === '') {
        return;
    }
    run("UPDATE emails SET client_id = ? WHERE client_id IS NULL AND deleted_at IS NULL AND direction = 'in' AND LOWER(from_email) = ?", [$clientId, strtolower($email)]);
    run("UPDATE emails SET client_id = ? WHERE client_id IS NULL AND deleted_at IS NULL AND direction = 'out' AND LOWER(to_email) = ?", [$clientId, strtolower($email)]);
    sync_document_clients();
}

function make_preview(string $text): string
{
    $t = trim((string) preg_replace('/\s+/', ' ', $text));
    return mb_substr($t, 0, 200);
}

/** Records a message sent from the CRM. */
function store_outgoing(string $messageId, string $to, string $subject, string $body, ?int $clientId, ?int $userId, ?string $inReplyTo, string $fromEmail, string $fromName, ?string $attachments = null, bool $auto = false, ?int $remindDays = null): int
{
    $t = ms();
    run('INSERT INTO emails (direction, message_id, in_reply_to, from_email, from_name, to_email, subject, body, preview, attachments, auto, remind_days, msg_date, client_id, user_id, read_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ['out', $messageId, $inReplyTo, strtolower($fromEmail), $fromName, strtolower($to), $subject, $body, make_preview($body), $attachments, $auto ? 1 : 0, $remindDays, $t, $clientId, $userId, $t, $t]);
    return insert_id();
}

/** Best effort: keep a copy in the mailbox's Sent folder so webmail shows it too. */
function sent_copy(string $raw): void
{
    $c = imap_cfg();
    $folder = (string) ($c['sent_folder'] ?? '');
    if (!$c || $folder === '') {
        return;
    }
    try {
        $im = new ImapClient($c);
        try {
            $im->append($folder, $raw);
        } finally {
            $im->close();
        }
    } catch (Throwable $e) {
        error_log('CRM sent copy: ' . $e->getMessage());
    }
}

/**
 * Pulls new messages from the INBOX into the emails table.
 * @return array{new:int,skipped:bool}
 */
function sync_inbox(int $box = 1): array
{
    $sfx = $box === 2 ? '_2' : '';
    $c = imap_cfg($box);
    if (!$c) {
        throw new MailException('IMAP nije podešen u config.php.');
    }
    $lock = (int) (meta_get('sync_lock') ?? 0);
    if ($lock > ms() - 120000) {
        return ['new' => 0, 'skipped' => true];
    }
    meta_set('sync_lock', (string) ms());
    $new = 0;
    $im = null;
    try {
        $im = new ImapClient($c);
        $folder = (string) ($c['folder'] ?? 'INBOX');
        $sel = $im->select($folder);
        $lastUid = (int) (meta_get('imap_last_uid' . $sfx) ?? 0);
        if ((int) (meta_get('imap_uidvalidity' . $sfx) ?? 0) !== $sel['uidvalidity']) {
            $lastUid = 0;
            meta_set('imap_uidvalidity' . $sfx, (string) $sel['uidvalidity']);
        }
        if ($lastUid === 0) {
            $uids = $im->uidSearch('ALL');
            $uids = array_slice($uids, -((int) ($c['initial_limit'] ?? 150)));
        } else {
            $uids = array_values(array_filter($im->uidSearch(($lastUid + 1) . ':*'), static fn ($u) => $u > $lastUid));
        }
        $maxUid = $lastUid;
        $batch = array_slice($uids, 0, 100);
        foreach ($batch as $uid) {
            $msg = $im->fetchMessage($uid, 12000000);
            $maxUid = max($maxUid, $uid);
            if (!$msg) {
                continue;
            }
            if (store_incoming($msg['raw'], $uid, $msg['seen'], strlen($msg['raw']) < 12000000, $box)) {
                $new++;
            }
        }
        if ($batch) {
            meta_set('imap_last_uid' . $sfx, (string) $maxUid);
        }
        meta_set('imap_last_sync' . $sfx, (string) ms());
        meta_set('imap_last_error' . $sfx, '');
    } catch (Throwable $e) {
        meta_set('imap_last_error' . $sfx, $e->getMessage());
        throw $e instanceof MailException ? $e : new MailException($e->getMessage());
    } finally {
        if ($im) {
            $im->close();
        }
        meta_set('sync_lock', '0');
    }
    return ['new' => $new, 'skipped' => false];
}

function store_incoming(string $raw, int $uid, bool $seen, bool $complete = true, int $box = 1): bool
{
    $p = Mime::parse($raw);
    $h = $p['headers'];
    $mid = trim((string) ($h['message-id'] ?? ''), " <>\t");
    if ($mid === '') {
        $mid = 'noid-' . sha1(substr($raw, 0, 4000));
    }
    $mid = mb_substr($mid, 0, 190);
    if (row('SELECT id FROM emails WHERE message_id = ?', [$mid])) {
        return false;
    }
    [$fromName, $fromEmail] = Mime::address((string) ($h['from'] ?? ''));
    [, $replyTo] = Mime::address((string) ($h['reply-to'] ?? ''));
    [, $toEmail] = Mime::address((string) ($h['to'] ?? ''));
    $subject = mb_substr(Mime::decodeHeader((string) ($h['subject'] ?? '')), 0, 255);
    $text = $p['text'] !== '' ? $p['text'] : Mime::htmlToText($p['html']);
    $text = mb_substr(str_replace("\r\n", "\n", $text), 0, 60000);
    $ts = isset($h['date']) ? strtotime((string) $h['date']) : false;
    $date = $ts ? $ts * 1000 : ms();
    $date = min($date, ms());
    $irt = isset($h['in-reply-to']) ? mb_substr(trim($h['in-reply-to'], " <>\t"), 0, 190) : null;
    $client = client_for_email($fromEmail);
    $att = $p['attachments'] ? mb_substr(implode(' | ', $p['attachments']), 0, 500) : null;
    $t = ms();
    run('INSERT INTO emails (direction, uid, message_id, in_reply_to, from_email, from_name, reply_to, to_email, subject, body, preview, attachments, msg_date, client_id, read_at, created_at, mailbox)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ['in', $uid, $mid, $irt, $fromEmail, mb_substr($fromName, 0, 190), $replyTo, $toEmail, $subject, $text, make_preview($text), $att, $date, $client, $seen ? $date : null, $t, $box]);
    $emailId = insert_id();
    if ($complete) {
        foreach ($p['files'] as $f) {
            try {
                store_document($client, $emailId, $f['name'], $f['type'], $f['data'], null);
            } catch (Throwable $e) {
                error_log('CRM attachment: ' . $e->getMessage());
                break;
            }
        }
    }
    if (!$seen && $box === 1) { // dodatni sandučić je samo za primanje: bez automatskog odgovora
        maybe_auto_reply($h, $replyTo !== '' ? $replyTo : $fromEmail, $subject, $mid, $date, $client);
    }
    return true;
}
