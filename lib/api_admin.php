<?php
declare(strict_types=1);

/* API akcije: Statistika, korisnici, sigurnost, backup i postavke. Uključuje se iz api.php u istom opsegu (koristi $action, $u, body()...). */

switch ($action) {
    case 'security_overview': {
        $u = need_user();
        need_admin($u);
        run('DELETE FROM ip_blocks WHERE until_at <= ?', [ms()]);
        out(['twofa' => setting_get('twofa_enabled', '1') === '1', 'twofaActive' => twofa_required(), 'mailOk' => Mailer::configured(),
            'blocks' => array_map(static fn ($b) => ['ip' => (string) $b['ip'], 'until' => (int) $b['until_at'], 'reason' => (string) $b['reason'], 'at' => (int) $b['created_at']], rows('SELECT * FROM ip_blocks ORDER BY created_at DESC LIMIT 100')),
            'trusted' => (int) row('SELECT COUNT(*) AS c FROM trusted_devices WHERE expires_at > ?', [ms()])['c']]);
    }

    case 'security_save': {
        $u = need_write();
        need_admin($u);
        $in = body();
        setting_set('twofa_enabled', !empty($in['twofa']) ? '1' : '0');
        if (!empty($in['revoke_trusted'])) {
            run('DELETE FROM trusted_devices');
        }
        audit(null, (int) $u['id'], 'security', 'Prijava u dva koraka: ' . (!empty($in['twofa']) ? 'uključena' : 'isključena') . (!empty($in['revoke_trusted']) ? ', pouzdani uređaji poništeni' : ''));
        out(['ok' => true]);
    }

    case 'ip_unblock': {
        $u = need_write();
        need_admin($u);
        $ip = substr((string) (body()['ip'] ?? ''), 0, 45);
        run('DELETE FROM ip_blocks WHERE ip = ?', [$ip]);
        run('DELETE FROM login_attempts WHERE ip = ?', [$ip]);
        audit(null, (int) $u['id'], 'security', 'Odblokirana IP adresa ' . $ip);
        out(['ok' => true]);
    }

    case 'usage': {
        $u = need_user();
        need_admin($u);
        out(['usage' => usage_report()]);
    }

    case 'ping': {
        $u = need_write();
        presence_ping((int) $u['id']);
        out(['ok' => true]);
    }

    case 'user_stats': {
        $u = need_user();
        $from = (string) ($_GET['from'] ?? '');
        $to = (string) ($_GET['to'] ?? '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $to) || $to <= $from || strtotime($to) - strtotime($from) > 4000 * 86400) {
            throw new ApiError('Razdoblje nije ispravno.');
        }
        out(['from' => $from, 'to' => $to, 'users' => user_stats($u, $from, $to)]);
    }

    case 'pipeline': {
        $u = need_user();
        out(pipeline_report($u));
    }

    case 'revenue': {
        $u = need_user();
        out(revenue_report($u));
    }

    case 'audit_list': {
        $u = need_user();
        need_admin($u);
        $cid = (int) ($_GET['client_id'] ?? 0);
        $lim = max(1, min(500, (int) ($_GET['limit'] ?? 150)));
        $rs = $cid ? rows('SELECT * FROM audit_log WHERE client_id = ? ORDER BY at DESC, id DESC LIMIT ' . $lim, [$cid])
                   : rows('SELECT * FROM audit_log ORDER BY at DESC, id DESC LIMIT ' . $lim);
        out(['entries' => array_map(static fn ($r) => ['id' => (string) $r['id'], 'clientId' => $r['client_id'] !== null ? (string) $r['client_id'] : '', 'client' => (string) $r['client_name'],
            'user' => $r['user_id'] !== null ? user_name_of($r['user_id']) : 'Sustav', 'at' => (int) $r['at'], 'action' => (string) $r['action'], 'details' => (string) $r['details']], $rs)]);
    }

    case 'goals': {
        $u = need_user();
        out(goals_report($u));
    }

    case 'goals_save': {
        $u = need_write();
        need_admin($u);
        $in = body()['goals'] ?? [];
        $clean = [];
        if (is_array($in)) {
            foreach ($in as $id => $v) {
                $v = round((float) $v, 2);
                if ($v < 0 || $v > 1000000) {
                    throw new ApiError('Cilj mora biti između 0 i 1.000.000 €.');
                }
                if ($v > 0 && row("SELECT id FROM users WHERE id = ? AND role = 'sales'", [(int) $id])) {
                    $clean[(string) (int) $id] = $v;
                }
            }
        }
        setting_set('weekly_goals', json_encode($clean));
        audit(null, (int) $u['id'], 'update', 'Tjedni ciljevi prihoda ažurirani');
        out(['ok' => true]);
    }

    case 'backup_list': {
        $u = need_user();
        need_admin($u);
        out(['backups' => backup_list(), 'keep' => BACKUP_KEEP, 'doneToday' => backup_today_exists()]);
    }

    case 'backup_run': {
        $u = need_write();
        need_admin($u);
        $r = backup_create((string) $u['name']);
        out(['ok' => true, 'name' => $r['name'], 'backups' => backup_list(), 'keep' => BACKUP_KEEP, 'doneToday' => true]);
    }

    case 'bounce_enable': {
        $u = need_write();
        need_admin($u);
        setting_set('bounce_enabled', !empty(body()['on']) ? '1' : '0');
        audit(null, (int) $u['id'], 'update', 'Automatska obrada vraćenih poruka: ' . (!empty(body()['on']) ? 'uključena' : 'isključena'), '');
        out(['ok' => true, 'enabled' => bounce_enabled()]);
    }

    case 'bounce_preview': {
        // admin: što bi obrada učinila s vraćenim porukama u Inboxu (ništa se ne zapisuje)
        $u = need_user();
        need_admin($u);
        out(bounce_preview());
    }

    case 'backup_latest': {
        // admin: preuzmi najnoviju kopiju (ako danas još nema nijedne, prvo se napravi)
        $u = need_user();
        need_admin($u);
        $l = backup_list();
        if (!$l) {
            backup_create((string) $u['name']);
            $l = backup_list();
        }
        $f = $l[0]['name'];
        $path = backup_dir() . '/' . $f;
        audit(null, (int) $u['id'], 'backup', 'Preuzeta sigurnosna kopija: ' . $f);
        header_remove('Content-Type');
        header('Content-Type: application/gzip');
        header('Content-Length: ' . filesize($path));
        header('Content-Disposition: attachment; filename="' . $f . '"');
        header('Cache-Control: private, no-store');
        readfile($path);
        exit;
    }

    case 'backup_download': {
        $u = need_user();
        need_admin($u);
        $f = (string) ($_GET['f'] ?? '');
        if (!preg_match('/^crm-backup-\d{8}-\d{6}\.json\.gz$/', $f) || !is_file(backup_dir() . '/' . $f)) {
            throw new ApiError('Kopija ne postoji.', 404);
        }
        $path = backup_dir() . '/' . $f;
        audit(null, (int) $u['id'], 'backup', 'Preuzeta sigurnosna kopija: ' . $f);
        header_remove('Content-Type');
        header('Content-Type: application/gzip');
        header('Content-Length: ' . filesize($path));
        header('Content-Disposition: attachment; filename="' . $f . '"');
        header('Cache-Control: private, no-store');
        readfile($path);
        exit;
    }

    case 'alert_done': {
        $u = need_write();
        $id = (int) (body()['id'] ?? 0);
        run('UPDATE alerts SET done_at = ? WHERE id = ? AND user_id = ? AND done_at IS NULL', [ms(), $id, $u['id']]);
        out(['ok' => true]);
    }

    case 'settings_save': {
        $u = need_write();
        need_admin($u);
        $in = body();
        $subject = f_str($in, 'ar_subject', 200, 'Predmet automatskog odgovora', true);
        if (preg_match('/[\r\n]/', $subject)) {
            throw new ApiError('Predmet mora biti u jednom retku.');
        }
        $text = f_str($in, 'ar_body', 3000, 'Tekst automatskog odgovora', true);
        setting_set('autoreply_enabled', !empty($in['ar_enabled']) ? '1' : '0');
        setting_set('autoreply_subject', $subject);
        setting_set('autoreply_body', $text);
        setting_set('report_enabled', !empty($in['report_enabled']) ? '1' : '0');
        out(['ok' => true]);
    }

    case 'report_preview': {
        need_user();
        need_admin(current_user());
        out(['ok' => true] + report_text(null, ($_GET['period'] ?? '') === 'month'));
    }

    case 'report_send': {
        $u = need_write();
        need_admin($u);
        if (!Mailer::configured()) {
            throw new ApiError('E-mail još nije podešen.', 409);
        }
        try {
            send_report([$u], null, !empty(body()['monthly']));
        } catch (MailException $e) {
            out(['ok' => false, 'error' => $e->getMessage()]);
        }
        out(['ok' => true, 'to' => (string) $u['email']]);
    }

    case 'user_create': {
        $u = need_write();
        need_admin($u);
        $in = body();
        $name = f_str($in, 'name', 120, 'Ime', true);
        $email = strtolower(f_email($in, 'email', true));
        $pass = (string) ($in['password'] ?? '');
        check_password_strength($pass);
        $role = in_array($in['role'] ?? '', ['admin', 'sales'], true) ? $in['role'] : 'sales';
        if (row('SELECT id FROM users WHERE email = ?', [$email])) {
            throw new ApiError('Korisnik s tom e-mail adresom već postoji.');
        }
        run('INSERT INTO users (name, email, pass_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
            [$name, $email, password_hash($pass, PASSWORD_DEFAULT), $role, ms()]);
        out(['ok' => true]);
    }

    case 'user_update': {
        $u = need_write();
        need_admin($u);
        $in = body();
        $t = row('SELECT * FROM users WHERE id = ?', [(int) ($in['id'] ?? 0)]);
        if (!$t) {
            throw new ApiError('Korisnik ne postoji.', 404);
        }
        $name = f_str($in, 'name', 120, 'Ime', true);
        $email = strtolower(f_email($in, 'email', true));
        $role = in_array($in['role'] ?? '', ['admin', 'sales'], true) ? $in['role'] : $t['role'];
        $active = !empty($in['active']) ? 1 : 0;
        if (row('SELECT id FROM users WHERE email = ? AND id <> ?', [$email, $t['id']])) {
            throw new ApiError('Ta e-mail adresa već pripada drugom korisniku.');
        }
        if ((int) $t['id'] === (int) $u['id'] && ($role !== 'admin' || !$active)) {
            throw new ApiError('Ne možete sami sebi ukloniti administratorska prava ili račun deaktivirati.');
        }
        $pass = (string) ($in['password'] ?? '');
        if ($pass !== '') {
            check_password_strength($pass);
            run('UPDATE users SET pass_hash = ? WHERE id = ?', [password_hash($pass, PASSWORD_DEFAULT), $t['id']]);
            trusted_revoke((int) $t['id']);
            audit(null, (int) $u['id'], 'security', 'Administrator je resetirao lozinku korisniku ' . $t['name']);
        }
        run('UPDATE users SET name = ?, email = ?, role = ?, active = ? WHERE id = ?', [$name, $email, $role, $active, $t['id']]);
        out(['ok' => true]);
    }

    case 'password_change': {
        $u = need_write();
        $in = body();
        $full = row('SELECT pass_hash FROM users WHERE id = ?', [$u['id']]);
        if (!password_verify((string) ($in['current'] ?? ''), (string) $full['pass_hash'])) {
            throw new ApiError('Trenutna lozinka nije točna.');
        }
        $new = (string) ($in['password'] ?? '');
        check_password_strength($new);
        run('UPDATE users SET pass_hash = ? WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), $u['id']]);
        trusted_revoke((int) $u['id']);
        out(['ok' => true]);
    }

}
