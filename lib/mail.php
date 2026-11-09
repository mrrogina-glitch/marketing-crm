<?php
declare(strict_types=1);

final class MailException extends RuntimeException
{
}

/**
 * Sends plain-text mail through SMTP (or PHP mail()). No external libraries.
 * Settings come from config.php, section "mail".
 */
final class Mailer
{
    public static function configured(): bool
    {
        $m = cfg('mail');
        if (!is_array($m) || empty($m['from_email'])) {
            return false;
        }
        return (($m['driver'] ?? 'smtp') === 'mail') || !empty($m['host']);
    }

    public static function fromEmail(): string
    {
        return (string) cfg('mail.from_email', '');
    }

    /**
     * @param array<string,string> $extra extra headers: In-Reply-To, References, Auto-Submitted, X-Auto-Response-Suppress, Precedence
     * @param list<array{0:string,1:string,2:string}> $attachments [file name, mime type, binary data]
     * @return array{message_id:string, raw:string} message id without angle brackets, and the full raw message
     */
    public static function send(string $to, string $subject, string $body, ?string $senderName = null, array $extra = [], array $attachments = [], array $identity = []): array
    {
        if (!self::configured()) {
            throw new MailException('E-mail nije podešen u config.php.');
        }
        $m = $identity ? array_merge((array) cfg('mail'), $identity) : cfg('mail'); // $identity: drugi sandučić (Inbox 2) šalje sa svoje adrese
        $from = self::clean((string) $m['from_email']);
        $to = self::clean($to);
        if (!filter_var($to, FILTER_VALIDATE_EMAIL) || !filter_var($from, FILTER_VALIDATE_EMAIL)) {
            throw new MailException('Adresa pošiljatelja ili primatelja nije ispravna.');
        }
        $subject = self::clean($subject);

        $company = trim((string) ($m['from_name'] ?? ''));
        $sender = trim((string) $senderName);
        $display = $sender !== '' && $company !== '' ? $sender . ' | ' . $company : ($sender !== '' ? $sender : $company);

        $messageId = bin2hex(random_bytes(12)) . '@' . self::domain($from);
        $common = [];
        $common[] = 'Date: ' . date('r');
        $common[] = 'From: ' . self::addr($from, $display);
        $common[] = 'Message-ID: <' . $messageId . '>';
        foreach (['In-Reply-To', 'References'] as $h) {
            if (!empty($extra[$h]) && preg_match('/^(<[^<>\s]+>\s*)+$/', trim((string) $extra[$h]))) {
                $common[] = $h . ': ' . trim((string) $extra[$h]);
            }
        }
        foreach (['Auto-Submitted' => '/^auto-(replied|generated)$/', 'X-Auto-Response-Suppress' => '/^[A-Za-z, ]{1,40}$/', 'Precedence' => '/^(bulk|junk|list)$/'] as $h => $re) {
            if (!empty($extra[$h]) && preg_match($re, trim((string) $extra[$h]))) {
                $common[] = $h . ': ' . trim((string) $extra[$h]);
            }
        }
        if (!empty($extra['List-Unsubscribe']) && preg_match('#^<https://[^<>\s]+>$#', trim((string) $extra['List-Unsubscribe']))) {
            $common[] = 'List-Unsubscribe: ' . trim((string) $extra['List-Unsubscribe']);
            if (($extra['List-Unsubscribe-Post'] ?? '') === 'List-Unsubscribe=One-Click') {
                $common[] = 'List-Unsubscribe-Post: List-Unsubscribe=One-Click';
            }
        }
        $common[] = 'MIME-Version: 1.0';

        $body = str_replace(["\r\n", "\r"], "\n", $body);
        $body = str_replace("\n", "\r\n", $body);
        $encBody = chunk_split(base64_encode($body), 76, "\r\n");

        if ($attachments) {
            $boundary = '=_crm_' . bin2hex(random_bytes(12));
            $common[] = 'Content-Type: multipart/mixed; boundary="' . $boundary . '"';
            $payload = '--' . $boundary . "\r\n"
                . "Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . $encBody;
            foreach ($attachments as [$fname, $mime, $data]) {
                $fname = self::clean($fname);
                $mime = preg_match('#^[\w.+-]+/[\w.+-]+$#', $mime) ? $mime : 'application/octet-stream';
                if (preg_match('/^[\x20-\x7E]*$/', $fname)) {
                    $q = '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], $fname) . '"';
                    $nameParam = 'name=' . $q;
                    $fileParam = 'filename=' . $q;
                } else {
                    $nameParam = "name*=UTF-8''" . rawurlencode($fname);
                    $fileParam = "filename*=UTF-8''" . rawurlencode($fname);
                }
                $payload .= '--' . $boundary . "\r\n"
                    . 'Content-Type: ' . $mime . '; ' . $nameParam . "\r\n"
                    . 'Content-Disposition: attachment; ' . $fileParam . "\r\n"
                    . "Content-Transfer-Encoding: base64\r\n\r\n"
                    . chunk_split(base64_encode($data), 76, "\r\n");
            }
            $encBody = $payload . '--' . $boundary . "--\r\n";
        } else {
            $common[] = 'Content-Type: text/plain; charset=UTF-8';
            $common[] = 'Content-Transfer-Encoding: base64';
        }

        $toHeader = 'To: ' . self::addr($to, '');
        $subjHeader = 'Subject: ' . self::enc($subject);
        $message = implode("\r\n", array_merge([$toHeader, $subjHeader], $common)) . "\r\n\r\n" . $encBody;

        if (($m['driver'] ?? 'smtp') === 'mail') {
            $ok = @mail($to, self::enc($subject), $encBody, implode("\r\n", $common), '-f' . $from);
            if (!$ok) {
                throw new MailException('PHP mail() nije prihvatio poruku.');
            }
        } else {
            self::smtp($m, $from, $to, $message);
        }
        return ['message_id' => $messageId, 'raw' => $message];
    }

    /** Provjera SMTP prijave bez slanja poruke. */
    public static function check(array $m): void
    {
        self::smtp($m, (string) ($m['from_email'] ?? ''), '', '');
    }

    private static function clean(string $s): string
    {
        return trim(str_replace(["\r", "\n", "\0"], ' ', $s));
    }

    private static function domain(string $email): string
    {
        $p = strrchr($email, '@');
        return $p ? substr($p, 1) : 'localhost';
    }

    private static function enc(string $s): string
    {
        $s = self::clean($s);
        if ($s === '' || preg_match('/^[\x20-\x7E]*$/', $s)) {
            return $s;
        }
        return mb_encode_mimeheader($s, 'UTF-8', 'B', "\r\n");
    }

    private static function addr(string $email, string $name): string
    {
        $name = self::clean($name);
        if ($name === '') {
            return '<' . $email . '>';
        }
        if (preg_match('/^[\x20-\x7E]*$/', $name)) {
            return '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], $name) . '" <' . $email . '>';
        }
        return self::enc($name) . ' <' . $email . '>';
    }

    private static function smtp(array $m, string $from, string $to, string $message): void
    {
        $host = (string) $m['host'];
        $port = (int) ($m['port'] ?? 465);
        $secure = (string) ($m['secure'] ?? 'ssl'); // ssl | tls | none
        $verify = ($m['verify_peer'] ?? true) !== false;

        $ctx = stream_context_create(['ssl' => [
            'verify_peer' => $verify,
            'verify_peer_name' => $verify,
            'SNI_enabled' => true,
        ]]);
        $remote = ($secure === 'ssl' ? 'ssl://' : 'tcp://') . $host . ':' . $port;
        $fp = @stream_socket_client($remote, $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx);
        if (!$fp) {
            throw new MailException("Povezivanje na SMTP poslužitelj nije uspjelo: $errstr ($errno)");
        }
        stream_set_timeout($fp, 25);

        $read = static function () use ($fp): string {
            $out = '';
            while (($l = fgets($fp, 2048)) !== false) {
                $out .= $l;
                if (strlen($l) < 4 || $l[3] === ' ') {
                    break;
                }
            }
            if ($out === '') {
                throw new MailException('SMTP poslužitelj nije odgovorio.');
            }
            return $out;
        };
        $cmd = static function (string $c, array $ok, ?string $mask = null) use ($fp, $read): string {
            fwrite($fp, $c . "\r\n");
            $r = $read();
            if (!in_array((int) substr($r, 0, 3), $ok, true)) {
                throw new MailException('SMTP odbija naredbu ' . ($mask ?? strtok($c, ' ')) . ': ' . trim($r));
            }
            return $r;
        };

        try {
            $greet = $read();
            if ((int) substr($greet, 0, 3) !== 220) {
                throw new MailException('SMTP pozdrav nije u redu: ' . trim($greet));
            }
            $ehlo = self::domain($from);
            $cmd('EHLO ' . $ehlo, [250]);
            if ($secure === 'tls') {
                $cmd('STARTTLS', [220]);
                if (!@stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                    throw new MailException('TLS veza (STARTTLS) nije uspostavljena.');
                }
                $cmd('EHLO ' . $ehlo, [250]);
            }
            $user = (string) ($m['user'] ?? '');
            if ($user !== '') {
                $cmd('AUTH LOGIN', [334]);
                $cmd(base64_encode($user), [334], 'korisničko ime');
                $cmd(base64_encode((string) ($m['pass'] ?? '')), [235], 'lozinka');
            }
            if ($to === '') { // samo provjera prijave
                @fwrite($fp, "QUIT\r\n");
                return;
            }
            $cmd('MAIL FROM:<' . $from . '>', [250]);
            $cmd('RCPT TO:<' . $to . '>', [250, 251]);
            $cmd('DATA', [354]);
            $data = preg_replace('/^\./m', '..', $message);
            if (substr($data, -2) !== "\r\n") {
                $data .= "\r\n";
            }
            fwrite($fp, $data . ".\r\n");
            $r = $read();
            if ((int) substr($r, 0, 3) !== 250) {
                throw new MailException('SMTP nije prihvatio poruku: ' . trim($r));
            }
            @fwrite($fp, "QUIT\r\n");
        } finally {
            @fclose($fp);
        }
    }
}
