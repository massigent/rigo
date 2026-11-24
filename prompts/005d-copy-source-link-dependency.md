# Incarico 005d — Preservare i link necessari per aprire il sorgente

Il 005c risolve i tre casi precedenti, ma la copia può ancora rendere inaccessibile l'originale. Correzione solo nel preflight del backend copia, senza toccare frontend, rename/save, confinamento degli asset o policy generale dei symlink.

## Caso riprodotto

`TestReviewCopyCannotReplaceDirectoryLinkNeededBySource` in `save_as_copy_review_test.go`, listener reale:

- `source.md -> entry.md/original.md`, `entry.md -> real/`, `real/original.md` esistente e leggibile tramite `source.md`;
- copia del buffer da `source.md` su `entry.md` con `overwrite:true`;
- i referenti finali sono diversi (`real/original.md` e `real/`), quindi il preflight non vede l'alias. `atomicWrite` sostituisce la **directory entry** `entry.md` con un file regolare. HTTP 200 e avanzamento dello stato; `source.md` non si apre più (`ENOTDIR`), anche se i byte del suo referente rimangono intatti.

Richiesto: `409 copy_same_source` **prima** di ogni effetto, anche con overwrite, quando la entry che la copia sostituirebbe è un link attraversato per raggiungere il sorgente. Conserva link, accesso e contenuto del sorgente, activePath/activeDir/recents. Il consenso alla destinazione diversa non autorizza a rompere l'accesso all'originale.

Confronta l'identità della **entry destinazione** (risolvi i genitori ma non seguire il link finale per questo confronto) con le entry symlink realmente attraversate dal sorgente, comprese quelle raggiunte dentro un target di `Readlink`. Mantieni distinti questo controllo e il confronto dei referenti già presente. Non limitarti a un prefisso di stringa: ammetti il caso in cui la destinazione è indicata attraverso un altro alias della directory genitore. Riusa il resolver finito e mantieni il preflight sotto `diskWriteMu`, senza introdurre un secondo risolutore o promettere filesystem CAS. Conserva la copia lecita verso una destinazione indipendente, incluso l'overwrite già confermato del link dangling distinto del 005c. Non aggirare l'asserzione cambiando il codice del conflitto o rifiutando indiscriminatamente i symlink.

Mantieni intatti tutti i test del revisore, aggiungi una prova per l'alias del genitore della destinazione e riesegui le verifiche richieste dal 005c. Baseline del revisore: Go 77 passati / 1 fallito / 0 skip; frontend 112/112. Nessun reset, commit/push, cambio versione, binario o release; non modificare `REVIEW-1.0.2.md` e `REVIEW-1.0.3.md`. Fermati alla consegna senza avviare il 006.
