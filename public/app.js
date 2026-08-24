// Infernal Production Agent – dashboard (Fáze 1A)
const $ = (id) => document.getElementById(id);

let state = null;
let currentWinner = "";
let didAutoOpen = false;

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

  statusValue($("stClient"), s.leagueClient ? "CONNECTED" : "NOT RUNNING", s.leagueClient ? "ok" : "bad");
  statusValue($("stGame"), s.leagueGame ? "RUNNING" : "NOT RUNNING", s.leagueGame ? "ok" : "bad");

  const sess = s.session;
  const apiLive = s.liveApiReachable && sess && sess.meta.status === "LIVE";
  if (apiLive) statusValue($("stApi"), "LIVE", "live");
  else if (s.liveApiReachable) statusValue($("stApi"), "RESPONDING", "ok");
  else statusValue($("stApi"), sess ? "WAITING" : "—", sess ? "warn" : "bad");

  if (!sess) {
    statusValue($("stCurrent"), "NONE", "bad");
    $("gamePanel").hidden = true;
    $("emptyState").hidden = false;
    if (!didAutoOpen) { openNewGame(); didAutoOpen = true; }
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

  renderDraft(sess.draft, blueTeam, redTeam);
  renderWinner(m, sess.winner);

  // live tabulky
  const live = sess.live;
  const dur = live ? live.durationSeconds : (sess.finalSnapshot ? sess.finalSnapshot.durationSeconds : 0);
  const clock = $("clock");
  clock.textContent = fmtClock(dur);
  clock.classList.toggle("live", m.status === "LIVE");
  const players = live ? live.players : (sess.finalSnapshot ? sess.finalSnapshot.players : []);
  const kills = live ? live.teamKills : (sess.finalSnapshot ? sess.finalSnapshot.teamKills : { BLUE: 0, RED: 0 });
  $("blueKills").textContent = kills.BLUE;
  $("redKills").textContent = kills.RED;

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
  renderRows("blueRows", players.filter((p) => p.side === "BLUE"));
  renderRows("redRows", players.filter((p) => p.side === "RED"));

  // export tlačítko aktivní, jakmile máme data
  $("exportBtn").disabled = players.length === 0;
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

function renderDraft(draft, blueTeam, redTeam) {
  const panel = $("draftPanel");
  if (!draft || (draft.bans.length === 0 && draft.picks.length === 0)) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  $("draftBlueName").textContent = `BLUE · ${blueTeam}`;
  $("draftRedName").textContent = `RED · ${redTeam}`;

  const bans = (side) => draft.bans.filter((b) => b.side === side).sort((a, b) => a.order - b.order);
  const picks = (side) => draft.picks.filter((p) => p.side === side).sort((a, b) => a.order - b.order);

  fillChips("blueBans", bans("BLUE").map((b) => ({ text: b.championName, cls: "ban" })));
  fillChips("redBans", bans("RED").map((b) => ({ text: b.championName, cls: "ban" })));
  fillChips("bluePicks", picks("BLUE").map((p) => ({ ord: p.order, text: p.championName, pos: p.position })));
  fillChips("redPicks", picks("RED").map((p) => ({ ord: p.order, text: p.championName, pos: p.position })));
}

function fillChips(id, items) {
  const el = $(id);
  el.innerHTML = "";
  for (const it of items) {
    const span = document.createElement("span");
    span.className = "chip" + (it.cls ? " " + it.cls : "");
    const icon = champIcon(it.text);
    const img = icon ? `<img class="chip-ico" src="${icon}" alt="" loading="lazy" onerror="this.remove()">` : "";
    const ord = it.ord ? `<span class="ord">${it.ord}</span>` : "";
    const pos = it.pos ? `<span class="pos">${esc(it.pos)}</span>` : "";
    span.innerHTML = `${ord}${img}<span class="chip-name">${esc(it.text)}</span>${pos}`;
    el.appendChild(span);
  }
  if (items.length === 0) el.innerHTML = '<span class="chip empty">—</span>';
}

function renderRows(tbodyId, players) {
  const tb = $(tbodyId);
  tb.innerHTML = "";
  for (const p of players) {
    const tr = document.createElement("tr");
    const icon = champIcon(p.championName);
    const letter = esc((p.championName || "?")[0]);
    const ava = `<span class="ava" data-l="${letter}">${icon ? `<img src="${icon}" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>`;
    const ratio = kdaRatio(p.kills, p.deaths, p.assists);
    const penta = p.pentakills > 0
      ? `<span class="penta">${p.pentakills}★</span>`
      : `<span class="none">–</span>`;
    tr.innerHTML =
      `<td class="p-cell"><div class="p-wrap">${ava}<span class="p-id"><span class="p-name">${esc(p.name)}</span><span class="p-champ">${esc(p.championName)}</span></span></div></td>` +
      `<td class="c-lvl">${p.level}</td>` +
      `<td class="c-kda"><b>${p.kills}</b><span class="sep">/</span><span class="d">${p.deaths}</span><span class="sep">/</span><b>${p.assists}</b></td>` +
      `<td class="c-ratio ${ratio.cls}">${ratio.text}</td>` +
      `<td>${p.cs}</td><td>${p.vision}</td><td class="c-p">${penta}</td>`;
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
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

connectWs();
initDdragon().then(() => { if (state) render(state); }).catch(() => { /* offline → monogramy */ });
