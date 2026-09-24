# Live data contract (LeagueBroadcast → Supabase)

Agent od verze 0.1.6 vytváří průběžný, verzovaný stream dat nezávislý na cílové
databázové struktuře. Dokud není ingest endpoint nastavený, běží v režimu
`local-only` a všechny zprávy ukládá do složky konkrétní hry:

- `live_events.jsonl` – append-only historie eventů, snapshotů a lifecycle zpráv,
- `live_state.json` – poslední publikovaný snapshot,
- `live_final.json` – zmrazený finální stav po konci hry,
- `confirmed.json` a `.txt` – stávající finální export zůstává zachovaný.

## Obálka zprávy

Každý HTTP požadavek nese jeden JSON objekt:

```json
{
  "schemaVersion": 1,
  "eventId": "ILT-2026-08-28-001:00000042",
  "localGameId": "ILT-2026-08-28-001",
  "sequence": 42,
  "kind": "event",
  "type": "champion.kill",
  "source": "league-broadcast",
  "capturedAt": "2026-08-28T18:42:11.245Z",
  "gameTime": 825.4,
  "payload": {}
}
```

`eventId` musí mít na serveru UNIQUE constraint. Opakovaný POST stejné zprávy
musí být idempotentní a vrátit 2xx. `sequence` určuje pořadí zpráv v jedné hře.

## Typy

- `game.created` / `game.ended` – lifecycle; konec obsahuje finální čas v sekundách,
- `champion.kill` – vrah, oběť a asistující hráči,
- `player.update` – K/D/A, nákup/prodej itemů a level-up,
- `objective`, `team.update` – další LeagueBroadcast eventy (surový payload),
- `objective.kill` – normalizovaný objektiv: `kind` (`dragon`, `baron`, `tower`),
  `side` a `team`, `dragonType` (`fire`, `earth`, `water`, `air`, `hextech`,
  `chemtech`, `elder`), `stolen`, `killer` a `eventId`. Věže jsou z Riot Live API,
  draci a baroni z LeagueBroadcastu (Live API je ve spectatoru nehlásí). Heraldi,
  voidgrubi, inhibitory a Atakhan se zatím nesledují,
- `gold.sample` – gold týmů každých 30 s herního času a na konci hry:
  `gameTime`, `teams` (`BLUE`, `RED`) a `diff` (modří − červení). Z nich jde graf,
- `gold.lane14` – jednou za hru, ve 14. minutě: `gameTime` a `players` (`side`,
  `slot`, `name`, `championName`, `gold`, `opponentChampion`, `goldDiff`). `slot`
  je pořadí v týmu z LeagueBroadcastu = role (0 top, 1 jungle, 2 mid, 3 bot,
  4 support); protivník na stejné roli má stejný `slot` na druhé straně.
  Když Agent naběhne až po 15. minutě, zpráva nepřijde,
- `game.state` – K/D/A, CS, gold (celá čísla), itemy, level, vision, pentakilly,
  solo killy (kill bez asistence, z Live API),
  `slot`, team kills/gold, game time a `objectives` (součty za tým, dračí duše,
  první drak/baron/věž, timeline).

Objektivy a pentakilly se berou z event streamu Riot Live API i ve chvíli, kdy
statistiky hráčů dodává LeagueBroadcast. Pentakill se k hráči páruje přes stranu
a championa, protože oba zdroje píšou jména hráčů různě.

Diskrétní eventy se zapisují okamžitě. Snapshoty jsou omezené standardně na
nejvýše 2 za sekundu (`LIVE_SNAPSHOT_INTERVAL_MS=500`), aby pasivní gold
nevytvářel zbytečný počet databázových zápisů.

## Zapnutí vzdáleného ingestu

```powershell
$env:INFERNAL_INGEST_URL = "https://<project>.supabase.co/functions/v1/live-ingest"
$env:INFERNAL_INGEST_TOKEN = "<production-specific token>"
```

Agent posílá `POST` s `Content-Type: application/json` a tokenem v hlavičce
`Authorization: Bearer ...`. Neúspěšné zprávy zůstávají v
`data/outbox/pending/` a po obnovení spojení se odešlou znovu v pořadí.

Do distribuované Electron aplikace nepatří Supabase `service_role` klíč.
Doporučený cíl je Edge Function, která ověří produkční token, validuje obálku a
provede idempotentní zápis/upsert do tabulek.

## Doporučené databázové vrstvy

- `game_events` – append-only zprávy `kind=event|lifecycle`, UNIQUE `event_id`,
- `live_game_state` – poslední `game.state`, UPSERT podle `local_game_id`,
- finální relační tabulky – naplní se z potvrzené hry po skončení.
