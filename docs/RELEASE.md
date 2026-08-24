# Release & auto-update (Fáze 1)

Aplikace se balí electron-builderem do Windows installeru a updatuje se sama
z **GitHub Releases** přes electron-updater. Uživatel po spuštění dostane novou
verzi automaticky (stáhne na pozadí, nainstaluje při zavření).

## Jednorázové nastavení (musíš udělat ty)

1. **Založ GitHub repo** pro Agenta (např. `infernal-production-agent`).
2. V [`electron-builder.yml`](../electron-builder.yml) přepiš `publish.owner`
   z `GITHUB_USER_TODO` na svůj GitHub účet (a `repo`, pokud jsi zvolil jiný název).
3. Vytvoř **Personal Access Token** (classic, scope `repo`) a nastav ho jako
   proměnnou `GH_TOKEN` (electron-updater/-builder ho čte při publikaci):

   ```powershell
   $env:GH_TOKEN = "ghp_..."
   ```

## Vydání nové verze

1. Zvedni `version` v `package.json` (např. `0.1.0` → `0.1.1`). **Auto-update
   funguje jen na vyšší verzi.**
2. Publikuj:

   ```bash
   npm run release
   ```

   To zbuildí backend + overlaye, postaví installer a nahraje ho na GitHub
   Releases (installer, `latest.yml`, blockmap). Release se vytvoří jako **draft** —
   na GitHubu ho potvrď (Publish release).
3. Hotovo. Každá appka po příštím spuštění najde `latest.yml`, porovná verzi a
   stáhne update.

## Vydání přes CI (doporučeno)

Repo má GitHub Actions workflow [`.github/workflows/release.yml`](../.github/workflows/release.yml),
který po pushnutí tagu `vX.Y.Z` sám zbuildí backend + overlaye, postaví installer
a nahraje ho na Releases **jedním krokem** (žádné duplicitní drafty, build neběží
u tebe lokálně). Postup vydání:

1. Zvedni `version` v `package.json` (např. `0.1.1`).
2. Commitni a otaguj:

   ```bash
   git commit -am "release 0.1.1"
   git push
   git tag v0.1.1
   git push origin v0.1.1
   ```

3. Sleduj běh v záložce **Actions** na GitHubu. Po doběhnutí je release rovnou
   publikovaný (ne draft) → auto-update ho vidí. `GH_TOKEN` u sebe **nepotřebuješ**,
   CI používá vestavěný `GITHUB_TOKEN`.

**Pozn.:** tag musí sedět na `version` v `package.json` (tag `v0.1.1` ↔ version `0.1.1`).

## Lokální build bez publikace

- `npm run dist:win` — postaví installer do `release/`, nic nenahrává.
- `npm run pack:dir` — jen rozbalená appka v `release/win-unpacked/` (rychlé, na test).

## Co je potřeba vědět

- **Code signing:** installer teď není podepsaný důvěryhodným certifikátem →
  Windows SmartScreen při instalaci varuje („Neznámý vydavatel"). Auto-update
  funguje i bez podpisu, ale pro hladší UX zvaž EV/OV code-signing certifikát
  (placené). Konfiguruje se ve `win` sekci `electron-builder.yml`.
- **Ikona:** teď se používá default Electron ikona. Až budeš mít `build/icon.ico`
  (256×256+), odkomentuj `win.icon` v `electron-builder.yml`.
- **Velikost:** installer ~120 MB (obsahuje Electron runtime). Delta updaty
  electron-updater řeší přes blockmap, takže uživatelé nestahují pokaždé celých 120 MB.
- **Privátní repo:** funguje taky, ale klienti pak potřebují token — pro veřejnou
  distribuci je jednodušší public repo.
