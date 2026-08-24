<script setup lang="ts">
// Dev-only wrapper: injects fake game data so components render without a live server.
// Data shape mirrors the real BlueBottle ingameFrontendData so the same selectors work
// in production (scoreboardBottom + tabs) and in dev mode.
// Remove <DevMock> from App.vue before production use.
import { provide } from 'vue'
import { ClientKey } from '@/client'

// ── DDragon asset helpers ────────────────────────────────────────────────
const DDR = (p: string) => `https://ddragon.leagueoflegends.com/cdn/14.24.1/img/${p}`
const ch  = (n: string) => DDR(`champion/${n}.png`)
const it  = (id: number) => DDR(`item/${id}.png`)
const sp  = (n: string) => DDR(`spell/${n}.png`)
const rn  = (path: string) => `https://ddragon.leagueoflegends.com/cdn/img/perk-images/${path}`

// CDragon ult icons — more reliable than DDragon /spell/ paths across patches.
// Uses the champion's internal lowercase name; CDragon always serves from /latest/.
const cdUlt = (champion: string) =>
  `https://raw.communitydragon.org/latest/game/assets/characters/${champion}/hud/icons2d/${champion}_r.png`

// ── Scoreboard helpers ────────────────────────────────────────────────────
// mkItem: slot 0-5 = inventory, 6 = trinket, 8 = quest
// Cost: descending by slot-index so getSortedInventory + reverse gives correct visual order
function mkItem(id: number, slotIndex: number) {
  return { id, slot: slotIndex, displayName: '', assetUrl: it(id), stacks: 0, charges: 0, count: 1, combineCost: 0, cost: (6 - slotIndex) * 1000 }
}
// mkItemCd: item currently on cooldown (readyAt + maxCooldown trigger the ring in BottomPanel)
function mkItemCd(id: number, slotIndex: number, cdPctDone: number, maxCooldown: number) {
  const remaining = Math.round((1 - cdPctDone / 100) * maxCooldown)
  return { ...mkItem(id, slotIndex), readyAt: GT + remaining, maxCooldown }
}

// ── Tabs helpers ──────────────────────────────────────────────────────────
const GT = 285 // mock game time (seconds)

// Ult ability: iconUrl = fully resolved URL for the R icon
function mkUlt(iconUrl: string, ready: boolean, cdPct = 0, totalCooldown = 120) {
  const remaining = ready ? 0 : (1 - cdPct / 100) * totalCooldown
  const readyAt   = ready ? 0 : GT + remaining
  return {
    identifier: 'R', displayName: 'R', slot: 3, // SpellSlotIndex.R
    totalCooldown, readyAt, level: 3, charges: 0,
    assets: { spellName: 'R', iconAsset: iconUrl, iconName: '', nativeBinHash: 0 },
  }
}

// Summoner spell: slot 4 = D, slot 5 = F
function mkSpell(spell: string, slot: 4 | 5) {
  return {
    identifier: spell, displayName: spell, slot,
    totalCooldown: 300, readyAt: 0, level: 1, charges: 0,
    assets: { spellName: spell, iconAsset: sp(spell), iconName: '', nativeBinHash: 0 },
  }
}

// Perk page: [primaryStyle, keystone, secondaryStyle]
// Style IDs: Precision=8000, Domination=8100, Sorcery=8200, Inspiration=8300, Resolve=8400
function mkPerks(
  primaryId: number, primaryPath: string,
  keystoneId: number, keystonePath: string,
  secondaryId: number, secondaryPath: string,
) {
  return [
    { id: primaryId,   name: '', iconPath: rn(primaryPath) },
    { id: keystoneId,  name: '', iconPath: rn(keystonePath) },
    { id: secondaryId, name: '', iconPath: rn(secondaryPath) },
  ]
}

function mkHealth(current: number, max: number) {
  return { current, max, shield: 0, physicalShield: 0, magicalShield: 0 }
}
function mkResource(current: number, max: number) {
  return { type: max === 0 ? 2 : 0, current, max } // type 2 = none, 0 = mana
}
function mkXp(current: number, nextLevel: number) {
  return { previousLevel: 0, current, nextLevel }
}

// ── SCOREBOARD (team-level, for Scoreboard.vue) ───────────────────────────
// NOTE: real BlueBottle uses 'gold' not 'totalGold'; we keep both for compat.
// bestOf: 1 = Bo1 regular season (record shows totalScore e.g. 5-2)
// bestOf: 3 = Bo3 playoff series  (record shows seriesScore e.g. 1-0)
// bestOf: 5 = Bo5 playoff grand finals
const MOCK_SCOREBOARD = {
  bestOf: 5, // ← 1 = regular season (totalScore text), 3 = Bo3 circles, 5 = Bo5 circles
  teams: [
    {
      teamName: 'Gen.G', teamTag: 'GEN',
      // teamIconUrl: cache-relative path used in real games; use http URL here so
      // getCacheUrl passes it through unchanged in the mock.
      teamIconUrl: ch('Garen'), // dev placeholder — real game uses BlueBottle cache path
      seriesScore: { wins: 2, losses: 1 }, totalScore: { wins: 5, losses: 2 },
      kills: 7, towers: 3, gold: 42800, totalGold: 42800,
      grubs: 6, heralds: 0,
      dragons: ['Fire', 'Water', 'Air', 'Earth', 'Hextech', 'Chemtech'],
      // Elder buff active: started 60 s ago, expires in 90 s; gold advantage tracked by BlueBottle
      dragonPowerPlay: { gold: 2400, kills: 2, deaths: 0, timeStart: GT - 60, timeEnd: GT + 90 },
    },
    {
      teamName: 'T1', teamTag: 'T1',
      teamIconUrl: ch('Zed'), // dev placeholder — Faker's iconic champion
      seriesScore: { wins: 1, losses: 2 }, totalScore: { wins: 3, losses: 4 },
      kills: 5, towers: 1, gold: 38200, totalGold: 38200,
      grubs: 6, heralds: 1,
      dragons: ['Fire', 'Water', 'Air', 'Earth', 'Hextech', 'Chemtech'],
      // Baron buff active: started 90 s ago, expires in 90 s; gold advantage tracked by BlueBottle
      baronPowerPlay: { gold: 3500, kills: 1, deaths: 0, timeStart: GT - 90, timeEnd: GT + 90 },
    },
  ],
}

// ── SCOREBOARD BOTTOM (per-player, for BottomPanel.vue) ──────────────────
const MOCK_SCOREBOARD_BOTTOM = {
  gameTime: GT,
  teams: [
    {
      id: '100', name: 'Blue', tag: 'BLU',
      players: [
        {
          champion: { id: 86, alias: 'Garen', name: 'Garen', squareImg: ch('Garen'), splashImg: '', splashCenteredImg: '', loadingImg: '', tileImg: '' },
          name: 'Kingen', displayName: 'Kingen',
          kills: 12, deaths: 10, assists: 14, level: 9, gold: 2100, totalGold: 9200, creepScore: 245, visionScore: 12, shutdown: 450,
          items: [
            mkItem(3083, 0), mkItemCd(3026, 1, 40, 90), // slot 1 on 40% cooldown
            mkItemCd(3340, 6, 25, 90), // trinket on 25% cooldown
            mkItemCd(3513, 8, 55, 240), // quest teleport (slot 8) on cooldown → tests quest-slot TP countdown
          ],
        },
        {
          champion: { id: 64, alias: 'LeeSin', name: 'Lee Sin', squareImg: ch('LeeSin'), splashImg: '', splashCenteredImg: '', loadingImg: '', tileImg: '' },
          name: 'Cuzz', displayName: 'Cuzz',
          kills: 3, deaths: 2, assists: 4, level: 8, gold: 1450, totalGold: 7800, creepScore: 95, visionScore: 8, shutdown: 0,
          respawnAt: GT + 12, // dead — 12 s until respawn (tests death timer)
          items: [
            mkItem(3078, 0), mkItem(3071, 1),
            mkItem(3340, 6), // trinket
          ],
        },
        {
          champion: { id: 103, alias: 'Ahri', name: 'Ahri', squareImg: ch('Ahri'), splashImg: '', splashCenteredImg: '', loadingImg: '', tileImg: '' },
          name: 'Bdd', displayName: 'Bdd',
          kills: 1, deaths: 2, assists: 6, level: 9, gold: 2800, totalGold: 10100, creepScore: 185, visionScore: 10, shutdown: 0,
          items: [
            mkItem(3089, 0), mkItem(3157, 1), mkItem(3139, 2),
            mkItem(3340, 6), // trinket
          ],
        },
        {
          champion: { id: 222, alias: 'Jinx', name: 'Jinx', squareImg: ch('Jinx'), splashImg: '', splashCenteredImg: '', loadingImg: '', tileImg: '' },
          name: 'Viper', displayName: 'Viper',
          kills: 4, deaths: 1, assists: 2, level: 9, gold: 3600, totalGold: 11400, creepScore: 215, visionScore: 6, shutdown: 0,
          items: [
            mkItem(3031, 0), mkItem(3142, 1), mkItem(3026, 2),
            mkItem(3363, 6), // farsight
            mkItem(3042, 8), // quest item
          ],
        },
        {
          champion: { id: 412, alias: 'Thresh', name: 'Thresh', squareImg: ch('Thresh'), splashImg: '', splashCenteredImg: '', loadingImg: '', tileImg: '' },
          name: 'Lehends', displayName: 'Lehends',
          kills: 0, deaths: 1, assists: 8, level: 8, gold: 850, totalGold: 5600, creepScore: 35, visionScore: 22, shutdown: 0,
          items: [
            mkItem(3190, 0), mkItem(3109, 1),
            mkItem(3364, 6), // control ward trinket
            mkItem(3109, 8), // quest item
          ],
        },
      ],
    },
    {
      id: '200', name: 'Red', tag: 'RED',
      players: [
        {
          champion: { id: 122, alias: 'Darius', name: 'Darius', squareImg: ch('Darius'), splashImg: '', splashCenteredImg: '', loadingImg: '', tileImg: '' },
          name: 'Nuguri', displayName: 'Nuguri',
          kills: 1, deaths: 2, assists: 2, level: 8, gold: 2500, totalGold: 8600, creepScore: 138, visionScore: 9, shutdown: 700,
          items: [
            mkItem(3083, 0), mkItem(3071, 1),
            mkItem(3340, 6),
          ],
        },
        {
          champion: { id: 104, alias: 'Graves', name: 'Graves', squareImg: ch('Graves'), splashImg: '', splashCenteredImg: '', loadingImg: '', tileImg: '' },
          name: 'Peanut', displayName: 'Peanut',
          kills: 2, deaths: 3, assists: 3, level: 8, gold: 1200, totalGold: 7200, creepScore: 110, visionScore: 7, shutdown: 0,
          items: [
            mkItem(3078, 0), mkItem(3026, 1),
            mkItem(3340, 6),
            mkItem(3715, 8), // quest
          ],
        },
        {
          champion: { id: 238, alias: 'Zed', name: 'Zed', squareImg: ch('Zed'), splashImg: '', splashCenteredImg: '', loadingImg: '', tileImg: '' },
          name: 'Faker', displayName: 'Faker',
          kills: 2, deaths: 1, assists: 3, level: 9, gold: 3100, totalGold: 10800, creepScore: 192, visionScore: 11, shutdown: 0,
          respawnAt: GT + 23, // dead — 23 s until respawn (tests death timer)
          items: [
            mkItem(3142, 0), mkItem(3071, 1), mkItem(3139, 2),
            mkItem(3340, 6),
          ],
        },
        {
          champion: { id: 51, alias: 'Caitlyn', name: 'Caitlyn', squareImg: ch('Caitlyn'), splashImg: '', splashCenteredImg: '', loadingImg: '', tileImg: '' },
          name: 'Ruler', displayName: 'Ruler',
          kills: 3, deaths: 1, assists: 4, level: 9, gold: 2800, totalGold: 11200, creepScore: 205, visionScore: 5, shutdown: 0,
          items: [
            mkItem(3031, 0), mkItem(3026, 1),
            mkItem(3363, 6),
            mkItem(3869, 8), // quest
          ],
        },
        {
          champion: { id: 89, alias: 'Leona', name: 'Leona', squareImg: ch('Leona'), splashImg: '', splashCenteredImg: '', loadingImg: '', tileImg: '' },
          name: 'Keria', displayName: 'Keria',
          kills: 0, deaths: 2, assists: 7, level: 8, gold: 700, totalGold: 5200, creepScore: 28, visionScore: 20, shutdown: 0,
          items: [
            mkItem(3190, 0), mkItem(3109, 1),
            mkItem(3364, 6),
            mkItem(3869, 8), // quest
          ],
        },
      ],
    },
  ],
}

// ── TABS (rich player data: abilities / health / resource / XP / perks) ──
const MOCK_TABS = {
  '100': {
    id: 100,
    players: [
      {
        id: 'kingen', playerName: 'Kingen', playerHashtag: '', displayName: 'Kingen', givenName: 'Chae-young', familyName: 'Kim',
        championAssets: { id: 86, alias: 'Garen', name: 'Garen', squareImg: ch('Garen'), splashImg: '', splashCenteredImg: '', loadingImg: '', tileImg: '' },
        level: 9, hasBaron: false, hasElder: false, stacksData: 357, // mock stacks (Nasus/Veigar/Smolder-style badge)
        health:   mkHealth(2800, 3600),
        resource: mkResource(0, 0),    // Garen – no resource
        experience: mkXp(320, 512),
        abilities: [
          mkUlt(cdUlt('garen'), true),
          mkSpell('SummonerFlash', 4), mkSpell('SummonerTeleport', 5),
        ],
        perks: mkPerks(8000, 'Styles/7201_Precision.png', 8021, 'Styles/Precision/Conqueror/Conqueror.png', 8400, 'Styles/7204_Resolve.png'),
      },
      {
        id: 'cuzz', playerName: 'Cuzz', playerHashtag: '', displayName: 'Cuzz', givenName: 'Min-jun', familyName: 'Park',
        championAssets: { id: 64, alias: 'LeeSin', name: 'Lee Sin', squareImg: ch('LeeSin'), splashImg: '', splashCenteredImg: '', loadingImg: '', tileImg: '' },
        level: 8, hasBaron: false, hasElder: false,
        health:   mkHealth(1760, 2200),
        resource: mkResource(320, 600),
        experience: mkXp(150, 480),
        abilities: [
          mkUlt(cdUlt('leesin'), false, 55, 180),
          mkSpell('SummonerFlash', 4), mkSpell('SummonerSmite', 5),
        ],
        perks: mkPerks(8100, 'Styles/7200_Domination.png', 8016, 'Styles/Domination/Predator/Predator.png', 8200, 'Styles/7202_Sorcery.png'),
      },
      {
        id: 'bdd', playerName: 'Bdd', playerHashtag: '', displayName: 'Bdd', givenName: 'Won-seok', familyName: 'Jo',
        championAssets: { id: 103, alias: 'Ahri', name: 'Ahri', squareImg: ch('Ahri'), splashImg: '', splashCenteredImg: '', loadingImg: '', tileImg: '' },
        level: 9, hasBaron: false, hasElder: true,
        health:   mkHealth(1350, 1800),
        resource: mkResource(680, 900),
        experience: mkXp(80, 512),
        abilities: [
          mkUlt(cdUlt('ahri'), false, 30, 130),
          mkSpell('SummonerFlash', 4), mkSpell('SummonerTeleport', 5),
        ],
        perks: mkPerks(8100, 'Styles/7200_Domination.png', 8112, 'Styles/Domination/Electrocute/Electrocute.png', 8300, 'Styles/7203_Whimsy.png'),
      },
      {
        id: 'viper', playerName: 'Viper', playerHashtag: '', displayName: 'Viper', givenName: 'Do-hyeon', familyName: 'Park',
        championAssets: { id: 222, alias: 'Jinx', name: 'Jinx', squareImg: ch('Jinx'), splashImg: '', splashCenteredImg: '', loadingImg: '', tileImg: '' },
        level: 9, hasBaron: false, hasElder: true,
        health:   mkHealth(1600, 2050),
        resource: mkResource(450, 720),
        experience: mkXp(410, 512),
        abilities: [
          mkUlt(cdUlt('jinx'), true),
          mkSpell('SummonerFlash', 4), mkSpell('SummonerHeal', 5),
        ],
        perks: mkPerks(8000, 'Styles/7201_Precision.png', 8008, 'Styles/Precision/LethalTempo/LethalTempo.png', 8200, 'Styles/7202_Sorcery.png'),
      },
      {
        id: 'lehends', playerName: 'Lehends', playerHashtag: '', displayName: 'Lehends', givenName: 'Sin-hyeok', familyName: 'Son',
        championAssets: { id: 412, alias: 'Thresh', name: 'Thresh', squareImg: ch('Thresh'), splashImg: '', splashCenteredImg: '', loadingImg: '', tileImg: '' },
        level: 8, hasBaron: false, hasElder: false,
        health:   mkHealth(1700, 2350),
        resource: mkResource(850, 1200),
        experience: mkXp(380, 480),
        abilities: [
          mkUlt(cdUlt('thresh'), true),
          mkSpell('SummonerFlash', 4), mkSpell('SummonerDot', 5),
        ],
        perks: mkPerks(8400, 'Styles/7204_Resolve.png', 8439, 'Styles/Resolve/VeteransAftershock/Aftershock.png', 8300, 'Styles/7203_Whimsy.png'),
      },
    ],
  },
  '200': {
    id: 200,
    players: [
      {
        id: 'nuguri', playerName: 'Nuguri', playerHashtag: '', displayName: 'Nuguri', givenName: 'Sun-woo', familyName: 'Jang',
        championAssets: { id: 122, alias: 'Darius', name: 'Darius', squareImg: ch('Darius'), splashImg: '', splashCenteredImg: '', loadingImg: '', tileImg: '' },
        level: 8, hasBaron: false, hasElder: false, stacksData: 1250, // mock stacks
        health:   mkHealth(2550, 3200),
        resource: mkResource(0, 0),    // Darius – no resource
        experience: mkXp(260, 480),
        abilities: [
          mkUlt(cdUlt('darius'), false, 20, 100),
          mkSpell('SummonerFlash', 4), mkSpell('SummonerTeleport', 5),
        ],
        perks: mkPerks(8000, 'Styles/7201_Precision.png', 8021, 'Styles/Precision/Conqueror/Conqueror.png', 8100, 'Styles/7200_Domination.png'),
      },
      {
        id: 'peanut', playerName: 'Peanut', playerHashtag: '', displayName: 'Peanut', givenName: 'Wang-ho', familyName: 'Han',
        championAssets: { id: 104, alias: 'Graves', name: 'Graves', squareImg: ch('Graves'), splashImg: '', splashCenteredImg: '', loadingImg: '', tileImg: '' },
        level: 8, hasBaron: false, hasElder: false,
        health:   mkHealth(1650, 2100),
        resource: mkResource(340, 580),
        experience: mkXp(420, 480),
        abilities: [
          mkUlt(cdUlt('graves'), true),
          mkSpell('SummonerFlash', 4), mkSpell('SummonerSmite', 5),
        ],
        perks: mkPerks(8000, 'Styles/7201_Precision.png', 8017, 'Styles/Precision/FleetFootwork/FleetFootwork.png', 8100, 'Styles/7200_Domination.png'),
      },
      {
        id: 'faker', playerName: 'Faker', playerHashtag: '', displayName: 'Faker', givenName: 'Sang-hyeok', familyName: 'Lee',
        championAssets: { id: 238, alias: 'Zed', name: 'Zed', squareImg: ch('Zed'), splashImg: '', splashCenteredImg: '', loadingImg: '', tileImg: '' },
        level: 9, hasBaron: true, hasElder: false,
        health:   mkHealth(1480, 1980),
        resource: mkResource(140, 200),  // Zed – energy
        experience: mkXp(490, 512),
        abilities: [
          mkUlt(cdUlt('zed'), false, 70, 120),
          mkSpell('SummonerFlash', 4), mkSpell('SummonerTeleport', 5),
        ],
        perks: mkPerks(8100, 'Styles/7200_Domination.png', 8112, 'Styles/Domination/Electrocute/Electrocute.png', 8000, 'Styles/7201_Precision.png'),
      },
      {
        id: 'ruler', playerName: 'Ruler', playerHashtag: '', displayName: 'Ruler', givenName: 'Jae-hyeon', familyName: 'Park',
        championAssets: { id: 51, alias: 'Caitlyn', name: 'Caitlyn', squareImg: ch('Caitlyn'), splashImg: '', splashCenteredImg: '', loadingImg: '', tileImg: '' },
        level: 9, hasBaron: true, hasElder: false,
        health:   mkHealth(1520, 1960),
        resource: mkResource(520, 820),
        experience: mkXp(200, 512),
        abilities: [
          mkUlt(cdUlt('caitlyn'), true),
          mkSpell('SummonerFlash', 4), mkSpell('SummonerHeal', 5),
        ],
        perks: mkPerks(8000, 'Styles/7201_Precision.png', 8017, 'Styles/Precision/FleetFootwork/FleetFootwork.png', 8200, 'Styles/7202_Sorcery.png'),
      },
      {
        id: 'keria', playerName: 'Keria', playerHashtag: '', displayName: 'Keria', givenName: 'Min-seok', familyName: 'Ryu',
        championAssets: { id: 89, alias: 'Leona', name: 'Leona', squareImg: ch('Leona'), splashImg: '', splashCenteredImg: '', loadingImg: '', tileImg: '' },
        level: 8, hasBaron: false, hasElder: false,
        health:   mkHealth(1900, 2750),
        resource: mkResource(590, 980),
        experience: mkXp(60, 480),
        abilities: [
          mkUlt(cdUlt('leona'), true),
          mkSpell('SummonerFlash', 4), mkSpell('SummonerDot', 5),
        ],
        perks: mkPerks(8400, 'Styles/7204_Resolve.png', 8439, 'Styles/Resolve/VeteransAftershock/Aftershock.png', 8300, 'Styles/7203_Whimsy.png'),
      },
    ],
  },
}

// ── Inhibitor respawn timers ──────────────────────────────────────────────
// inhibitors: teamInhibitorData[] — each team object groups the inhibitors that
// team DESTROYED. The respawn timer belongs to the owner (the opposite side), so
// PatchPanel flips the side before display: CHAOS destroyed → blue timer, etc.
// IngameObjectiveType: INHIBITOR_L0=12 (bot), L1=13 (mid), L2=14 (top)
// timeAlive > GT → inhibitor is destroyed, countdown running
const MOCK_INHIBITORS = [
  {
    // ORDER (blue) destroyed red's MID inhibitor → shows on red side
    team: 'ORDER', teamid: 100, side: 0,
    inhibitors: {
      '1': { type: 13, timeDestroy: GT - 165, timeAlive: GT + 45 },  // red MID — 0:45 left
    },
  },
  {
    // CHAOS (red) destroyed blue's BOT + TOP inhibitors → shows on blue side
    team: 'CHAOS', teamid: 200, side: 1,
    inhibitors: {
      '0': { type: 12, timeDestroy: GT - 120, timeAlive: GT + 90 },  // blue BOT — 1:30 left
      '2': { type: 14, timeDestroy: GT -  60, timeAlive: GT + 150 }, // blue TOP — 2:30 left
    },
  },
]

// ── Objective respawn timers ──────────────────────────────────────────────
// iObjectiveRespawnData: { type: IngameObjectiveType, timeDestroy, timeAlive?, mapSide? }
// IngameObjectiveType: GRUB=0, HERALD=1, BARON=4, DRAGON_WATER=5, DRAGON_AIR=6,
//   DRAGON_EARTH=7, DRAGON_FIRE=8, DRAGON_HEXTECH=9, DRAGON_CHEMTECH=10, DRAGON_ELDER=11
// timeAlive must be > GT to show the timer; we set it to GT + remaining seconds.
const MOCK_BARON_TIMER  = { type: 'GRUB',         timeDestroy: 240, timeAlive: GT + 52 }  // Grub, 52 s left
const MOCK_DRAGON_TIMER = { type: 'DRAGON_FIRE',  timeDestroy: 210, timeAlive: GT - 15 }  // Infernal, respawned 15 s ago → alive

// ── Role quest progress — mirrors real BlueBottle sideInfoPage (type=64=RoleQuest) ──
// player order within each team: [top, jungle, mid, adc, support]
// team: 1=Order/blue, 2=Chaos/red
// curValue/maxValue: raw progress; Scoreboard.vue computes (cur/max)*100
function mkRQ(team: 1 | 2, pcts: number[]) {
  return pcts.map((pct) => ({ team, curValue: pct, maxValue: 100 }))
}
const MOCK_SIDE_INFO_PAGE = {
  type: 64, // IngameSideInfoPageType.RoleQuest
  title: 'Role Quests',
  players: [
    // Blue (team 1): top=75% jungle=85% mid=30% adc=60% support=0%
    ...mkRQ(1, [75, 85, 30, 60, 0]),
    // Red (team 2): top=50% jungle=20% mid=80% adc=90% support=40%
    ...mkRQ(2, [50, 20, 80, 90, 40]),
  ],
  display: { showHero: false, showMinValue: false, showCurValue: true, showMaxValue: true, showBar: true },
}

// ── Full snapshot (mirrors real LeagueBroadcast GameStateSnapshot) ────────
const MOCK_SNAPSHOT = {
  gameState: 'Running',
  version: 1,
  gameData: {
    gameTime: GT,
    gameStatus: 2, // GameState.Running
    // Real games send a season-based gameVersion (2026 = season 16); patch field is
    // usually absent for custom overlays. PatchPanel converts 16.x → year-based 26.x.
    gameVersion: '16.11.123.4567',

    // Used by Scoreboard.vue (team-level stats)
    scoreboard: MOCK_SCOREBOARD,

    // Used by BottomPanel.vue (per-player KDA / gold / CS / items)
    scoreboardBottom: MOCK_SCOREBOARD_BOTTOM,

    // Used by BottomPanel.vue (abilities / health / resource / XP / runes)
    tabs: MOCK_TABS,

    // Objective respawn timers (baronPitTimer / dragonPitTimer)
    baronPitTimer:  MOCK_BARON_TIMER,
    dragonPitTimer: MOCK_DRAGON_TIMER,

    // Inhibitor respawn timers
    inhibitors: MOCK_INHIBITORS,

    // Role quest progress — sideInfoPage with type=RoleQuest (64)
    sideInfoPage: MOCK_SIDE_INFO_PAGE,
  },
}

// ── Minimal client mock ───────────────────────────────────────────────────
// Mock getAllTeamParticipants returns Record<number, tabPlayer[]>
// (same player objects from MOCK_TABS, just keyed by numeric team ID)
const MOCK_PARTICIPANTS: Record<number, any[]> = {
  100: MOCK_TABS['100'].players,
  200: MOCK_TABS['200'].players,
}

const mockClient = {
  connect: () => {},
  disconnect: () => {},
  isIngameConnected: () => false,
  onIngameConnect:    (fn: () => void) => { void fn; return () => {} },
  onIngameDisconnect: (fn: () => void) => { void fn; return () => {} },
  onIngameEvents:     (_handlers: any) => { return () => {} },
  // Resolve a cache-relative path to a full URL — mirrors the real getCacheUrl()
  // In dev mode all asset paths are already absolute DDragon URLs, so pass through unchanged.
  getCacheUrl: (path?: string) => {
    if (!path) return 'http://localhost:58869/cache'
    if (path.startsWith('http')) return path
    let clean = path.startsWith('/') ? path.slice(1) : path
    if (clean.startsWith('cache')) clean = clean.slice(5)
    if (clean.startsWith('/')) clean = clean.slice(1)
    return `http://localhost:58869/cache/${clean}`
  },
  // REST API mock — gameState.getAllTeamParticipants() returns the same
  // player objects that MOCK_TABS contains, keyed by numeric team ID.
  api: {
    gameState: {
      getAllTeamParticipants: () => Promise.resolve(MOCK_PARTICIPANTS),
    },
  },
  ingameStore: {
    getSnapshot: () => MOCK_SNAPSHOT,
    watchImmediate(selector: (s: any) => any, cb: (v: any, prev: any) => void) {
      cb(selector(MOCK_SNAPSHOT), undefined)
      return () => {}
    },
    watch(_selector: (s: any) => any, _cb: (v: any, prev: any) => void) {
      return () => {}
    },
  },
  watchIngame(selector: (s: any) => any, cb: (v: any) => void) {
    cb(selector(MOCK_SNAPSHOT))
    return () => {}
  },
} as any

provide(ClientKey, mockClient)
</script>

<template>
  <slot />
</template>
