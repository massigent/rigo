# Incarico 004b — Errori operativi di permesso e fine dello stato saving

La revisione ha confermato la parte principale del 004: 55 test Go con race/shuffle verdi, vet pulito; 89 frontend verdi. Policy file 0444, enforcement force/overwrite e flusso copia sono presenti. Conserva queste modifiche e tutte le garanzie 001–003.

Il 004 NON è approvato: tre test indipendenti falliscono.

## 1. Fallimento rimozione sorgente ignorato — ALTA

Test: `read_only_review_test.go`, TestReviewRenameDoesNotIgnoreSourceRemovalPermissionFailure.

Riproduzione su Linux, utente non privilegiato:
- file sorgente 0644, leggibile e apribile O_WRONLY;
- directory sorgente 0555: non consente rimozione del file;
- destinazione in altra directory scrivibile;
- rename con baseline corretta e testo nuovo.

Risultato attuale: atomicWrite della destinazione riesce, os.Remove del sorgente fallisce ma il suo errore è ignorato; API 200 success:true, activePath/activeDir/recents passano alla destinazione. L'operazione è diventata una copia, non una rinomina completata.

Correzione:
- Verifica i prerequisiti pertinenti della rimozione sorgente prima degli effetti quando determinabili senza mutazioni. Il permesso di scrittura del FILE non dimostra il diritto di cancellarlo dalla directory.
- Non ignorare errori Stat/Remove del sorgente dopo la scrittura. Un fallimento operativo deve essere segnalato, mai 200/success:true; permission failure -> 403 write_forbidden con path/fase pertinenti.
- Non aggiornare stato attivo/recents per una rinomina fallita.
- Non introdurre scritture di prova, troncamenti, chmod o un nuovo algoritmo di salvataggio in-place.
- Un preflight non elimina il TOCTOU. Se il fallimento avviene dopo aver scritto/sostituito la destinazione, comunica esplicitamente l'esito parziale (destinazione scritta, sorgente non rimosso), preserva il sorgente e non dichiarare rollback o «nessuna modifica». Non tentare un rollback distruttivo che potrebbe cancellare il lavoro di un altro processo. Il test indipendente non impone rollback della destinazione: impone errore onesto e stato applicativo non avanzato.
- Aggiungi test anche per destinazione già esistente e per rimozione effettivamente fallita, non solo per un helper di mode. Dove i privilegi/OS impediscono il caso, skip mirato come nel test del revisore.

Questo difetto era preesistente, ma rientra nel requisito 004 esplicito «errori operativi di permesso mai dichiarati successo» e contraddice il resoconto della consegna; non rinviarlo al riordino generale Save As.

## 2. Filesystem read-only classificato male — MEDIA

Test: `read_only_review_test.go`, TestReviewReadOnlyFilesystemWriteErrorsArePermissionRefusals.

`writeFailureStatus(&os.PathError{Err: syscall.EROFS})` restituisce oggi 500 write_failed. EROFS non è coperto da os.IsPermission/fs.ErrPermission.

Riconosci l'errore filesystem read-only anche quando incapsulato e restituisci 403 write_forbidden. Mantieni la distinzione dagli errori di I/O generici (che non devono diventare tutti permission errors). Verifica i call site save/rename/cartelle. Non servono mount/remount privilegiati: il test del revisore verifica il mapping errno, non simula un filesystem read-only reale e non va presentato come tale.

## 3. Destinazione protetta lascia «Salvataggio…» — MEDIA

Test: `tests/frontend/review-read-only.test.cjs`.

Riproduzione: documento NORMALE, digitazione (debounce autosave), apri Save As verso file protetto. startRename annulla il debounce. Il backend rifiuta 403 read_only sulla destinazione; il controller mostra alert ma non chiude lo stato transitorio. La UI resta «Salvataggio…» pur senza richieste o timer pendenti.

Termina correttamente lo stato saving su tutti i rifiuti pertinenti. In questo caso il sorgente rimane editabile e dirty, path/baseline invariati, beforeunload attivo; status non transitorio che spieghi il rifiuto o lo stato modificato. Non bloccare il sorgente per un problema della destinazione, non offrire force e non ritentare automaticamente. Conserva l'indicatore read-only appropriato nel caso sorgente già protetto/copia.

## Consegna

- Mantieni i due test Go e il test frontend indipendenti, senza indebolire le asserzioni.
- Tutti i 55 Go precedenti + i 2 nuovi verdi; tutti gli 89 frontend precedenti + il nuovo verdi, oltre ai casi aggiuntivi richiesti.
- Go race/shuffle, vet, frontend dopo npm ci, sintassi JS/CJS, diff check ed esclusione asset dev.
- Aggiorna la documentazione degli esiti parziali e dei limiti di permesso, senza promettere transazioni atomiche fra due percorsi o verifica ACL/Windows completa.
- Intervento circoscritto: niente reset, cambio semantica Save As generale, modifica del protocollo revisioni, Host/Origin, nuove funzionalità o packaging.
- Nessun commit/push, incremento versione, binario o release. Riporta comandi/esiti effettivi e attendi revisione indipendente.
