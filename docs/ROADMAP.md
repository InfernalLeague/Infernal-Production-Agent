# Infernal Production Agent — Roadmap

Rozhodnutí (2026-08-24):
- **Balení:** Electron + electron-updater (celý balík = jedna .exe, auto-update pro všechny).
- **NodeCG (`produkce/`):** legacy / paralelní pokus → **nepokračujeme**. Jdeme cestou
  Agent + Vue overlaye servírované přímo z Agenta.
- **Live data pro ingame overlay:** LeagueBroadcast (3. strana, `localhost:58869`) zůstává
  externí závislost — dokumentovat jako prerekvizitu, případně později spouštět jako child-process.

## Cílová architektura

```
Infernal Production Agent (.exe = Electron shell)
├── main process
│   ├── boot: stávající Node/Express+ws backend (port 4700)
│   ├── sběr LoL dat → ConfirmedGame → exportéry (TXT / JSON / Web)
│   ├── static hosting overlayů:  /overlay/ingame  /overlay/pickban
│   ├── electron-updater → check GitHub Releases na startu
│   ├── (pozdější) OBS WebSocket, thumbnaily, YouTube upload
│   └── data dir = app.getPath('userData')  (NE relativně ke zdrojáku!)
├── renderer: dashboard (public/) jako okno
└── resources/overlays/{ingame,pickban}  ← vite buildy, bundlené do .exe

Externí: OBS (WebSocket), LeagueBroadcast (:58869), Infernal HUB (Vercel+Supabase)
```

---

## Fáze 0 — Electron shell + servírování overlayů  ✅ HOTOVO (2026-08-24)

**Cíl:** jedno spustitelné .exe, overlaye běží lokálně, dashboard je okno.

- [x] Přidat `electron` (v43). `electron-builder`/`electron-updater` = Fáze 1.
- [x] Main process (`electron/main.mjs`): nabootuje backend z `dist/index.js` (NE tsx),
      počká na server, otevře `BrowserWindow` → `http://localhost:4700` (dashboard).
- [x] Build pipeline: `tsc` → `dist/`; `scripts/build-overlays.mjs` zbuildí oba overlaye
      (`vite build` v jejich repech) a zkopíruje `dist` → `overlays/{ingame,pickban}`.
- [x] Express static routes: `/overlay/ingame`, `/overlay/pickban` (`mountOverlay` v
      `server.ts`; chybějící build → 404 s nápovědou místo tichého selhání).
- [x] Data dir přes env override v `config.ts`: `INFERNAL_DATA_DIR` (Electron = userData),
      `INFERNAL_ASSETS_DIR` (public+overlays; Electron = resources). Dev default = ROOT.
- [x] **Oprava portů/base:** ingame overlay měl `base` = `/` → rozbil by se pod podcestou.
      Nastaveno `base: './'` (pickban už měl). Dev servery overlayů (5173/5174) tím odpadají.
- [x] Zachován `npm run mock` a dev flow.

**Nové scripty:** `build:overlays`, `build:all`, `app` (electron .), `app:mock`, `app:build`.
**Výsledek:** `npm run app:build` → jedno okno, jeden proces, OBS míří na `/overlay/*` na :4700.
**Ověřeno:** dashboard, `/api/state`, oba overlaye vrací 200; data zapsána do userData.
**Zbývá (přenést do Fáze 1):** electron-builder balení do .exe + zahrnout `dist/`, `public/`,
`overlays/` do resources (extraResources) a `INFERNAL_ASSETS_DIR=process.resourcesPath`.
GUI okno nešlo v tomto prostředí vizuálně ověřit — otestovat na reálném desktopu.

## Fáze 1 — Balení do .exe + auto-update (electron-updater)  ✅ HOTOVO (2026-08-24)

**Cíl:** „updaty se automaticky stáhnou všem po spuštění."

- [x] electron-builder config (`electron-builder.yml`): NSIS installer, `files` (dist+electron),
      `extraResources` (public+overlays), `asarUnpack` dist, `publish: github`.
- [x] Packaged režim ověřen: `INFERNAL_ASSETS_DIR=process.resourcesPath`, backend bootuje
      z asaru, overlaye+assety se servírují z resources (vše 200 přes zabalený .exe).
- [x] electron-updater ve `main.mjs`: check na startu (jen packaged) → download na pozadí →
      instalace při quitu; chyby jen logované (offline/špatný feed appku neshodí).
- [x] Feed = **GitHub Releases** (rozhodnutí uživatele). Release postup: `docs/RELEASE.md`.
- [x] Scripty: `pack:dir`, `dist:win`, `release`. Ověřeno: installer + `latest.yml` + `app-update.yml`.
- [x] Overlaye jsou uvnitř balíku → updatují se **spolu s appkou** (řeší zadání).

**Release:** GitHub repo, publish konfigurace i ikona jsou nastavené; CI vydává po tagu `vX.Y.Z`.
**Rizika/pozn.:** bez code-signingu SmartScreen varuje (zvážit certifikát).

## Fáze 2 — Web-ready export contract (příprava na live web)

**Cíl:** připravit JSON kontrakt, aby web integrace nikdy neparsovala TXT.
Bez rozšiřování statistik (držíme lean scope).

- [x] Verzovaná obálka průběžných live zpráv (`schemaVersion: 1`).
- [x] LeagueBroadcast WebSocket collector pro ingame eventy a snapshoty.
- [x] Lokální JSONL audit + odolný HTTP outbox pro budoucí Supabase Edge Function.
- [ ] `schemaVersion` do finálního `ConfirmedGame`.
- [ ] Zachytit **PUUID/riotId** hráče (z Live API `riotId` / LCU) — i když se zatím nikam
      nepíše. Jména se mění; stabilní ID spáruje historii.
- [ ] Přenést `gameMode` / `mapName` / patch verzi do `ConfirmedGame` (dnes se zahazují).
- [ ] Nullable `matchId` / `seriesId` (později se plní z Infernal HUB plánu zápasů).
- [ ] `JsonExporter` (kanonický JSON) vedle `TxtExporter`. TXT nechat beze změny.
- [x] Outbox + idempotentní `eventId` a pořadové `sequence` pro live ingest.

## Fáze 3 — Live web export → Infernal HUB  (= Fáze 2 z memory)

**Cíl:** po každé hře poslat `ConfirmedGame` na web.

- [ ] `WebUploader` / oživit `DatabaseExporter` → POST JSON na HUB API (Vercel + Supabase).
- [ ] Auth (API key), retry z outboxu, idempotency (offline-resilient).
- [ ] Supabase schema zrcadlí `ConfirmedGame`.
- **Blokováno:** dokud neexistuje HUB backend. Dělat až po definici HUB API.

## Fáze 4 — Stříhání streamu podle her (OBS WebSocket)

**Cíl:** rozstříhat nahrávku podle her, které Agent sám detekuje.
**Princip: NE rozpoznávání obrazu — Agent už zná ground-truth časy (`LIVE`/`GAME_ENDED`).**

- [ ] `obs-websocket-js` v main procesu, připojení na OBS (`localhost:4455`).
- [ ] Na `GAME_ENDED` volat **`SplitRecordFile`** → každá hra = vlastní soubor
      (žádné post-processing stříhání). Nebo dropovat chapter markery.
- [ ] Manifest: mapování výstupní soubor → `localGameId` / `ConfirmedGame`.
- [ ] Fallback pro jeden hotový VOD: logovat wall-clock hranice → ffmpeg
      stream-copy cut (`-ss/-to -c copy`, bezztrátové, rychlé).
- [ ] Nastavení: OBS ws adresa/heslo v settings.
- **CV rozpoznávání** (loading screen/HUD) jen jako fallback pro staré nahrávky bez Agenta.

## Fáze 5 — Auto thumbnaily

**Cíl:** z per-game `ConfirmedGame` vygenerovat YouTube thumbnail.

- [ ] HTML/canvas šablona (reuse overlay assetů, champion art) → render do PNG.
- [ ] Render přes Electron offscreen `BrowserWindow` → `capturePage` (žádný extra puppeteer).
- [ ] Vstupy: týmy, skóre, winner, klíčoví championi.

## Fáze 6 — YouTube upload

**Cíl:** automatický (potvrzovaný) upload rozstříhaných her.

- [ ] YouTube Data API v3: `videos.insert` (title/desc/tags z `ConfirmedGame`) + `thumbnails.set`.
- [ ] OAuth na Google účet; tokeny bezpečně v `userData`.
- [ ] **Kvóta:** upload = ~1600 jednotek z 10 000/den → cca **6 uploadů/den** bez navýšení.
- [ ] Upload je publikace navenek → **vždy potvrdit před odesláním**.
- **Rizika:** OAuth verifikace appky, kvóta, správa tokenů.

---

## Průřezové

- Settings UI: OBS ws, HUB API key, YouTube auth, data dir.
- Migrace data dir → `userData` (Fáze 0).
- Logging už existuje (`src/util/logger.ts`).

## Doporučené pořadí

`0` (základ) → `2` (levné, dělat při zásahu do buildu) → `1` (dostat distribuci brzy) →
`4` → `5` → `6` → `3` (až bude HUB).
