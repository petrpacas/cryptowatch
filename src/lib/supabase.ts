import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | undefined

export function getSupabaseConfig() {
  const url = import.meta.env.VITE_SUPABASE_URL
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

  if (!url || !publishableKey) {
    throw new Error('Chybí VITE_SUPABASE_URL nebo VITE_SUPABASE_PUBLISHABLE_KEY v .env.')
  }

  return { url, publishableKey }
}

export function getSupabaseClient(): SupabaseClient {
  if (client) return client

  const { url, publishableKey } = getSupabaseConfig()
  client = createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
  return client
}
