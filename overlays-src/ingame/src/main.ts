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

client.connect()
