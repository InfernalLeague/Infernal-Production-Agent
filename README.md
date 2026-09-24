# Infernal Production Agent

Lokální aplikace pro sběr live dat ze **spectatované** hry League of Legends,
jejich průběžný transport, potvrzení a export do `.txt`.

Od verze 0.1.6 je Agent připravený na live ingest: LeagueBroadcast WebSocket
poskytuje rychlé eventy a bohaté snapshoty, Riot Live API zůstává jako fallback.

## Architektura (podle workflow §45, §69)

Klíčový princip: **NENÍ to `League → TXT`**. Vše míří do jednoho objektu
`ConfirmedGame` (source of truth), ze kterého čtou exportéry:

```
League Live API ─┐
                 ├──► ConfirmedGame ──► TxtExporter        (aktivní)
(Screenshot)  ───┘                 └──► DatabaseExporter   (Fáze 2, stub)
```

| Vrstva | Soubor | Role |
|---|---|---|
| Live API klient | `src/league/LiveClientApi.ts` | čte `127.0.0.1:2999/liveclientdata/allgamedata` |
| LeagueBroadcast | `src/live/LeagueBroadcastCollector.ts` | WebSocket eventy + K/D/A, CS, gold, itemy a čas |
| Live publisher | `src/live/LiveStreamPublisher.ts` | JSONL audit, outbox a volitelný HTTP ingest |
| Mock zdroj | `src/league/MockLiveClient.ts` | simuluje hru bez League (`--mock`) |
| Collector | `src/league/LeagueDataCollector.ts` | polling smyčka (1×/s), emituje data/výpadky |
| Game session | `src/core/GameSession.ts` | stav jedné hry v paměti |
| Orchestrátor | `src/core/GameManager.ts` | stavový automat, konec hry, recovery, export |
| Model | `src/export/buildConfirmedGame.ts` | Live snapshot → `ConfirmedGame` |
| Export | `src/export/TxtExporter.ts` | strojově čitelný `.txt` (§42) |
| Server | `src/server/server.ts` | REST + WebSocket + dashboard |
| Dashboard | `public/` | diagnostické UI (§4, §12) |

## Spuštění

```bash
npm install
```

**Vyzkoušení bez League (mock režim)** — nasimuluje hru Ixtal vs Freljord,
která po ~90 s „skončí":

```bash
npm run mock
```

**Ostrý provoz s běžící League hrou:**

```bash
npm run dev
```

Pak otevři **http://localhost:4700**.

## Spuštění jako aplikace (Electron) + overlaye

Od Fáze 0 běží vše z jednoho procesu: dashboard jako okno a **oba overlaye se
servírují z téhož serveru** (už se nespouští samostatné Vite dev servery).

```bash
npm run app:build
```

To zbuildí backend (`tsc`), zbuildí ingame overlay a zkopíruje ho do `overlays/`,
a otevře okno appky. Pak už stačí `npm run app` (příp. `npm run app:mock`).
Overlay je pro OBS na `http://localhost:4700/overlay/ingame`.

Zdroj overlaye je v monorepu (`overlays-src/ingame`), přepíšeš ho přes
`INGAME_OVERLAY_DIR`. Draft (pick/ban) Agent neřeší vůbec — běží v Champion
Draftu na webu Infernal League, včetně overlaye.
Ingame overlay i Agent používají běžící **LeagueBroadcast** (`localhost:58869`)
jako primární zdroj live dat.

Zapisovatelná data (`data/`, `games/`, `logs/`) jdou v Electron režimu do
`%APPDATA%\infernal-production-agent` (userData), v dev režimu (`npm run mock/dev`)
zůstávají v repu.

## Postup v UI

1. Vyplň **New Game** (Team 1/2, číslo hry, série, strana) → **CREATE GAME**.
2. Stav přejde na `WAITING FOR GAME`. Jakmile LeagueBroadcast nebo Live API začne
   odpovídat → `LIVE`
   a dashboard ukazuje K/D/A, CS, Vision, level, championy, pentakilly.
3. Po konci hry (Live API mlčí ~12 s, nebo tlačítkem *Ukončit hru ručně*) →
   `GAME ENDED` a zmrazí se **final live snapshot**.
4. Zvol **Winner** a klikni **EXPORT .TXT**.

## Výstup

Ve složce `games/<datum>_<team1>_<team2>_G<n>/`:

- `export.txt` + `Infernal_<team1>_vs_<team2>_Game<n>_<datum>.txt` — finální export
- `confirmed.json` — source of truth (§50)
- `live_final.json` — final live snapshot
- `live_events.jsonl` — průběžné eventy/snapshoty pro testování databázového kontraktu
- `live_state.json` — poslední publikovaný stav hry

Export obsahuje za každý tým draky podle typu (včetně Eldera a dračí duše),
barony a věže, u hry prvního draka, barona a věž a sekci `OBJECTIVES` s časovou
osou (`čas;objektiv;typ;tým;stolen`). Věže jdou z Riot Live API, draci a baroni
z LeagueBroadcastu.

Gold je v celých číslech. Sekce `GOLD` má vzorek každých 30 s herního času
(`čas;modří;červení;rozdíl`), hráči mají `slot` (role podle pořadí v týmu),
`opponent` a rozdíl goldu proti protivníkovi na stejné roli na konci hry,
v 10. a v 15. minutě (`gold_diff`, `gold_diff_at_10`, `gold_diff_at_15`).
V `confirmed.json` je celá časová osa goldu včetně hráčů (`goldTimeline`).

`data/current_game/live_snapshot.json` je recovery snapshot (každých 5 s při LIVE).

Bez databázového endpointu běží publisher v režimu `local-only`. Pozdější
Supabase Edge Function se zapne přes `INFERNAL_INGEST_URL` a
`INFERNAL_INGEST_TOKEN`; formát je popsán v `docs/LIVE_DATA_CONTRACT.md`.

## Co Fáze 1A záměrně NEřeší

Screenshot, AI extrakci, reconciliation, review/confirm obrazovku, databázi,
web, účty. Damage / Gold / Gold-per-min proto zůstávají prázdné (přijdou ze
screenshotu ve Fázi 1B). Vision Score je live-only (§23).
