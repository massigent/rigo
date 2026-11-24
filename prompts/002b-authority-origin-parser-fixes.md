# Incarico 002b — Correzioni mirate del parser Host/Origin

La revisione ha confermato il funzionamento generale dell'incarico 002: 30 test Go verdi (anche tre esecuzioni con shuffle e race detector), 46 frontend verdi, vet pulito. Il guard è collegato al server reale e l'ordine dei middleware è corretto. Conserva queste modifiche.

Restano tre violazioni della policy esplicita, riprodotte tramite listener loopback reale e GET /api/init. È stato aggiunto il test indipendente `http_boundary_review_test.go`, funzione `TestReviewBoundaryRejectsUnlistedAuthoritiesAndMalformedOrigins`, con tre sottocasi: tutti falliscono e restituiscono 200 con token.

## 1. Host IPv4-mapped IPv6 non previsto

Richiesta:

```
Host: [::ffff:127.0.0.1]:<porta listener>
```

Policy dichiarata: solo `127.0.0.1` e `localhost`, nessun literal IPv6.

Risultato attuale: parseAuthority applica net.ParseIP(inner).String(), che trasforma l'indirizzo mapped in `127.0.0.1`; hostNameAllowed lo ammette. La normalizzazione cancella l'informazione sul tipo di authority prima dell'allow-list.

Correzione: non far diventare una forma esclusa dalla policy una authority ammessa attraverso la canonicalizzazione. Puoi rifiutare esplicitamente tutte le forme IPv6/bracketed per questo listener, oppure conservare il tipo/formato del literal e applicare correttamente la policy. Non ampliare la policy per far passare il test: IPv6 non è previsto in questo incarico.

## 2. Origin distinto erroneamente considerato same-origin

Richiesta:

```
Host: 127.0.0.1:<porta>
Origin: http://[::ffff:7f00:1]:<porta>
```

Risultato attuale: accettato per lo stesso collasso IPv6-mapped -> IPv4. Sono hostname/origini serializzate diverse per il browser: una equivalenza di indirizzi IP non basta a dichiararle same-origin. Rifiuta questa origine mantenendo valide le normalizzazioni consentite di case e porta default.

Questi due casi non dimostrano da soli un exploit browser completo o una lettura da un hostname esterno; dimostrano che il confine applicato non coincide con quello dichiarato. Non descriverli come sfruttamento remoto provato.

## 3. Origin con frammento vuoto

```
Origin: http://127.0.0.1:<porta>#
```

Risultato attuale: accettato. url.Parse perde l'indicazione del separatore `#` quando il frammento è vuoto, quindi il controllo u.Fragment/u.RawFragment non basta.

Rifiuta anche questa forma: un Origin non include delimitatori di frammento, neanche vuoti. Non rimuovere il requisito «nessun path/query/frammento» dal capitolato. Mantieni i controlli esistenti su `?` vuoto (ForceQuery), userinfo, spazi e valori multipli.

## Consegna

- Correzione minima nel parser/policy, nessuna riscrittura dell'architettura HTTP.
- Il test indipendente deve passare senza ridurre/rimuovere asserzioni. Aggiungi le varianti nelle tabelle unit esistenti, incluse forme mapped con notazione decimale/esadecimale, e verifica che non si ammettano con porte default o Origin in maiuscolo.
- Conserva hostname consentiti, localhost case-insensitive, listener dinamico, porta HTTP default, SSE, token/secret e header di sicurezza sui rifiuti del guard.
- `go test -race -count=1 ./...`, `go vet ./...`, 46 frontend verdi; diff check e controllo asset dev dopo npm ci.
- Nessuna modifica a controller approvato, protocollo mtime, autenticazione token, versioni/binari/release. Nessun commit/push.
- Riporta risultati effettivi e limiti. Attendi la nuova revisione prima del prossimo incarico.
