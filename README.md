# Prodajni stol (CRM za marketinšku agenciju)

Samostalna PHP + MySQL aplikacija: klijenti, obavezne bilješke, praćenje rada prodavača,
zajednički sandučić `marketing@vip-grupa.eu` (slanje, primanje, odgovaranje, kopija u Poslano).
Bez vanjskih biblioteka i bez vanjskih poziva (fontovi su sustavski).

Zahtjevi: PHP 8.0 ili novije (pdo_mysql, mbstring, iconv, openssl), MySQL/MariaDB, HTTPS.

## Postavljanje na cPanel (jednokratno)

1. **Poddomena.** cPanel > Domains > Create A New Domain: `marketing.vip-grupa.eu`.
   Document root: `/home/KORISNIK/marketing.vip-grupa.eu`. Zatim SSL/TLS Status > Run AutoSSL.
2. **Baza.** MySQL Database Wizard: napravite bazu i korisnika (sve ovlasti). Zapišite podatke.
3. **Sandučić.** Email Accounts > Create: `marketing@vip-grupa.eu`, jaka lozinka.
   Na istom ekranu „Connect Devices" prikazuje točne nazive SMTP i IMAP poslužitelja i portove.
4. **Isporučivost pošte.** Email Deliverability > Manage za vip-grupa.eu > Repair (SPF i DKIM).
   Dodajte i DMARC (DNS Zone Editor, TXT zapis `_dmarc`):
   `v=DMARC1; p=none; rua=mailto:marketing@vip-grupa.eu`.
   Ako je DNS kod drugog pružatelja, iste zapise upišite tamo.
5. **Kod.** Git Version Control > Create: klonirajte repozitorij u `/home/KORISNIK/marketing.vip-grupa.eu`
   (javni repozitorij: HTTPS adresa; privatni: SSH adresa i javni ključ koji cPanel prikaže dodajte
   u GitHub kao Deploy key). Ako cPanel ne dopusti kloniranje u postojeću mapu, kao document root
   poddomene postavite mapu repozitorija.
6. **Konfiguracija.** File Manager: kopirajte `config.sample.php` u `config.php` i upišite podatke baze,
   lozinku sandučića i `install_key`. `config.php` nije u Gitu i ne smije se dijeliti.
7. **Prvi korisnik.** Otvorite `https://marketing.vip-grupa.eu/install.php?key=VAŠ_INSTALL_KEY`
   i napravite administratora. Nakon toga se install.php sam zaključa.
8. **Cron** (Cron Jobs), putanju do PHP-a provjerite u cPanelu (npr. `/opt/cpanel/ea-php83/root/usr/bin/php`):
   - svake 5 minuta, pošta, zakazano slanje, podsjetnici i tjedni izvještaj: `*/5 * * * * /opt/cpanel/ea-php83/root/usr/bin/php /home/KORISNIK/marketing.vip-grupa.eu/cron.php`
   - svake minute, automatsko ažuriranje koda: `* * * * * cd /home/KORISNIK/marketing.vip-grupa.eu && git pull --ff-only -q`
9. U aplikaciji: Postavke > Pošta > „Pošalji probni e-mail meni" i „Osvježi poštu sada".

## Ažuriranja

Svaka izmjena koda koja se gurne u `main` na GitHubu stiže na server u roku od minute (cron `git pull`).
Izmjene baze idu kao numerirani koraci u `lib/core.php` (funkcija `migrate`) i primijene se same
pri prvom zahtjevu nakon ažuriranja. `config.php` se nikad ne dira.

## Kako radi pošta

- Slanje: SMTP preko sandučića; u pismu piše „Ime prodavača | VIP grupa", a odgovori stižu u isti sandučić.
- Primanje: IMAP, mapa INBOX. Poruke se pojavljuju u kartici Inbox i uz klijenta (prema e-mail adresi pošiljatelja).
  Osvježavanje: cron svakih 5 minuta, gumb „Osvježi poštu" i automatski dok je Inbox otvoren.
- Odgovor: u čitaču poruke; zadržava nit (In-Reply-To i References) i dodaje citat.
- Poslane poruke spremaju se i u mapu Poslano sandučića (`imap.sent_folder`), pa su vidljive i u webmailu.
- Privici se u CRM-u samo navode; otvaraju se u webmailu.

## Pošta u CRM-u: funkcije

- **Predlošci i potpis.** Šest gotovih predložaka (prvi kontakt, ponuda, dva follow-upa, dvije zahvale). Administrator ih uređuje u Postavke > Predlošci. Svaki prodavač ima svoj potpis (Postavke > Moj potpis); ako ga ne upiše, dodaje se ime, tvrtka i adresa sandučića.
- **Podsjetnik bez odgovora.** Pri slanju e-maila bira se "Podsjeti me ako klijent ne odgovori" (zadano 3 dana). Ako klijent do tada ne odgovori, pojavi se u Pregled > Čekaju odgovor (pošalji podsjetnik, odgodi 2 dana, odbaci) i prodavač dobije e-mail (jednom).
- **Zakazano slanje.** U prozoru za e-mail odaberite "Zakaži slanje". Šalje ga cron (svakih 5 minuta, pa kasni najviše toliko) ili prvo osvježavanje pošte u aplikaciji. Popis i otkazivanje: Inbox > Zakazano slanje. Neuspjelo slanje pokušava se do 3 puta, a zatim se označi kao "nije poslano".
- **Pretvaranje maila u klijenta.** U čitaču poruke "Napravi klijenta iz poruke" otvara obrazac s podacima iz poruke. Prodavač mora odabrati vrstu (tvrtka ili fizička osoba), provjeriti podatke i upisati prvu bilješku. Tek tada se klijent sprema, a poruka i njezini privici povezuju se s njim.
- **Tvrtke i fizičke osobe.** Obje vrste imaju OIB (neobavezan, provjerava se kontrolna znamenka). Fizička osoba nema "kontakt osobu".
- **Priloženi dokumenti.** Uz klijenta se čuvaju datoteke do 10 MB (ponude, ugovori). Mogu se priložiti e-mailu (do 15 MB ukupno). Privici dolaznih poruka spremaju se automatski i uz klijenta. Datoteke se spremaju u mapu `storage/` (zaštićena .htaccess-om). Preporuka: u `config.php` postavite `app.storage` na mapu izvan javne mape.
- **Automatski odgovor izvan radnog vremena.** Radno vrijeme: ponedjeljak–petak 08:00–16:00 (mijenja se u `config.php`, odjeljak `work`). Odgovor se šalje najviše jednom dnevno po pošiljatelju i samo na svježe poruke. Ne odgovara se na automatsku poštu, newslettere, no-reply adrese i mailing liste. Tekst i uključivanje: Postavke > Automatski odgovor. Državni praznici nisu uključeni (tada se odgovara kao u radni dan).
- **Tjedni izvještaj voditelju.** Svaki ponedjeljak od 08:00 administratori dobivaju e-mail za prošli tjedan (po prodavaču: novi klijenti, aktivnosti, e-mailovi, dobiveni poslovi, klijenti kojima treba pažnja). Pregled i probno slanje: Postavke.
