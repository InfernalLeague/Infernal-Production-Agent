// Infernal Production Agent – dashboard (Fáze 1A)
const $ = (id) => document.getElementById(id);

let state = null;
let currentWinner = "";

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
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "state") render(msg.data);
  };
  ws.onclose = () => setTimeout(connectWs, 1500); // reconnect
}

// --- akce -------------------------------------------------------------------
async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

// --- New Game modal ---------------------------------------------------------
function openNewGame() { $("newGameModal").hidden = false; }
function closeNewGame() { $("newGameModal").hidden = true; }
$("openNewGame").onclick = openNewGame;
$("emptyCreate").onclick = openNewGame;
$("closeNewGame").onclick = closeNewGame;
$("newGameModal").addEventListener("click", (e) => { if (e.target.id === "newGameModal") closeNewGame(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeNewGame(); });

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
  });
  if (ok) {
    closeNewGame();
    toast(`Hra založena: ${data.meta.localGameId}`, "ok");
  } else {
    hint.textContent = data.error || "Chyba při zakládání hry.";
    hint.classList.add("err");
  }
};

$("endBtn").onclick = () => post("/api/game/end");

$("exportBtn").onclick = async () => {
  const hint = $("exportHint");
  hint.className = "hint";
  const { ok, data } = await post("/api/export/txt");
  if (ok) {
    hint.textContent = data.filePath || "";
    hint.classList.add("ok");
    toast(`✓ Exportováno: ${data.filename}`, "ok");
    refreshGames();
  } else {
    hint.textContent = data.error || "Export selhal.";
    hint.classList.add("err");
    toast(data.error || "Export selhal.", "err");
  }
};

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
function statusValue(el, text, cls) {
  el.textContent = text;
  el.parentElement.className = "status-value " + (cls || "");
}

function render(s) {
  state = s;
  $("mockBadge").hidden = !s.mock;
  renderDashRunning(s);

  statusValue($("stClient"), s.leagueClient ? "CONNECTED" : "NOT RUNNING", s.leagueClient ? "ok" : "bad");
  statusValue($("stGame"), s.leagueGame ? "RUNNING" : "NOT RUNNING", s.leagueGame ? "ok" : "bad");

  const sess = s.session;
  const apiLive = s.liveApiReachable && sess && sess.meta.status === "LIVE";
  if (apiLive) statusValue($("stApi"), "LIVE", "live");
  else if (s.liveApiReachable) statusValue($("stApi"), "RESPONDING", "ok");
  else statusValue($("stApi"), sess ? "WAITING" : "—", sess ? "warn" : "bad");

  const broadcast = s.leagueBroadcast || {};
  if (!broadcast.enabled) statusValue($("stBroadcast"), s.mock ? "MOCK DISABLED" : "DISABLED", "bad");
  else if (broadcast.connected) statusValue($("stBroadcast"), broadcast.gameState || "CONNECTED", broadcast.gameState === "Running" ? "live" : "ok");
  else statusValue($("stBroadcast"), "RECONNECTING", "warn");

  const delivery = s.liveDelivery || { mode: "local-only", pending: 0 };
  if (delivery.mode === "remote") {
    statusValue($("stDelivery"), delivery.pending ? `OUTBOX ${delivery.pending}` : "REMOTE READY", delivery.pending ? "warn" : "ok");
  } else {
    statusValue($("stDelivery"), "LOCAL TEST", "ok");
  }

  if (!sess) {
    statusValue($("stCurrent"), "NONE", "bad");
    $("gamePanel").hidden = true;
    $("emptyState").hidden = false;
    return;
  }

  const m = sess.meta;
  statusValue($("stCurrent"), `${m.team1} vs ${m.team2} · G${m.gameNumber}`, "ok");
  $("emptyState").hidden = true;
  $("gamePanel").hidden = false;

  $("mTeam1").textContent = m.team1;
  $("mTeam2").textContent = m.team2;
  $("mGame").textContent = `Game ${m.gameNumber} · ${m.seriesFormat}`;
  $("mId").textContent = m.localGameId;

  const source = $("dataSourceBadge");
  const broadcastFresh = broadcast.connected && broadcast.lastSnapshotAt && Date.now() - broadcast.lastSnapshotAt < 3000;
  source.className = "source-pill " + (broadcastFresh ? "primary" : "fallback");
  source.textContent = broadcastFresh ? "WEBSOCKET · LEAGUEBROADCAST" : (s.mock ? "MOCK DATA" : "FALLBACK · RIOT LIVE API");
  const deliveryNote = $("deliveryNote");
  deliveryNote.className = "delivery-note " + (delivery.mode === "remote" ? "remote" : "");
  deliveryNote.textContent = delivery.mode === "remote"
    ? `Database stream aktivní${delivery.pending ? ` · ${delivery.pending} čeká` : ""}`
    : "Live stream: local test log";

  // fáze badge
  const badge = $("phaseBadge");
  const cls = { WAITING_FOR_GAME: "waiting", LIVE: "live", GAME_ENDED: "ended", EXPORTED: "exported" }[m.status] || "";
  badge.className = "badge " + cls;
  badge.textContent = { WAITING_FOR_GAME: "WAITING FOR GAME", LIVE: "LIVE", GAME_ENDED: "GAME ENDED", EXPORTED: "EXPORTED" }[m.status] || m.status;

  // strany
  const blueTeam = m.team1Side === "BLUE" ? m.team1 : m.team2;
  const redTeam = m.team1Side === "BLUE" ? m.team2 : m.team1;
  $("blueTeamName").textContent = blueTeam;
  $("redTeamName").textContent = redTeam;

  renderWinner(m, sess.winner);
  // Vítěz předvyplněný odhadem po konci hry (poslední zbouraná budova).
  $("winnerAuto").hidden = !(sess.winner && sess.winnerSource === "auto");

  // live tabulky
  const live = sess.live;
  const dur = live ? live.durationSeconds : (sess.finalSnapshot ? sess.finalSnapshot.durationSeconds : 0);
  const clock = $("clock");
  clock.textContent = fmtClock(dur);
  clock.classList.toggle("live", m.status === "LIVE");
  const players = live ? live.players : (sess.finalSnapshot ? sess.finalSnapshot.players : []);
  const kills = live ? live.teamKills : (sess.finalSnapshot ? sess.finalSnapshot.teamKills : { BLUE: 0, RED: 0 });
  const gold = live ? live.teamGold : (sess.finalSnapshot ? sess.finalSnapshot.teamGold : { BLUE: null, RED: null });
  $("blueKills").textContent = kills.BLUE;
  $("redKills").textContent = kills.RED;
  // Gold týmu a rozdíl proti soupeři (kladný = vede).
  const teamGoldText = (own, enemy) =>
    own == null ? "— gold" : `${fmtGold(own)} gold${enemy == null ? "" : ` (${fmtDiff(own - enemy)})`}`;
  $("blueGold").textContent = teamGoldText(gold && gold.BLUE, gold && gold.RED);
  $("redGold").textContent = teamGoldText(gold && gold.RED, gold && gold.BLUE);

  // objektivy (draci podle typu, baroni, heraldi, voidgrubi, věže, inhiby)
  const objectives = live ? live.objectives : (sess.finalSnapshot ? sess.finalSnapshot.objectives : null);
  $("blueObj").textContent = fmtObjectives(objectives && objectives.teams.BLUE);
  $("redObj").textContent = fmtObjectives(objectives && objectives.teams.RED);

  // first blood (jméno + strana), jakmile padne první krev
  const fb = live ? live.firstBlood : (sess.finalSnapshot ? sess.finalSnapshot.firstBlood : null);
  const fbEl = $("firstBlood");
  if (fb) {
    fbEl.hidden = false;
    fbEl.textContent = `🩸 First Blood · ${fb.playerName}`;
    fbEl.classList.toggle("side-blue", fb.side === "BLUE");
    fbEl.classList.toggle("side-red", fb.side === "RED");
  } else {
    fbEl.hidden = true;
  }
  renderRows("blueRows", players.filter((p) => p.side === "BLUE"), players);
  renderRows("redRows", players.filter((p) => p.side === "RED"), players);

  // export tlačítko aktivní, jakmile máme data
  $("exportBtn").disabled = players.length === 0;
}

const DRAGON_LABELS = {
  fire: "Infernal", earth: "Mountain", water: "Ocean", air: "Cloud",
  hextech: "Hextech", chemtech: "Chemtech", elder: "Elder",
};

function fmtObjectives(t) {
  if (!t) return "";
  const dragons = Object.entries(t.dragonTypes)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => (count > 1 ? `${count}× ` : "") + DRAGON_LABELS[type])
    .join(", ");
  const parts = [`🐉 ${t.dragons}${dragons ? ` (${dragons})` : ""}`];
  if (t.dragonSoul) parts.push(`duše ${DRAGON_LABELS[t.dragonSoul]}`);
  parts.push(`Baron ${t.barons}`, `Věže ${t.towers}`);
  return parts.join(" · ");
}

function renderWinner(m, winner) {
  const seg = $("winnerSeg");
  const key = `${m.team1}|${m.team2}`;
  if (seg.dataset.filled !== key) {
    seg.innerHTML = "";
    [m.team1, m.team2].forEach((name) => {
      const b = document.createElement("button");
      b.className = "seg-btn";
      b.textContent = name;
      b.dataset.team = name;
      b.onclick = () => {
        const v = currentWinner === name ? "" : name; // klik na aktivní = zrušit
        post("/api/game/winner", { winner: v });
      };
      seg.appendChild(b);
    });
    seg.dataset.filled = key;
  }
  currentWinner = winner || "";
  [...seg.children].forEach((b) => b.classList.toggle("active", b.dataset.team === currentWinner));
}

function renderRows(tbodyId, players, all) {
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
      `<td class="p-cell"><div class="p-wrap">${ava}<span class="p-id"><span class="p-name">${esc(p.name)}</span><span class="p-champ">${esc(p.championName)}</span></span></div></td>` +
      `<td class="c-lvl">${p.level}</td>` +
      `<td class="c-kda"><b>${p.kills}</b><span class="sep">/</span><span class="d">${p.deaths}</span><span class="sep">/</span><b>${p.assists}</b></td>` +
      `<td>${p.cs}</td><td class="c-gold">${p.gold == null ? "—" : fmtGold(p.gold)}${laneDiff(p, all)}</td>` +
      `<td><span class="item-list">${items || "—"}</span></td>`;
    tb.appendChild(tr);
  }
}

function kdaRatio(k, d, a) {
  if (d === 0) return (k + a) > 0 ? { text: "Perfect", cls: "perf" } : { text: "0.0", cls: "" };
  const r = (k + a) / d;
  return { text: r.toFixed(1), cls: r >= 4 ? "good" : "" };
}

function fmtClock(sec) {
  if (!sec && sec !== 0) return "--:--";
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
function fmtGold(gold) { return Math.round(Number(gold)).toLocaleString("cs-CZ"); }
function fmtDiff(diff) {
  const n = Math.round(diff);
  return (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n).toLocaleString("cs-CZ");
}
/** Rozdíl goldu proti protivníkovi na stejné roli (stejné pořadí v týmu). */
function laneDiff(p, all) {
  if (p.gold == null || p.slot == null || !all) return "";
  const opp = all.find((o) => o.side !== p.side && o.slot === p.slot);
  if (!opp || opp.gold == null) return "";
  const d = p.gold - opp.gold;
  return `<span class="gdiff ${d > 0 ? "pos" : d < 0 ? "neg" : ""}">${fmtDiff(d)}</span>`;
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// --- navigace (taby) --------------------------------------------------------
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

document.querySelectorAll(".mock-cb").forEach((cb) => (cb.onchange = () => loadOverlay(cb.dataset.mock)));

function activeSub() {
  const b = document.querySelector(".sub-tab.active");
  return b ? b.dataset.sub : "ingame";
}

function switchTab(tab) {
  document.querySelectorAll(".nav-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tabview").forEach((v) => v.classList.toggle("active", v.dataset.view === tab));
  if (tab === "overlays") loadOverlay(activeSub()); // načti iframe až při zobrazení
  if (tab === "dashboard") refreshGames();
}

function switchSub(sub) {
  document.querySelectorAll(".sub-tab").forEach((b) => b.classList.toggle("active", b.dataset.sub === sub));
  document.querySelectorAll(".subview").forEach((v) => v.classList.toggle("active", v.dataset.subview === sub));
  loadOverlay(sub);
}

document.querySelectorAll(".nav-tab").forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));
document.querySelectorAll(".sub-tab").forEach((b) => (b.onclick = () => switchSub(b.dataset.sub)));

// URL overlayů + tlačítka kopírovat / otevřít
$("urlIngame").textContent = overlayUrl("ingame");
document.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => {
  const text = $(b.dataset.copy).textContent;
  try { await navigator.clipboard.writeText(text); toast("URL zkopírováno", "ok"); }
  catch { toast("Kopírování selhalo", "err"); }
}));
document.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => window.open($(b.dataset.open).textContent, "_blank")));

// --- produkce (Twitch / Kick) + theme --------------------------------------
const PRODUCTIONS = {
  twitch: { label: "Twitch", short: "Twitch", production: "Twitch" },
  kick: { label: "Kick", short: "Kick", production: "Kick" },
};
let production = localStorage.getItem("il_production");

function applyProduction(p) {
  if (!PRODUCTIONS[p]) return;
  production = p;
  localStorage.setItem("il_production", p);
  document.body.dataset.prod = p;
  $("prodSwitch").textContent = PRODUCTIONS[p].label;
  // předvyplní pole Production v New Game
  const prodInput = $("production");
  if (prodInput) {
    prodInput.value = PRODUCTIONS[p].production;
  }
}

function openProdModal() { $("prodModal").hidden = false; }
function closeProdModal() { $("prodModal").hidden = true; }

document.querySelectorAll(".prod-choice").forEach((b) => (b.onclick = () => {
  applyProduction(b.dataset.prod);
  closeProdModal();
  toast(`Produkce: ${PRODUCTIONS[b.dataset.prod].short}`, "ok");
}));
$("prodSwitch").onclick = openProdModal;
$("prodModal").addEventListener("click", (e) => { if (e.target.id === "prodModal" && production) closeProdModal(); });

// při startu: aplikuj uložený theme (aby UI nebylo bez barvy) a vždy ukaž výběr
if (production) applyProduction(production);
else $("prodSwitch").textContent = "Vybrat produkci";
openProdModal();

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
      body.textContent = "Aktualizace je stažená. Restartuj aplikaci pro dokončení instalace.";
      install.disabled = false;
    }
  });
}

// --- Dashboard --------------------------------------------------------------
function renderDashRunning(s) {
  const el = $("dashRunningBody");
  if (!el) return;
  const sess = s && s.session;
  const live = sess && (sess.meta.status === "LIVE" || sess.meta.status === "WAITING_FOR_GAME");
  if (!sess || !live) {
    el.innerHTML = '<span class="dash-none">Žádná hra právě neběží.</span>';
    return;
  }
  const m = sess.meta;
  const dur = sess.live ? sess.live.durationSeconds : 0;
  const phase = m.status === "LIVE" ? "LIVE" : "WAITING";
  el.innerHTML =
    `<div class="dash-run-match">${esc(m.team1)} <span class="vs">vs</span> ${esc(m.team2)}</div>` +
    `<div class="dash-run-meta"><span class="badge ${m.status === "LIVE" ? "live" : "waiting"}">${phase}</span>` +
    `<span>Game ${m.gameNumber} · ${esc(m.seriesFormat)}</span>` +
    (m.status === "LIVE" ? `<span class="clock live">${fmtClock(dur)}</span>` : "") + `</div>`;
}

const todayISO = new Date().toISOString().slice(0, 10);

async function refreshGames() {
  try {
    const games = await fetch("/api/games").then((r) => r.json());
    const today = games.filter((g) => g.date === todayISO);
    const played = today.filter((g) => g.ended);
    fillDashList("dashPlayed", played.map((g) => ({
      title: g.title,
      sub: (g.gameNumber ? `Game ${g.gameNumber}` : "") + (g.winner ? ` · 🏆 ${g.winner}` : (g.exported ? "" : " · neexportováno")),
      cls: g.exported ? "ok" : "",
    })), "Zatím žádná dohraná hra dnes.");
  } catch {
    fillDashList("dashPlayed", [], "Seznam se nepodařilo načíst.");
  }
}

function fillDashList(id, items, emptyText) {
  const el = $(id);
  if (!el) return;
  if (!items.length) { el.innerHTML = `<span class="dash-none">${esc(emptyText)}</span>`; return; }
  el.innerHTML = items.map((it) =>
    `<div class="dash-item ${it.cls || ""}"><span class="dash-item-t">${esc(it.title)}</span>` +
    (it.sub ? `<span class="dash-item-s">${esc(it.sub)}</span>` : "") + `</div>`,
  ).join("");
}

// datum + placeholdery pro web-napojení
$("dashDate").textContent = new Date().toLocaleDateString("cs-CZ", {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
});
fillDashList("dashScheduled", [], "Rozpis se načte z webu (přijde později).");
fillDashList("dashUpcoming", [], "Zatím nic — napojí se na rozpis z webu.");
refreshGames();

connectWs();
initDdragon().then(() => { if (state) render(state); }).catch(() => { /* offline → monogramy */ });
