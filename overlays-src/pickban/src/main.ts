import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { LeagueBroadcastClient } from '@bluebottle_gg/league-broadcast-client'
import App from './App.vue'
import { ClientKey, defaultClientConfig } from './client'
import './style.css'

const app = createApp(App)
app.use(createPinia())

const client = new LeagueBroadcastClient(defaultClientConfig)
app.provide(ClientKey, client)

// Debug aid: expose client + a champ-select dump helper on window.
// In the browser console run:  __csDump()
;(window as any).__overlayClient = client
;(window as any).__csDump = () => {
  const d: any = client.getChampSelectData?.()
  const out = {
    bestOfType: d?.metaData?.bestOfType,
    matchType:  d?.metaData?.matchData?.type,
    blue: {
      tag:      d?.blueTeam?.metaData?.tag,
      match:    d?.blueTeam?.scoreMatch,
      season:   d?.blueTeam?.scoreSeason,
      fearless: d?.blueTeam?.fearlessBans,
    },
    red: {
      tag:      d?.redTeam?.metaData?.tag,
      match:    d?.redTeam?.scoreMatch,
      season:   d?.redTeam?.scoreSeason,
      fearless: d?.redTeam?.fearlessBans,
    },
  }
  console.log('[__csDump]', JSON.stringify(out, null, 2))
  return out
}
;(window as any).__fearlessDump = async () => {
  const d: any = client.getChampSelectData?.()
  const blueId = d?.blueTeam?.metaData?.teamId
  const redId  = d?.redTeam?.metaData?.teamId
  try {
    const bans: any = await (client as any).api?.match?.getBans()
    console.log('[__fearlessDump] blueTeamId =', blueId, ' redTeamId =', redId)
    console.log('[__fearlessDump] typeof blueId =', typeof blueId)

    // 1) One full champion object — to confirm squareImg / image fields exist.
    let firstChamp: any = null
    for (const g of Object.values(bans ?? {})) {
      for (const arr of Object.values(g as any)) {
        if (Array.isArray(arr) && arr.length) { firstChamp = arr[0]; break }
      }
      if (firstChamp) break
    }
    console.log('[__fearlessDump] sample champion object =', JSON.stringify(firstChamp, null, 2))

    // 2) Replicate buildFearless() with the live team ids.
    const build = (teamId: any) => {
      const gameIds = Object.keys(bans ?? {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b)
      const out: any[] = []
      gameIds.forEach((gid, idx) => {
        const champs = bans?.[gid]?.[teamId] ?? []
        out.push({ gameId: gid, gameNum: idx + 1, count: champs.length })
      })
      return out
    }
    console.log('[__fearlessDump] buildFearless(blue) =', JSON.stringify(build(blueId)))
    console.log('[__fearlessDump] buildFearless(red)  =', JSON.stringify(build(redId)))
    return { blueId, redId, firstChamp, blue: build(blueId), red: build(redId) }
  } catch (e) {
    console.warn('[__fearlessDump] getBans() failed:', e)
    return { blueId, redId, error: String(e) }
  }
}

app.mount('#app')

// V mock režimu (?mock v URL, nebo dev build) shadowuje DevMock reálného klienta.
// Přeskoč connect(), ať se nespamuje konzole WebSocket chybami k LeagueBroadcastu.
const DEV_MOCK = new URLSearchParams(location.search).has('mock')
  || (import.meta.env.DEV && import.meta.env.VITE_MOCK !== 'false')
if (!DEV_MOCK) {
  client.connect()
}
