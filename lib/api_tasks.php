<?php
declare(strict_types=1);

/* API akcije: Zadaci. Uključuje se iz api.php u istom opsegu (koristi $action, $u, body()...). */

switch ($action) {
    case 'task_create': {
        $u = need_write();
        $in = body();
        $title = f_str($in, 'title', 300, 'Zadatak', true);
        $descr = f_str($in, 'descr', 4000, 'Opis zadatka');
        $due = f_date($in['due'] ?? '');
        if ($due === null) {
            throw new ApiError('Odaberite rok zadatka.');
        }
        $cid = null;
        $cname = '';
        if (!empty($in['client_id'])) {
            $c = load_client((string) $in['client_id']);
            $cid = (int) $c['id'];
            $cname = (string) $c['name'];
        }
        $assignee = active_user_id($in['assignee_id'] ?? null, (int) $u['id']);
        $rep = in_array((string) ($in['repeat'] ?? ''), ['dnevno', 'tjedno', 'mjesecno'], true) ? (string) $in['repeat'] : '';
        run('INSERT INTO tasks (client_id, title, descr, due_date, assignee_id, created_by, created_at, repeat_every) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [$cid, $title, $descr, $due, $assignee, $u['id'], ms(), $rep]);
        $tid = insert_id();
        audit($cid, (int) $u['id'], 'task', 'Zadatak: ' . $title . ' (rok ' . date('d.m.Y.', strtotime($due)) . ', ' . user_name_of($assignee) . ')', $cname);
        if ($assignee !== (int) $u['id']) {
            $body = $u['name'] . ' vam je zadao zadatak: ' . $title . "\nRok: " . date('d.m.Y.', strtotime($due)) . ($cname !== '' ? "\nKlijent: " . $cname : '') . ($descr !== '' ? "\n\n" . $descr : '');
            alert_create($assignee, $cid, 'task', 'Novi zadatak: ' . $title, $body, null, 'tk:' . $tid);
            alert_mail($assignee, 'Novi zadatak: ' . $title, $body);
        }
        out(['ok' => true, 'id' => (string) $tid]);
    }

    case 'task_assign': {
        $u = need_write();
        $in = body();
        $t = row('SELECT * FROM tasks WHERE id = ?', [(int) ($in['id'] ?? 0)]);
        if (!$t || !task_visible($u, $t)) {
            throw new ApiError('Zadatak ne postoji.', 404);
        }
        if ($u['role'] !== 'admin' && (int) $t['created_by'] !== (int) $u['id'] && (int) $t['assignee_id'] !== (int) $u['id']) {
            throw new ApiError('Zadatak može dodijeliti administrator, autor ili trenutni izvršitelj.', 403);
        }
        if ($t['done_at'] !== null) {
            throw new ApiError('Završeni zadatak nije moguće dodijeliti.');
        }
        $to = active_user_id($in['assignee_id'] ?? null, 0);
        if ($to <= 0) {
            throw new ApiError('Odaberite korisnika.');
        }
        if ($to === (int) $t['assignee_id']) {
            throw new ApiError('Zadatak je već dodijeljen tom korisniku.');
        }
        run('UPDATE tasks SET assignee_id = ?, taken_at = NULL, taken_by = NULL WHERE id = ?', [$to, $t['id']]);
        $cid = $t['client_id'] !== null ? (int) $t['client_id'] : null;
        audit($cid, (int) $u['id'], 'task', 'Zadatak dodijeljen: ' . $t['title'] . ' → ' . user_name_of($to));
        $body = $u['name'] . ' vam je dodijelio/la zadatak: ' . $t['title'] . "\nRok: " . date('d.m.Y.', strtotime((string) $t['due_date']));
        alert_create($to, $cid, 'task', 'Dodijeljen zadatak: ' . $t['title'], $body, null, 'ta:' . $t['id'] . ':' . $to . ':' . ms());
        alert_mail($to, 'Dodijeljen zadatak: ' . $t['title'], $body);
        out(['ok' => true]);
    }

    case 'task_take':
    case 'task_note':
    case 'task_done':
    case 'task_delete': {
        $u = need_write();
        $in = body();
        $t = row('SELECT * FROM tasks WHERE id = ?', [(int) ($in['id'] ?? 0)]);
        if (!$t || !task_visible($u, $t)) {
            throw new ApiError('Zadatak ne postoji.', 404);
        }
        $cid = $t['client_id'] !== null ? (int) $t['client_id'] : null;
        $now = ms();
        if ($action === 'task_delete') {
            if ($u['role'] !== 'admin' && (int) $t['created_by'] !== (int) $u['id']) {
                throw new ApiError('Zadatak može obrisati administrator ili autor zadatka.', 403);
            }
            run('DELETE FROM task_notes WHERE task_id = ?', [$t['id']]);
            run('DELETE FROM tasks WHERE id = ?', [$t['id']]);
            audit($cid, (int) $u['id'], 'task', 'Zadatak obrisan: ' . $t['title']);
        } elseif ($action === 'task_take') {
            if ($t['done_at'] !== null) {
                throw new ApiError('Zadatak je već završen.');
            }
            if (!empty($t['taken_at'])) {
                throw new ApiError('Zadatak je već preuzet.');
            }
            run('UPDATE tasks SET taken_at = ?, taken_by = ? WHERE id = ?', [$now, $u['id'], $t['id']]);
            audit($cid, (int) $u['id'], 'task', 'Zadatak preuzet: ' . $t['title']);
            if ((int) $t['created_by'] !== (int) $u['id']) {
                alert_create((int) $t['created_by'], $cid, 'task', 'Zadatak preuzet: ' . $t['title'], $u['name'] . ' je preuzeo/la zadatak.', null, 'tt:' . $t['id']);
            }
        } elseif ($action === 'task_note') {
            $txt = f_text($in, 'body', 'Bilješka');
            run('INSERT INTO task_notes (task_id, user_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)', [$t['id'], $u['id'], 'note', $txt, $now]);
            audit($cid, (int) $u['id'], 'task', 'Bilješka uz zadatak: ' . $t['title']);
        } else {
            $done = !empty($in['done']);
            $txt = trim((string) ($in['body'] ?? ''));
            if ($done) {
                if ($t['done_at'] !== null) {
                    throw new ApiError('Zadatak je već završen.');
                }
                if ($txt !== '') {
                    $txt = f_text($in, 'body', 'Bilješka');
                    run('INSERT INTO task_notes (task_id, user_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)', [$t['id'], $u['id'], 'close', $txt, $now]);
                }
                run('UPDATE tasks SET done_at = ?, done_by = ? WHERE id = ?', [$now, $u['id'], $t['id']]);
                audit($cid, (int) $u['id'], 'task', 'Zadatak završen: ' . $t['title']);
                if (!empty($t['repeat_every'])) { // ponavljajući zadatak: odmah nastaje sljedeći
                    $nd = task_next_due((string) ($t['due_date'] ?? ''), (string) $t['repeat_every']);
                    run('INSERT INTO tasks (client_id, title, descr, due_date, assignee_id, created_by, created_at, repeat_every) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                        [$t['client_id'], $t['title'], $t['descr'] ?? '', $nd, $t['assignee_id'], $t['created_by'], $now, $t['repeat_every']]);
                    audit($cid, (int) $u['id'], 'task', 'Ponavljajući zadatak: sljedeći rok ' . date('d.m.Y.', strtotime($nd)) . ' (' . $t['title'] . ')');
                }
                if ((int) $t['created_by'] !== (int) $u['id']) {
                    alert_create((int) $t['created_by'], $cid, 'task', 'Zadatak završen: ' . $t['title'], $u['name'] . ' je završio/la zadatak.' . ($txt !== '' ? "\n" . $txt : ''), null, 'td:' . $t['id']);
                }
            } else {
                run('UPDATE tasks SET done_at = NULL, done_by = NULL WHERE id = ?', [$t['id']]);
                audit($cid, (int) $u['id'], 'task', 'Zadatak ponovno otvoren: ' . $t['title']);
            }
        }
        out(['ok' => true]);
    }

}
