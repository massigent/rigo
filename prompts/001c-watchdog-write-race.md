# Incarico 001c — Ultima race riprodotta tra watchdog e scritture

Le correzioni richieste in 001b sono state verificate: i cinque test indipendenti precedenti passano, la suite consegnata passa 42/42, Go passa 21 test con race detector, vet è pulito e gli EmbedFiles sono 15 senza asset dev. NON annullare queste correzioni.

L'incarico 001 resta aperto per una race aggiuntiva riprodotta in due varianti. Non è un nuovo requisito funzionale: riguarda il watchdog e il falso stato «Salvato» già nel perimetro originale.

## Riproduzione

1. Documento A pulito, buffer `alpha`, baseline mtime 1000.
2. Il file esterno è cambiato: `external snapshot`, mtime 8888.
3. Parte il watchdog. Trattieni la risposta stat, oppure lascia completare lo stat e trattieni la rilettura file: la risposta descrive lo snapshot precedente al prossimo salvataggio.
4. Ctrl+S senza digitare: il buffer revision non cambia. Il backend risponde 409, l'utente conferma e il retry con mod_time 0 salva `alpha` su disco (mtime 9000). Trattieni la risposta di successo di quel retry.
5. Con il retry in volo, consegna al watchdog lo snapshot vecchio (`external snapshot`, 8888).
6. Completa la risposta del salvataggio forzato (9000).

Risultato attuale, riprodotto:
- disco: `alpha`;
- editor: `external snapshot`;
- status: «Salvato»;
- beforeunload NON protegge;
- baseline client: nuovo mtime, quindi il watchdog può non rilevare più la divergenza.

Causa: writePendingForCurrentSession viene verificato solo all'inizio del watchdog. Una scrittura può iniziare mentre stat o file sono già in volo; unchangedSince non la rileva se revisioni, testo e mtime non sono ancora cambiati. La rilettura incrementa bufferRevision/savedRevision; la risposta del salvataggio vecchio conferma una revisione più bassa e confirmPersisted può comunque dichiarare pulito il buffer riletto.

## Test indipendenti già nel repository

`tests/frontend/review-watchdog-write.test.cjs`: due varianti (`stat` e `file`), entrambe falliscono. Il fetch double simula anche la persistenza effettiva nel filesystem finto PRIMA della risposta HTTP, non si limita a confrontare stringhe di stato.

Eseguibili con:

```sh
node --test tests/frontend/review-watchdog-write.test.cjs
```

Non rimuovere/indebolire le asserzioni né modificare il finto backend per nascondere la race.

## Correzione richiesta

- Non applicare una risposta watchdog se durante la sua attesa è iniziata/è stata accodata una scrittura pertinente. Il vincolo deve valere dopo stat e dopo file, non solo prima della prima richiesta.
- Usa una generazione/epoch delle scritture o una garanzia equivalente, oltre a sessione e revisioni del testo. Valuta anche il caso in cui la scrittura si completi durante la lettura: non affidarti esclusivamente a un flag temporaneo.
- Una risposta save non può attribuire la nuova baseline mtime e «Salvato» a un testo diverso da quello confermato. Rivedi confirmPersisted rispetto a revisioni rese pulite da una rilettura, senza rompere digitazione durante save e coalescing.
- Conserva la rilettura automatica delle modifiche esterne quando non contestata; niente disabilitazione globale del watchdog per far passare i test.
- Aggiungi almeno una verifica equivalente per rename durante una lettura watchdog, mantenendo i casi su digitazione, cambio documento e salvataggio completato prima della lettura.
- Non cambiare il protocollo Go, l'autenticazione, la semantica rename o il packaging. Soluzione minima nel controller e test pertinenti, non riscrittura generale.

## Consegna

Tutti i 42 test precedenti + i 2 test indipendenti nuovi + eventuali test aggiuntivi verdi; Go race e vet, sintassi su ogni JS/CJS e diff check puliti. Riesegui il controllo esclusione asset dev dopo npm ci. Riporta risultati effettivi e limiti (jsdom non equivale a browser nativo).

Nessun commit/push, incremento versione, binario o release. Attendi la revisione prima di procedere al prossimo incarico.
