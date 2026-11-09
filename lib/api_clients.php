<?php
declare(strict_types=1);

/* API akcije: Klijenti, bilješke, kampanje, uvoz i duplikati. Uključuje se iz api.php u istom opsegu (koristi $action, $u, body()...). */

switch ($action) {
    case 'pool_list': {
        need_user();
        $q = trim((string) ($_GET['q'] ?? ''));
        $pg = max(1, (int) ($_GET['p'] ?? 1));
        $per = 50;
        $where = pool_sql();
        $p = [];
        if ($q !== '') {
            $like = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], mb_substr($q, 0, 80)) . '%';
            $where .= " AND (name LIKE ? ESCAPE '!' OR email LIKE ? ESCAPE '!' OR oib LIKE ? ESCAPE '!' OR phone LIKE ? ESCAPE '!' OR address LIKE ? ESCAPE '!')";
            $p = [$like, $like, $like, $like, $like];
        }
        $total = (int) (row('SELECT COUNT(*) AS c FROM clients WHERE ' . $where, $p)['c'] ?? 0);
        $list = rows('SELECT * FROM clients WHERE ' . $where . ' ORDER BY name LIMIT ' . $per . ' OFFSET ' . (($pg - 1) * $per), $p);
        out(['total' => $total, 'page' => $pg, 'per' => $per, 'clients' => array_map('client_out', $list)]);
    }

    case 'pool_segments': {
        $u = need_user();
        need_admin($u);
        out(pool_segments());
    }

    case 'pool_campaign': {
        // kampanja "povratak": admin šalje izgubljenim klijentima iz arhive (grad / djelatnost), kroz red slanja s ograničenjem po satu
        $u = need_write();
        need_admin($u);
        $in = body();
        $city = trim((string) ($in['city'] ?? ''));
        $ind = trim((string) ($in['industry'] ?? ''));
        $limit = max(1, min(1000, (int) ($in['limit'] ?? 200)));
        $ids = pool_segment_ids($city, $ind, $limit);
        if (!empty($in['preview'])) {
            $cl = $ids ? rows('SELECT * FROM clients WHERE id IN (' . implode(',', array_map('intval', array_slice($ids, 0, 3))) . ')') : [];
            $subject = trim((string) ($in['subject'] ?? ''));
            $text = trim((string) ($in['body'] ?? ''));
            out(['count' => count($ids), 'samples' => $subject !== '' && $text !== '' ? bulk_samples($subject, $text, $cl, $u, 3) : []]);
        }
        if (!Mailer::configured()) {
            throw new ApiError('E-mail još nije podešen. Administrator ga podešava u config.php.', 409);
        }
        $subject = f_str($in, 'subject', 255, 'Predmet', true);
        if (preg_match('/[\r\n]/', $subject)) {
            throw new ApiError('Predmet mora biti u jednom retku.');
        }
        $text = f_str($in, 'body', 20000, 'Poruka', true);
        if (!$ids) {
            throw new ApiError('U odabranom segmentu nema klijenata s ispravnom e-mail adresom.');
        }
        $r = transaction(static fn () => bulk_queue($u, $ids, $subject, $text, null));
        if ($r['queued'] === 0) {
            throw new ApiError('Nijedna poruka nije stavljena u red (primatelji su već dobili poruku s istim predmetom u zadnjih 30 dana).');
        }
        audit(null, (int) $u['id'], 'update', 'Kampanja povratak: "' . $subject . '" (' . $r['queued'] . ' primatelja, segment: ' . ($city !== '' ? $city : 'svi') . ')', '');
        out(['ok' => true] + $r + ['eta' => bulk_eta(bulk_pending_count())]);
    }

    case 'client_get': {
        need_user();
        $c = load_client((string) ($_GET['id'] ?? ''));
        out(['client' => client_out($c), 'notes' => array_map('note_out', rows('SELECT id, client_id, author_id, type, subject, body, to_email, created_at, bulk FROM notes WHERE client_id = ? ORDER BY created_at DESC, id DESC LIMIT 500', [$c['id']]))]);
    }

    case 'client_create': {
        $u = need_write();
        $in = body();
        $kind = f_kind($in);
        $name = f_str($in, 'name', 190, $kind === 'osoba' ? 'Ime i prezime' : 'Naziv tvrtke', true);
        $contact = $kind === 'osoba' ? $name : f_str($in, 'contact', 190, 'Kontakt osoba', true);
        $oib = f_oib($in);
        $email = f_email($in, 'email');
        $email2 = f_email($in, 'email2');
        $phone = f_str($in, 'phone', 60, 'Telefon');
        $service = f_services($in['service'] ?? '');
        $industry = f_str($in, 'industry', 120, 'Djelatnost');
        $value = f_value($in['value'] ?? 0);
        $vkind = (($in['value_kind'] ?? '') === 'ugovoreno') ? 'ugovoreno' : 'ponudeno';
        $status = f_status($in['status'] ?? 'novi');
        $owner = active_user_id($in['owner_id'] ?? null, (int) $u['id']);
        $fu = f_date($in['next_follow_up'] ?? '');
        $fut = $fu ? f_time($in['next_follow_time'] ?? '') : null;
        [$campA, $campS, $campE, $campV, $campT] = f_campaign($in);
        if ($campA === 1) {
            $status = 'aktivni';
            $vkind = 'ugovoreno'; // aktivna kampanja = ugovoreno
        }
        $note = f_text($in, 'note', 'Prva bilješka');
        $mailId = !empty($in['email_id']) ? (int) load_email((string) $in['email_id'])['id'] : null;
        $t = ms();
        $id = transaction(static function () use ($kind, $oib, $name, $contact, $email, $phone, $service, $industry, $value, $vkind, $status, $owner, $fu, $fut, $note, $t, $u, $campA, $campS, $campE, $campV): int {
            run('INSERT INTO clients (kind, oib, name, contact, email, phone, service, industry, value, value_kind, status, owner_id, next_follow_up, next_follow_time, won_at, created_by, created_at, updated_at, camp_active, camp_start, camp_end, camp_value)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$kind, $oib, $name, $contact, $email, $phone, $service, $industry, $value, $vkind, $status, $owner, $fu, $fut, $status === 'dobiven' ? $t : null, $u['id'], $t, $t, $campA, $campS, $campE, $campV]);
            $cid = insert_id();
            record_owner($cid, (int) $owner, $t);
            run('INSERT INTO notes (client_id, author_id, type, body, created_at) VALUES (?, ?, ?, ?, ?)', [$cid, $u['id'], 'note', $note, $t]);
            return $cid;
        });
        run('UPDATE clients SET camp_type = ?, email2 = ?, camp_months = ? WHERE id = ?', [$campT, $email2, camp_months_val($in['camp_months'] ?? 12), $id]);
        link_emails_to_client($id, strtolower($email));
        link_emails_to_client($id, strtolower($email2));
        if ($mailId !== null) {
            run('UPDATE emails SET client_id = ? WHERE id = ? AND client_id IS NULL', [$id, $mailId]);
            sync_document_clients();
        }
        audit($id, (int) $u['id'], 'create', 'Klijent kreiran, status: ' . (STAGE_LABELS[$status] ?? $status) . ($campA ? ', kampanja do ' . date('d.m.Y.', strtotime($campE)) . ' (' . number_format((float) $campV, 2, ',', '.') . ' €)' : ''), $name);
        out(['ok' => true, 'id' => (string) $id]);
    }

    case 'client_multi': {
        $u = need_write();
        $in = body();
        $c = load_client((string) ($in['client_id'] ?? ''));
        if ($u['role'] !== 'admin' && (int) $c['owner_id'] !== (int) $u['id']) {
            throw new ApiError('Opciju može promijeniti administrator ili prodavač klijenta.', 403);
        }
        $on = !empty($in['on']) ? 1 : 0;
        run('UPDATE clients SET multi_camp = ?, updated_at = ? WHERE id = ?', [$on, ms(), $c['id']]);
        audit((int) $c['id'], (int) $u['id'], 'update', $on ? 'Označen kao marketing agencija: može imati više aktivnih kampanja odjednom' : 'Maknuta oznaka marketing agencije (više kampanja odjednom)', (string) $c['name']);
        out(['ok' => true]);
    }

    case 'campaign_add': {
        $u = need_write();
        $in = body();
        $c = load_client((string) ($in['client_id'] ?? ''));
        if ($u['role'] !== 'admin' && (int) $c['owner_id'] !== (int) $u['id']) {
            throw new ApiError('Kampanju može dodati administrator ili prodavač klijenta.', 403);
        }
        if ((int) ($c['multi_camp'] ?? 0) !== 1) {
            throw new ApiError('Više istovremenih kampanja moguće je samo za klijenta označenog kao marketing agencija.');
        }
        [, $ns, $ne, $nv, $nt] = f_campaign(['camp_active' => 1, 'camp_start' => $in['start'] ?? '', 'camp_end' => $in['end'] ?? '', 'camp_value' => $in['value'] ?? '', 'camp_type' => $in['type'] ?? '']);
        $title = mb_substr(trim((string) ($in['title'] ?? '')), 0, 190);
        $t = ms();
        $nm = camp_months_val($in['months'] ?? 12);
        transaction(static function () use ($c, $u, $ns, $ne, $nv, $nt, $title, $t, $nm): void {
            run('INSERT INTO campaigns (client_id, start_date, end_date, value, created_by, created_at, service, owner_id, title, camp_type, camp_months) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$c['id'], $ns, $ne, $nv, $u['id'], $t, (string) ($c['service'] ?? ''), $c['owner_id'] ?? null, $title, $nt, $nm]);
            mark_client_active($c, (int) $u['id'], $t);
            run('INSERT INTO notes (client_id, author_id, type, body, created_at) VALUES (?, ?, ?, ?, ?)',
                [$c['id'], $u['id'], 'note', 'Dodatna kampanja' . ($title !== '' ? ' „' . $title . '“' : '') . ': ' . date('d.m.Y.', strtotime($ns)) . ' – ' . date('d.m.Y.', strtotime($ne)) . ', vrijednost ' . number_format((float) $nv, 2, ',', '.') . ' €', $t]);
        });
        audit((int) $c['id'], (int) $u['id'], 'campaign', 'Dodatna kampanja' . ($title !== '' ? ' „' . $title . '“' : '') . ': ' . date('d.m.Y.', strtotime($ns)) . ' – ' . date('d.m.Y.', strtotime($ne)) . ', ' . number_format((float) $nv, 2, ',', '.') . ' €', (string) $c['name']);
        out(['ok' => true]);
    }

    case 'campaign_remove': {
        $u = need_write();
        $cp = row('SELECT * FROM campaigns WHERE id = ?', [(int) (body()['id'] ?? 0)]);
        if (!$cp) {
            throw new ApiError('Kampanja ne postoji.', 404);
        }
        $c = load_client((string) $cp['client_id']);
        if ($u['role'] !== 'admin' && (int) $c['owner_id'] !== (int) $u['id']) {
            throw new ApiError('Kampanju može obrisati administrator ili prodavač klijenta.', 403);
        }
        run('DELETE FROM campaigns WHERE id = ?', [$cp['id']]);
        audit((int) $c['id'], (int) $u['id'], 'campaign', 'Obrisana kampanja ' . ($cp['title'] !== '' ? '„' . $cp['title'] . '“ ' : '') . date('d.m.Y.', strtotime((string) $cp['end_date'])) . ' (' . number_format((float) $cp['value'], 2, ',', '.') . ' €)', (string) $c['name']);
        out(['ok' => true]);
    }

    case 'campaign_extend': {
        $u = need_write();
        $in = body();
        $c = load_client((string) ($in['client_id'] ?? ''));
        if ($u['role'] !== 'admin' && (int) $c['owner_id'] !== (int) $u['id']) {
            throw new ApiError('Kampanju može produljiti administrator ili prodavač klijenta.', 403);
        }
        if ((int) $c['camp_active'] !== 1 || empty($c['camp_end'])) {
            throw new ApiError('Klijent nema aktivnu kampanju.');
        }
        $ne = f_date($in['end'] ?? '');
        if ($ne === null || $ne <= (string) $c['camp_end']) {
            throw new ApiError('Novi datum završetka mora biti nakon današnjeg završetka kampanje.');
        }
        $old = (string) $c['camp_end'];
        run('UPDATE clients SET camp_end = ?, updated_at = ? WHERE id = ?', [$ne, ms(), $c['id']]);
        run('INSERT INTO notes (client_id, author_id, type, body, created_at) VALUES (?, ?, ?, ?, ?)',
            [$c['id'], $u['id'], 'note', 'Kampanja produljena: ' . date('d.m.Y.', strtotime($old)) . ' → ' . date('d.m.Y.', strtotime($ne)), ms()]);
        audit((int) $c['id'], (int) $u['id'], 'campaign', 'Kampanja produljena do ' . date('d.m.Y.', strtotime($ne)), (string) $c['name']);
        run('UPDATE alerts SET done_at = ? WHERE client_id = ? AND kind = ? AND done_at IS NULL', [ms(), $c['id'], 'camp_soon']);
        out(['ok' => true]);
    }

    case 'search': {
        need_user();
        $q = trim((string) ($_GET['q'] ?? ''));
        if (mb_strlen($q) < 2) {
            out(['clients' => [], 'notes' => [], 'emails' => []]);
        }
        $like = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], mb_substr($q, 0, 80)) . '%';
        $cl = rows("SELECT id, name, contact, email, status FROM clients WHERE name LIKE ? ESCAPE '!' OR contact LIKE ? ESCAPE '!' OR email LIKE ? ESCAPE '!' OR email2 LIKE ? ESCAPE '!' OR oib LIKE ? ESCAPE '!' OR phone LIKE ? ESCAPE '!' ORDER BY name LIMIT 8", [$like, $like, $like, $like, $like, $like]);
        $nt = rows("SELECT n.id, n.client_id, n.type, n.body, n.created_at, c.name AS cname FROM notes n JOIN clients c ON c.id = n.client_id WHERE n.body LIKE ? ESCAPE '!' OR n.subject LIKE ? ESCAPE '!' ORDER BY n.created_at DESC LIMIT 8", [$like, $like]);
        $em = rows("SELECT id, direction, from_email, from_name, to_email, subject, body, msg_date FROM emails WHERE deleted_at IS NULL AND (subject LIKE ? ESCAPE '!' OR body LIKE ? ESCAPE '!' OR from_email LIKE ? ESCAPE '!' OR from_name LIKE ? ESCAPE '!' OR to_email LIKE ? ESCAPE '!') ORDER BY msg_date DESC LIMIT 8", [$like, $like, $like, $like, $like]);
        $snip = static function (string $t) use ($q): string {
            $t = trim(preg_replace('/\s+/u', ' ', $t) ?? $t);
            $p = mb_stripos($t, $q);
            $from = $p === false ? 0 : max(0, $p - 40);
            return ($from > 0 ? '…' : '') . mb_substr($t, $from, 120) . (mb_strlen($t) > $from + 120 ? '…' : '');
        };
        out([
            'clients' => array_map(static fn ($r) => ['id' => (string) $r['id'], 'name' => (string) $r['name'], 'contact' => (string) $r['contact'], 'email' => (string) $r['email'], 'status' => (string) $r['status']], $cl),
            'notes' => array_map(static fn ($r) => ['id' => (string) $r['id'], 'clientId' => (string) $r['client_id'], 'client' => (string) $r['cname'], 'type' => (string) $r['type'], 'snip' => $snip((string) $r['body']), 'at' => (int) $r['created_at']], $nt),
            'emails' => array_map(static fn ($r) => ['id' => (string) $r['id'], 'dir' => $r['direction'] === 'in' ? 'in' : 'out', 'who' => $r['direction'] === 'in' ? trim((string) $r['from_name'] . ' <' . $r['from_email'] . '>') : (string) $r['to_email'], 'subject' => (string) $r['subject'], 'snip' => $snip((string) $r['body']), 'at' => (int) $r['msg_date']], $em),
        ]);
    }

    case 'campaign_renew': {
        $u = need_write();
        $in = body();
        $c = load_client((string) ($in['client_id'] ?? ''));
        [, $ns, $ne, $nv, $nt] = f_campaign(['camp_active' => 1, 'camp_start' => $in['start'] ?? '', 'camp_end' => $in['end'] ?? '', 'camp_value' => $in['value'] ?? '', 'camp_type' => $in['type'] ?? '']);
        if ((int) $c['camp_active'] === 1 && !empty($c['camp_end']) && $c['camp_end'] >= date('Y-m-d') && $ns <= (string) $c['camp_end']) {
            throw new ApiError('Kampanja još traje. Nova se upisuje nakon završetka ili odznačite Aktivni.');
        }
        $t = ms();
        $nm = camp_months_val($in['months'] ?? 12);
        transaction(static function () use ($c, $u, $ns, $ne, $nv, $nt, $t, $nm): void {
            archive_campaign($c, (int) $u['id']);
            run('UPDATE clients SET camp_active = 1, camp_start = ?, camp_end = ?, camp_value = ?, camp_type = ?, camp_months = ?, updated_at = ? WHERE id = ?', [$ns, $ne, $nv, $nt, $nm, $t, $c['id']]);
            mark_client_active($c, (int) $u['id'], $t);
            run('INSERT INTO notes (client_id, author_id, type, body, created_at) VALUES (?, ?, ?, ?, ?)',
                [$c['id'], $u['id'], 'note', 'Nova kampanja: ' . date('d.m.Y.', strtotime($ns)) . ' – ' . date('d.m.Y.', strtotime($ne)) . ', vrijednost ' . number_format((float) $nv, 2, ',', '.') . ' €', $t]);
        });
        audit((int) $c['id'], (int) $u['id'], 'campaign', 'Nova kampanja: ' . date('d.m.Y.', strtotime($ns)) . ' – ' . date('d.m.Y.', strtotime($ne)) . ', ' . number_format((float) $nv, 2, ',', '.') . ' €', (string) $c['name']);
        out(['ok' => true]);
    }

    case 'client_update': {
        $u = need_write();
        $in = body();
        $c = load_client((string) ($in['id'] ?? ''));
        $kind = f_kind($in, (string) ($c['kind'] ?? 'tvrtka'));
        $name = f_str($in, 'name', 190, $kind === 'osoba' ? 'Ime i prezime' : 'Naziv tvrtke', true);
        $contact = $kind === 'osoba' ? $name : f_str($in, 'contact', 190, 'Kontakt osoba', true);
        $oib = f_oib($in);
        $email = f_email($in, 'email');
        $phone = f_str($in, 'phone', 60, 'Telefon');
        $service = f_services($in['service'] ?? '');
        $industry = array_key_exists('industry', $in) ? f_str($in, 'industry', 120, 'Djelatnost') : (string) ($c['industry'] ?? '');
        if (!empty($in['has_contract']) && f_date($in['contract_end'] ?? '') === null) {
            throw new ApiError('Odaberite datum do kada je ugovor aktivan.');
        }
        $value = array_key_exists('value', $in) ? f_value($in['value']) : (float) $c['value'];
        $owner = ($c['owner_id'] === null && (string) ($in['owner_id'] ?? '') === '') ? null : active_user_id($in['owner_id'] ?? null, (int) ($c['owner_id'] ?? $u['id']));
        $fu = array_key_exists('next_follow_up', $in) ? f_date($in['next_follow_up']) : ($c['next_follow_up'] ?: null);
        run('UPDATE clients SET kind = ?, oib = ?, name = ?, contact = ?, email = ?, phone = ?, service = ?, industry = ?, value = ?, owner_id = ?, next_follow_up = ?, updated_at = ? WHERE id = ?',
            [$kind, $oib, $name, $contact, $email, $phone, $service, $industry, $value, $owner, $fu, ms(), $c['id']]);
        if ((int) $owner !== (int) $c['owner_id']) {
            record_owner((int) $c['id'], (int) $owner, ms());
        }
        if (array_key_exists('has_contract', $in)) {
            $hc = !empty($in['has_contract']) ? 1 : 0;
            $ce = $hc ? f_date($in['contract_end'] ?? '') : null;
            if ($hc && $ce === null) {
                throw new ApiError('Odaberite datum do kada je ugovor aktivan.');
            }
            run('UPDATE clients SET has_contract = ?, contract_end = ? WHERE id = ?', [$hc, $ce, $c['id']]);
        }
        $newVals = ['kind' => $kind, 'name' => $name, 'contact' => $contact, 'oib' => $oib, 'email' => $email, 'phone' => $phone, 'service' => $service, 'industry' => $industry, 'value' => $value, 'owner_id' => $owner, 'next_follow_up' => $fu];
        if (array_key_exists('has_contract', $in)) {
            $newVals['has_contract'] = !empty($in['has_contract']) ? 1 : 0;
            $newVals['contract_end'] = !empty($in['has_contract']) ? f_date($in['contract_end'] ?? '') : '';
        }
        if (array_key_exists('camp_active', $in)) {
            [$campA, $campS, $campE, $campV, $campT] = f_campaign($in);
            $newVals += ['camp_active' => $campA, 'camp_start' => $campS, 'camp_end' => $campE, 'camp_value' => $campV];
            if ($campA === 0 && (int) $c['camp_active'] === 1) {
                archive_campaign($c, (int) $u['id']); // kampanja je završena ili prekinuta: ostaje u povijesti
            }
            run('UPDATE clients SET camp_active = ?, camp_start = ?, camp_end = ?, camp_value = ?, camp_type = ?, camp_months = ? WHERE id = ?', [$campA, $campS, $campE, $campV, $campT, camp_months_val($in['camp_months'] ?? 12), $c['id']]);
            if ($campA === 1) {
                mark_client_active($c, (int) $u['id'], ms());
                run("UPDATE clients SET value_kind = 'ugovoreno' WHERE id = ?", [$c['id']]);
            }
        }
        if (array_key_exists('email2', $in)) {
            $e2 = f_email($in, 'email2');
            run('UPDATE clients SET email2 = ? WHERE id = ?', [$e2, $c['id']]);
            link_emails_to_client((int) $c['id'], strtolower($e2));
        }
        if (array_key_exists('address', $in)) {
            run('UPDATE clients SET address = ? WHERE id = ?', [mb_substr(trim((string) $in['address']), 0, 255), $c['id']]);
        }
        link_emails_to_client((int) $c['id'], strtolower($email));
        $diff = client_diff($c, $newVals);
        if ($diff !== '') {
            audit((int) $c['id'], (int) $u['id'], 'update', $diff, $name);
        }
        out(['ok' => true]);
    }

    case 'client_take': {
        $u = need_write();
        $in = body();
        $c = load_client((string) ($in['id'] ?? ''));
        if ((int) $c['owner_id'] === (int) $u['id']) {
            throw new ApiError('Ovaj klijent je već vaš.');
        }
        $t = ms();
        $from = user_name_of((int) $c['owner_id']);
        transaction(static function () use ($c, $u, $t, $from): void {
            run('UPDATE clients SET owner_id = ?, updated_at = ? WHERE id = ?', [$u['id'], $t, $c['id']]);
            record_owner((int) $c['id'], (int) $u['id'], $t);
            run('INSERT INTO notes (client_id, author_id, type, body, created_at) VALUES (?, ?, ?, ?, ?)',
                [$c['id'], $u['id'], 'note', 'Klijenta je preuzeo/la ' . $u['name'] . ' (prethodni prodavač: ' . $from . ').', $t]);
        });
        audit((int) $c['id'], (int) $u['id'], 'update', 'Prodavač: ' . $from . ' → ' . $u['name'] . ' (preuzimanje)', (string) $c['name']);
        out(['ok' => true]);
    }

    case 'client_delete': {
        $u = need_write();
        $c = load_client((string) (body()['id'] ?? ''));
        if ($u['role'] !== 'admin' && (int) $c['owner_id'] !== (int) $u['id']) {
            throw new ApiError('Klijenta može obrisati administrator ili njegov prodavač.', 403);
        }
        delete_document_rows(rows('SELECT id, stored FROM documents WHERE client_id = ?', [$c['id']]));
        transaction(static function () use ($c): void {
            run("UPDATE scheduled_emails SET status = 'cancelled' WHERE client_id = ? AND status = 'pending'", [$c['id']]);
            run('UPDATE emails SET client_id = NULL WHERE client_id = ?', [$c['id']]);
            run('DELETE FROM notes WHERE client_id = ?', [$c['id']]);
            run('DELETE FROM campaigns WHERE client_id = ?', [$c['id']]);
            run('DELETE FROM task_notes WHERE task_id IN (SELECT id FROM tasks WHERE client_id = ?)', [$c['id']]);
            run('DELETE FROM tasks WHERE client_id = ?', [$c['id']]);
            run('DELETE FROM clients WHERE id = ?', [$c['id']]);
        });
        audit((int) $c['id'], (int) $u['id'], 'delete', 'Klijent obrisan (status: ' . (STAGE_LABELS[$c['status']] ?? $c['status']) . ', vrijednost ' . number_format((float) $c['value'], 2, ',', '.') . ' €)', (string) $c['name']);
        out(['ok' => true]);
    }

    case 'note_add': {
        $u = need_write();
        $in = body();
        $c = load_client((string) ($in['client_id'] ?? ''));
        $type = (string) ($in['type'] ?? 'note');
        if (!in_array($type, ['note', 'call', 'meeting'], true)) {
            throw new ApiError('Vrsta bilješke nije ispravna.');
        }
        $text = f_text($in, 'text', 'Bilješka');
        $fu = f_date($in['next_follow_up'] ?? '');
        $fut = $fu ? f_time($in['next_follow_time'] ?? '') : null;
        $t = ms();
        if ($type === 'call') {
            $text = 'Kontakt telefonom: ' . date('d.m.Y. H:i', intdiv($t, 1000)) . "\n" . $text;
        }
        // vrijednost: ponuđeno ili ugovoreno (neobavezno, mijenja se samo ako je poslana)
        $setValue = array_key_exists('value', $in) && trim((string) $in['value']) !== '';
        $value = $setValue ? f_value($in['value']) : (float) $c['value'];
        $vkind = (($in['value_kind'] ?? '') === 'ugovoreno') ? 'ugovoreno' : ((($in['value_kind'] ?? '') === 'ponudeno') ? 'ponudeno' : (string) ($c['value_kind'] ?: 'ponudeno'));
        $valueChanged = $setValue && ((float) $value !== (float) $c['value'] || $vkind !== (string) ($c['value_kind'] ?: 'ponudeno'));
        if ($valueChanged) {
            $text .= "\nVrijednost: " . number_format((float) $value, 2, ',', '.') . ' € (' . ($vkind === 'ugovoreno' ? 'Ugovoreno' : 'Pregovori') . ')';
        }
        $camp = null;
        if (array_key_exists('camp_active', $in)) {
            $camp = f_campaign($in);
            $camp[5] = camp_months_val($in['camp_months'] ?? 12);
        }
        transaction(static function () use ($c, $u, $type, $text, $fu, $fut, $t, $valueChanged, $value, $vkind, $camp): void {
            run('INSERT INTO notes (client_id, author_id, type, body, created_at) VALUES (?, ?, ?, ?, ?)', [$c['id'], $u['id'], $type, $text, $t]);
            if ($fu) {
                run('UPDATE clients SET next_follow_up = ?, next_follow_time = ?, updated_at = ? WHERE id = ?', [$fu, $fut, $t, $c['id']]);
            } else {
                run('UPDATE clients SET updated_at = ? WHERE id = ?', [$t, $c['id']]);
            }
            if ($valueChanged) {
                run('UPDATE clients SET value = ?, value_kind = ? WHERE id = ?', [$value, $vkind, $c['id']]);
            }
            if ($camp !== null) {
                [$campA, $campS, $campE, $campV, $campT] = $camp;
                if ($campA === 0 && (int) $c['camp_active'] === 1) {
                    archive_campaign($c, (int) $u['id']);
                }
                run('UPDATE clients SET camp_active = ?, camp_start = ?, camp_end = ?, camp_value = ?, camp_type = ?, camp_months = ? WHERE id = ?', [$campA, $campS, $campE, $campV, $campT, $camp[5], $c['id']]);
                if ($campA === 1) {
                    mark_client_active($c, (int) $u['id'], $t);
                    run("UPDATE clients SET value_kind = 'ugovoreno' WHERE id = ?", [$c['id']]);
                }
            }
        });
        $new = [];
        if ($fu) {
            $new['next_follow_up'] = $fu . ($fut ? ' ' . $fut : '');
            $c['next_follow_up'] = (string) $c['next_follow_up'] . ($c['next_follow_time'] ? ' ' . $c['next_follow_time'] : '');
        }
        if ($valueChanged) {
            $new['value'] = $value;
        }
        if ($camp !== null) {
            $new += ['camp_active' => $camp[0], 'camp_start' => $camp[1], 'camp_end' => $camp[2], 'camp_value' => $camp[3]];
        }
        $diff = $new ? client_diff($c, $new) : '';
        if ($valueChanged && $vkind !== (string) ($c['value_kind'] ?: 'ponudeno')) {
            $diff = trim($diff . ' Status: ' . ($vkind === 'ugovoreno' ? 'Ugovoreno' : 'Pregovori'));
        }
        if ($diff !== '') {
            audit((int) $c['id'], (int) $u['id'], 'update', $diff, (string) $c['name']);
        }
        out(['ok' => true]);
    }

    case 'status_change': {
        $u = need_write();
        $in = body();
        $c = load_client((string) ($in['client_id'] ?? ''));
        $new = f_status($in['status'] ?? '');
        $text = f_text($in, 'text', 'Razlog promjene');
        if ($new === $c['status']) {
            throw new ApiError('Status je već postavljen.');
        }
        $t = ms();
        $label = ['novi' => 'Novi kontakt', 'kontaktiran' => 'Kontaktiran', 'ponuda' => 'Ponuda poslana', 'pregovori' => 'Pregovori', 'aktivni' => 'Aktivni', 'dobiven' => 'Dobiven', 'izgubljen' => 'Izgubljen'];
        transaction(static function () use ($c, $u, $new, $text, $t, $label): void {
            run('UPDATE clients SET status = ?, won_at = ?, updated_at = ? WHERE id = ?',
                [$new, $new === 'dobiven' ? $t : $c['won_at'], $t, $c['id']]);
            run('INSERT INTO notes (client_id, author_id, type, body, created_at) VALUES (?, ?, ?, ?, ?)',
                [$c['id'], $u['id'], 'status', $label[$c['status']] . ' → ' . $label[$new] . "\n" . $text, $t]);
        });
        audit((int) $c['id'], (int) $u['id'], 'status', 'Status: ' . $label[$c['status']] . ' → ' . $label[$new] . ' (' . $text . ')', (string) $c['name']);
        out(['ok' => true]);
    }

    case 'dup_scan': {
        $u = need_user();
        need_admin($u);
        $groups = dup_groups();
        $cl = [];
        foreach ($groups as $g) {
            foreach ($g['ids'] as $id) {
                $cl[$id] = true;
            }
        }
        $info = [];
        if ($cl) {
            $in = implode(',', array_map('intval', array_keys($cl)));
            foreach (rows('SELECT * FROM clients WHERE id IN (' . $in . ')') as $c) {
                $cnt = row('SELECT (SELECT COUNT(*) FROM notes WHERE client_id = ?) AS n, (SELECT COUNT(*) FROM emails WHERE client_id = ?) AS e, (SELECT COUNT(*) FROM documents WHERE client_id = ?) AS d', [$c['id'], $c['id'], $c['id']]);
                $info[(string) $c['id']] = ['id' => (string) $c['id'], 'name' => (string) $c['name'], 'oib' => (string) $c['oib'], 'email' => (string) $c['email'], 'phone' => (string) $c['phone'],
                    'status' => (string) $c['status'], 'owner' => user_name_of($c['owner_id']), 'notes' => (int) $cnt['n'], 'emails' => (int) $cnt['e'], 'docs' => (int) $cnt['d'], 'created' => (int) $c['created_at']];
            }
        }
        out(['groups' => array_map(static fn ($g) => ['reasons' => $g['reasons'], 'clients' => array_map(static fn ($i) => $info[$i], $g['ids'])], array_slice($groups, 0, 200)), 'total' => count($groups)]);
    }

    case 'client_merge': {
        $u = need_write();
        need_admin($u);
        $in = body();
        $r = clients_merge((int) ($in['keep'] ?? 0), is_array($in['remove'] ?? null) ? $in['remove'] : [], (int) $u['id']);
        out(['ok' => true] + $r);
    }

    case 'dup_ignore': {
        $u = need_write();
        need_admin($u);
        $ids = array_values(array_unique(array_map('intval', (array) (body()['ids'] ?? []))));
        sort($ids);
        $k = implode(',', array_map('strval', $ids));
        $cur = json_decode((string) setting_get('dup_ignored', '[]'), true) ?: [];
        $cur[] = $k;
        setting_set('dup_ignored', json_encode(array_values(array_unique($cur))));
        out(['ok' => true]);
    }

    case 'import_preview': {
        if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
            throw new ApiError('Metoda nije dopuštena.', 405);
        }
        $u = need_user();
        need_admin($u);
        if (!csrf_ok()) {
            throw new ApiError('Sigurnosna provjera nije uspjela. Osvježite stranicu.', 403);
        }
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) {
            throw new ApiError('Datoteka nije učitana (najviše 5 MB).', 400);
        }
        if ($f['size'] > 5 * 1024 * 1024) {
            throw new ApiError('Datoteka je prevelika (najviše 5 MB).', 413);
        }
        $ext = strtolower(pathinfo((string) $f['name'], PATHINFO_EXTENSION));
        if (!in_array($ext, ['xlsx', 'csv', 'txt'], true)) {
            throw new ApiError('Podržani su .xlsx i .csv. Stariji .xls spremite kao .xlsx ili CSV.', 400);
        }
        [$data, $heads, $fields] = import_parse((string) $f['tmp_name'], $ext === 'xlsx' ? 'xlsx' : 'csv');
        $chk = import_check($data);
        $token = bin2hex(random_bytes(16));
        file_put_contents(storage_dir() . '/import-' . $token . '.json', json_encode(['name' => (string) $f['name'], 'rows' => $chk, 'at' => ms(), 'user' => (int) $u['id']], JSON_UNESCAPED_UNICODE), LOCK_EX);
        foreach (glob(storage_dir() . '/import-*.json') ?: [] as $old) {
            if (filemtime($old) < time() - 86400) {
                @unlink($old);
            }
        }
        $ok = $dup = $bad = 0;
        foreach ($chk as $r) {
            if ($r['errors']) {
                $bad++;
            } elseif ($r['dup']) {
                $dup++;
            } else {
                $ok++;
            }
        }
        $pick = static fn (array $r) => ['row' => $r['row'], 'name' => (string) ($r['rec']['name'] ?? ''), 'email' => (string) ($r['rec']['email'] ?? ''), 'errors' => $r['errors'], 'dup' => $r['dup'], 'notes' => $r['notes']];
        out(['token' => $token, 'file' => (string) $f['name'], 'columns' => array_map(null, $fields, $heads), 'total' => count($chk), 'ok' => $ok, 'dup' => $dup, 'bad' => $bad,
            'badRows' => array_map($pick, array_slice(array_values(array_filter($chk, static fn ($r) => $r['errors'])), 0, 100)),
            'dupRows' => array_map($pick, array_slice(array_values(array_filter($chk, static fn ($r) => !$r['errors'] && $r['dup'])), 0, 100)),
            'okRows' => array_map($pick, array_slice(array_values(array_filter($chk, static fn ($r) => !$r['errors'] && !$r['dup'])), 0, 30))]);
    }

    case 'import_commit': {
        $u = need_write();
        need_admin($u);
        $in = body();
        $tok = (string) ($in['token'] ?? '');
        if (!preg_match('/^[0-9a-f]{32}$/', $tok) || !is_file(storage_dir() . '/import-' . $tok . '.json')) {
            throw new ApiError('Pregled uvoza je istekao. Učitajte datoteku ponovno.', 404);
        }
        $j = json_decode((string) file_get_contents(storage_dir() . '/import-' . $tok . '.json'), true);
        $noOwner = ($in['owner_id'] ?? '') === 'none';
        $owner = $noOwner ? null : active_user_id($in['owner_id'] ?? null, (int) $u['id']);
        $mode = (string) ($in['mode'] ?? 'skip');
        $withDup = $mode === 'all';
        $forceStatus = in_array((string) ($in['status'] ?? ''), ['novi', 'kontaktiran', 'ponuda', 'pregovori', 'aktivni', 'dobiven', 'izgubljen'], true) ? (string) $in['status'] : '';
        $statusMap = ['novi' => 'novi', 'novi kontakt' => 'novi', 'kontaktiran' => 'kontaktiran', 'ponuda' => 'ponuda', 'ponuda poslana' => 'ponuda', 'pregovori' => 'pregovori', 'aktivni' => 'aktivni', 'dobiven' => 'dobiven', 'izgubljen' => 'izgubljen'];
        $made = $skipDup = $skipBad = 0;
        $t = ms();
        transaction(static function () use ($j, $owner, $withDup, $mode, $forceStatus, $statusMap, $u, $t, &$made, &$skipDup, &$skipBad): void {
            foreach ($j['rows'] as $r) {
                if ($r['errors']) {
                    $skipBad++;
                    continue;
                }
                if ($r['dup'] && !$withDup && !($mode === 'oib' && $r['dup']['type'] !== 'oib')) {
                    $skipDup++;
                    continue;
                }
                $rec = $r['rec'];
                $kindRaw = mb_strtolower((string) ($rec['kind'] ?? ''));
                $kind = preg_match('/osob|fiz/u', $kindRaw) ? 'osoba' : 'tvrtka';
                $name = mb_substr((string) $rec['name'], 0, 190);
                $contact = $kind === 'osoba' ? $name : mb_substr((string) ($rec['contact'] ?? ''), 0, 190);
                $status = $forceStatus !== '' ? $forceStatus : ($statusMap[mb_strtolower((string) ($rec['status'] ?? ''))] ?? 'novi');
                $val = (string) ($rec['value'] ?? '');
                $val = num_hr($val);
                $svc = f_services((string) ($rec['service'] ?? ''));
                $ind = mb_substr(trim((string) ($rec['industry'] ?? '')), 0, 120);
                $note = 'Uvezeno iz datoteke ' . mb_substr((string) $j['name'], 0, 80) . '.' . (!empty($rec['note']) ? "\n" . mb_substr((string) $rec['note'], 0, 1500) : '');
                run('INSERT INTO clients (kind, oib, name, contact, email, phone, address, service, industry, value, status, owner_id, next_follow_up, won_at, created_by, created_at, updated_at, camp_active, camp_start, camp_end, camp_value)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 0, NULL, NULL, 0)',
                    [$kind, (string) ($rec['oib_fixed'] ?? ''), $name, $contact, strtolower((string) ($rec['email'] ?? '')), mb_substr((string) ($rec['phone'] ?? ''), 0, 60), mb_substr((string) ($rec['address'] ?? ''), 0, 255), $svc, $ind, $val, $status, $owner, $status === 'dobiven' ? $t : null, $u['id'], $t, $t]);
                $cid = insert_id();
                record_owner($cid, (int) $owner, $t);
                run('INSERT INTO notes (client_id, author_id, type, body, created_at) VALUES (?, ?, ?, ?, ?)', [$cid, $u['id'], 'note', $note, $t]);
                $made++;
            }
        });
        @unlink(storage_dir() . '/import-' . $tok . '.json');
        audit(null, (int) $u['id'], 'import', 'Uvoz iz datoteke ' . $j['name'] . ': uvezeno ' . $made . ', preskočeno duplikata ' . $skipDup . ', s greškom ' . $skipBad);
        out(['ok' => true, 'created' => $made, 'skippedDup' => $skipDup, 'skippedBad' => $skipBad]);
    }

}
