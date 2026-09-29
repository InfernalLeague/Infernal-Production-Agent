// Infernal Production Agent – dashboard
//
// Jedna obrazovka: vlevo program produkce, vpravo karta aktuální hry, která
// mění podobu podle fáze (čeká na start → LIVE → potvrzení vítěze). Stav
// spojení je v horní liště; co je potřeba udělat, ukáže pruh pod ní.
const $ = (id) => document.getElementById(id);

let state = null;
let production = localStorage.getItem("il_production");
/** Hra z programu, u které je otevřená oprava vítěze (jen předchozí hra). */
let fixOpen = null;

// --- Data Dragon: champion ikony -------------------------------------------
let ddVersion = null;
const champIdByName = {};
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function initDdragon() {
  const versions = await fetch("https://ddragon.leagueoflegends.com/api/versions.json").then((r) => r.json());
  ddVersion = versions[0];
  const data = await fetch(`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/data/en_US/champion.json`).then((r) => r.json());
  for (const key in data.data) {
    const c = data.data[key];
    champIdByName[norm(c.name)] = c.id; // display name → interní id (soubor ikony)
  }
}
function champIcon(displayName) {
  if (!ddVersion) return null;
  const id = champIdByName[norm(displayName)];
  return id ? `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${id}.png` : null;
}
function itemIcon(itemId) {
  return ddVersion && itemId ? `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/item/${itemId}.png` : null;
}

// --- WebSocket: živý stav ---------------------------------------------------
function connectWs() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  // Po restartu agenta (aktualizace) si produkci znovu řekne dashboard.
  ws.onopen = () => { if (production) post("/api/production", { production }); };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "state") render(msg.data);
  };
  ws.onclose = () => setTimeout(connectWs, 1500); // reconnect
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

// --- menu ⋯ -----------------------------------------------------------------
function closeMenu() { $("menuList").hidden = true; }
$("menuBtn").onclick = (e) => { e.stopPropagation(); $("menuList").hidden = !$("menuList").hidden; };
document.addEventListener("click", (e) => { if (!e.target.closest(".menu")) closeMenu(); });
$("menuList").addEventListener("click", (e) => {
  const act = e.target.closest("button")?.dataset.act;
  if (!act) return;
  closeMenu();
  if (act === "manual") openNewGame();
  if (act === "export") exportTxt();
  if (act === "overlays") showOverlays(true);
  if (act === "refresh") {
    if (production) post("/api/production", { production });
    post("/api/autopilot", { enabled: $("autoEnabled").checked });
    toast("Načítám program…", "ok");
  }
});
$("autoEnabled").onchange = () => post("/api/autopilot", { enabled: $("autoEnabled").checked });

async function exportTxt() {
  const { ok, data } = await post("/api/export/txt");
  if (ok) toast(`Exportováno: ${data.filename}`, "ok");
  else toast(data.error || "Export selhal.", "err");
}

// --- ruční hra (modal) --------------------------------------------------------
function openNewGame() { $("newGameModal").hidden = false; }
function closeNewGame() { $("newGameModal").hidden = true; }
$("closeNewGame").onclick = closeNewGame;
$("newGameModal").addEventListener("click", (e) => { if (e.target.id === "newGameModal") closeNewGame(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeNewGame(); closeMenu(); } });

$("createBtn").onclick = async () => {
  const hint = $("createHint");
  hint.className = "hint";
  const { ok, data } = await post("/api/game", {
    team1: $("team1").value,
    team2: $("team2").value,
    gameNumber: Number($("gameNumber").value),
    seriesFormat: $("seriesFormat").value,
    production: $("production").value,
    team1Side: $("team1Side").value,
    web: selectedWebGame,
  });
  if (ok) {
    closeNewGame();
    selectWebGame(null);
    toast(`Hra založena: ${data.meta.localGameId}`, "ok");
  } else {
    hint.textContent = data.error || "Chyba při zakládání hry.";
    hint.classList.add("err");
  }
};

// Výběr hry z programu produkce (ruční hra).
let selectedWebGame = null;
const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
$("webDate").value = todayIso();

function selectWebGame(pick) {
  selectedWebGame = pick ? { gameId: pick.game.id, matchId: pick.match.id, label: pick.label } : null;
  document.querySelectorAll(".web-game").forEach((b) => b.classList.toggle("active", pick && b.dataset.game === pick.game.id));
  const hint = $("webPickHint");
  hint.className = "hint";
  if (!pick) return;
  const a = pick.match.teamA, b = pick.match.teamB;
  const g = pick.game;
  $("team1").value = a ? a.name : "";
  $("team2").value = b ? b.name : "";
  $("gameNumber").value = g.number;
  const fmt = String(pick.match.format || "").toUpperCase();
  if (["BO1", "BO3", "BO5"].includes(fmt)) $("seriesFormat").value = fmt;
  // Strany podle hry na webu (Champion Draft / volba strany); jinak team A modrá.
  $("team1Side").value = a && g.redTeamId === a.id ? "RED" : "BLUE";
  hint.textContent = `Vybráno: ${pick.label}. Výsledek se po konci hry zapíše k téhle hře a rovnou potvrdí.`;
  hint.classList.add("ok");
}

$("webLoadBtn").onclick = async () => {
  const list = $("webGames");
  const hint = $("webPickHint");
  hint.className = "hint";
  list.innerHTML = '<span class="none">Načítám…</span>';
  const res = await fetch(`/api/web/schedule?date=${encodeURIComponent($("webDate").value || todayIso())}`);
  const data = await res.json().catch(() => ({}));
  list.innerHTML = "";
  if (!res.ok) {
    hint.textContent = data.error || "Program se nepodařilo načíst.";
    hint.classList.add("err");
    return;
  }
  const matches = data.matches || [];
  if (matches.length === 0) {
    list.innerHTML = '<span class="none">V tento den produkce nemá žádný zápas.</span>';
    return;
  }
  for (const match of matches) {
    const names = `${match.teamA ? match.teamA.name : "?"} vs ${match.teamB ? match.teamB.name : "?"}`;
    for (const game of match.games) {
      const btn = document.createElement("button");
      btn.className = "web-game";
      btn.dataset.game = game.id;
      const status = game.status === "confirmed"
        ? (game.resultSource === "admin" ? "potvrzeno adminem" : "potvrzeno")
        : game.status === "annulled" ? "anulováno" : "čeká";
      btn.innerHTML = `<b>${esc(fmtTime(match.scheduledAt))} · ${esc(names)}</b><span>Game ${game.number} · ${esc(status)}${match.published ? "" : " · nezveřejněný"}</span>`;
      btn.disabled = game.status === "annulled" || game.resultSource === "admin";
      btn.onclick = () => selectWebGame({ match, game, label: `${names} · Game ${game.number}` });
      list.appendChild(btn);
    }
  }
};

// --- napojení na web (modal) -----------------------------------------------------
function openSettings() {
  $("settingsModal").hidden = false;
  $("settingsHint").className = "hint";
  $("settingsHint").textContent = "";
  fetch("/api/settings/web").then((r) => r.json()).then((w) => {
    $("webUrl").value = w.webUrl || "";
    for (const [key, id] of [["twitch", "webTokenTwitch"], ["kick", "webTokenKick"]]) {
      const t = (w.tokens && w.tokens[key]) || {};
      $(id).value = "";
      $(id).placeholder = t.hasToken ? `uložený token …${t.tokenHint} (nech prázdné, pokud neměníš)` : "ilpa_…";
    }
  });
}
function closeSettings() { $("settingsModal").hidden = true; }
$("settingsBtn").onclick = openSettings;
$("closeSettings").onclick = closeSettings;
$("settingsModal").addEventListener("click", (e) => { if (e.target.id === "settingsModal") closeSettings(); });

async function saveSettings() {
  const body = { webUrl: $("webUrl").value, tokens: {} };
  if ($("webTokenTwitch").value.trim()) body.tokens.twitch = $("webTokenTwitch").value.trim();
  if ($("webTokenKick").value.trim()) body.tokens.kick = $("webTokenKick").value.trim();
  const { ok } = await post("/api/settings/web", body);
  return ok;
}
$("saveWebBtn").onclick = async () => {
  const hint = $("settingsHint");
  hint.className = "hint";
  if (await saveSettings()) {
    hint.textContent = "Uloženo.";
    hint.classList.add("ok");
    toast("Napojení na web uloženo", "ok");
  } else {
    hint.textContent = "Uložení selhalo.";
    hint.classList.add("err");
  }
};
$("testWebBtn").onclick = async () => {
  const hint = $("settingsHint");
  hint.className = "hint";
  hint.textContent = "Zkouším…";
  await saveSettings();
  // Otestuje token každé produkce, která nějaký má.
  const w = await fetch("/api/settings/web").then((r) => r.json()).catch(() => ({}));
  const lines = [];
  let failed = false;
  for (const key of ["twitch", "kick"]) {
    if (!(w.tokens && w.tokens[key] && w.tokens[key].hasToken)) continue;
    const label = PRODUCTIONS[key].label;
    const res = await fetch(`/api/web/schedule?production=${key}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      failed = true;
      lines.push(`${label}: ${data.error || "spojení selhalo"}`);
    } else if (data.production !== (key === "kick" ? 2 : 1)) {
      failed = true;
      lines.push(`${label}: token patří produkci ${data.production === 2 ? "Kick" : "Twitch"}`);
    } else {
      const games = (data.matches || []).reduce((n, m) => n + m.games.length, 0);
      lines.push(`${label}: funguje, dnes ${(data.matches || []).length} zápasů, ${games} her`);
    }
  }
  hint.textContent = lines.length ? lines.join(" · ") : "Není uložený žádný token.";
  hint.classList.add(failed || !lines.length ? "err" : "ok");
};

// --- produkce (Twitch / Kick) --------------------------------------------------
const PRODUCTIONS = {
  twitch: { label: "Twitch", production: "Twitch" },
  kick: { label: "Kick", production: "Kick" },
};

function applyProduction(p) {
  if (!PRODUCTIONS[p]) return;
  production = p;
  localStorage.setItem("il_production", p);
  // Agent podle produkce vybere token, načte program a zakládá hry.
  post("/api/production", { production: p });
  document.body.dataset.prod = p;
  $("prodSwitch").textContent = PRODUCTIONS[p].label;
  $("production").value = PRODUCTIONS[p].production;
}

function openProdModal() { $("prodModal").hidden = false; }
function closeProdModal() { $("prodModal").hidden = true; }
document.querySelectorAll(".prod-choice").forEach((b) => (b.onclick = () => {
  applyProduction(b.dataset.prod);
  closeProdModal();
  toast(`Produkce: ${PRODUCTIONS[b.dataset.prod].label}`, "ok");
}));
$("prodSwitch").onclick = openProdModal;
$("prodModal").addEventListener("click", (e) => { if (e.target.id === "prodModal" && production) closeProdModal(); });

// --- akce na kartě hry -----------------------------------------------------------
$("endBtn").onclick = () => post("/api/game/end");
$("webResendBtn").onclick = () => post("/api/game/sync");
// Klik na tým = vítěz. Klik na už vybraný (odhadnutý) tým odhad potvrdí;
// na web se znovu neposílá.
$("winnerBtns").addEventListener("click", (e) => {
  const team = e.target.closest("[data-team]")?.dataset.team;
  if (team) post("/api/game/winner", { winner: team });
});

// Oprava vítěze předchozí hry přímo v programu.
$("programList").addEventListener("click", (e) => {
  const fix = e.target.closest("[data-fix]");
  if (fix) {
    fixOpen = fixOpen === fix.dataset.fix ? null : fix.dataset.fix;
    if (state) render(state);
    return;
  }
  const team = e.target.closest("[data-prev-team]")?.dataset.prevTeam;
  if (team) post("/api/game/winner", { winner: team, which: "previous" });
  if (e.target.closest("[data-prev-resend]")) post("/api/game/sync", { which: "previous" });
});

// --- toast ------------------------------------------------------------------
function toast(msg, type) {
  const t = document.createElement("div");
  t.className = "toast " + (type || "");
  t.textContent = msg;
  $("toastWrap").appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 3600);
}

// --- render -----------------------------------------------------------------
const ENDED = ["GAME_ENDED", "EXPORTED"];
const WAITING = ["WAITING_FOR_GAME", "CREATED"];
const PROGRAM_STATE = {
  done: "dohráno", current: "teď", next: "na řadě", upcoming: "později",
  annulled: "anulováno", admin: "zapsal admin", pending: "hra zatím nezaložená",
};
const SYNC_TEXT = {
  idle: () => "",
  sending: () => "Zapisuji výsledek na web…",
  ok: (sync) => `✓ Zapsáno na webu (revize ${sync.revision})${sync.unmatched ? ` · ${sync.unmatched} hráčů nespárováno — zkontroluj v adminu` : ""}`,
  error: (sync) => `Nezapsáno: ${sync.message || "chyba"}${sync.message && sync.message.startsWith("Chybí vítěz") ? "" : " — zkusím znovu za 30 s"}`,
  rejected: (sync) => `Web výsledek odmítl: ${sync.message || ""}`,
};

function render(s) {
  state = s;
  $("mockBadge").hidden = !s.mock;
  if (s.autopilot) $("autoEnabled").checked = s.autopilot.enabled;
  renderHealth(s);
  renderProgram(s);
  renderGame(s);
}

// Horní lišta: čtyři světla a pruh s tím, co je potřeba udělat.
function renderHealth(s) {
  const sess = s.session;
  const active = sess && (WAITING.includes(sess.meta.status) || sess.meta.status === "LIVE");
  const broadcast = s.leagueBroadcast || {};
  const a = s.autopilot || {};
  const issues = [];

  const set = (id, cls, title) => {
    $(id).className = "hp " + cls;
    $(id).title = title;
  };

  if (s.mock) set("hpClient", "idle", "Mock režim");
  else if (s.leagueClient) set("hpClient", "ok", "League klient běží");
  else {
    set("hpClient", active ? "warn" : "idle", "League klient neběží");
    if (active) issues.push({ level: "warn", text: "Spusť League klienta a spectate hry." });
  }

  if (s.leagueGame || (sess && sess.meta.status === "LIVE")) set("hpGame", "ok", "Spectate běží");
  else set("hpGame", "idle", "Spectate zatím neběží");

  if (!broadcast.enabled) set("hpBroadcast", "idle", s.mock ? "V mock režimu vypnutý" : "Vypnutý");
  else if (broadcast.connected) set("hpBroadcast", "ok", `LeagueBroadcast: ${broadcast.gameState || "připojený"}`);
  else {
    set("hpBroadcast", active ? "bad" : "warn", "LeagueBroadcast neběží");
    if (active) issues.push({ level: "bad", text: "LeagueBroadcast neběží — spusť ho, jinak chybí gold, draci a baroni." });
  }

  const web = s.web || {};
  if (!a.production) set("hpWeb", "idle", "Není vybraná produkce");
  else if (!web.hasToken) {
    set("hpWeb", "bad", "Chybí token produkce");
    issues.push({ level: "bad", text: `Chybí token produkce ${PRODUCTIONS[a.production].label} — vlož ho v ⚙.` });
  } else if (a.error) {
    set("hpWeb", "bad", a.error);
    issues.push({ level: "bad", text: a.error });
  } else if (sess && sess.meta.status === "LIVE" && s.liveWeb && s.liveWeb.state === "error") {
    set("hpWeb", "warn", `Živý stav se nezapisuje: ${s.liveWeb.message || "chyba"}`);
    issues.push({ level: "warn", text: `Živý stav se na web nezapisuje: ${s.liveWeb.message || "chyba"} — zkouším dál.` });
  } else set("hpWeb", "ok", "Web v pořádku");

  const issue = issues.find((i) => i.level === "bad") || issues[0];
  $("issue").hidden = !issue;
  if (issue) {
    $("issue").className = "issue " + issue.level;
    $("issue").textContent = issue.text;
  }
}

// Program vlevo: zápasy dne a jejich hry.
function renderProgram(s) {
  const a = s.autopilot || {};
  $("programDate").textContent = new Date().toLocaleDateString("cs-CZ", { weekday: "short", day: "numeric", month: "numeric" })
    + (a.enabled === false ? " · autopilot vypnutý" : "");
  const list = $("programList");
  const program = a.program || [];
  if (!a.production) { list.innerHTML = '<p class="none">Vyber produkci vpravo nahoře.</p>'; return; }
  if (a.error && !program.length) { list.innerHTML = `<p class="none">${esc(a.error)}</p>`; return; }
  if (!program.length) {
    list.innerHTML = `<p class="none">${a.fetchedAt ? "Produkce dnes nemá v programu žádný zápas." : "Načítám program…"}</p>`;
    return;
  }

  const prev = s.previous;
  const prevOpen = prev && prev.meta.web && (!s.session || prev.meta.localGameId !== s.session.meta.localGameId);
  const prevGameId = prevOpen ? prev.meta.web.gameId : null;
  if (fixOpen && fixOpen !== prevGameId) fixOpen = null;

  const groups = [];
  for (const g of program) {
    let group = groups.find((x) => x.matchId === g.matchId);
    if (!group) groups.push((group = { matchId: g.matchId, first: g, games: [] }));
    group.games.push(g);
  }

  list.innerHTML = groups.map(({ first, games }) => {
    const hot = games.some((g) => g.state === "current" || g.state === "next");
    const done = games.every((g) => g.state === "done" || g.state === "annulled" || g.state === "admin");
    return `<div class="pm ${hot ? "hot" : ""} ${done ? "done" : ""}">` +
      `<div class="pm-head"><span class="pm-time">${esc(fmtTime(first.scheduledAt))}</span>` +
      `<span class="pm-teams">${esc(first.teamA)} <em>vs</em> ${esc(first.teamB)}</span>` +
      `${first.published ? "" : '<span class="pm-test">test</span>'}</div>` +
      games.map((g) => programGame(g, prev, prevGameId)).join("") +
      `</div>`;
  }).join("");
}

function programGame(g, prev, prevGameId) {
  const label = g.number ? `Game ${g.number}` : "Game 1";
  const status = g.winner ? `🏆 ${g.winner}` : PROGRAM_STATE[g.state] || g.state;
  const canFix = g.gameId && g.gameId === prevGameId;
  let html = `<div class="pg ${g.state}"><span class="pg-n">${esc(label)}</span><span class="pg-s">${esc(status)}</span>` +
    (canFix ? `<button class="pg-fix" data-fix="${esc(g.gameId)}">${fixOpen === g.gameId ? "Zavřít" : "Opravit"}</button>` : "") +
    `</div>`;
  if (canFix && fixOpen === g.gameId) {
    const sync = prev.webSync || { state: "idle" };
    html += `<div class="pg-fixbox">` +
      `<div class="pg-fixbtns">${[prev.meta.team1, prev.meta.team2].map((name) =>
        `<button class="seg-btn ${prev.winner === name ? "active" : ""}" data-prev-team="${esc(name)}">${esc(name)}</button>`).join("")}</div>` +
      `<span class="web-sync-text ${sync.state}">${esc((SYNC_TEXT[sync.state] || SYNC_TEXT.idle)(sync))}</span>` +
      (sync.state === "error" || sync.state === "rejected" ? '<button class="btn btn-sm btn-ghost" data-prev-resend>Odeslat znovu</button>' : "") +
      `</div>`;
  }
  return html;
}

// Karta aktuální hry.
function renderGame(s) {
  const sess = s.session;
  const status = sess ? sess.meta.status : null;
  const showGame = Boolean(sess);
  $("idle").hidden = showGame;
  $("gameHead").hidden = !showGame;
  if (!sess) {
    const { title, text } = idleText(s);
    $("idleTitle").textContent = title;
    $("idleText").textContent = text;
    ["waitBox", "winnerBox", "summary", "liveNote", "boards", "gameActions"].forEach((id) => ($(id).hidden = true));
    return;
  }

  const m = sess.meta;
  $("mTeam1").textContent = m.team1;
  $("mTeam2").textContent = m.team2;
  $("mGame").textContent = `Game ${m.gameNumber} · ${m.seriesFormat}${m.web ? "" : " · bez webu"}`;
  $("mId").textContent = m.localGameId;

  const badge = $("phaseBadge");
  badge.className = "badge " + ({ WAITING_FOR_GAME: "waiting", CREATED: "waiting", LIVE: "live", GAME_ENDED: "ended", EXPORTED: "ended" }[status] || "");
  badge.textContent = { WAITING_FOR_GAME: "ČEKÁ NA START", CREATED: "ČEKÁ NA START", LIVE: "LIVE", GAME_ENDED: "KONEC HRY", EXPORTED: "KONEC HRY" }[status] || status;

  const live = sess.live;
  const snap = live || sess.finalSnapshot;
  const clock = $("clock");
  clock.textContent = snap ? fmtClock(snap.durationSeconds) : "--:--";
  clock.classList.toggle("live", status === "LIVE");

  const blueTeam = m.team1Side === "BLUE" ? m.team1 : m.team2;
  const redTeam = m.team1Side === "BLUE" ? m.team2 : m.team1;

  // čekání na start
  $("waitBox").hidden = !WAITING.includes(status);
  if (WAITING.includes(status)) {
    $("waitBlue").textContent = blueTeam;
    $("waitRed").textContent = redTeam;
    $("waitText").textContent = m.auto
      ? "Autopilot čeká na start hry. Jakmile naběhne spectate, začne sbírat data sám."
      : "Čekám na start hry. Jakmile naběhne spectate, začnu sbírat data.";
  }

  // konec hry: vítěz
  const ended = ENDED.includes(status);
  $("winnerBox").hidden = !ended;
  if (ended) renderWinner(sess, blueTeam, redTeam);

  // souhrn + hráči
  const players = snap ? snap.players : [];
  $("summary").hidden = !snap;
  if (snap) renderSummary(snap);
  const note = $("liveNote");
  note.hidden = status !== "LIVE";
  if (status === "LIVE") note.textContent = liveNote(s, m);

  $("boards").hidden = players.length === 0;
  $("blueTeamName").textContent = blueTeam;
  $("redTeamName").textContent = redTeam;
  const lane14 = snap ? snap.laneGoldAt14 : null;
  renderRows("blueRows", players.filter((p) => p.side === "BLUE"), lane14);
  renderRows("redRows", players.filter((p) => p.side === "RED"), lane14);

  const fb = snap ? snap.firstBlood : null;
  const fbEl = $("firstBlood");
  fbEl.hidden = !fb;
  if (fb) {
    fbEl.textContent = `First Blood · ${fb.playerName}`;
    fbEl.className = "fb-pill " + (fb.side === "BLUE" ? "side-blue" : "side-red");
  }

  $("gameActions").hidden = status !== "LIVE";
}

function idleText(s) {
  const a = s.autopilot || {};
  if (!a.production) return { title: "Vyber produkci", text: "Podle produkce agent načte program a hry bude zakládat sám." };
  if (a.error) return { title: "Program se nenačetl", text: a.error };
  if (!a.enabled) return { title: "Autopilot je vypnutý", text: "Zapni ho v menu ⋯, nebo tam založ hru ručně." };
  if (!a.fetchedAt) return { title: "Načítám program…", text: "" };
  if (a.nextLabel) return { title: "Připravuji další hru", text: a.nextLabel };
  if (!(a.program || []).length) return { title: "Dnes nic nehrajeme", text: "Produkce nemá v programu žádný zápas. Hru mimo program založíš v menu ⋯." };
  return { title: "Program je dohraný", text: "Dnes už žádná hra nečeká." };
}

function liveNote(s, m) {
  const broadcast = s.leagueBroadcast || {};
  const fresh = broadcast.connected && broadcast.lastSnapshotAt && Date.now() - broadcast.lastSnapshotAt < 3000;
  const source = s.mock ? "mock data" : fresh ? "data z LeagueBroadcastu" : "záloha z Riot Live API (bez goldu)";
  if (!m.web) return `Sbírám ${source}. Hra není propojená s webem.`;
  const w = s.liveWeb || {};
  const web = w.state === "ok" ? "živě na webu" : w.state === "error" ? "živý stav se na web nezapisuje" : "živý stav se chystá na web";
  return `Sbírám ${source} · ${web}.`;
}

function renderWinner(sess, blueTeam, redTeam) {
  const auto = sess.winner && sess.winnerSource === "auto";
  $("winnerQ").textContent = !sess.winner
    ? "Kdo vyhrál? Agent vítěze neodhadl — zvol ho, pak přejdu na další hru."
    : auto
      ? "Agent odhaduje vítěze podle zbořené nexusové věže. Klikni na něj pro potvrzení, nebo zvol druhý tým."
      : "Vítěz potvrzený. Když je špatně, klikni na druhý tým.";
  const btns = [[blueTeam, "BLUE"], [redTeam, "RED"]].map(([name, side]) => {
    const active = sess.winner === name;
    return `<button class="winner-btn ${active ? "active" : ""} side-${side.toLowerCase()}" data-team="${esc(name)}">` +
      `<span class="tag side-${side.toLowerCase()}">${side}</span><b>${esc(name)}</b>` +
      `<small>${active ? (auto ? "odhad — potvrdit" : "vítěz") : ""}</small></button>`;
  }).join("");
  if ($("winnerBtns").dataset.html !== btns) {
    $("winnerBtns").innerHTML = btns;
    $("winnerBtns").dataset.html = btns;
  }
  const sync = sess.webSync || { state: "idle" };
  const text = !sess.meta.web
    ? "Hra není propojená s webem — výsledek zůstává jen v agentovi (Export .TXT v menu ⋯)."
    : (SYNC_TEXT[sync.state] || SYNC_TEXT.idle)(sync);
  $("webSyncText").textContent = text;
  $("webSyncText").className = "web-sync-text " + sync.state;
  $("webResendBtn").hidden = !(sync.state === "error" || sync.state === "rejected");
}

function renderSummary(snap) {
  const k = snap.teamKills || { BLUE: 0, RED: 0 };
  $("blueKills").textContent = k.BLUE;
  $("redKills").textContent = k.RED;
  const g = snap.teamGold || {};
  const gold = $("goldDiff");
  if (g.BLUE == null || g.RED == null) {
    gold.textContent = "—";
    gold.className = "";
  } else {
    const d = g.BLUE - g.RED;
    gold.textContent = d === 0 ? "±0" : `${d > 0 ? "Blue" : "Red"} +${fmtK(Math.abs(d))}`;
    gold.className = d > 0 ? "s-blue" : d < 0 ? "s-red" : "";
  }
  const t = snap.objectives && snap.objectives.teams;
  const pair = (key) => (t ? `${t.BLUE[key]} : ${t.RED[key]}` : "0 : 0");
  $("dragons").textContent = pair("dragons");
  $("barons").textContent = pair("barons");
  $("towers").textContent = pair("towers");
  const soul = t && (t.BLUE.dragonSoul ? "Blue" : t.RED.dragonSoul ? "Red" : null);
  $("dragons").title = t ? dragonTitle(t) + (soul ? ` · duše: ${soul}` : "") : "";
}

const DRAGON_LABELS = {
  fire: "Infernal", earth: "Mountain", water: "Ocean", air: "Cloud",
  hextech: "Hextech", chemtech: "Chemtech", elder: "Elder",
};
function dragonTitle(t) {
  const list = (team) => Object.entries(team.dragonTypes)
    .filter(([, n]) => n > 0)
    .map(([type, n]) => (n > 1 ? `${n}× ` : "") + DRAGON_LABELS[type]).join(", ") || "—";
  return `Blue: ${list(t.BLUE)} · Red: ${list(t.RED)}`;
}

function renderRows(tbodyId, players, lane14) {
  const tb = $(tbodyId);
  tb.innerHTML = "";
  for (const p of players) {
    const tr = document.createElement("tr");
    const icon = champIcon(p.championName);
    const letter = esc((p.championName || "?")[0]);
    const ava = `<span class="ava" data-l="${letter}">${icon ? `<img src="${icon}" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>`;
    const items = (p.items || []).slice(0, 7).map((id) => {
      const src = itemIcon(id);
      return src ? `<img class="item-mini" src="${src}" alt="Item ${id}" title="Item ${id}" loading="lazy">` : "";
    }).join("");
    tr.innerHTML =
      `<td class="p-cell"><div class="p-wrap">${ava}<span class="p-id"><span class="p-name">${esc(p.name)}</span><span class="p-champ">${esc(p.championName)}${p.soloKills ? ` · ${p.soloKills} solo` : ""}</span></span></div></td>` +
      `<td class="c-lvl">${p.level}</td>` +
      `<td class="c-kda"><b>${p.kills}</b><span class="sep">/</span><span class="d">${p.deaths}</span><span class="sep">/</span><b>${p.assists}</b></td>` +
      `<td>${p.cs}</td><td class="c-gold">${p.gold == null ? "—" : fmtGold(p.gold)}${laneDiff(p, lane14)}</td>` +
      `<td><span class="item-list">${items || "—"}</span></td>`;
    tb.appendChild(tr);
  }
}

// --- formátování ------------------------------------------------------------
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
function fmtClock(sec) {
  if (!sec && sec !== 0) return "--:--";
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
function fmtGold(gold) { return Math.round(Number(gold)).toLocaleString("cs-CZ"); }
function fmtK(n) { return n >= 1000 ? `${(n / 1000).toFixed(1).replace(".", ",")}k` : String(Math.round(n)); }
function fmtDiff(diff) {
  const n = Math.round(diff);
  return (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n).toLocaleString("cs-CZ");
}
/** Rozdíl goldu proti protivníkovi na stejné roli ve 14. minutě (jakmile je zaznamenaný). */
function laneDiff(p, lane14) {
  if (!lane14 || p.slot == null) return "";
  const row = lane14.players.find((l) => l.side === p.side && l.slot === p.slot);
  if (!row || row.goldDiff == null) return "";
  const d = row.goldDiff;
  return `<span class="gdiff ${d > 0 ? "pos" : d < 0 ? "neg" : ""}" title="Rozdíl goldu proti protivníkovi na stejné roli ve 14. minutě">@14 ${fmtDiff(d)}</span>`;
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// --- overlaye ---------------------------------------------------------------
const overlayUrl = (name) => `${location.origin}/overlay/${name}`;

function overlayMock(name) {
  const cb = document.querySelector(`.mock-cb[data-mock="${name}"]`);
  return cb ? cb.checked : false;
}

// Náhled: přidá ?mock=1, pokud je zaškrtnutý přepínač (overlay pak běží na mock
// datech bez hry / LeagueBroadcastu). Kopírovaná OBS URL zůstává bez parametru.
function loadOverlay(name) {
  const iframe = document.querySelector(`iframe[data-lazy="${name}"]`);
  if (!iframe) return;
  const want = overlayUrl(name) + "/" + (overlayMock(name) ? "?mock=1" : "");
  if (iframe.getAttribute("data-src") !== want) {
    iframe.setAttribute("data-src", want);
    iframe.src = want;
  }
}

function showOverlays(show) {
  $("overlaysView").hidden = !show;
  $("liveView").hidden = show;
  if (show) loadOverlay("ingame");
}
$("overlaysBack").onclick = () => showOverlays(false);
document.querySelectorAll(".mock-cb").forEach((cb) => (cb.onchange = () => loadOverlay(cb.dataset.mock)));

$("urlIngame").textContent = overlayUrl("ingame");
document.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => {
  const text = $(b.dataset.copy).textContent;
  try { await navigator.clipboard.writeText(text); toast("URL zkopírováno", "ok"); }
  catch { toast("Kopírování selhalo", "err"); }
}));
document.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => window.open($(b.dataset.open).textContent, "_blank")));

// --- verze aplikace (roh) ---------------------------------------------------
fetch("/api/meta").then((r) => r.json()).then((m) => {
  const el = $("versionBadge");
  el.textContent = `v${m.version}`;
  el.hidden = false;
}).catch(() => {});

// --- auto-update okno (přes Electron preload) -------------------------------
$("updLater").onclick = () => { $("updateModal").hidden = true; };
$("updInstall").onclick = () => { if (window.electronAPI) window.electronAPI.installUpdate(); };

if (window.electronAPI && window.electronAPI.onUpdate) {
  window.electronAPI.onUpdate((u) => {
    const modal = $("updateModal"), title = $("updTitle"), body = $("updBody");
    const notes = $("updNotes"), install = $("updInstall");
    if (!u || u.state === "none" || u.state === "error") { modal.hidden = true; return; }
    modal.hidden = false;
    notes.hidden = !u.notes;
    notes.textContent = u.notes || "";
    if (u.state === "available") {
      title.textContent = `Stahuje se verze ${u.version}`;
      body.textContent = "Nová verze se stahuje na pozadí. Až bude připravená, můžeš appku restartovat.";
      install.disabled = true;
    } else if (u.state === "downloaded") {
      title.textContent = `Verze ${u.version} je připravená`;
      body.textContent = "Aktualizace je stažená. Tlačítkem se aplikace zavře, sama se aktualizuje a za pár sekund se znovu otevře — bez průvodce instalací.";
      install.disabled = false;
    }
  });
}

// --- start ------------------------------------------------------------------
// Uložená produkce se použije hned; okno výběru se ukáže vždy, ať ji produkce potvrdí.
if (production) applyProduction(production);
else $("prodSwitch").textContent = "Vybrat produkci";
openProdModal();

connectWs();
initDdragon().then(() => { if (state) render(state); }).catch(() => { /* offline → monogramy */ });
