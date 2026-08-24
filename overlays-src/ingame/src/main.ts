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

app.mount('#app')

// V mock režimu (?mock v URL, nebo dev build) shadowuje DevMock reálného klienta.
// Přeskoč connect(), ať se nespamuje konzole WebSocket chybami k LeagueBroadcastu.
const DEV_MOCK = new URLSearchParams(location.search).has('mock')
  || (import.meta.env.DEV && import.meta.env.VITE_MOCK !== 'false')
if (!DEV_MOCK) {
  client.connect()
}
