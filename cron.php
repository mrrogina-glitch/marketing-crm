<?php
declare(strict_types=1);

// Pokreće se iz cPanel Cron Jobs svakih 5 minuta (samo iz naredbenog retka).
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/lib/core.php';
require __DIR__ . '/lib/mail.php';
require __DIR__ . '/lib/imap.php';
require __DIR__ . '/lib/features.php';
require __DIR__ . '/lib/backup.php';

app_boot();

try {
    $jobs = run_background_jobs(true);
    echo date('c') . ' zakazano poslano: ' . ($jobs['scheduled'] ?? 0) . ', podsjetnici: ' . ($jobs['reminders'] ?? 0) . (!empty($jobs['report']) ? ', tjedni izvještaj poslan' : '') . "\n";
    if (imap_cfg() === null) {
        fwrite(STDERR, "IMAP nije podešen.\n");
        exit(0);
    }
    $r = sync_inbox();
    echo date('c') . ' nove poruke: ' . $r['new'] . ($r['skipped'] ? ' (preskočeno, sinkronizacija već traje)' : '') . "\n";
    if (imap_cfg(2) !== null) {
        try {
            $r2 = sync_inbox(2);
            echo date('c') . ' Inbox 2, nove poruke: ' . $r2['new'] . ($r2['skipped'] ? ' (preskočeno)' : '') . "\n";
        } catch (Throwable $e) {
            fwrite(STDERR, date('c') . ' Inbox 2 greška: ' . $e->getMessage() . "\n");
        }
    }
} catch (Throwable $e) {
    fwrite(STDERR, date('c') . ' greška: ' . $e->getMessage() . "\n");
    exit(1);
}
