<?php
declare(strict_types=1);

/* API akcije: E-mail, Inbox, grupna pošta, predlošci i dokumenti. Uključuje se iz api.php u istom opsegu (koristi $action, $u, body()...). */

switch ($action) {
    case 'email_delete': {
        $u = need_write();
        $e = load_email((string) (body()['id'] ?? ''));
        $own = $e['client_id'] !== null ? row('SELECT owner_id FROM clients WHERE id = ?', [$e['client_id']]) : null;
        $allowed = $u['role'] === 'admin' || (int) ($e['user_id'] ?? 0) === (int) $u['id'] || ($own && (int) $own['owner_id'] === (int) $u['id'])
            || ($e['client_id'] === null && $e['direction'] === 'in');
        if (!$allowed) {
            throw new ApiError('Poruku može obrisati administrator, pošiljatelj ili prodavač klijenta.', 403);
        }
        delete_document_rows(rows('SELECT id, stored FROM documents WHERE email_id = ?', [$e['id']]));
        $srv = server_trash($e); // i na poslužitelju: premještanje u smeće
        run("UPDATE emails SET deleted_at = ?, client_id = NULL, remind_done_at = COALESCE(remind_done_at, ?), subject = '', body = '', preview = '', attachments = NULL, from_name = '', reply_to = '', in_reply_to = NULL WHERE id = ?", [ms(), ms(), $e['id']]);
        audit($e['client_id'] !== null ? (int) $e['client_id'] : null, (int) $u['id'], 'email', 'Obrisana poruka: ' . ((string) $e['subject'] !== '' ? $e['subject'] : '(bez predmeta)') . ' (' . ($e['direction'] === 'in' ? 'od ' . $e['from_email'] : 'za ' . $e['to_email']) . ')' . ($srv === 'moved' ? ' · premještena u smeće na poslužitelju' : ''));
        out(['ok' => true, 'server' => $srv]);
    }

    case 'email_send': {
        $u = need_write();
        $in = body();
        $c = load_client((string) ($in['client_id'] ?? ''));
        $to = f_email($in, 'to', true);
        if (dnc_has($to) && !($u['role'] === 'admin' && !empty($in['force']))) {
            throw new ApiError('Ova adresa je na popisu "ne kontaktirati" (odjava ili zahtjev klijenta). ' . ($u['role'] === 'admin' ? 'Administrator može poslati poruku uz potvrdu.' : 'Poruka nije poslana.'), 409);
        }
        $subject = f_str($in, 'subject', 255, 'Predmet', true);
        if (preg_match('/[\r\n]/', $subject)) {
            throw new ApiError('Predmet mora biti u jednom retku.');
        }
        $text = f_str($in, 'body', 20000, 'Poruka', true);
        $docIds = is_array($in['doc_ids'] ?? null) ? array_map('intval', $in['doc_ids']) : [];
        $remind = null;
        if (isset($in['remind_days']) && $in['remind_days'] !== '' && $in['remind_days'] !== null) {
            $remind = (int) $in['remind_days'];
            if ($remind < 1 || $remind > 60) {
                throw new ApiError('Podsjetnik može biti za 1 do 60 dana.');
            }
        }
        if (!empty($in['send_at'])) {
            $at = (int) $in['send_at'];
            if ($at < ms() + 60000 || $at > ms() + 366 * DAY_MS) {
                throw new ApiError('Vrijeme slanja mora biti u budućnosti (najviše godinu dana unaprijed).');
            }
            if (!Mailer::configured()) {
                throw new ApiError('E-mail još nije podešen. Administrator ga podešava u config.php.', 409);
            }
            if ($docIds) {
                load_attachments($docIds, (int) $c['id']); // validate now, fail early
            }
            approval_queue_single($u, $c, $to, $subject, $text, $docIds, $remind, $at, 's');
            out(['ok' => true, 'scheduled' => true, 'needsApproval' => true, 'sendAt' => $at]);
        }
        if (!empty($in['followup'])) {
            // podsjetnik klijentu koji nije odgovorio: šalje se tek nakon odobrenja administratora
            if (!Mailer::configured()) {
                throw new ApiError('E-mail još nije podešen. Administrator ga podešava u config.php.', 409);
            }
            if ($docIds) {
                load_attachments($docIds, (int) $c['id']);
            }
            approval_queue_single($u, $c, $to, $subject, $text, $docIds, $remind, ms(), 'f');
            out(['ok' => true, 'needsApproval' => true]);
        }
        send_and_store($u, $to, $subject, with_signature($text, $u), (int) $c['id'], null, $docIds, $remind);
        record_client_email($c, $u, $to, $subject, $text);
        out(['ok' => true]);
    }

    case 'sched_cancel': {
        $u = need_write();
        $s = row('SELECT * FROM scheduled_emails WHERE id = ?', [(int) (body()['id'] ?? 0)]);
        if (!$s) {
            throw new ApiError('Zakazana poruka ne postoji.', 404);
        }
        if ($u['role'] !== 'admin' && (int) $s['user_id'] !== (int) $u['id']) {
            throw new ApiError('Zakazanu poruku može otkazati autor ili administrator.', 403);
        }
        if (run("UPDATE scheduled_emails SET status = 'cancelled' WHERE id = ? AND status IN ('awaiting', 'pending', 'failed')", [$s['id']]) !== 1) {
            throw new ApiError('Poruka je već poslana ili se upravo šalje.', 409);
        }
        if ($s['batch'] !== null) {
            run("UPDATE mail_batches SET status = 'cancelled' WHERE batch = ? AND status = 'awaiting'", [$s['batch']]);
        }
        out(['ok' => true]);
    }

    case 'reminder_done': {
        $u = need_write();
        $in = body();
        $e = load_email((string) ($in['email_id'] ?? ''));
        $snooze = (int) ($in['snooze_days'] ?? 0);
        if ($snooze > 0) {
            $waited = (int) ceil((ms() - (int) $e['msg_date']) / DAY_MS);
            run('UPDATE emails SET remind_days = ?, remind_notified_at = NULL WHERE id = ?', [$waited + min($snooze, 30), $e['id']]);
        } else {
            run('UPDATE emails SET remind_done_at = ? WHERE id = ?', [ms(), $e['id']]);
        }
        out(['ok' => true]);
    }

    case 'email_reply': {
        if (stripos((string) ($_SERVER['CONTENT_TYPE'] ?? ''), 'multipart/form-data') === 0) {
            if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
                throw new ApiError('Metoda nije dopuštena.', 405);
            }
            $u = need_user();
            if (!csrf_ok()) {
                throw new ApiError('Sigurnosna provjera nije uspjela. Osvježite stranicu.', 403);
            }
        } else {
            $u = need_write();
        }
        if (isset($_POST['data'])) {
            $in = json_decode((string) $_POST['data'], true);
            if (!is_array($in)) {
                throw new ApiError('Neispravan zahtjev.');
            }
        } else {
            if (!$_POST && !$_FILES && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0 && str_contains((string) ($_SERVER['CONTENT_TYPE'] ?? ''), 'multipart')) {
                throw new ApiError('Privici su preveliki za ovaj poslužitelj.', 413);
            }
            $in = body();
        }
        $files = uploaded_attachments('files');
        $orig = load_email((string) ($in['email_id'] ?? ''));
        if ($orig['direction'] === 'in') {
            $to = (string) ($orig['reply_to'] !== '' ? $orig['reply_to'] : $orig['from_email']);
        } else {
            $to = '';
            foreach (preg_split('/[,;]+/', (string) $orig['to_email']) as $cand) {
                if (preg_match('/<([^>]+)>/', $cand, $m)) {
                    $cand = $m[1];
                }
                $cand = trim($cand);
                if (filter_var($cand, FILTER_VALIDATE_EMAIL)) {
                    $to = $cand;
                    break;
                }
            }
        }
        if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
            throw new ApiError('Poruka nema ispravnu adresu za odgovor.');
        }
        $text = f_str($in, 'body', 20000, 'Odgovor', true);
        $subject = preg_match('/^\s*(re|odg)\s*:/i', (string) $orig['subject']) ? (string) $orig['subject'] : 'Re: ' . $orig['subject'];
        $quoted = array_slice(preg_split('/\r?\n/', (string) $orig['body']), 0, 40);
        $full = with_signature($text, $u) . "\n\n" . 'Dana ' . date('d.m.Y. \u H:i', (int) ($orig['msg_date'] / 1000)) . ' ' . trim(($orig['from_name'] !== '' ? $orig['from_name'] . ' ' : '') . '<' . $orig['from_email'] . '>') . " je napisao/la:\n"
            . implode("\n", array_map(static fn ($l) => '> ' . $l, $quoted));
        $cid = $orig['client_id'] !== null ? (int) $orig['client_id'] : null;
        $docIds = is_array($in['doc_ids'] ?? null) ? array_map('intval', $in['doc_ids']) : [];
        send_and_store($u, $to, mb_substr($subject, 0, 255), $full, $cid, '<' . $orig['message_id'] . '>', $cid ? $docIds : [], null, false, [], (int) ($orig['mailbox'] ?? 1) === 2 ? 2 : 1, $files);
        $t = ms();
        transaction(static function () use ($orig, $cid, $u, $to, $subject, $text, $t): void {
            run('UPDATE emails SET read_at = COALESCE(read_at, ?) WHERE id = ?', [$t, $orig['id']]);
            if ($cid) {
                run('INSERT INTO notes (client_id, author_id, type, subject, body, to_email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [$cid, $u['id'], 'email', mb_substr($subject, 0, 255), $text, $to, $t]);
                run('UPDATE clients SET updated_at = ? WHERE id = ?', [$t, $cid]);
            }
        });
        out(['ok' => true]);
    }

    case 'email_open': {
        $u = need_write();
        $e = load_email((string) (body()['id'] ?? ''));
        if ($e['read_at'] === null) {
            run('UPDATE emails SET read_at = ? WHERE id = ?', [ms(), $e['id']]);
        }
        $o = email_out($e);
        $o['read'] = true;
        $o['body'] = (string) $e['body'];
        $o['replyTo'] = (string) $e['reply_to'];
        $o['docs'] = array_map('doc_out', rows('SELECT * FROM documents WHERE email_id = ? ORDER BY id', [$e['id']]));
        out(['ok' => true, 'email' => $o]);
    }

    case 'email_link': {
        $u = need_write();
        $in = body();
        $e = load_email((string) ($in['email_id'] ?? ''));
        $cid = null;
        if (!empty($in['client_id'])) {
            $cid = (int) load_client((string) $in['client_id'])['id'];
        }
        run('UPDATE emails SET client_id = ? WHERE id = ?', [$cid, $e['id']]);
        sync_document_clients();
        out(['ok' => true]);
    }

    case 'inbox_sync': {
        $u = need_write();
        if (imap_cfg() === null) {
            throw new ApiError('Primanje pošte još nije podešeno u config.php.', 409);
        }
        $force = !empty(body()['force']);
        run_background_jobs();
        $last = (int) (meta_get('imap_last_sync') ?? 0);
        if (!$force && $last > ms() - 20000) {
            out(['ok' => true, 'new' => 0, 'cached' => true]);
        }
        try {
            $r = sync_inbox();
        } catch (MailException $e) {
            error_log('CRM sync: ' . $e->getMessage());
            out(['ok' => false, 'error' => $u['role'] === 'admin' ? $e->getMessage() : 'Osvježavanje pošte nije uspjelo. Obavijestite administratora.']);
        }
        $new2 = 0;
        if (imap_cfg(2) !== null) {
            try {
                $new2 = sync_inbox(2)['new'];
            } catch (MailException $e) {
                error_log('CRM sync 2: ' . $e->getMessage());
            }
        }
        out(['ok' => true, 'new' => $r['new'] + $new2, 'skipped' => $r['skipped']]);
    }

    case 'imap2_test': {
        $u = need_write();
        need_admin($u);
        $c = imap2_from_input(body());
        try {
            $im = new ImapClient($c);
            try {
                $im->select($c['folder']);
            } finally {
                $im->close();
            }
        } catch (Throwable $e) {
            out(['ok' => false, 'error' => 'Primanje (IMAP): ' . $e->getMessage()]);
        }
        try {
            Mailer::check(array_merge((array) cfg('mail'), ['driver' => 'smtp', 'host' => $c['smtp_host'], 'port' => $c['smtp_port'], 'secure' => $c['smtp_secure'], 'user' => $c['user'], 'pass' => $c['pass'], 'from_email' => $c['user']]));
        } catch (Throwable $e) {
            out(['ok' => false, 'error' => 'Slanje (SMTP ' . $c['smtp_host'] . ':' . $c['smtp_port'] . '): ' . $e->getMessage()]);
        }
        out(['ok' => true]);
    }

    case 'imap2_diag': {
        $u = need_write();
        need_admin($u);
        $c = imap_cfg(2);
        if ($c === null) {
            throw new ApiError('Inbox 2 nije podešen.', 409);
        }
        $res = ['storedLastUid' => (int) (meta_get('imap_last_uid_2') ?? 0), 'storedValidity' => (int) (meta_get('imap_uidvalidity_2') ?? 0), 'lastError' => (string) (meta_get('imap_last_error_2') ?? ''), 'dbBox2' => (int) row('SELECT COUNT(*) AS c FROM emails WHERE mailbox = 2')['c']];
        try {
            $im = new ImapClient($c);
            try {
                $sel = $im->select((string) ($c['folder'] ?? 'INBOX'));
                $uids = $im->uidSearch('ALL');
                $res += ['validity' => $sel['uidvalidity'], 'serverCount' => count($uids), 'maxUid' => $uids ? max($uids) : 0, 'newerThanStored' => count(array_filter($uids, static fn ($x) => $x > $res['storedLastUid']))];
                $last = [];
                foreach (array_slice($uids, -8) as $uid) {
                    $m = $im->fetchMessage($uid, 6000);
                    if (!$m) {
                        $last[] = ['uid' => $uid, 'fetch' => false];
                        continue;
                    }
                    $h = Mime::parse($m['raw'])['headers'];
                    $mid = mb_substr(trim((string) ($h['message-id'] ?? ''), " <>\t"), 0, 190);
                    $ex = $mid !== '' ? row('SELECT mailbox, direction FROM emails WHERE message_id = ?', [$mid]) : null;
                    $last[] = ['uid' => $uid, 'date' => (string) ($h['date'] ?? ''), 'from' => mb_substr((string) ($h['from'] ?? ''), 0, 80), 'to' => mb_substr((string) ($h['to'] ?? ''), 0, 80), 'subject' => mb_substr(Mime::decodeHeader((string) ($h['subject'] ?? '')), 0, 80), 'inDb' => $ex ? ('mailbox ' . $ex['mailbox'] . ' ' . $ex['direction']) : 'ne'];
                }
                $res['last'] = $last;
                $res['trashFolder'] = $im->trashFolder();
                $rg = $im->uidSearch(($res['storedLastUid'] + 1) . ':*');
                $res['rangeSearch'] = ['count' => count($rg), 'first' => array_slice($rg, 0, 3), 'last' => array_slice($rg, -3)];
                $res['lock'] = (string) (meta_get('sync_lock') ?? '');
                $res['tryUid'] = (string) (meta_get('imap_try_uid_2') ?? '');
                if (!empty(body()['probe'])) {
                    $probe = [];
                    $newer = array_values(array_filter($uids, static fn ($x) => $x > $res['storedLastUid']));
                    @set_time_limit(120);
                    foreach (array_slice($newer, 0, 12) as $uid) {
                        $t0 = microtime(true);
                        try {
                            $m = $im->fetchMessage($uid, 12000000);
                            $r = ['uid' => $uid, 'size' => $m ? strlen($m['raw']) : null];
                            if ($m) {
                                $r['stored'] = store_incoming($m['raw'], $uid, $m['seen'], strlen($m['raw']) < 12000000, 2);
                            }
                        } catch (Throwable $e) {
                            $r = ['uid' => $uid, 'exception' => get_class($e) . ': ' . $e->getMessage()];
                        }
                        $r['sec'] = round(microtime(true) - $t0, 2);
                        $probe[] = $r;
                    }
                    $res['probe'] = $probe;
                }
            } finally {
                $im->close();
            }
        } catch (Throwable $e) {
            $res['error'] = $e->getMessage();
        }
        out($res);
    }

    case 'imap2_save': {
        $u = need_write();
        need_admin($u);
        $c = imap2_from_input(body());
        $prev = imap_cfg(2);
        $changed = $prev === null || strtolower((string) $prev['user']) !== strtolower($c['user']) || $prev['host'] !== $c['host'] || $prev['folder'] !== $c['folder'];
        $store = $c;
        $store['pass_enc'] = imap2_encrypt($c['pass']);
        unset($store['pass']);
        setting_set('imap2', json_encode($store));
        if ($changed) {
            foreach (['imap_last_uid_2', 'imap_uidvalidity_2', 'imap_last_sync_2', 'imap_last_error_2'] as $k) {
                run('DELETE FROM meta WHERE k = ?', [$k]);
            }
        }
        out(['ok' => true]);
    }

    case 'imap2_clear': {
        $u = need_write();
        need_admin($u);
        run("DELETE FROM settings WHERE k = 'imap2'");
        foreach (['imap_last_uid_2', 'imap_uidvalidity_2', 'imap_last_sync_2', 'imap_last_error_2'] as $k) {
            run('DELETE FROM meta WHERE k = ?', [$k]);
        }
        out(['ok' => true]);
    }

    case 'mail_test': {
        $u = need_write();
        need_admin($u);
        $box = (int) (body()['box'] ?? 1) === 2 ? 2 : 1; // 2 = probni e-mail s adrese Inboxa 2 (npr. marketing@sjeverni.fm)
        try {
            $ident = mail_identity($box);
            $from = $ident ? (string) $ident['from_email'] : Mailer::fromEmail();
            Mailer::send((string) $u['email'], 'Probni e-mail iz VIP MARKET-a' . ($box === 2 ? ' (Inbox 2)' : ''), "Ako ovo čitate, slanje e-maila radi.\n\nPošiljatelj: " . $from . "\nPoslano: " . date('d.m.Y. H:i'), (string) $u['name'], [], [], $ident ?? []);
        } catch (MailException $e) {
            out(['ok' => false, 'error' => $e->getMessage()]);
        }
        out(['ok' => true, 'to' => (string) $u['email'], 'from' => $from]);
    }

    case 'doc_upload': {
        if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
            throw new ApiError('Metoda nije dopuštena.', 405);
        }
        $u = need_user();
        if (!csrf_ok()) {
            throw new ApiError('Sigurnosna provjera nije uspjela. Osvježite stranicu.', 403);
        }
        if (!$_POST && !$_FILES && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
            throw new ApiError('Datoteka je prevelika za ovaj poslužitelj (najviše 10 MB, a poslužitelj možda dopušta manje).', 413);
        }
        $c = load_client((string) ($_POST['client_id'] ?? ''));
        $f = $_FILES['file'] ?? null;
        if (!$f || !is_array($f) || is_array($f['name'])) {
            throw new ApiError('Datoteka nije primljena.');
        }
        if ($f['error'] === UPLOAD_ERR_INI_SIZE || $f['error'] === UPLOAD_ERR_FORM_SIZE || (int) $f['size'] > DOC_MAX_BYTES) {
            throw new ApiError('Datoteka je prevelika (najviše 10 MB).', 413);
        }
        if ($f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file((string) $f['tmp_name'])) {
            throw new ApiError('Učitavanje datoteke nije uspjelo.');
        }
        $data = file_get_contents((string) $f['tmp_name']);
        if ($data === false || $data === '') {
            throw new ApiError('Datoteka je prazna.');
        }
        $isContract = !empty($_POST['contract']) ? 1 : 0;
        if ($isContract) {
            $ext = strtolower(pathinfo((string) $f['name'], PATHINFO_EXTENSION));
            $okType = ($ext === 'pdf' && str_starts_with($data, '%PDF'))
                || ($ext === 'docx' && str_starts_with($data, "PK\x03\x04"))
                || ($ext === 'doc' && str_starts_with($data, "\xD0\xCF\x11\xE0"));
            if (!$okType) {
                throw new ApiError('Ugovor mora biti PDF ili Word datoteka (.pdf, .doc, .docx).');
            }
        }
        $id = store_document((int) $c['id'], null, (string) $f['name'], (string) ($f['type'] ?? ''), $data, (int) $u['id'], $isContract);
        run('UPDATE clients SET updated_at = ? WHERE id = ?', [ms(), $c['id']]);
        audit((int) $c['id'], (int) $u['id'], 'doc', ($isContract ? 'Dodan ugovor: ' : 'Dodan dokument: ') . (string) $f['name'], (string) $c['name']);
        out(['ok' => true, 'id' => (string) $id]);
    }

    case 'doc_download': {
        need_user();
        $d = row('SELECT * FROM documents WHERE id = ?', [(int) ($_GET['id'] ?? 0)]);
        if (!$d || !preg_match('/^[0-9a-f]{32}$/', (string) $d['stored'])) {
            throw new ApiError('Dokument ne postoji.', 404);
        }
        $path = storage_dir() . '/' . $d['stored'];
        if (!is_file($path)) {
            throw new ApiError('Datoteka nedostaje na poslužitelju.', 404);
        }
        header_remove('Content-Type');
        header('Content-Type: application/octet-stream');
        header('Content-Length: ' . filesize($path));
        $ascii = preg_replace('/[^\x20-\x7E]|["\\%]/', '_', (string) $d['filename']);
        header('Content-Disposition: attachment; filename="' . $ascii . '"; filename*=UTF-8\'\'' . rawurlencode((string) $d['filename']));
        header('Cache-Control: private, no-store');
        readfile($path);
        exit;
    }

    case 'doc_delete': {
        $u = need_write();
        $d = row('SELECT * FROM documents WHERE id = ?', [(int) (body()['id'] ?? 0)]);
        if (!$d) {
            throw new ApiError('Dokument ne postoji.', 404);
        }
        $c = $d['client_id'] !== null ? row('SELECT owner_id FROM clients WHERE id = ?', [$d['client_id']]) : null;
        $allowed = $u['role'] === 'admin' || (int) ($d['uploaded_by'] ?? 0) === (int) $u['id'] || ($c && (int) $c['owner_id'] === (int) $u['id']);
        if (!$allowed) {
            throw new ApiError('Dokument može obrisati administrator, onaj tko ga je učitao ili prodavač klijenta.', 403);
        }
        delete_document_rows([$d]);
        if ($d['client_id'] !== null) {
            audit((int) $d['client_id'], (int) $u['id'], 'doc', 'Obrisan dokument: ' . (string) $d['filename']);
        }
        out(['ok' => true]);
    }

    case 'signature_save': {
        $u = need_write();
        $sig = f_str(body(), 'signature', 1000, 'Potpis');
        run('UPDATE users SET signature = ? WHERE id = ?', [$sig !== '' ? $sig : null, $u['id']]);
        out(['ok' => true]);
    }

    case 'mail_overview': {
        $u = need_user();
        out(['ok' => true] + mail_overview($u));
    }

    case 'spell_check': {
        $u = need_write();
        $in = body();
        $subject = (string) ($in['subject'] ?? '');
        $text = (string) ($in['body'] ?? '');
        if (mb_strlen($text) > 20000 || mb_strlen($subject) > 500) {
            throw new ApiError('Tekst je predug za provjeru.');
        }
        $a = hr_spell_scan($subject);
        $b = hr_spell_scan($text);
        $res = ['ok' => true, 'issues' => array_merge($a['issues'], $b['issues']), 'subject' => $a['fixed'], 'body' => $b['fixed'], 'ai' => null];
        if (!empty($in['ai']) && ai_enabled() && trim($text) !== '') {
            ai_rate_check((int) $u['id']);
            $res['ai'] = ai_proofread($b['fixed']);
        }
        out($res);
    }

    case 'ai_draft': {
        $u = need_write();
        $in = body();
        $client = !empty($in['client_id']) ? load_client((string) $in['client_id']) : null;
        ai_rate_check((int) $u['id']);
        out(['ok' => true] + ai_draft($in + ['single' => $client !== null], $u, $client));
    }

    case 'bulk_preview': {
        $u = need_write();
        $in = body();
        $r = bulk_clients($u, is_array($in['audience'] ?? null) ? $in['audience'] : []);
        $stat = [];
        foreach (rows("SELECT client_id, COUNT(*) AS c, MAX(created_at) AS m FROM notes WHERE type = 'email' GROUP BY client_id") as $x) {
            $stat[(int) $x['client_id']] = [(int) $x['c'], (int) $x['m']];
        }
        $list = array_map(static fn ($c) => ['id' => (string) $c['id'], 'name' => (string) $c['name'], 'email' => (string) $c['email'], 'status' => (string) $c['status'],
            'owner' => user_name_of($c['owner_id']), 'mails' => $stat[(int) $c['id']][0] ?? 0, 'last' => $stat[(int) $c['id']][1] ?? null], array_slice($r['clients'], 0, 1000));
        $n = count($r['clients']);
        out(['ok' => true, 'clients' => $list, 'total' => $n, 'noEmail' => $r['noEmail'], 'dnc' => $r['dnc'] ?? 0, 'eta' => bulk_eta(bulk_pending_count() + $n)]);
    }

    case 'bulk_preview_msg': {
        $u = need_write();
        $in = body();
        $subject = f_str($in, 'subject', 255, 'Predmet', true);
        $text = f_str($in, 'body', 20000, 'Poruka', true);
        $ids = array_values(array_filter(array_map('intval', is_array($in['ids'] ?? null) ? $in['ids'] : [])));
        $cl = [];
        foreach ($ids as $id) {
            $c = row('SELECT * FROM clients WHERE id = ?', [$id]);
            if ($c && ($u['role'] === 'admin' || (int) $c['owner_id'] === (int) $u['id']) && filter_var(trim((string) $c['email']), FILTER_VALIDATE_EMAIL)) {
                $cl[] = $c;
            }
        }
        out(['ok' => true, 'total' => count($cl), 'samples' => bulk_samples($subject, $text, $cl, $u, 5), 'needsApproval' => $u['role'] !== 'admin']);
    }

    case 'bulk_send': {
        $u = need_write();
        $in = body();
        if (!Mailer::configured()) {
            throw new ApiError('E-mail još nije podešen. Administrator ga podešava u config.php.', 409);
        }
        $subject = f_str($in, 'subject', 255, 'Predmet', true);
        if (preg_match('/[\r\n]/', $subject)) {
            throw new ApiError('Predmet mora biti u jednom retku.');
        }
        $text = f_str($in, 'body', 20000, 'Poruka', true);
        $ids = array_values(array_filter(array_map('intval', is_array($in['ids'] ?? null) ? $in['ids'] : [])));
        if (!$ids) {
            throw new ApiError('Odaberite barem jednog primatelja.');
        }
        $at = null;
        if (!empty($in['send_at'])) {
            $at = (int) $in['send_at'];
            if ($at < ms() + 60000 || $at > ms() + 366 * DAY_MS) {
                throw new ApiError('Vrijeme slanja mora biti u budućnosti (najviše godinu dana unaprijed).');
            }
        }
        $r = transaction(static fn () => bulk_queue($u, $ids, $subject, $text, $at));
        if ($r['queued'] === 0) {
            throw new ApiError('Nijedna poruka nije stavljena u red' . ($r['skipped'] ? ' (primatelji su već dobili poruku s istim predmetom u zadnjih 30 dana ili nemaju ispravnu adresu).' : '.'));
        }
        if ($r['needsApproval']) {
            audit(null, (int) $u['id'], 'update', 'Grupna e-mail poruka čeka odobrenje: "' . $subject . '" (' . $r['queued'] . ' primatelja)', '');
        }
        out(['ok' => true] + $r + ['eta' => bulk_eta(bulk_pending_count())]);
    }

    case 'batch_detail': {
        $u = need_write();
        $b = row('SELECT * FROM mail_batches WHERE batch = ?', [(string) (body()['batch'] ?? '')]);
        if (!$b || ($u['role'] !== 'admin' && (int) $b['user_id'] !== (int) $u['id'])) {
            throw new ApiError('Slanje ne postoji.', 404);
        }
        $rowsx = rows('SELECT s.client_id, s.to_email, s.subject, s.body, s.user_id FROM scheduled_emails s WHERE s.batch = ? ORDER BY s.id', [$b['batch']]);
        $samples = [];
        foreach (array_slice($rowsx, 0, 5) as $r) {
            $su = row('SELECT * FROM users WHERE id = ?', [$r['user_id']]);
            $c = row('SELECT name FROM clients WHERE id = ?', [$r['client_id']]);
            $samples[] = ['to' => (string) $r['to_email'], 'name' => (string) ($c['name'] ?? ''), 'sender' => (string) ($su['name'] ?? ''), 'subject' => (string) $r['subject'],
                'body' => $su ? with_signature((string) $r['body'], $su) : (string) $r['body']];
        }
        $names = [];
        foreach ($rowsx as $r) {
            $c = row('SELECT name FROM clients WHERE id = ?', [$r['client_id']]);
            $names[] = ($c['name'] ?? '?') . ' <' . $r['to_email'] . '>';
        }
        out(['ok' => true, 'batch' => (string) $b['batch'], 'by' => user_name_of($b['user_id']), 'status' => (string) $b['status'], 'sendAt' => (int) $b['send_at'], 'total' => count($rowsx), 'samples' => $samples, 'recipients' => array_slice($names, 0, 300)]);
    }

    case 'batch_decide': {
        $u = need_write();
        need_admin($u);
        $in = body();
        $b = row('SELECT * FROM mail_batches WHERE batch = ?', [(string) ($in['batch'] ?? '')]);
        if (!$b) {
            throw new ApiError('Slanje ne postoji.', 404);
        }
        if ($b['status'] !== 'awaiting') {
            throw new ApiError('O ovom slanju je već odlučeno.', 409);
        }
        $approve = ($in['decision'] ?? '') === 'approve';
        transaction(static function () use ($b, $u, $approve): void {
            run("UPDATE scheduled_emails SET status = ? WHERE batch = ? AND status = 'awaiting'", [$approve ? 'pending' : 'cancelled', $b['batch']]);
            run('UPDATE mail_batches SET status = ?, decided_by = ?, decided_at = ? WHERE batch = ?', [$approve ? 'approved' : 'rejected', $u['id'], ms(), $b['batch']]);
        });
        audit(null, (int) $u['id'], 'update', ($approve ? 'Odobreno' : 'Odbijeno') . ' grupno slanje: "' . $b['subject'] . '" (' . user_name_of($b['user_id']) . ', ' . $b['total'] . ' primatelja)', '');
        out(['ok' => true]);
    }

    case 'bulk_cancel': {
        $u = need_write();
        $batch = (string) (body()['batch'] ?? '');
        $sql = "UPDATE scheduled_emails SET status = 'cancelled' WHERE batch = ? AND bulk = 1 AND status IN ('awaiting','pending','failed')";
        $p = [$batch];
        if ($u['role'] !== 'admin') {
            $sql .= ' AND user_id = ?';
            $p[] = $u['id'];
        }
        $n = run($sql, $p);
        run("UPDATE mail_batches SET status = 'cancelled' WHERE batch = ? AND status = 'awaiting'" . ($u['role'] !== 'admin' ? ' AND user_id = ' . (int) $u['id'] : ''), [$batch]);
        out(['ok' => true, 'cancelled' => $n]);
    }

    case 'template_save': {
        $u = need_write();
        need_admin($u);
        $in = body();
        $name = f_str($in, 'name', 120, 'Naziv predloška', true);
        $subject = f_str($in, 'subject', 255, 'Predmet', true);
        $text = f_str($in, 'body', 10000, 'Tekst predloška', true);
        $kind = ($in['kind'] ?? '') === 'akcija' ? 'akcija' : 'email';
        $mode = in_array($in['send_mode'] ?? '', ['delay', 'fixed'], true) ? $in['send_mode'] : 'manual';
        $days = max(0, min(60, (int) ($in['send_days'] ?? 1)));
        $time = preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', (string) ($in['send_time'] ?? '')) ? (string) $in['send_time'] : '09:00';
        $fixed = $mode === 'fixed' && !empty($in['send_fixed']) ? (int) $in['send_fixed'] : null;
        if ($mode === 'fixed' && $fixed === null) {
            throw new ApiError('Odaberite datum i vrijeme slanja.');
        }
        $aud = $kind === 'akcija' ? clean_audience($in['audience'] ?? []) : ['groups' => [], 'kind' => 'sve', 'owner' => ''];
        if ($kind === 'akcija' && !$aud['groups']) {
            throw new ApiError('Odaberite barem jednu skupinu primatelja.');
        }
        $inputs = [];
        foreach ((is_array($in['inputs'] ?? null) ? $in['inputs'] : []) as $k => $v) {
            if (in_array($k, ['naziv', 'ponuda', 'popust', 'rok', 'kontakt', 'ton'], true) && is_string($v)) {
                $inputs[$k] = mb_substr(trim($v), 0, 1000);
            }
        }
        $vals = [$name, $subject, $text, $kind, $mode, $days, $time, $fixed, json_encode($aud), json_encode($inputs ?: new stdClass()), ms()];
        if (!empty($in['id'])) {
            if (run('UPDATE templates SET name = ?, subject = ?, body = ?, kind = ?, send_mode = ?, send_days = ?, send_time = ?, send_fixed = ?, audience = ?, inputs = ?, updated_at = ? WHERE id = ?', array_merge($vals, [(int) $in['id']])) === 0 && !row('SELECT id FROM templates WHERE id = ?', [(int) $in['id']])) {
                throw new ApiError('Predložak ne postoji.', 404);
            }
        } else {
            $max = row('SELECT COALESCE(MAX(sort_order), 0) AS m FROM templates');
            run('INSERT INTO templates (name, subject, body, kind, send_mode, send_days, send_time, send_fixed, audience, inputs, updated_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', array_merge($vals, [(int) $max['m'] + 1]));
        }
        out(['ok' => true]);
    }

    case 'template_quick': {
        // svaki korisnik može spremiti dobar odgovor iz Inboxa kao zajednički predložak (obični e-mail predložak)
        $u = need_write();
        $in = body();
        $name = f_str($in, 'name', 120, 'Naziv predloška', true);
        $text = f_str($in, 'body', 10000, 'Tekst predloška', true);
        if (mb_strlen(trim($text)) < 10) {
            throw new ApiError('Tekst predloška je prekratak.');
        }
        if (row('SELECT id FROM templates WHERE name = ? AND kind = ?', [$name, 'email'])) {
            throw new ApiError('Predložak s tim nazivom već postoji. Odaberite drugi naziv.');
        }
        $subject = trim((string) ($in['subject'] ?? '')) !== '' ? f_str($in, 'subject', 255, 'Predmet') : 'Odgovor';
        $max = row('SELECT COALESCE(MAX(sort_order), 0) AS m FROM templates');
        run('INSERT INTO templates (name, subject, body, kind, send_mode, send_days, send_time, send_fixed, audience, inputs, updated_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$name, $subject, $text, 'email', 'manual', 1, '09:00', null, json_encode(['groups' => [], 'kind' => 'sve', 'owner' => '']), json_encode(new stdClass()), ms(), (int) $max['m'] + 1]);
        audit(null, (int) $u['id'], 'update', 'Predložak spremljen iz odgovora: ' . $name);
        out(['ok' => true]);
    }

    case 'campaign_preview': {
        $u = need_write();
        need_admin($u);
        $in = body();
        $list = campaign_recipients(is_array($in['audience'] ?? null) ? $in['audience'] : []);
        out(['ok' => true, 'count' => count($list), 'sample' => array_map(static fn ($c) => (string) $c['name'], array_slice($list, 0, 8))]);
    }

    case 'campaign_send': {
        $u = need_write();
        need_admin($u);
        if (!Mailer::configured()) {
            throw new ApiError('E-mail još nije podešen. Administrator ga podešava u config.php.', 409);
        }
        $t = row("SELECT * FROM templates WHERE id = ? AND kind = 'akcija'", [(int) (body()['id'] ?? 0)]);
        if (!$t) {
            throw new ApiError('Akcija ne postoji. Najprije je spremite.', 404);
        }
        $r = transaction(static fn () => campaign_queue($t, $u));
        out(['ok' => true] + $r);
    }

    case 'template_delete': {
        $u = need_write();
        need_admin($u);
        run('DELETE FROM templates WHERE id = ?', [(int) (body()['id'] ?? 0)]);
        out(['ok' => true]);
    }

    case 'dnc_list': {
        need_user();
        out(['list' => array_map(static fn ($r) => ['id' => (string) $r['id'], 'email' => (string) $r['email'], 'client' => $r['client_id'] !== null ? (string) $r['client_id'] : '', 'reason' => (string) $r['reason'],
            'source' => (string) $r['source'], 'at' => (int) $r['created_at']], rows('SELECT * FROM do_not_contact ORDER BY created_at DESC, id DESC LIMIT 2000'))]);
    }

    case 'dnc_add': {
        $u = need_write();
        $in = body();
        $email = strtolower(f_email($in, 'email', true));
        $reason = f_str($in, 'reason', 190, 'Razlog') ?: 'Dodano ručno';
        if (!dnc_add($email, $reason, 'manual', (int) $u['id'])) {
            throw new ApiError('Adresa je već na popisu.', 409);
        }
        out(['ok' => true]);
    }

    case 'dnc_remove': {
        $u = need_write();
        need_admin($u);
        $r = row('SELECT * FROM do_not_contact WHERE id = ?', [(int) (body()['id'] ?? 0)]);
        if (!$r) {
            throw new ApiError('Zapis ne postoji.', 404);
        }
        run('DELETE FROM do_not_contact WHERE id = ?', [$r['id']]);
        audit($r['client_id'] !== null ? (int) $r['client_id'] : null, (int) $u['id'], 'dnc', 'Uklonjen s popisa ne kontaktirati: ' . $r['email']);
        out(['ok' => true]);
    }

}
