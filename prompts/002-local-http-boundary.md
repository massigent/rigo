# Incarico 002 — Protezione Host/Origin del server HTTP locale

L'incarico 001 (incluse 001b e 001c) è approvato nel perimetro verificato. Parti dal working tree attuale, senza reset, conservando controller e test. Leggi `AUDIT-IMPLEMENTATION.md` e il backend reale.

## Obiettivo e difetto riprodotto

Il server ascolta su 127.0.0.1 con porta dinamica. authMiddleware controlla Origin per alcune API ma non Host; /api/init è pubblico e restituisce il token. Un probe del revisore contro lo stack attuale (`securityHeaders(setupMux())`) ha ottenuto 200 e token da GET /api/init con Host `attacker.example` e senza Origin.

Non è stato eseguito un exploit DNS-rebinding completo in browser, ma il confine HTTP incompleto è riprodotto. Un Origin assente non prova che una richiesta provenga dalla UI: alcune richieste GET normalmente non lo inviano.

Implementa una validazione del confine HTTP locale che protegga anche l'handshake e gli asset pubblici. Non migrare in questo incarico a cookie/nonce e non cambiare il protocollo mtime.

## Requisiti

1. **Controllo globale Host**, su tutti i percorsi, PRIMA di esporre contenuti o modificare stato: `/`, `/static/*`, `/api/init`, API tokenizzate, `/api/events`, `/api/internal/open`, fallback FileServer e percorsi sconosciuti. Un token valido non autorizza un Host estraneo.
2. Valida l'authority effettiva (`r.Host`), non solo r.URL.Host. Usa parsing strutturato, non prefissi/stringhe parziali. Ammetti soltanto authority loopback esplicitamente previste per l'istanza e la **porta effettiva del listener**. La configurazione deve essere immutabile durante il servizio. Mantieni funzionante l'URL del launcher `http://127.0.0.1:<porta>`; se supporti localhost/IPv6, documenta e testa la policy. Niente risoluzione DNS per stabilire se un hostname arbitrario punta a loopback.
3. Rifiuta hostname civetta, indirizzi non loopback, porta sbagliata, authority malformate, userinfo e forme ambigue. Header `Forwarded`, `X-Forwarded-Host`, `X-Forwarded-Proto` non devono ampliare la fiducia: l'app non è dietro un reverse proxy.
4. **Origin, quando presente**, deve essere un'origine valida coerente con l'origine HTTP consentita della richiesta: stesso schema/host/porta normalizzati secondo una policy esplicita. La vecchia regola «qualsiasi loopback, qualsiasi porta» non basta. Rifiuta origini esterne, `null`, schema diverso, porta diversa, userinfo, path/query/frammenti e valori multipli. Non aggiungere CORS permissivo né riflettere l'Origin.
5. L'assenza di Origin resta consentita per UI/asset/richieste locali legittime SOLO dopo Host valido; le API protette richiedono comunque il loro token e il canale interno il control secret. L'handshake pubblico resta utilizzabile dalla UI, ma non con Host estraneo. Non confondere il controllo Origin con autenticazione completa contro processi locali.
6. Mantieni CSP, Referrer-Policy, X-Frame-Options e nosniff anche sui rifiuti. Risposte rifiutate senza contenuto del documento, token/secret o mutazioni di activePath/activeDir/recents. Un 403 è appropriato; documenta eventuale status diverso per input malformato.
7. Mantieni porta automatica `-port 0`, porta esplicita, `--no-browser`, launcher single-instance, eventi SSE e immagini locali. Non rompere le aperture legittime: nessuna whitelist hardcoded della porta di sviluppo.
8. Introduci un unico punto di composizione dello stack HTTP (o equivalente) usato sia da main sia dai test: i nuovi test non devono dimostrare soltanto il funzionamento di un helper mai collegato al server reale. Non duplicare due policy Host/Origin divergenti tra wrapper e authMiddleware.

## Test obbligatori

Unit test tabellari per parsing/policy e integration test dello stack reale con listener loopback e porta assegnata dal sistema.

Copri almeno:
- Host valido + GET init senza Origin -> handshake funzionante; Host valido + Origin same-origin -> funzionante.
- Host estraneo/civetta senza Origin -> rifiuto, anche con token valido; GET init non deve restituire token.
- Porta Host diversa da listener, malformed authority, header forwarded ingannevoli.
- Origin altro hostname/porta/schema, `null`, userinfo/path/query/frammenti -> rifiuto; documenta normalizzazione maiuscole e porte di default.
- Parametrizza percorsi pubblici, API protetta, SSE e canale interno per provare che il guard sia globale. Evita test SSE bloccanti: usa cancellazione/timeout e verifica l'apertura legittima dello stream.
- Token UI e control secret mancanti/errati restano rifiutati con Host valido; controlla assenza di mutazioni nelle richieste negate.
- Security header presenti anche sul rifiuto del nuovo guard.
- Test con porta dinamica reale, non soltanto costante finta o global mutabili. Nessun accesso a HOME/recenti reali né apertura del browser nei test.

Adatta le fixture dei test esistenti dove necessario, ma non indebolire le asserzioni di sicurezza o sostituire gli endpoint reali con repliche. Conserva la suite frontend: 46 test devono restare verdi.

## Confini

Solo hardening Host/Origin e collegamento allo stack. Niente cookie HttpOnly, nonce, autenticazione radicalmente nuova, TLS, workspace root, protocollo conflitti, read-only, semantica rename, nuove funzionalità o packaging. Non toccare le REVIEW storiche. Documentazione utente EN/IT: aggiorna soltanto le affermazioni pertinenti, senza promettere sicurezza assoluta o isolamento da processi dello stesso utente.

## Consegna

- `go test -race -count=1 ./...`, `go vet ./...` e suite frontend dal comando unico documentato.
- `git diff --check` e verifica esclusione asset dev dopo npm ci.
- Riporta policy scelta, ordine dei middleware, file modificati, comandi/esiti reali e limiti (un test Host simulato non equivale a exploit browser DNS-rebinding completo).
- Nessun commit/push, aggiornamento versione, binario o release. Lascia le modifiche disponibili per la revisione indipendente.
