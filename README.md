# SoundOut — Convertitore MP4/MOV/YouTube → MP3

Webapp locale per convertire video in MP3. Due modalità, separate da un toggle in alto a destra:

- **Video → MP3** — carichi un file MP4 o MOV, la conversione avviene interamente nel browser (FFmpeg via WebAssembly). Il file non lascia mai il dispositivo, nessun upload.
- **YouTube → MP3** — incolli un link YouTube, un piccolo server locale estrae l'audio con `yt-dlp`, poi il browser lo converte in MP3 con la stessa pipeline FFmpeg.

## Struttura del progetto

```
convertitore/
├── README.md
├── server.py          backend Python: static file server + API di estrazione YouTube
└── public/             frontend statico
    ├── index.html
    ├── styles.css
    └── app.js
```

## Requisiti

- Python 3
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) installato e nel `PATH` (solo per la modalità YouTube)

```bash
python3 -m pip install --user -U yt-dlp
```

Non serve `ffmpeg` installato sul sistema: la conversione gira via FFmpeg WebAssembly nel browser.

## Avvio

```bash
cd /Users/luca/Desktop/all/convertitore
python3 server.py
```

Poi apri **http://127.0.0.1:8420** nel browser. Il server resta in esecuzione finché non lo fermi con `Ctrl+C` (o `lsof -ti tcp:8420 | xargs kill` da un altro terminale).

## Come funziona

### Video → MP3 (client-side, no upload)

1. Trascini/scegli un file MP4 o MOV (uno alla volta, max 500 MB consigliato).
2. Scegli qualità audio (128/192/320 kbps) e canali (stereo/mono).
3. FFmpeg (compilato in WebAssembly, caricato da CDN) converte il file direttamente nel browser.
4. Il download dell'MP3 parte automaticamente.

Il file video non viene mai inviato al server: tutta la conversione avviene in un Web Worker nel browser.

### YouTube → MP3

1. Incolli il link del video.
2. Il frontend chiama `POST /api/yt-audio` sul server locale.
3. Il server usa `yt-dlp` per estrarre la traccia audio dal video (senza post-processing, nessun `ffmpeg` lato server) e la restituisce al browser.
4. Il browser converte l'audio ricevuto in MP3 con la stessa pipeline FFmpeg usata per i file locali.
5. Il download dell'MP3 parte automaticamente, con il titolo del video come nome file.

Limiti: video fino a 20 minuti; la qualità audio massima disponibile dipende dai formati che YouTube espone senza richiedere un PoToken (in pratica, spesso un audio ~128 kbps incluso in un mp4 360p) — selezionare 320 kbps non migliora una sorgente già compressa a bitrate inferiore.

**Uso responsabile**: questa funzione va usata solo con contenuti di cui possiedi i diritti o per cui hai l'autorizzazione del titolare. Estrarre audio da YouTube senza autorizzazione può violare i Termini di Servizio della piattaforma e il copyright dei contenuti.

## Note tecniche

- **FFmpeg.wasm**: caricato da CDN (`unpkg.com`) come build UMD, con `core`, `wasm` e `worker` convertiti in blob URL locali per evitare le restrizioni same-origin dei Web Worker.
- **yt-dlp**: viene reinstallato periodicamente da YouTube quando cambia la piattaforma; se la modalità YouTube smette di funzionare, il primo passo è aggiornarlo (`python3 -m pip install --user -U yt-dlp`).
- **Nessun database, nessun log persistente**: il server non salva né analizza i contenuti convertiti; i file temporanei della modalità YouTube vengono cancellati subito dopo l'invio al browser.

## Roadmap (idee per v2)

- Batch conversion (più file insieme)
- Tag ID3 (titolo, artista, copertina)
- Normalizzazione del volume
- Taglio inizio/fine (trimming)
