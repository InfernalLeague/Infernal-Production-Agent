import { inject, type InjectionKey } from 'vue'
import { LeagueBroadcastClient, type LeagueBroadcastClientConfig } from '@bluebottle_gg/league-broadcast-client'

export const ClientKey: InjectionKey<LeagueBroadcastClient> = Symbol('LeagueBroadcastClient')

export const defaultClientConfig: LeagueBroadcastClientConfig = {
  host: 'localhost',
  port: 58869,
  autoConnect: false,
}

export function useClient(): LeagueBroadcastClient {
  const client = inject(ClientKey)
  if (!client) {
    throw new Error('[overlay] LeagueBroadcastClient not provided. Make sure to provide it in main.ts.')
  }
  return client
}
