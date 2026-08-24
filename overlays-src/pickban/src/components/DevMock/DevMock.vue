<script setup lang="ts">
// Dev-only wrapper: provides fake champion-select data so the overlay renders
// without a live LeagueBroadcast server. Remove <DevMock> from App.vue before
// registering the overlay in BlueBottle.
import { provide } from 'vue'
import { ClientKey } from '@/client'

// ── DDragon asset helpers ─────────────────────────────────────────────────
const sq = (alias: string) =>
  `https://ddragon.leagueoflegends.com/cdn/14.24.1/img/champion/${alias}.png`
const ld = (alias: string) =>
  `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${alias}_0.jpg`

function mkSimple(alias: string, name: string) {
  return { id: 0, alias, name, squareImg: sq(alias), splashImg: '', splashCenteredImg: '', loadingImg: ld(alias), tileImg: '' }
}

function mkChamp(id: number, alias: string, name: string) {
  return {
    id, alias, name,
    squareImg: sq(alias),
    splashImg: '',
    splashCenteredImg: '',
    loadingImg: ld(alias),
    tileImg: '',
    spells: [],
    skins: {},
    attackSpeed: 0,
  }
}

function mkBanFilled(alias: string, name: string) {
  return { isActive: false, champion: mkChamp(0, alias, name) }
}
const mkBanEmpty   = () => ({ isActive: false, champion: undefined })
const mkBanActive  = () => ({ isActive: true,  champion: undefined })

function mkPick(player: string, alias?: string, name?: string) {
  return {
    id: 0,
    isActive: false,
    player,
    summonerSpells: [],
    champion: alias && name ? mkChamp(0, alias, name) : undefined,
  }
}
function mkPickActive(player: string) {
  return { id: 0, isActive: true, player, summonerSpells: [], champion: undefined }
}

// ── Mock champion-select snapshot ────────────────────────────────────────
// Scenario: PICK PHASE 1, GEN.G (1-0) vs T1 (0-1).
// Blue has locked picks 1+2; slot 3 is currently active (being picked).
// Red has locked picks 1+2; slots 3-5 waiting.
const MOCK_CHAMP_SELECT = {
  isActive: true,
  isConnected: true,
  isTestingEnvironment: true,
  blueTeam: {
    index: 0,
    scoreMatch:  { wins: 1, losses: 0 },
    scoreSeason: { wins: 7, losses: 1 },
    metaData: { teamId: 1, name: 'Gen.G', tag: 'GEN', isActive: true, members: [] },
    bans: [
      mkBanFilled('Zed',    'Zed'),
      mkBanFilled('LeeSin', 'Lee Sin'),
      mkBanFilled('Ahri',   'Ahri'),
      mkBanEmpty(),
      mkBanEmpty(),
    ],
    slots: [
      mkPick('Kingen', 'Garen',    'Garen'),
      mkPick('Cuzz',   'LeeSin',   'Lee Sin'),
      mkPickActive('Bdd'),
      mkPick('Viper',  undefined,  undefined),
      mkPick('Lehends',undefined,  undefined),
    ],
    timeline: [],
    fearlessBans: {
      1: [
        mkSimple('Garen',   'Garen'),
        mkSimple('LeeSin',  'Lee Sin'),
        mkSimple('Orianna', 'Orianna'),
        mkSimple('Jinx',    'Jinx'),
        mkSimple('Thresh',  'Thresh'),
      ],
      2: [
        mkSimple('Viktor',      'Viktor'),
        mkSimple('Camille',     'Camille'),
        mkSimple('Lulu',        'Lulu'),
        mkSimple('Jhin',        'Jhin'),
        mkSimple('Blitzcrank',  'Blitzcrank'),
      ],
    },
  },
  redTeam: {
    index: 1,
    scoreMatch:  { wins: 0, losses: 1 },
    scoreSeason: { wins: 5, losses: 3 },
    metaData: { teamId: 2, name: 'T1', tag: 'T1', isActive: true, members: [] },
    bans: [
      mkBanFilled('Jinx',     'Jinx'),
      mkBanFilled('Thresh',   'Thresh'),
      mkBanFilled('Caitlyn',  'Caitlyn'),
      mkBanEmpty(),
      mkBanEmpty(),
    ],
    slots: [
      mkPick('Faker',   'Zed',    'Zed'),
      mkPick('Peanut',  'Graves', 'Graves'),
      mkPick('Nuguri',  undefined, undefined),
      mkPick('Ruler',   undefined, undefined),
      mkPick('Keria',   undefined, undefined),
    ],
    timeline: [],
    fearlessBans: {
      1: [
        mkSimple('Zed',      'Zed'),
        mkSimple('Graves',   'Graves'),
        mkSimple('Yasuo',    'Yasuo'),
        mkSimple('Caitlyn',  'Caitlyn'),
        mkSimple('Nautilus', 'Nautilus'),
      ],
      2: [
        mkSimple('Akali',    'Akali'),
        mkSimple('Vi',       'Vi'),
        mkSimple('Azir',     'Azir'),
        mkSimple('Jinx',     'Jinx'),
        mkSimple('Leona',    'Leona'),
      ],
    },
  },
  metaData: {
    bestOfType: 'BestOf5',  // simulace BO5 fearless série (4 odehrané hry)
    patch: '16.11',  // season-based → zobrazí se jako 26.11
    performanceData: { updateDuration: 5 },
    matchData: undefined,
  },
  timer: {
    phaseName: 3,      // PICK1
    phaseDuration: 30,
    timeRemaining: 15.3,
  },
}

const MOCK_SNAPSHOT = {
  champSelectData: MOCK_CHAMP_SELECT,
  isActive: true,
  version: 1,
}

// REST fearless bans shape: { [gameId]: { [teamId]: champs[] } }
// Mock team ids: blue = 1, red = 2. Games 1–4 played (5 unique champs each side),
// game 5 (current) empty. Simulates a BO5 fearless series mid game 5.
const MOCK_FEARLESS_BANS = {
  1: {
    1: [mkSimple('Garen', 'Garen'), mkSimple('LeeSin', 'Lee Sin'), mkSimple('Orianna', 'Orianna'), mkSimple('Jinx', 'Jinx'), mkSimple('Thresh', 'Thresh')],
    2: [mkSimple('Zed', 'Zed'), mkSimple('Graves', 'Graves'), mkSimple('Yasuo', 'Yasuo'), mkSimple('Caitlyn', 'Caitlyn'), mkSimple('Nautilus', 'Nautilus')],
  },
  2: {
    1: [mkSimple('Viktor', 'Viktor'), mkSimple('Camille', 'Camille'), mkSimple('Lulu', 'Lulu'), mkSimple('Jhin', 'Jhin'), mkSimple('Blitzcrank', 'Blitzcrank')],
    2: [mkSimple('Akali', 'Akali'), mkSimple('Vi', 'Vi'), mkSimple('Azir', 'Azir'), mkSimple('Aphelios', 'Aphelios'), mkSimple('Leona', 'Leona')],
  },
  3: {
    1: [mkSimple('Aatrox', 'Aatrox'), mkSimple('Khazix', "Kha'Zix"), mkSimple('Ahri', 'Ahri'), mkSimple('Ezreal', 'Ezreal'), mkSimple('Rakan', 'Rakan')],
    2: [mkSimple('Renekton', 'Renekton'), mkSimple('Sejuani', 'Sejuani'), mkSimple('Syndra', 'Syndra'), mkSimple('Kaisa', "Kai'Sa"), mkSimple('Braum', 'Braum')],
  },
  4: {
    1: [mkSimple('Gnar', 'Gnar'), mkSimple('Maokai', 'Maokai'), mkSimple('Taliyah', 'Taliyah'), mkSimple('Varus', 'Varus'), mkSimple('Karma', 'Karma')],
    2: [mkSimple('Jax', 'Jax'), mkSimple('Viego', 'Viego'), mkSimple('Ryze', 'Ryze'), mkSimple('Zeri', 'Zeri'), mkSimple('Milio', 'Milio')],
  },
  5: { 1: [], 2: [] },
}

// ── Minimal mock client ───────────────────────────────────────────────────
const mockClient = {
  connect:    () => {},
  disconnect: () => {},
  isPreGameConnected: () => true,
  onPreGameConnect:    (_fn: () => void) => () => {},
  onPreGameDisconnect: (_fn: () => void) => () => {},
  getCacheUrl: (path?: string) => {
    if (!path) return ''
    if (path.startsWith('http')) return path
    let clean = path.startsWith('/') ? path.slice(1) : path
    if (clean.startsWith('cache')) clean = clean.slice(5)
    if (clean.startsWith('/')) clean = clean.slice(1)
    return `http://localhost:58869/cache/${clean}`
  },
  api: {
    match: {
      getBans: async () => MOCK_FEARLESS_BANS,
    },
  },
  preGameStore: {
    getSnapshot: () => MOCK_SNAPSHOT,
    watchImmediate(selector: (s: typeof MOCK_SNAPSHOT) => unknown, cb: (v: unknown) => void) {
      cb(selector(MOCK_SNAPSHOT))
      return () => {}
    },
    watch(_selector: (s: typeof MOCK_SNAPSHOT) => unknown, _cb: (v: unknown) => void) {
      return () => {}
    },
  },
} as any

provide(ClientKey, mockClient)
</script>

<template>
  <slot />
</template>
