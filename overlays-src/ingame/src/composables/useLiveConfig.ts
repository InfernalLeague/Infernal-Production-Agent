import { ref, onMounted, onUnmounted } from 'vue'

// ── Infernal League live-game config (Supabase) ─────────────────────────────
// The overlay does NOT read player names from BlueBottle. Instead, an operator
// configures each broadcast in the website admin panel: pick the two teams, click
// the players that actually play (handles subs), in role order (TOP→SUPPORT), and
// mark which team is on blue/red side. That config lives in public.live_config.
//
// The overlay reads it and shows those names in fixed slots; live stats come from
// BlueBottle, mapped by side + slot index:
//   blue slot i  ↔  scoreboardBottom.teams[0].players[i]   (in-game blue / Order)
//   red  slot i  ↔  scoreboardBottom.teams[1].players[i]   (in-game red  / Chaos)
//
// The publishable key is safe to embed in a client-side overlay: access is bounded
// by the table's RLS policies (anon SELECT).
const SUPABASE_URL = 'https://ldhxoxqewajqgqashyuv.supabase.co'
const SUPABASE_KEY = 'sb_publishable_A97jJEl2pW7Oxd8MPQxRJA_XRQcLHv2'

const HEADERS = {
  apikey:        SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
}

export interface LiveSlot {
  name: string
  role: string | null
}

export interface TeamRecord {
  wins: number
  losses: number
}

const ZERO_RECORD: TeamRecord = { wins: 0, losses: 0 }

export function useLiveConfig(refreshMs = 5_000) {
  // Ordered player slots per side (index 0 = TOP … 4 = SUPPORT).
  const blue = ref<LiveSlot[]>([])
  const red  = ref<LiveSlot[]>([])
  // Season W-L for the two teams currently on stream — computed from
  // public.matches so the Bo1 record text doesn't depend on BlueBottle's
  // totalScore (which requires manual per-broadcast setup).
  const blueRecord = ref<TeamRecord>({ ...ZERO_RECORD })
  const redRecord  = ref<TeamRecord>({ ...ZERO_RECORD })

  async function fetchRecords(blueId: number | null, redId: number | null): Promise<void> {
    const ids = [blueId, redId].filter((n): n is number => Number.isFinite(n))
    if (!ids.length) {
      blueRecord.value = { ...ZERO_RECORD }
      redRecord.value  = { ...ZERO_RECORD }
      return
    }
    const inList = ids.join(',')
    // Regular-season, decided matches involving either team.
    const url = `${SUPABASE_URL}/rest/v1/matches`
      + `?or=(home_team_id.in.(${inList}),away_team_id.in.(${inList}))`
      + `&home_score=not.is.null&away_score=not.is.null`
      + `&select=home_team_id,away_team_id,home_score,away_score,playoff_round`
    const r = await fetch(url, { headers: HEADERS })
    if (!r.ok) {
      console.warn('[overlay] team records fetch failed:', r.status)
      return
    }
    const rows = await r.json() as Array<{
      home_team_id: number; away_team_id: number
      home_score: number | string; away_score: number | string
      playoff_round: string | null
    }>
    const recordFor = (teamId: number | null): TeamRecord => {
      if (!Number.isFinite(teamId as number)) return { ...ZERO_RECORD }
      let wins = 0, losses = 0
      for (const m of rows) {
        if (m.playoff_round) continue // season record = regular season only, matches web
        const isHome = m.home_team_id === teamId
        const isAway = m.away_team_id === teamId
        if (!isHome && !isAway) continue
        const homeWon = Number(m.home_score) > Number(m.away_score)
        const won = isHome ? homeWon : !homeWon
        if (won) wins++
        else     losses++
      }
      return { wins, losses }
    }
    blueRecord.value = recordFor(blueId)
    redRecord.value  = recordFor(redId)
  }

  async function fetchOnce(): Promise<void> {
    try {
      const cfgRes = await fetch(
        `${SUPABASE_URL}/rest/v1/live_config?id=eq.1&select=blue_team_id,red_team_id,blue_players,red_players`,
        { headers: HEADERS },
      )
      if (!cfgRes.ok) {
        console.warn('[overlay] live_config fetch failed:', cfgRes.status)
        return
      }
      const [cfg] = await cfgRes.json()
      if (!cfg) {
        blue.value = []; red.value = []
        blueRecord.value = { ...ZERO_RECORD }
        redRecord.value  = { ...ZERO_RECORD }
        return
      }

      const blueIds: number[] = Array.isArray(cfg.blue_players) ? cfg.blue_players : []
      const redIds:  number[] = Array.isArray(cfg.red_players)  ? cfg.red_players  : []

      // Resolve player ids → { name, role } in one request.
      const allIds = [...new Set([...blueIds, ...redIds])].filter((n) => Number.isFinite(n))
      const byId = new Map<number, LiveSlot>()
      if (allIds.length) {
        const pRes = await fetch(
          `${SUPABASE_URL}/rest/v1/players?id=in.(${allIds.join(',')})&select=id,name,role`,
          { headers: HEADERS },
        )
        if (pRes.ok) {
          for (const p of (await pRes.json()) as any[]) {
            byId.set(p.id, { name: (p.name ?? '').trim(), role: p.role ?? null })
          }
        }
      }

      const slot = (id: number): LiveSlot => byId.get(id) ?? { name: '', role: null }
      blue.value = blueIds.map(slot)
      red.value  = redIds.map(slot)

      const blueTeamId = Number.isFinite(cfg.blue_team_id) ? Number(cfg.blue_team_id) : null
      const redTeamId  = Number.isFinite(cfg.red_team_id)  ? Number(cfg.red_team_id)  : null
      await fetchRecords(blueTeamId, redTeamId)
    } catch (err) {
      // Keep the previous config on a transient network error.
      console.warn('[overlay] live_config fetch error:', err)
    }
  }

  let timer: ReturnType<typeof setInterval> | null = null

  onMounted(() => {
    fetchOnce()                            // immediate on mount
    timer = setInterval(fetchOnce, refreshMs)  // poll so last-minute sub/side changes propagate
  })

  onUnmounted(() => {
    if (timer !== null) clearInterval(timer)
  })

  return { blue, red, blueRecord, redRecord }
}
