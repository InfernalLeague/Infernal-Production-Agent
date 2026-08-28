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
| LCU klient | `src/league/LcuClient.ts` | champ select z klienta (lockfile auth) → bany + picky |
| Champ select | `src/champselect/ChampSelectCollector.ts` | polling draftu, normalizace banů/picků v pořadí |
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

To zbuildí backend (`tsc`), zbuildí oba overlaye a zkopíruje je do `overlays/`,
a otevře okno appky. Pak už stačí `npm run app` (příp. `npm run app:mock`).
Overlaye jsou pro OBS na:

- **Ingame:**  `http://localhost:4700/overlay/ingame`
- **Pick/Ban:** `http://localhost:4700/overlay/pickban`

Zdroje overlayů jsou v monorepu (`overlays-src/ingame`, `overlays-src/pickban`);
přepíšeš přes `INGAME_OVERLAY_DIR` / `PICKBAN_OVERLAY_DIR`.
Ingame overlay i Agent používají běžící **LeagueBroadcast** (`localhost:58869`)
jako primární zdroj live dat.

Zapisovatelná data (`data/`, `games/`, `logs/`) jdou v Electron režimu do
`%APPDATA%\infernal-production-agent` (userData), v dev režimu (`npm run mock/dev`)
zůstávají v repu.

## Postup v UI

1. Vyplň **New Game** (Team 1/2, číslo hry, série, strana) → **CREATE GAME**.
   Udělej to **před / během champ selectu**, ať se stihne zachytit draft.
2. Stav přejde na `WAITING FOR GAME`. Pokud produkční PC prochází **champ
   selectem** (je v lobby / hostuje custom hru), přečtou se z LCU **bany a picky**
   a zobrazí se v panelu DRAFT. Jakmile Live API začne odpovídat → `LIVE`
   a dashboard ukazuje K/D/A, CS, Vision, level, championy, pentakilly.
3. Po konci hry (Live API mlčí ~12 s, nebo tlačítkem *Ukončit hru ručně*) →
   `GAME ENDED` a zmrazí se **final live snapshot**.
4. Zvol **Winner** a klikni **EXPORT .TXT**.

## Champ select (bany + picky)

Draft se čte z **LCU API** klienta přes lockfile
(`C:\Riot Games\League of Legends\lockfile`, jde přepsat přes `LCU_LOCKFILE`).

**Důležité omezení:** LCU vidí jen draft, kterého se klient sám účastní. Funguje
tedy, když produkční PC je **v lobby / hostuje custom hru** a prochází champ
selectem. Když hru jen **spectatuješ**, draft (hlavně bany) tudy nezískáš — picky
se pak vezmou až z rozehrané hry, bany chybí.

## Výstup

Ve složce `games/<datum>_<team1>_<team2>_G<n>/`:

- `export.txt` + `Infernal_<team1>_vs_<team2>_Game<n>_<datum>.txt` — finální export
- `confirmed.json` — source of truth (§50)
- `live_final.json` — final live snapshot
- `live_events.jsonl` — průběžné eventy/snapshoty pro testování databázového kontraktu
- `live_state.json` — poslední publikovaný stav hry

`data/current_game/live_snapshot.json` je recovery snapshot (každých 5 s při LIVE).

Bez databázového endpointu běží publisher v režimu `local-only`. Pozdější
Supabase Edge Function se zapne přes `INFERNAL_INGEST_URL` a
`INFERNAL_INGEST_TOKEN`; formát je popsán v `docs/LIVE_DATA_CONTRACT.md`.

## Co Fáze 1A záměrně NEřeší

Screenshot, AI extrakci, reconciliation, review/confirm obrazovku, databázi,
web, účty. Damage / Gold / Gold-per-min proto zůstávají prázdné (přijdou ze
screenshotu ve Fázi 1B). Vision Score je live-only (§23).
