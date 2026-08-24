<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useClient } from '@/client'
import { useIngameSelector, useTabPlayers } from '@/composables/useIngame'
import { useLiveConfig } from '@/composables/useLiveConfig'
import { getSortedInventory, getTrinket, getRoleQuest } from '@bluebottle_gg/league-broadcast-client'

// ── Constants ──────────────────────────────────────────────────────────────
// Rune tree/style IDs (Precision, Domination, Sorcery, Inspiration, Resolve)
const STYLE_IDS = new Set([8000, 8100, 8200, 8300, 8400])

// Item IDs that show a live stack counter over the item icon
// (any item Riot marks with stacking uniques worth surfacing in broadcast).
const STACK_ITEM_IDS = new Set([
  1082, // Dark Seal
  3041, // Mejai's Soulstealer
  // Tear line — surface accumulated bonus mana (charges toward the upgrade).
  3070, // Tear of the Goddess
  3003, // Archangel's Staff
  3004, // Manamune
  3119, // Winter's Approach
  2526, // Whispering Circlet
  // Minion / gold-quest items — stacks count toward the gold payout.
  1083, // Cull
  // Health-stacking uniques — stacks are permanent bonus HP gained.
  3084, // Heartsteel
  // Jungle companion pets — stacks are treats/takedowns toward evolution.
  1101, // Scorchclaw Pup
  1102, // Gustwalker Hatchling
  1103, // Mosstomper Seedling
])

// Ornn Masterwork upgrade detection.
// Riot's Ornn masterwork items sit in the 7000-7099 range. BlueBottle also
// populates `modifierUrl` on the itemWithAsset when a masterwork variant is
// equipped — we accept either signal to be robust across patches.
function isOrnnUpgrade(id: number, modifierUrl?: string | null): boolean {
  return (id >= 7000 && id <= 7099) || Boolean(modifierUrl)
}

// BlueBottle ResourceType enum → resource bar style identifier.
// Source: @bluebottle_gg/league-broadcast-client index.d.ts
const RESOURCE_BY_NUM: Record<number, string> = {
  0:   'mana',       // Mana         — most champions
  1:   'energy',     // Energy        — Akali, Lee Sin, Kennen, Shen, Zed
  2:   'none',       // None          — Garen, Katarina, Riven, Aatrox…
  3:   'shield',     // Shield        — Blitzcrank
  4:   'fury',       // Battle Fury   — Tryndamere
  5:   'fury',       // Dragon Fury   — Shyvana
  6:   'rage',       // Rage          — Renekton
  7:   'heat',       // Heat          — Rumble
  8:   'rage',       // Gnar Fury     — Gnar (confirmed type=8)
  9:   'ferocity',   // Ferocity      — Rengar
  10:  'none',       // Bloodwell     — Aatrox passive (not a traditional bar)
  11:  'flow',       // Wind/Flow     — Yasuo, Yone (confirmed type=11)
  12:  'ammo',       // Ammo          — Jhin, Graves
  13:  'moonlight',  // Moonlight     — Aphelios
  14:  'none',       // Other
  255: 'none',       // Unknown
}

// Manual alias overrides — only needed if BlueBottle sends wrong/unexpected type.
const CHAMP_RESOURCE: Record<string, string> = {}
// Player slot → role name (used for quest slot placeholder icon)
const ROLE_NAMES = ['top', 'jungle', 'mid', 'adc', 'support'] as const
// Secondary rune tree icons — CDragon direct URLs keyed by tree folder name.
// BlueBottle REST never includes style-perk IDs for custom overlays, so we extract
// the tree name by regex from the secondary individual rune's iconPath instead.
// CDragon paths are lowercase; individual rune icon (always in BB cache) is the fallback.
const SECONDARY_TREE_URLS: Record<string, string> = {
  Precision:   'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/styles/7201_precision.png',
  Domination:  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/styles/7200_domination.png',
  Sorcery:     'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/styles/7202_sorcery.png',
  Inspiration: 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/styles/7203_whimsy.png',
  Resolve:     'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/styles/7204_resolve.png',
}

// ── URL resolver ───────────────────────────────────────────────────────────
// BlueBottle sends asset paths as cache-relative strings (e.g. "champion/Garen.png").
// getCacheUrl() turns them into full http://localhost:58869/cache/... URLs.
// Absolute URLs (starting with "http") are returned unchanged.
const client = useClient()
const resolveUrl = (path?: string | null): string =>
  path ? client.getCacheUrl(path) : ''

// ── CDragon ult icon cache ─────────────────────────────────────────────────
// Fetches the correct R spell icon for each champion from CDragon's champion
// JSON (contains the real abilityIconPath). Reactive so computed player lists
// automatically recompute when new icons arrive.
const _cdUltIcons = reactive<Record<string, string>>({})
let   _cdSummaryP: Promise<any[] | null> | null = null

function getCdSummary(): Promise<any[] | null> {
  if (!_cdSummaryP) {
    _cdSummaryP = fetch(
      'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json',
    ).then(r => r.json()).catch(() => null)
  }
  return _cdSummaryP
}

async function prefetchUltIcon(alias: string): Promise<void> {
  const key = alias.toLowerCase()
  if (!key || key in _cdUltIcons) return
  _cdUltIcons[key] = '' // claim slot — prevents duplicate in-flight requests
  try {
    const summary = await getCdSummary()
    const entry   = summary?.find((c: any) => (c.alias ?? '').toLowerCase() === key)
    if (!entry) { console.warn('[overlay] CDragon: champion not in summary:', alias); return }
    const data    = await fetch(
      `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champions/${entry.id}.json`,
    ).then(r => r.json())
    const spells: any[] = data.spells ?? []
    // R is always the 4th spell (index 3); spellKey is lowercase 'r' in CDragon JSON
    const rSpell   = spells[3] ?? spells.find((s: any) => s.spellKey === 'r') ?? null
    const iconPath = rSpell?.abilityIconPath ?? null
    if (!iconPath) { console.warn('[overlay] CDragon: no R iconPath for', alias); return }
    const url = 'https://raw.communitydragon.org/latest/' +
      (iconPath as string)
        .toLowerCase()
        .replace('/lol-game-data/assets/', 'plugins/rcp-be-lol-game-data/global/default/')
    _cdUltIcons[key] = url
    console.info('[overlay] CDragon ult icon ready:', alias, '→', url)
  } catch (err) {
    console.warn('[overlay] CDragon ult icon fetch failed:', alias, err)
    delete _cdUltIcons[key] // allow retry
  }
}

// Tracks which champion aliases had their secondary tree CDragon URL fail.
// Reactive so Vue can swap to the individual rune fallback without DOM hacks.
const secondaryTreeFailed = reactive<Record<string, boolean>>({})

// ── Data sources ───────────────────────────────────────────────────────────
const gameTime   = useIngameSelector((s) => s.gameData?.gameTime ?? 0, 0)
const sbBottom   = useIngameSelector((s) => s.gameData?.scoreboardBottom ?? null, null)
const scoreboard = useIngameSelector((s) => (s.gameData as any)?.scoreboard ?? null, null)
// tabPlayers: polled via REST every 1 s — contains abilities/perks/resource/XP
// but NOT health (BlueBottle REST returns health: {} for custom overlays).
const tabPlayers = useTabPlayers()
// wsTabs: BlueBottle WebSocket snapshot — contains FULL tabPlayer data including
// health.current / health.max, but only when BlueBottle's own ChampionTabs
// overlay is active. Used as primary source for health; REST as fallback for rest.
const wsTabs = useIngameSelector((s) => (s.gameData as any)?.tabs ?? null, null)

// ── Live-game config (Supabase) ─────────────────────────────────────────────
// Operator-configured player names per side, in role order (TOP→SUPPORT).
// These REPLACE the BlueBottle names; live stats are mapped by side + slot index.
const { blue: liveBlue, red: liveRed } = useLiveConfig()

// ── Team-level baron/elder ─────────────────────────────────────────────────
// BlueBottle REST never reliably returns tabPlayer.hasBaron/hasElder for custom overlays.
// Derive it from scoreboard.teams[n].baronPowerPlay / dragonPowerPlay instead.
// teams[0] = blue (Order), teams[1] = red (Chaos).
const blueHasBaron = computed(() => ((scoreboard.value?.teams?.[0] as any)?.baronPowerPlay?.timeEnd  ?? 0) > gameTime.value)
const blueHasElder = computed(() => ((scoreboard.value?.teams?.[0] as any)?.dragonPowerPlay?.timeEnd ?? 0) > gameTime.value)
const redHasBaron  = computed(() => ((scoreboard.value?.teams?.[1] as any)?.baronPowerPlay?.timeEnd  ?? 0) > gameTime.value)
const redHasElder  = computed(() => ((scoreboard.value?.teams?.[1] as any)?.dragonPowerPlay?.timeEnd ?? 0) > gameTime.value)

// ── Per-player buff-loss tracking ─────────────────────────────────────────
// When a player dies while their team has baron/elder, they lose that buff.
// We record which buff's timeEnd they died during. As long as the SAME buff is
// still active (same timeEnd), the player is excluded from colouring.
// When a new baron/elder is obtained (new timeEnd), the block is automatically lifted.
const _lostBaronAt  = reactive<Record<string, number>>({})   // alias → timeEnd of the baron lost
const _lostElderAt  = reactive<Record<string, number>>({})
const _buffPrevRA   = new Map<string, number>()              // alias → previous respawnAt

// Track previous buff timeEnd per team to detect new baron/elder acquisitions.
// Needed to mark players who were ALREADY dead when the baron/elder was killed —
// those players never trigger the alive→dead transition, so we check separately.
let _prevBaronEnd = [0, 0]
let _prevElderEnd = [0, 0]

watch([sbBottom, scoreboard, gameTime], () => {
  const gt    = gameTime.value
  const sb    = sbBottom.value as any
  const sc    = scoreboard.value as any
  const teams = [
    {
      players:   sb?.teams?.[0]?.players  ?? [],
      baronEnd:  sc?.teams?.[0]?.baronPowerPlay?.timeEnd  ?? 0,
      elderEnd:  sc?.teams?.[0]?.dragonPowerPlay?.timeEnd ?? 0,
    },
    {
      players:   sb?.teams?.[1]?.players  ?? [],
      baronEnd:  sc?.teams?.[1]?.baronPowerPlay?.timeEnd  ?? 0,
      elderEnd:  sc?.teams?.[1]?.dragonPowerPlay?.timeEnd ?? 0,
    },
  ]

  for (let idx = 0; idx < teams.length; idx++) {
    const { players, baronEnd, elderEnd } = teams[idx]
    // A truly NEW buff: timeEnd changed to a different future value
    const newBaron = baronEnd > gt && baronEnd !== _prevBaronEnd[idx]
    const newElder = elderEnd > gt && elderEnd !== _prevElderEnd[idx]

    for (const p of players) {
      const alias  = (p.champion?.alias ?? '').toLowerCase()
      if (!alias) continue
      const prevRA = _buffPrevRA.get(alias) ?? 0
      const currRA = p.respawnAt ?? 0
      const isDead = currRA > gt

      // Case 1: Transition alive → dead while buff is active
      if ((prevRA === 0 || prevRA <= gt) && isDead) {
        if (baronEnd > gt) _lostBaronAt[alias] = baronEnd
        if (elderEnd > gt) _lostElderAt[alias] = elderEnd
      }

      // Case 2: New buff obtained while player is ALREADY dead
      // They didn't have the buff when it was earned — mark them excluded
      if (isDead) {
        if (newBaron) _lostBaronAt[alias] = baronEnd
        if (newElder) _lostElderAt[alias] = elderEnd
      }

      _buffPrevRA.set(alias, currRA)
    }

    _prevBaronEnd[idx] = baronEnd
    _prevElderEnd[idx] = elderEnd
  }
}, { immediate: false })

// ── Per-player normaliser ──────────────────────────────────────────────────
// wsTabPlayer: from gameData.tabs (WebSocket) — has health.current/max when BlueBottle's
//              own ChampionTabs overlay is active. Used as primary HP source.
// tabPlayer:   from REST poll — has abilities/perks/resource/XP but health: {} always.
// teamHasBaron/teamHasElder: derived from scoreboard powerPlay — reliable fallback.
// teamBaronEnd/teamElderEnd: the timeEnd of the current buff, used to detect
//   whether a player who died during it has since been "cleared" by a new kill.
function normPlayer(sbPlayer: any, tabPlayer: any, wsTabPlayer: any, gt: number, playerIndex: number, teamHasBaron = false, teamHasElder = false, teamBaronEnd = 0, teamElderEnd = 0, configName = ''): any {
  if (!sbPlayer) return null

  const role = ROLE_NAMES[playerIndex] ?? 'top'

  // Cooldown helper for items/trinkets (readyAt & maxCooldown from itemWithAsset)
  function itemCd(item: any): any {
    if (!item?.assetUrl) return null
    const remaining = Math.max(0, (item.readyAt ?? 0) - gt)
    const total     = item.maxCooldown ?? 0
    const ready     = remaining <= 0 || total <= 0
    const cdPct     = ready ? 100 : Math.round((1 - remaining / total) * 100)
    const id        = item.id ?? 0
    const rawStacks = item.stacks ?? 0
    return {
      imageUrl: resolveUrl(item.assetUrl),
      ready,
      cdPct,
      remaining,   // used by the quest slot to show the quest-teleport countdown
      id,
      isOrnn: isOrnnUpgrade(id, item.modifierUrl),
      // Only surface stacks for items where the count is meaningful to viewers.
      stacks: STACK_ITEM_IDS.has(id) && rawStacks > 0 ? rawStacks : null,
    }
  }

  // Cooldown helper for summoner spells (readyAt & totalCooldown from ingameAbilityInfo)
  function spellCd(ab: any): any {
    if (!ab?.assets?.iconAsset) return null
    const remaining = Math.max(0, (ab.readyAt ?? 0) - gt)
    const total     = ab.totalCooldown ?? 0
    const ready     = remaining <= 0
    const cdPct     = ready ? 100 : total > 0 ? Math.round((1 - remaining / total) * 100) : 0
    return { imageUrl: resolveUrl(ab.assets.iconAsset), ready, cdPct, remaining }
  }

  // Champion icon — prefer sbPlayer.champion, fall back to tabPlayer.championAssets
  const champData = sbPlayer.champion ?? tabPlayer?.championAssets
  const champion = champData
    ? { name: champData.name ?? '', alias: (champData.alias ?? '').toLowerCase(), imageUrl: resolveUrl(champData.squareImg) }
    : null

  // Items with cooldown state; reverse so highest-value is closest to center
  const inv   = getSortedInventory(sbPlayer)
  const items = [...inv].reverse().map(itemCd)

  const trinket = itemCd(getTrinket(sbPlayer))

  // getRoleQuest checks slot 8 only.
  // Slot 7 is used by BlueBottle for Control Ward (support) and free Boots (ADC)
  // when a player places those items in the role-quest position instead of
  // a standard quest item. We fall back to slot 7 so the image still shows.
  const rawQuest =
    getRoleQuest(sbPlayer) ??
    sbPlayer.items?.find((item: any) => item.slot === 7 && item.assetUrl)
  // itemCd surfaces the quest item's own cooldown. For toplaners the completed
  // lane quest grants a Teleport (empowered if they already run TP) in this slot;
  // its readyAt/maxCooldown then drive the countdown ring like any active item.
  // Support (ward) / ADC (boots) quest items have no active CD → no ring.
  const roleQuestItem = itemCd(rawQuest)

  // HP / mana / XP
  // HP: wsTabPlayer (WebSocket gameData.tabs) is primary — has health when BlueBottle's
  //     ChampionTabs overlay is active. REST tabPlayer.health is always {} → 0 fallback.
  const hp      = wsTabPlayer?.health?.current ?? tabPlayer?.health?.current ?? 0
  const maxHp   = wsTabPlayer?.health?.max     ?? tabPlayer?.health?.max     ?? 0
  const mana    = tabPlayer?.resource?.current  ?? 0
  const maxMana = tabPlayer?.resource?.max      ?? 0
  // XP: experience.current is CUMULATIVE xp; previousLevel is threshold for current level;
  // nextLevel is threshold for the next level — so progress = (current - prev) / (next - prev).
  const xpCur  = tabPlayer?.experience?.current       ?? 0
  const xpPrev = tabPlayer?.experience?.previousLevel ?? 0
  const xpNext = tabPlayer?.experience?.nextLevel     ?? 0
  const xp     = xpCur  - xpPrev
  const maxXp  = xpNext - xpPrev

  // Abilities: REST (tabPlayer) is the reliable base — has assets.iconAsset for D/F spells.
  // wsTabPlayer (ChampionTabs WS) is checked separately for the R ult icon only, as it
  // may populate iconAsset for R while the REST endpoint always omits it.
  const restAbilities: any[] = tabPlayer?.abilities ?? []
  const spellD  = restAbilities.find((a: any) => a.slot === 4) ?? null // SpellSlotIndex.D
  const spellF  = restAbilities.find((a: any) => a.slot === 5) ?? null // SpellSlotIndex.F
  const wsUltAb = wsTabPlayer?.abilities?.find((a: any) => a.slot === 3) ?? null
  const ultAb   = restAbilities.find((a: any) => a.slot === 3) ?? null // CD timing from REST

  // Ult cooldown — cdPct: 0 = just used, 100 = ready
  // locked = player below lvl 6 (ult not yet unlocked): icon shown grey, no CD ring.
  // BlueBottle REST does not include assets for Q/W/E/R abilities — only for summoner spells.
  // Fall back to a CDragon URL constructed from the champion alias so the ult slot has an icon.
  const alias      = (champData?.alias ?? '').toLowerCase()
  // Resource type — priority: alias override → numeric BB type → maxMana heuristic
  const _resApi    = tabPlayer?.resource?.type
  const _resNum    = typeof _resApi === 'number' ? (RESOURCE_BY_NUM[_resApi] ?? null) : null
  const resourceType =
    CHAMP_RESOURCE[alias] ??   // explicit override (e.g. no-resource champs)
    _resNum ??                  // numeric enum from BlueBottle (primary for most)
    (maxMana > 0 ? 'mana' : 'none')
  const ultLocked  = (sbPlayer.level ?? 0) < 6

  // Always compute icon URL — ult slot renders even when locked (grey).
  // Icon priority:
  //  1. wsTabPlayer R assets (populated when ChampionTabs is active)
  //  2. CDragon correct URL once async fetch completes
  //  3. CDragon HUD path (immediate, works for most standard champions)
  //  4. Champion square image via @error handler
  let ultIconUrl = resolveUrl(wsUltAb?.assets?.iconAsset ?? ultAb?.assets?.iconAsset)
  if (!ultIconUrl && alias) {
    const cdFetched = _cdUltIcons[alias]    // reactive — undefined | '' | 'https://...'
    ultIconUrl = (cdFetched != null && cdFetched !== '')
      ? cdFetched  // CDragon fetch finished with correct URL
      : `https://raw.communitydragon.org/latest/game/assets/characters/${alias}/hud/icons2d/${alias}_r.png`
    // ↑ immediate HUD-path attempt; Vue will re-render once CDragon async fetch updates _cdUltIcons
  }

  let ult: any = null
  if (ultAb || alias) {
    const remaining = Math.max(0, (ultAb?.readyAt ?? 0) - gt)
    const total     = ultAb?.totalCooldown ?? 0
    const ready     = !ultLocked && remaining <= 0
    const cdPct     = (!ultLocked && !ready) ? (total > 0 ? Math.round((1 - remaining / total) * 100) : 0) : 0
    const ultSquareFallback = resolveUrl(champData?.squareImg)
    ult = { imageUrl: ultIconUrl, squareFallback: ultSquareFallback, ready, cdPct, locked: ultLocked, remaining }
  }

  const summonerSpells = [spellCd(spellD), spellCd(spellF)]

  // Runes
  // BlueBottle REST returns individual perk data (iconPath for each perk) but does NOT include
  // the tree/style perks (id 8000/8100/8200/8300/8400). Layout in 9-perk array is:
  //   [0] keystone, [1-3] primary tree runes, [4-5] secondary tree runes, [6-8] stat shards.
  const perks: any[]  = tabPlayer?.perks ?? []
  const keystonePerk  = perks.find((p: any) => !STYLE_IDS.has(p.id)) ?? null
  const keystone      = keystonePerk?.iconPath ? { imageUrl: resolveUrl(keystonePerk.iconPath) } : null

  const stylePerks    = perks.filter((p: any) => STYLE_IDS.has(p.id))
  // Secondary rune TREE (path) icon — we want the path symbol (e.g. Precision, Domination),
  // not an individual rune. BlueBottle REST never includes style-perk IDs, so we extract
  // the tree name from the secondary individual rune's iconPath via regex.
  // e.g. "cache/perk-images/Styles/Precision/Triumph/Triumph.png" → "Precision"
  const secondaryRune = stylePerks[1] ?? (perks.length >= 5 ? perks[4] : null) ?? null
  // secondary exposes both URLs; the template picks reactively via secondaryTreeFailed
  // so Vue's :src binding stays correct without DOM manipulation hacks.
  let secondary: { treeUrl: string | null; runeUrl: string } | null = null
  if (secondaryRune?.iconPath) {
    const m       = (secondaryRune.iconPath as string).match(/Styles\/([^/]+)\//)
    const treeUrl = m ? (SECONDARY_TREE_URLS[m[1]] ?? null) : null
    const runeUrl = resolveUrl(secondaryRune.iconPath)
    if (runeUrl) secondary = { treeUrl, runeUrl }
  }

  // Stack counter — present only for champs with a stacking mechanic
  // (Nasus Q, Veigar AP, Smolder, Cho'Gath, Sion, Aurelion Sol, …)
  const stacks = tabPlayer?.stacksData != null ? Math.floor(tabPlayer.stacksData) : null

  // Death state — computed first so we can mask baron/elder for dead players.
  // respawnAt is an absolute game time (from scoreboardBottom via WebSocket, the most
  // reliably-updated source). tabPlayer.respawnAt is a 1 s-stale REST fallback.
  const respawnAt = sbPlayer.respawnAt ?? tabPlayer?.respawnAt ?? 0
  const isDead    = respawnAt > gt
  const respawnRemaining = isDead ? Math.ceil(respawnAt - gt) : 0

  // Baron/Elder buff:
  // 1. Player must be alive (!isDead)
  // 2. Their team must have the buff (teamHasBaron/Elder)
  // 3. They must NOT have died during this specific buff period
  //    (_lostBaronAt[alias] !== teamBaronEnd means either they never died,
  //     or they died during a DIFFERENT (older) baron — block only applies to current one)
  const hasBaron = !isDead && teamHasBaron && _lostBaronAt[alias] !== teamBaronEnd
  const hasElder = !isDead && teamHasElder && _lostElderAt[alias] !== teamElderEnd

  return {
    role,
    champion,
    // Name priority:
    //  1. Operator-configured live-game name for this side+slot — authoritative
    //  2. Player's real first name from BlueBottle team data (fallback)
    //  3. Raw in-game summoner name as a last resort (e.g. DevMock / unset config)
    summonerName: configName || tabPlayer?.givenName?.trim() || sbPlayer.displayName || sbPlayer.name || '',
    level:        sbPlayer.level    ?? 1,
    kills:        sbPlayer.kills    ?? 0,
    deaths:       sbPlayer.deaths   ?? 0,
    assists:      sbPlayer.assists  ?? 0,
    gold:         sbPlayer.totalGold ?? sbPlayer.gold ?? 0,
    creepScore:   sbPlayer.creepScore ?? 0,
    // Bounty = in-game "shutdown" value from BlueBottle scoreboardBottom (rounded to a whole number).
    bounty:       Math.round(sbPlayer.shutdown ?? 0),
    // Vision score — shown as a small badge on the trinket.
    visionScore:  Math.round(sbPlayer.visionScore ?? 0),
    hp, maxHp, mana, maxMana, resourceType, xp, maxXp,
    summonerSpells,
    items,
    trinket,
    roleQuestItem,
    keystone,
    secondary,
    ult,
    stacks,
    hasBaron,
    hasElder,
    isDead,
    respawnRemaining,
  }
}

// ── Tab-player lookup ──────────────────────────────────────────────────────
// Match by champion alias first (unique per team, language-independent),
// then fall back to summoner name (strips Riot-ID hashtag for compatibility).
// This is robust regardless of the ordering returned by getAllTeamParticipants.
function findTabPlayer(tabTeam: any[], sbPlayer: any): any | null {
  if (!tabTeam.length) return null

  // 1. Champion alias match — most reliable
  const champAlias = (sbPlayer.champion?.alias ?? '').toLowerCase()
  if (champAlias) {
    const byChamp = tabTeam.find((p: any) =>
      (p.championAssets?.alias ?? '').toLowerCase() === champAlias,
    )
    if (byChamp) return byChamp
  }

  // 2. Name match — strip Riot-ID hashtag (e.g. "NAME#EUW" → "NAME")
  const sbName = (sbPlayer.name ?? sbPlayer.displayName ?? '')
    .toLowerCase().split('#')[0].trim()
  if (sbName) {
    return (
      tabTeam.find((p: any) =>
        (p.playerName ?? p.displayName ?? '').toLowerCase().split('#')[0].trim() === sbName,
      ) ?? null
    )
  }

  return null
}

// ── Flat tab-player pools ──────────────────────────────────────────────────
// BlueBottle's REST endpoint keys teams by its own internal database ID (e.g. 5, 6)
// which has nothing to do with LoL's canonical blue=100 / red=200 team IDs.
// Champion aliases are unique across all 10 players in a single game, so we
// simply flatten all teams into one array and match by alias (or name as fallback).
const allTabPlayers = computed((): any[] => {
  const all: any[] = []
  for (const players of Object.values(tabPlayers.value)) {
    if (Array.isArray(players)) all.push(...(players as any[]))
  }
  return all
})

// WebSocket tabs players — available when BlueBottle's ChampionTabs overlay is active.
// Contains health.current / health.max; keyed by {teamId: {id, players: tabPlayer[]}}.
const allWsTabPlayers = computed((): any[] => {
  const tabs = wsTabs.value
  if (!tabs || typeof tabs !== 'object') return []
  const all: any[] = []
  for (const team of Object.values(tabs) as any[]) {
    const players = Array.isArray(team) ? team : team?.players
    if (Array.isArray(players)) all.push(...players)
  }
  return all
})

// ── Computed player lists ──────────────────────────────────────────────────
const bluePlayers = computed(() => {
  const sbTeam    = sbBottom.value?.teams?.[0]
  const tabAll    = allTabPlayers.value
  const wsAll     = allWsTabPlayers.value
  const gt        = gameTime.value
  const tBaron    = blueHasBaron.value
  const tElder    = blueHasElder.value
  const tBaronEnd = ((scoreboard.value as any)?.teams?.[0]?.baronPowerPlay?.timeEnd  ?? 0) as number
  const tElderEnd = ((scoreboard.value as any)?.teams?.[0]?.dragonPowerPlay?.timeEnd ?? 0) as number
  const cfg = liveBlue.value
  return (sbTeam?.players ?? []).map((p: any, i: number) =>
    normPlayer(
      p,
      findTabPlayer(tabAll, p),
      wsAll.length ? findTabPlayer(wsAll, p) : null,
      gt, i, tBaron, tElder, tBaronEnd, tElderEnd, cfg[i]?.name ?? '',
    ),
  ).filter(Boolean)
})

const redPlayers = computed(() => {
  const sbTeam    = sbBottom.value?.teams?.[1]
  const tabAll    = allTabPlayers.value
  const wsAll     = allWsTabPlayers.value
  const gt        = gameTime.value
  const tBaron    = redHasBaron.value
  const tElder    = redHasElder.value
  const tBaronEnd = ((scoreboard.value as any)?.teams?.[1]?.baronPowerPlay?.timeEnd  ?? 0) as number
  const tElderEnd = ((scoreboard.value as any)?.teams?.[1]?.dragonPowerPlay?.timeEnd ?? 0) as number
  const cfg = liveRed.value
  return (sbTeam?.players ?? []).map((p: any, i: number) =>
    normPlayer(
      p,
      findTabPlayer(tabAll, p),
      wsAll.length ? findTabPlayer(wsAll, p) : null,
      gt, i, tBaron, tElder, tBaronEnd, tElderEnd, cfg[i]?.name ?? '',
    ),
  ).filter(Boolean)
})

const hasPlayers = computed(() => bluePlayers.value.length > 0 || redPlayers.value.length > 0)

// ── Level-up flash ─────────────────────────────────────────────────────────
// Tracks which players are currently showing a level-up animation.
// Key = champion alias (unique per game); value = new level number.
const levelUpFlash = reactive<Record<string, number>>({})
const _prevLevels  = new Map<string, number>()
const _lvlTimers   = new Map<string, ReturnType<typeof setTimeout>>()

watch([bluePlayers, redPlayers], ([blue, red]) => {
  for (const p of [...blue, ...red]) {
    if (!p?.champion?.alias) continue
    const key  = p.champion.alias as string
    const curr = (p.level ?? 1) as number
    const prev = _prevLevels.get(key)
    if (prev !== undefined && curr > prev) {
      // Cancel any existing timer for this player
      const existing = _lvlTimers.get(key)
      if (existing) clearTimeout(existing)
      levelUpFlash[key] = curr
      _lvlTimers.set(key, setTimeout(() => { delete levelUpFlash[key] }, 2500))
    }
    _prevLevels.set(key, curr)
  }
})

// Prefetch CDragon ult icons as soon as scoreboard data is available
watch(sbBottom, (sb) => {
  for (const team of [sb?.teams?.[0], sb?.teams?.[1]]) {
    for (const p of (team?.players ?? [])) {
      const alias = p.champion?.alias
      if (alias) void prefetchUltIcon(alias)
    }
  }
}, { immediate: true })

// ── Helpers ────────────────────────────────────────────────────────────────
const MP_COLORS: Record<string, string> = {
  mana:       '#60a5fa',
  energy:     '#facc15',
  rage:       '#f97316',
  fury:       '#fb923c',
  ferocity:   '#fb923c',
  heat:       '#ef4444',
  flow:       '#a78bfa',
  wind:       '#a78bfa',
  shield:     '#22d3ee',
  ammo:       'rgba(255,255,255,0.65)',
  moonlight:  '#c4b5fd',  // Aphelios — silvery purple
}
function mpColor(type: string): string {
  return MP_COLORS[type] ?? MP_COLORS.mana
}

function hpPct(p: any): number {
  return p?.maxHp  ? Math.round(Math.max(0, Math.min(100, (p.hp  / p.maxHp)  * 100))) : 0
}
function mpPct(p: any): number {
  return p?.maxMana ? Math.round(Math.max(0, Math.min(100, (p.mana / p.maxMana) * 100))) : 0
}
function xpPct(p: any): number {
  return p?.maxXp  ? Math.round(Math.max(0, Math.min(100, (p.xp  / p.maxXp)  * 100))) : 0
}

function goldDiff(i: number): number {
  const bg = (bluePlayers.value[i] as any)?.gold ?? 0
  const rg = (redPlayers.value[i] as any)?.gold ?? 0
  return bg - rg
}

function fmtGold(diff: number): string {
  const abs = Math.round(Math.abs(diff))
  return abs >= 1000 ? (abs / 1000).toFixed(1) + 'k' : String(abs)
}

// Show any non-zero gold difference (no minimum threshold)
function blueLeads(i: number): boolean { return goldDiff(i) > 0 }
function redLeads (i: number): boolean { return goldDiff(i) < 0 }


const ITEM_CIRC    = 50.27  // 2π × r=8   (viewBox 22×22)
const TRINKET_CIRC = 43.98  // 2π × r=7   (viewBox 18×18)
const SPELL_CIRC   = 43.98  // 2π × r=7   (viewBox 18×18)
const ULT_CIRC     = 59.69  // 2π × r=9.5 (viewBox 24×24)

function itemDash(cdPct: number): string {
  return `${((cdPct / 100) * ITEM_CIRC).toFixed(2)} ${ITEM_CIRC}`
}
function trinketDash(cdPct: number): string {
  return `${((cdPct / 100) * TRINKET_CIRC).toFixed(2)} ${TRINKET_CIRC}`
}
function spellDash(cdPct: number): string {
  return `${((cdPct / 100) * SPELL_CIRC).toFixed(2)} ${SPELL_CIRC}`
}
function ultDash(cdPct: number): string {
  return `${((cdPct / 100) * ULT_CIRC).toFixed(2)} ${ULT_CIRC}`
}
// Quest-teleport countdown label — full remaining time (m:ss above a minute,
// else plain seconds), since the quest TP cooldown runs much longer than 9 s.
function tpCd(sec: number): string {
  const s = Math.ceil(sec)
  if (s >= 60) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  return String(s)
}
</script>

<template>
  <Transition name="bpanel">
    <div v-if="hasPlayers" class="bpanel">
      <div class="bpanel__topline" />

      <div class="bpanel__body">

        <!-- ── BLUE TEAM ──── outer (left) → center (right) ──────── -->
        <div class="bpt bpt--y">
          <div
            v-for="(player, i) in bluePlayers"
            :key="i"
            class="plyr plyr--y"
          >
            <!-- ① Trinket -->
            <div class="plyr__item plyr__item--trinket" :class="{ 'plyr__item--cd': player.trinket && !player.trinket.ready }">
              <img v-if="player.trinket?.imageUrl" :src="player.trinket.imageUrl" class="plyr__item-img" />
              <svg v-if="player.trinket && !player.trinket.ready" class="plyr__item-ring" viewBox="0 0 18 18">
                <circle cx="9" cy="9" r="7" stroke="rgba(0,0,0,0.30)" stroke-width="1.5" fill="none"/>
                <circle cx="9" cy="9" r="7"
                  stroke="rgba(255,255,255,0.45)" stroke-width="1.5" fill="none"
                  stroke-linecap="round"
                  :stroke-dasharray="trinketDash(player.trinket.cdPct ?? 0)"
                  transform="rotate(-90 9 9)"/>
              </svg>
              <span v-if="player.visionScore > 0" class="plyr__item-stacks">{{ player.visionScore }}</span>
            </div>

            <!-- ② Quest slot — real item or grayed role-icon placeholder.
                 Toplaner's completed quest grants a Teleport here; its cooldown
                 shows a ring + countdown just like an active item. -->
            <div class="plyr__item plyr__item--quest"
              :class="{ 'plyr__item--cd': player.roleQuestItem && !player.roleQuestItem.ready }">
              <img
                v-if="player.roleQuestItem?.imageUrl"
                :src="player.roleQuestItem.imageUrl"
                class="plyr__item-img"
              />
              <img
                v-else
                :src="`/icons/role-${player.role}.png`"
                class="plyr__item-img plyr__quest-ph"
              />
              <svg v-if="player.roleQuestItem && !player.roleQuestItem.ready" class="plyr__item-ring" viewBox="0 0 22 22">
                <circle cx="11" cy="11" r="8" stroke="rgba(0,0,0,0.30)" stroke-width="2" fill="none"/>
                <circle cx="11" cy="11" r="8"
                  stroke="rgba(255,255,255,0.45)" stroke-width="2" fill="none"
                  stroke-linecap="round"
                  :stroke-dasharray="itemDash(player.roleQuestItem.cdPct ?? 0)"
                  transform="rotate(-90 11 11)"/>
              </svg>
              <span v-if="player.roleQuestItem && !player.roleQuestItem.ready && player.roleQuestItem.remaining > 0"
                class="plyr__cd-num plyr__cd-num--tp">{{ tpCd(player.roleQuestItem.remaining) }}</span>
            </div>

            <!-- ③–⑦ Stat group: Items | CS | KDA | Spells | Ult (equal 8px gaps) -->
            <div class="plyr__stat-group">

              <!-- ③ Items 1–6 (right→left: slot 0 closest to center on right) -->
              <div class="plyr__items plyr__items--rtl">
                <div v-for="(item, idx) in player.items" :key="idx" class="plyr__item"
                  :class="{ 'plyr__item--cd': item && !item.ready, 'plyr__item--ornn': item?.isOrnn }">
                  <img v-if="item?.imageUrl" :src="item.imageUrl" class="plyr__item-img" />
                  <svg v-if="item && !item.ready" class="plyr__item-ring" viewBox="0 0 22 22">
                    <circle cx="11" cy="11" r="8" stroke="rgba(0,0,0,0.30)" stroke-width="2" fill="none"/>
                    <circle cx="11" cy="11" r="8"
                      stroke="rgba(255,255,255,0.45)" stroke-width="2" fill="none"
                      stroke-linecap="round"
                      :stroke-dasharray="itemDash(item.cdPct ?? 0)"
                      transform="rotate(-90 11 11)"/>
                  </svg>
                  <span v-if="item?.stacks != null" class="plyr__item-stacks">{{ item.stacks }}</span>
                </div>
              </div>

              <div class="plyr__cs-block plyr__cs-block--y">
                <span class="plyr__cs">{{ player.creepScore ?? 0 }}</span>
              </div>

              <div class="plyr__kda-block plyr__kda-block--y">
                <span class="plyr__kda">
                  <span class="plyr__k">{{ player.kills ?? 0 }}</span
                  ><span class="plyr__sep">/</span
                  ><span class="plyr__d">{{ player.deaths ?? 0 }}</span
                  ><span class="plyr__sep">/</span
                  ><span class="plyr__a">{{ player.assists ?? 0 }}</span>
                </span>
              </div>

              <!-- ⑥ Summoner spells (side by side) -->
              <div class="plyr__spells">
                <div v-for="si in [0, 1]" :key="si" class="plyr__spell" :class="{ 'plyr__spell--cd': player.summonerSpells?.[si] && !player.summonerSpells[si].ready }">
                  <img v-if="player.summonerSpells?.[si]?.imageUrl" :src="player.summonerSpells[si].imageUrl" class="plyr__spell-img" />
                  <svg v-if="player.summonerSpells?.[si] && !player.summonerSpells[si].ready" class="plyr__spell-ring" viewBox="0 0 18 18">
                    <circle cx="9" cy="9" r="7" stroke="rgba(0,0,0,0.30)" stroke-width="1.5" fill="none"/>
                    <circle cx="9" cy="9" r="7"
                      stroke="rgba(255,255,255,0.45)" stroke-width="1.5" fill="none"
                      stroke-linecap="round"
                      :stroke-dasharray="spellDash(player.summonerSpells[si].cdPct ?? 0)"
                      transform="rotate(-90 9 9)"/>
                  </svg>
                  <span v-if="player.summonerSpells?.[si] && !player.summonerSpells[si].ready && player.summonerSpells[si].remaining > 0 && player.summonerSpells[si].remaining <= 9" class="plyr__cd-num">{{ Math.ceil(player.summonerSpells[si].remaining) }}</span>
                </div>
              </div>

              <!-- ⑦ Ult -->
              <div class="plyr__ult" :class="{ 'plyr__ult--cd': player.ult && !player.ult.ready && !player.ult.locked, 'plyr__ult--locked': player.ult?.locked }">
                <img v-if="player.ult?.imageUrl" :src="player.ult.imageUrl" class="plyr__ult-img"
                  @error="(e: Event) => { const img = e.target as HTMLImageElement; if (player.ult?.squareFallback && img.src !== player.ult.squareFallback) { img.src = player.ult.squareFallback } else { img.style.display='none' } }" />
                <svg v-if="player.ult && !player.ult.ready && !player.ult.locked" class="plyr__ult-ring" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9.5" stroke="rgba(0,0,0,0.30)" stroke-width="2.5" fill="none"/>
                  <circle cx="12" cy="12" r="9.5"
                    stroke="rgba(255,255,255,0.45)" stroke-width="2.5" fill="none"
                    stroke-linecap="round"
                    :stroke-dasharray="ultDash(player.ult.cdPct ?? 0)"
                    transform="rotate(-90 12 12)"/>
                </svg>
                <span v-if="player.ult && !player.ult.ready && !player.ult.locked && player.ult.remaining > 0 && player.ult.remaining <= 9" class="plyr__cd-num plyr__cd-num--ult">{{ Math.ceil(player.ult.remaining) }}</span>
              </div>

            </div>

            <!-- ⑧ Name + bars — flex:1, bars fill right→left (center→outer) -->
            <div class="plyr__info">
              <div class="plyr__name plyr__name--y" :class="{ 'plyr__name--baron': player.hasBaron, 'plyr__name--elder': player.hasElder }">
                <span class="plyr__name-text">{{ player.summonerName }}</span>
              </div>
              <div class="plyr__bars plyr__bars--rtl">
                <div class="plyr__bar plyr__bar--hp">
                  <div class="plyr__bar-fill" :style="{ width: hpPct(player) + '%' }" />
                </div>
                <div v-if="player.resourceType !== 'none'" class="plyr__bar plyr__bar--mp">
                  <div class="plyr__bar-fill" :style="{ width: mpPct(player) + '%', background: mpColor(player.resourceType) }" />
                </div>
                <div class="plyr__bar plyr__bar--xp">
                  <div class="plyr__bar-fill" :style="{ width: xpPct(player) + '%' }" />
                </div>
              </div>
            </div>

            <!-- ⑨ Rune — secondary badge at bottom-left -->
            <div class="plyr__rune">
              <img v-if="player.keystone?.imageUrl" :src="player.keystone.imageUrl" class="plyr__rune-img" />
              <div v-else class="plyr__rune-ph" />
              <div v-if="player.secondary" class="plyr__rune-sec plyr__rune-sec--y">
                <img
                  :src="!player.secondary.treeUrl || secondaryTreeFailed[player.champion?.alias ?? '']
                    ? player.secondary.runeUrl
                    : player.secondary.treeUrl"
                  class="plyr__rune-sec-img"
                  @error="() => { if (player.champion?.alias) secondaryTreeFailed[player.champion.alias] = true }"
                />
              </div>
            </div>

            <!-- ⑩ Champion (closest to center) -->
            <div class="plyr__champ">
              <div class="plyr__champ-clip">
                <img v-if="player.champion?.imageUrl" :src="player.champion.imageUrl" :alt="player.champion?.name" class="plyr__champ-img" :class="{ 'plyr__champ-img--dead': player.isDead }" />
                <div v-else class="plyr__champ-ph" />
                <!-- Death overlay: grayscale img + countdown timer -->
                <div v-if="player.isDead" class="plyr__dead-overlay">
                  <span class="plyr__dead-timer">{{ player.respawnRemaining }}</span>
                </div>
                <!-- Level-up flash (blue side — slides from right) -->
                <Transition name="lvlup-y">
                  <div v-if="levelUpFlash[player.champion?.alias]" class="plyr__lvlup-flash plyr__lvlup-flash--y">
                    {{ levelUpFlash[player.champion?.alias] }}
                  </div>
                </Transition>
              </div>
              <span class="plyr__lvl plyr__lvl--y">{{ player.level ?? 1 }}</span>
              <span v-if="player.stacks != null && !player.isDead" class="plyr__stacks plyr__stacks--y">{{ player.stacks }}</span>
              <span v-if="player.bounty >= 100 && !player.isDead" class="plyr__bounty-badge plyr__bounty-badge--y">{{ player.bounty }}</span>
            </div>
          </div>
        </div>

        <!-- ── CENTER ─────────────────────────────────────────────── -->
        <div class="bpcenter">
          <div class="bpcenter__rows">
            <div v-for="i in 5" :key="i" class="bpcenter__row">
              <template v-if="blueLeads(i - 1)">
                <span class="mc__angle mc--y">&lt;</span>
                <span class="mc__val mc--y">{{ fmtGold(goldDiff(i - 1)) }}</span>
              </template>
              <template v-else-if="redLeads(i - 1)">
                <span class="mc__val mc--r">{{ fmtGold(goldDiff(i - 1)) }}</span>
                <span class="mc__angle mc--r">&gt;</span>
              </template>
            </div>
          </div>
        </div>

        <!-- ── RED TEAM ───── center (left) → outer (right) ─────── -->
        <div class="bpt bpt--r">
          <div
            v-for="(player, i) in redPlayers"
            :key="i"
            class="plyr plyr--r"
          >
            <!-- ⑩ Champion (closest to center) -->
            <div class="plyr__champ plyr__champ--r">
              <div class="plyr__champ-clip">
                <img v-if="player.champion?.imageUrl" :src="player.champion.imageUrl" :alt="player.champion?.name" class="plyr__champ-img" :class="{ 'plyr__champ-img--dead': player.isDead }" />
                <div v-else class="plyr__champ-ph" />
                <!-- Death overlay: grayscale img + countdown timer -->
                <div v-if="player.isDead" class="plyr__dead-overlay">
                  <span class="plyr__dead-timer">{{ player.respawnRemaining }}</span>
                </div>
                <!-- Level-up flash (red side — slides from left) -->
                <Transition name="lvlup-r">
                  <div v-if="levelUpFlash[player.champion?.alias]" class="plyr__lvlup-flash plyr__lvlup-flash--r">
                    {{ levelUpFlash[player.champion?.alias] }}
                  </div>
                </Transition>
              </div>
              <span class="plyr__lvl">{{ player.level ?? 1 }}</span>
              <span v-if="player.stacks != null && !player.isDead" class="plyr__stacks plyr__stacks--r">{{ player.stacks }}</span>
              <span v-if="player.bounty >= 100 && !player.isDead" class="plyr__bounty-badge plyr__bounty-badge--r">{{ player.bounty }}</span>
            </div>

            <!-- ⑨ Rune — secondary badge at bottom-right -->
            <div class="plyr__rune">
              <img v-if="player.keystone?.imageUrl" :src="player.keystone.imageUrl" class="plyr__rune-img" />
              <div v-else class="plyr__rune-ph" />
              <div v-if="player.secondary" class="plyr__rune-sec plyr__rune-sec--r">
                <img
                  :src="!player.secondary.treeUrl || secondaryTreeFailed[player.champion?.alias ?? '']
                    ? player.secondary.runeUrl
                    : player.secondary.treeUrl"
                  class="plyr__rune-sec-img"
                  @error="() => { if (player.champion?.alias) secondaryTreeFailed[player.champion.alias] = true }"
                />
              </div>
            </div>

            <!-- ⑧ Name + bars — flex:1, bars fill left→right (center→outer) -->
            <div class="plyr__info">
              <div class="plyr__name plyr__name--r" :class="{ 'plyr__name--baron': player.hasBaron, 'plyr__name--elder': player.hasElder }">
                <span class="plyr__name-text">{{ player.summonerName }}</span>
              </div>
              <div class="plyr__bars">
                <div class="plyr__bar plyr__bar--hp">
                  <div class="plyr__bar-fill" :style="{ width: hpPct(player) + '%' }" />
                </div>
                <div v-if="player.resourceType !== 'none'" class="plyr__bar plyr__bar--mp">
                  <div class="plyr__bar-fill" :style="{ width: mpPct(player) + '%', background: mpColor(player.resourceType) }" />
                </div>
                <div class="plyr__bar plyr__bar--xp">
                  <div class="plyr__bar-fill" :style="{ width: xpPct(player) + '%' }" />
                </div>
              </div>
            </div>

            <!-- ⑦–③ Stat group: Ult | Spells | KDA | CS | Items (equal 8px gaps) -->
            <div class="plyr__stat-group">

              <!-- ⑦ Ult -->
              <div class="plyr__ult" :class="{ 'plyr__ult--cd': player.ult && !player.ult.ready && !player.ult.locked, 'plyr__ult--locked': player.ult?.locked }">
                <img v-if="player.ult?.imageUrl" :src="player.ult.imageUrl" class="plyr__ult-img"
                  @error="(e: Event) => { const img = e.target as HTMLImageElement; if (player.ult?.squareFallback && img.src !== player.ult.squareFallback) { img.src = player.ult.squareFallback } else { img.style.display='none' } }" />
                <svg v-if="player.ult && !player.ult.ready && !player.ult.locked" class="plyr__ult-ring" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9.5" stroke="rgba(0,0,0,0.30)" stroke-width="2.5" fill="none"/>
                  <circle cx="12" cy="12" r="9.5"
                    stroke="rgba(255,255,255,0.45)" stroke-width="2.5" fill="none"
                    stroke-linecap="round"
                    :stroke-dasharray="ultDash(player.ult.cdPct ?? 0)"
                    transform="rotate(-90 12 12)"/>
                </svg>
                <span v-if="player.ult && !player.ult.ready && !player.ult.locked && player.ult.remaining > 0 && player.ult.remaining <= 9" class="plyr__cd-num plyr__cd-num--ult">{{ Math.ceil(player.ult.remaining) }}</span>
              </div>

              <!-- ⑥ Summoner spells (side by side) -->
              <div class="plyr__spells">
                <div v-for="si in [0, 1]" :key="si" class="plyr__spell" :class="{ 'plyr__spell--cd': player.summonerSpells?.[si] && !player.summonerSpells[si].ready }">
                  <img v-if="player.summonerSpells?.[si]?.imageUrl" :src="player.summonerSpells[si].imageUrl" class="plyr__spell-img" />
                  <svg v-if="player.summonerSpells?.[si] && !player.summonerSpells[si].ready" class="plyr__spell-ring" viewBox="0 0 18 18">
                    <circle cx="9" cy="9" r="7" stroke="rgba(0,0,0,0.30)" stroke-width="1.5" fill="none"/>
                    <circle cx="9" cy="9" r="7"
                      stroke="rgba(255,255,255,0.45)" stroke-width="1.5" fill="none"
                      stroke-linecap="round"
                      :stroke-dasharray="spellDash(player.summonerSpells[si].cdPct ?? 0)"
                      transform="rotate(-90 9 9)"/>
                  </svg>
                  <span v-if="player.summonerSpells?.[si] && !player.summonerSpells[si].ready && player.summonerSpells[si].remaining > 0 && player.summonerSpells[si].remaining <= 9" class="plyr__cd-num">{{ Math.ceil(player.summonerSpells[si].remaining) }}</span>
                </div>
              </div>

              <div class="plyr__kda-block plyr__kda-block--r">
                <span class="plyr__kda">
                  <span class="plyr__k">{{ player.kills ?? 0 }}</span
                  ><span class="plyr__sep">/</span
                  ><span class="plyr__d">{{ player.deaths ?? 0 }}</span
                  ><span class="plyr__sep">/</span
                  ><span class="plyr__a">{{ player.assists ?? 0 }}</span>
                </span>
              </div>

              <div class="plyr__cs-block plyr__cs-block--r">
                <span class="plyr__cs">{{ player.creepScore ?? 0 }}</span>
              </div>

              <!-- ③ Items 1–6 -->
              <div class="plyr__items">
                <div v-for="(item, idx) in player.items" :key="idx" class="plyr__item"
                  :class="{ 'plyr__item--cd': item && !item.ready, 'plyr__item--ornn': item?.isOrnn }">
                  <img v-if="item?.imageUrl" :src="item.imageUrl" class="plyr__item-img" />
                  <svg v-if="item && !item.ready" class="plyr__item-ring" viewBox="0 0 22 22">
                    <circle cx="11" cy="11" r="8" stroke="rgba(0,0,0,0.30)" stroke-width="2" fill="none"/>
                    <circle cx="11" cy="11" r="8"
                      stroke="rgba(255,255,255,0.45)" stroke-width="2" fill="none"
                      stroke-linecap="round"
                      :stroke-dasharray="itemDash(item.cdPct ?? 0)"
                      transform="rotate(-90 11 11)"/>
                  </svg>
                  <span v-if="item?.stacks != null" class="plyr__item-stacks">{{ item.stacks }}</span>
                </div>
              </div>

            </div>

            <!-- ② Quest slot — real item or grayed role-icon placeholder.
                 Toplaner's completed quest grants a Teleport here; its cooldown
                 shows a ring + countdown just like an active item. -->
            <div class="plyr__item plyr__item--quest"
              :class="{ 'plyr__item--cd': player.roleQuestItem && !player.roleQuestItem.ready }">
              <img
                v-if="player.roleQuestItem?.imageUrl"
                :src="player.roleQuestItem.imageUrl"
                class="plyr__item-img"
              />
              <img
                v-else
                :src="`/icons/role-${player.role}.png`"
                class="plyr__item-img plyr__quest-ph"
              />
              <svg v-if="player.roleQuestItem && !player.roleQuestItem.ready" class="plyr__item-ring" viewBox="0 0 22 22">
                <circle cx="11" cy="11" r="8" stroke="rgba(0,0,0,0.30)" stroke-width="2" fill="none"/>
                <circle cx="11" cy="11" r="8"
                  stroke="rgba(255,255,255,0.45)" stroke-width="2" fill="none"
                  stroke-linecap="round"
                  :stroke-dasharray="itemDash(player.roleQuestItem.cdPct ?? 0)"
                  transform="rotate(-90 11 11)"/>
              </svg>
              <span v-if="player.roleQuestItem && !player.roleQuestItem.ready && player.roleQuestItem.remaining > 0"
                class="plyr__cd-num plyr__cd-num--tp">{{ tpCd(player.roleQuestItem.remaining) }}</span>
            </div>

            <!-- ① Trinket -->
            <div class="plyr__item plyr__item--trinket" :class="{ 'plyr__item--cd': player.trinket && !player.trinket.ready }">
              <img v-if="player.trinket?.imageUrl" :src="player.trinket.imageUrl" class="plyr__item-img" />
              <svg v-if="player.trinket && !player.trinket.ready" class="plyr__item-ring" viewBox="0 0 18 18">
                <circle cx="9" cy="9" r="7" stroke="rgba(0,0,0,0.30)" stroke-width="1.5" fill="none"/>
                <circle cx="9" cy="9" r="7"
                  stroke="rgba(255,255,255,0.45)" stroke-width="1.5" fill="none"
                  stroke-linecap="round"
                  :stroke-dasharray="trinketDash(player.trinket.cdPct ?? 0)"
                  transform="rotate(-90 9 9)"/>
              </svg>
              <span v-if="player.visionScore > 0" class="plyr__item-stacks">{{ player.visionScore }}</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* ── Outer panel ─────────────────────────────────────────────────── */
.bpanel {
  position: absolute;
  bottom: 0;
  left: 305px;
  right: 305px;
  background: rgba(9, 5, 2, 0.94);
  border-top: 1px solid rgba(249, 115, 22, 0.14);
  box-shadow: 0 -4px 32px rgba(0, 0, 0, 0.40), inset 0 1px 0 rgba(249, 115, 22, 0.06);
}

.bpanel__topline {
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(120, 50, 8, 0.5) 6%,
    rgba(249, 115, 22, 0.75) 18%,
    rgba(249, 115, 22, 0.75) 82%,
    rgba(120, 50, 8, 0.5) 94%,
    transparent 100%
  );
}

.bpanel__body {
  display: flex;
  align-items: stretch;
  padding: 7px 18px 9px 18px;
}

/* ── Team columns ────────────────────────────────────────────────── */
.bpt {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.bpt--y .plyr { background: linear-gradient(90deg, rgba(251, 191, 36, 0.05) 0%, transparent 60%); }
.bpt--r .plyr { background: linear-gradient(270deg, rgba(239, 68, 68, 0.05) 0%, transparent 60%); }

/* ── CENTER COLUMN ───────────────────────────────────────────────── */
.bpcenter {
  width: 42px;            /* tight: fits "8.8k" + one arrow */
  flex-shrink: 0;
  display: flex;
  border-left:  1px solid rgba(255, 255, 255, 0.05);
  border-right: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(0, 0, 0, 0.12);
}

.bpcenter__rows {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

/* Only ever one arrow shows (blue-lead → '<', red-lead → '>'), so we use flex
   center instead of a 3-column grid — width shrinks to fit real content. */
.bpcenter__row {
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 0 1px;
}

.mc__angle,
.mc__val {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 13px;
  line-height: 1;
  letter-spacing: 0.03em;
  white-space: nowrap;
}

.mc--y { color: #fbbc23; text-shadow: 0 0 10px rgba(251, 191, 36, 0.45); }
.mc--r { color: #ef4444; text-shadow: 0 0 10px rgba(239, 68, 68,  0.45); }

/* ── Player row ───────────────────────────────────────────────────── */
.plyr {
  display: flex;
  align-items: center;
  height: 38px;
  gap: 4px;
  border-radius: 2px;
  padding: 0 4px;
}

/*
 * Stat group: Items ↔ CS ↔ KDA ↔ Spells ↔ Ult — equal 8px gaps.
 * The group is a flex container, so gap: 8px applies directly between
 * every child — no margin arithmetic, no scoped-selector quirks.
 * Outer .plyr keeps gap: 4px for all other element pairs.
 */
.plyr__stat-group {
  display: flex;
  align-items: center;
  gap: 4px;             /* tight spacing between Items | CS | KDA | Spells | Ult */
  flex-shrink: 0;
}


/* ── Champion ────────────────────────────────────────────────────── */
.plyr__champ {
  position: relative;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
}

/* Inner clip wrapper — clips only the image + flash, not the level badge */
.plyr__champ-clip {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: 3px;
}
.plyr__champ-img,
.plyr__champ-ph {
  width: 34px;
  height: 34px;
  border-radius: 3px;
  object-fit: cover;
  display: block;
}
.plyr__champ-ph {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.10);
}
.plyr--y .plyr__champ-img,
.plyr--y .plyr__champ-ph {
  border-top: none; border-bottom: none; border-left: none;
  border-right: 3px solid rgba(251, 191, 36, 0.82);
}
.plyr--r .plyr__champ--r .plyr__champ-img,
.plyr--r .plyr__champ--r .plyr__champ-ph {
  border-top: none; border-bottom: none; border-right: none;
  border-left: 3px solid rgba(239, 68, 68, 0.82);
}

/* Dead champion — grayscale + dimmed */
.plyr__champ-img--dead { filter: grayscale(1) brightness(0.40); }

/* Respawn countdown overlay — centered on the champion icon */
.plyr__dead-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.28);
  border-radius: 3px;
  pointer-events: none;
}
.plyr__dead-timer {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 16px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.98);
  text-shadow:
    0 0 6px rgba(0, 0, 0, 1),
    0 1px 4px rgba(0, 0, 0, 1);
  letter-spacing: 0.02em;
}

.plyr__lvl {
  position: absolute;
  bottom: -2px;
  right: -4px;
  z-index: 4;
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 12px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.95);
  text-shadow: 0 0 4px rgba(0, 0, 0, 1), 0 1px 4px rgba(0, 0, 0, 1);
  letter-spacing: 0.02em;
}
.plyr__lvl--y { right: auto; left: -4px; }

/* ── Keystone + secondary rune ───────────────────────────────────── */
.plyr__rune {
  position: relative;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.plyr__rune-img {
  width: 22px;
  height: 22px;
  object-fit: contain;
  display: block;
  border-radius: 50%;
  filter: drop-shadow(0 0 4px rgba(0, 0, 0, 0.8));
}
.plyr__rune-ph {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.10);
}

/* Secondary rune badge — corner set by modifier */
.plyr__rune-sec {
  position: absolute;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: rgba(9, 5, 2, 0.80);
  overflow: hidden;
  pointer-events: none;
}
/* Blue: bottom-left corner */
.plyr__rune-sec--y {
  bottom: -3px;
  left: -4px;
}
/* Red: bottom-right corner */
.plyr__rune-sec--r {
  bottom: -3px;
  right: -4px;
}
.plyr__rune-sec-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.9));
}

/* ── Info: name above bars — fills remaining row space ───────────── */
.plyr__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}

/* ── Player name ─────────────────────────────────────────────────── */
.plyr__name {
  display: flex;
  align-items: baseline;
  gap: 5px;
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 14px;        /* bigger than before (was 11px) */
  line-height: 1;
  color: rgba(255, 255, 255, 1.0);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.plyr__name--y { justify-content: flex-end; }   /* blue: name hugs center side */
.plyr__name--r { justify-content: flex-start; } /* red: name hugs center side */

/* Name text truncates; bounty stays fixed */
.plyr__name-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Bounty (shutdown) badge — top-center on champion icon ────────── */
.plyr__bounty-badge {
  position: absolute;
  top: -5px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;                 /* above the level-up flash (z-index 3) and level */
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 12px;
  line-height: 1;
  letter-spacing: 0.01em;
  white-space: nowrap;
  pointer-events: none;
  /* dark outline + glow so the number never blends into the level-up flash */
  text-shadow:
    0 0 3px #000,
    1px 1px 1px #000, -1px 1px 1px #000,
    1px -1px 1px #000, -1px -1px 1px #000;
}
.plyr__bounty-badge--y { color: #fbbf24; }
.plyr__bounty-badge--r { color: #ef4444; }

/* Baron buff — purple glow */
.plyr__name--baron {
  color: #c084fc;
  text-shadow:
    0 0 6px rgba(168, 85, 247, 0.90),
    0 0 14px rgba(168, 85, 247, 0.55);
}
/* Elder buff — teal glow */
.plyr__name--elder {
  color: #2dd4bf;
  text-shadow:
    0 0 6px rgba(45, 212, 191, 0.90),
    0 0 14px rgba(45, 212, 191, 0.55);
}

/* ── HP / Mana / XP bars ─────────────────────────────────────────── */
.plyr__bars {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.plyr__bar {
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
  display: flex;            /* needed for margin-left: auto on fill */
}
.plyr__bar--hp { height: 5px; } /* slightly slimmer to give the name room (2.5× mana ≥ 1.5×) */
.plyr__bar--mp { height: 2px; }
.plyr__bar--xp { height: 2px; }
.plyr__bar-fill {
  height: 100%;
  border-radius: 1px;
  transition: width 0.4s ease;
}
/* Blue bars fill right→left (center is on the right) */
.plyr__bars--rtl .plyr__bar-fill {
  margin-left: auto;
}
.plyr__bar--hp .plyr__bar-fill { background: linear-gradient(90deg, #16a34a, #4ade80); }
/* Mana bar fill — color overridden inline per resource type via mpColor() */
.plyr__bar--mp .plyr__bar-fill { background: #60a5fa; }
.plyr__bar--xp .plyr__bar-fill { background: rgba(167, 139, 250, 0.80); }
/* RTL: flip gradient direction so bright end still faces center (right) */
.plyr__bars--rtl .plyr__bar--hp .plyr__bar-fill { background: linear-gradient(270deg, #16a34a, #4ade80); }

/* ── Ult ─────────────────────────────────────────────────────────── */
.plyr__ult {
  position: relative;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: 3px;
}
.plyr__ult-img {
  width: 28px;
  height: 28px;
  object-fit: cover;
  display: block;
  border-radius: 3px;
}
.plyr__ult--cd     .plyr__ult-img { filter: grayscale(1) brightness(0.45); }
.plyr__ult--locked .plyr__ult-img { filter: grayscale(1) brightness(0.30); }
.plyr__ult-ring {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

/* ── Summoner spells — side by side ──────────────────────────────── */
.plyr__spells {
  display: flex;
  flex-direction: row;
  gap: 4px;
  flex-shrink: 0;
}
.plyr__spell {
  position: relative;
  width: 28px;
  height: 28px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  overflow: hidden;
  flex-shrink: 0;
}
.plyr__spell-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
/* Summoner spell on cooldown */
.plyr__spell--cd .plyr__spell-img { filter: grayscale(1) brightness(0.45); }
.plyr__spell-ring {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

/* ── Cooldown countdown numeral (last 9 s of a spell / ult) ─────── */
.plyr__cd-num {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 4;
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 15px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.98);
  text-shadow:
    0 0 3px #000,
    1px 1px 1px #000, -1px 1px 1px #000,
    1px -1px 1px #000, -1px -1px 1px #000;
  pointer-events: none;
}
/* Ult icon is larger (28 px) → bump the countdown text so it reads well. */
.plyr__cd-num--ult { font-size: 18px; }
/* Quest-teleport CD can read as m:ss → shrink so it fits the 28 px quest slot. */
.plyr__cd-num--tp { font-size: 12px; }

/* ── KDA ─────────────────────────────────────────────────────────── */
.plyr__kda-block {
  width: 68px;            /* tight: fits "11/11/11" — wider digits (99/99/99) may push slightly */
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.plyr__kda {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 20px;        /* large — spans most of the row height */
  line-height: 1;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
/* KDA numbers in team colour; separators stay white */
.plyr--y .plyr__k, .plyr--y .plyr__d, .plyr--y .plyr__a { color: #fbbf24; }
.plyr--r .plyr__k, .plyr--r .plyr__d, .plyr--r .plyr__a { color: #ef4444; }
.plyr__sep { color: rgba(255, 255, 255, 0.92); margin: 0 1px; }

/* ── CS ──────────────────────────────────────────────────────────── */
.plyr__cs-block {
  width: 30px;            /* tight: fits "111" — wider digits (999) may push slightly */
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.plyr__cs {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 19px;        /* large — matches KDA scale */
  line-height: 1;
  color: rgba(255, 255, 255, 0.95);
  white-space: nowrap;
  letter-spacing: 0.02em;
}

/* ── Item slots ──────────────────────────────────────────────────── */
.plyr__items {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
/* Blue: slot 0 on right, empties spill to the left (outer edge) */
.plyr__items--rtl {
  flex-direction: row-reverse;
}
.plyr__item {
  position: relative;
  width: 28px;
  height: 28px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.10);
  overflow: visible; /* stack badge + ornn glow spill out */
  flex-shrink: 0;
}
/* Inner image must stay clipped even though the wrapper allows overflow */
.plyr__item-img {
  border-radius: 2px;
}
.plyr__item--trinket {
  width: 22px;
  height: 22px;
  border-color: rgba(255, 255, 255, 0.07);
}
/* Dim only the trinket icon so the vision-score badge stays full-brightness. */
.plyr__item--trinket .plyr__item-img { opacity: 0.85; }
.plyr__item--quest {
  border-color: rgba(251, 191, 36, 0.28);
}

/* ── Ornn Masterwork item — golden ring + subtle pulse ─────────────── */
.plyr__item--ornn {
  border-color: rgba(249, 115, 22, 0.85);
  box-shadow:
    0 0 0 1px rgba(249, 115, 22, 0.35),
    0 0 8px rgba(249, 115, 22, 0.55),
    inset 0 0 4px rgba(255, 200, 100, 0.30);
  animation: ornn-pulse 2.4s ease-in-out infinite;
}
@keyframes ornn-pulse {
  0%, 100% {
    box-shadow:
      0 0 0 1px rgba(249, 115, 22, 0.35),
      0 0 8px  rgba(249, 115, 22, 0.55),
      inset 0 0 4px rgba(255, 200, 100, 0.30);
  }
  50% {
    box-shadow:
      0 0 0 1px rgba(249, 115, 22, 0.65),
      0 0 14px rgba(249, 115, 22, 0.85),
      inset 0 0 6px rgba(255, 200, 100, 0.50);
  }
}

/* ── Item stack counter (Dark Seal / Mejai's / trinket vision-score) ─── */
.plyr__item-stacks {
  position: absolute;
  bottom: -3px;
  right: -3px;
  z-index: 3;
  min-width: 13px;
  padding: 1px 3px;
  background: rgba(0, 0, 0, 0.82);
  border: 1px solid rgba(249, 115, 22, 0.55);
  border-radius: 2px;
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 10px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.98);
  text-align: center;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95);
  pointer-events: none;
}
/* Blue side: all item badges (trinket vision-score + Dark Seal / Mejai stacks)
   sit in the bottom-LEFT corner, mirroring red side's bottom-right. */
.plyr--y .plyr__item-stacks {
  right: auto;
  left: -3px;
}
.plyr__item-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* Item on cooldown — dim the icon */
.plyr__item--cd .plyr__item-img { filter: grayscale(1) brightness(0.45); }

/* Cooldown arc ring — overlaid on top of the icon */
.plyr__item-ring {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

/* Quest role-icon placeholder — grayed until quest completes */
.plyr__quest-ph { filter: grayscale(1) opacity(0.4); }

/* ── Stack counter badge (Nasus / Veigar / Smolder / …) ─────────────── */
/* Bottom corner, opposite the level number (blue: lvl bottom-left → stacks bottom-right; red: mirrored) */
.plyr__stacks {
  position: absolute;
  bottom: -2px;
  z-index: 4; /* above the level-up flash (z-index 3), same layer as .plyr__lvl */
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 11px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.95);
  text-shadow: 0 0 4px #000, 0 1px 3px #000;
  pointer-events: none;
}
.plyr__stacks--y { right: -4px; }
.plyr__stacks--r { left:  -4px; }

/* ── Level-up flash ──────────────────────────────────────────────── */
.plyr__lvlup-flash {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 20px;
  line-height: 1;
  color: #090502;
  border-radius: 2px;
  z-index: 3; /* behind .plyr__lvl */
  pointer-events: none;
  overflow: hidden;
}
.plyr__lvlup-flash--y { background: rgba(251, 188, 35, 0.92); } /* blue side — yellow */
.plyr__lvlup-flash--r { background: rgba(239, 68, 68, 0.92); }  /* red side — red */

/* Blue side: slides from right */
.lvlup-y-enter-active { transition: transform 0.25s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.15s ease; }
.lvlup-y-leave-active { transition: transform 0.25s ease, opacity 0.2s ease; }
.lvlup-y-enter-from   { transform: translateX(100%); opacity: 0; }
.lvlup-y-leave-to     { transform: translateX(100%); opacity: 0; }

/* Red side: slides from left */
.lvlup-r-enter-active { transition: transform 0.25s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.15s ease; }
.lvlup-r-leave-active { transition: transform 0.25s ease, opacity 0.2s ease; }
.lvlup-r-enter-from   { transform: translateX(-100%); opacity: 0; }
.lvlup-r-leave-to     { transform: translateX(-100%); opacity: 0; }

/* ── Panel enter/leave ───────────────────────────────────────────── */
.bpanel-enter-active { transition: transform 0.7s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.4s ease; }
.bpanel-leave-active { transition: transform 0.5s cubic-bezier(0.55, 0, 1, 0.45), opacity 0.3s ease; }
.bpanel-enter-from, .bpanel-leave-to { transform: translateY(100%); opacity: 0; }
</style>
