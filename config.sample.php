<?php
// Kopirajte ovu datoteku u config.php na serveru i upišite stvarne podatke.
// config.php se NE sprema u Git (vidi .gitignore) i ne smije biti javno dostupan.

return [
    'db' => [
        'host' => 'localhost',
        'name' => 'CPANELKORISNIK_crm',      // cPanel > MySQL Database Wizard
        'user' => 'CPANELKORISNIK_crm',
        'pass' => '',
        'charset' => 'utf8mb4',
    ],

    // Jednokratni ključ za install.php (dugi nasumični niz znakova).
    'install_key' => 'PROMIJENITE-OVO-U-DUGI-NASUMICNI-NIZ',

    'app' => [
        'timezone' => 'Europe/Zagreb',
        'url' => 'https://marketing.vip-grupa.eu',   // veza u podsjetnicima koji se šalju e-mailom
        // 'storage' => '/home/KORISNIK/crm-dokumenti', // neobavezno: mapa za dokumente IZVAN javne mape (preporučeno)
    ],

    // Radno vrijeme za automatski odgovor (dani: 1 = ponedjeljak ... 7 = nedjelja)
    'work' => [
        'days' => [1, 2, 3, 4, 5],
        'start' => '08:00',
        'end' => '16:00',
    ],

    // Slanje: zajednički sandučić marketing@vip-grupa.eu
    'mail' => [
        'driver' => 'smtp',                  // 'smtp' ili 'mail' (PHP mail())
        'host' => 'mail.vip-grupa.eu',
        'port' => 465,
        'secure' => 'ssl',                   // 'ssl' (465), 'tls' (587) ili 'none'
        'user' => 'marketing@vip-grupa.eu',
        'pass' => '',                        // lozinka sandučića
        'from_email' => 'marketing@vip-grupa.eu',
        'from_name' => 'VIP grupa',          // u pismu: "Ime prodavača | VIP grupa"
        'verify_peer' => true,               // false samo ako host ima neodgovarajući certifikat
    ],

    // Primanje: isti sandučić preko IMAP-a. Korisnik i lozinka se preuzimaju iz 'mail' ako ih ne upišete.
    'imap' => [
        'host' => 'mail.vip-grupa.eu',
        'port' => 993,
        'secure' => 'ssl',
        'folder' => 'INBOX',
        'sent_folder' => 'INBOX.Sent',       // kopija poslanih u webmail; '' za isključeno
        'initial_limit' => 150,              // koliko zadnjih poruka povući pri prvom spajanju
        'verify_peer' => true,
    ],
];
