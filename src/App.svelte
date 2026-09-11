<script lang="ts">
  import { onMount } from 'svelte'
  import type { Session } from '@supabase/supabase-js'
  import AuthPanel from './components/AuthPanel.svelte'
  import Dashboard from './components/Dashboard.svelte'
  import { getSupabaseClient, type AppClient } from './lib/supabase'
  import { errorMessage } from './lib/errors'

  let client = $state<AppClient | null>(null)
  let session = $state<Session | null>(null)
  let authReady = $state(false)
  let configError = $state('')

  onMount(() => {
    try {
      client = getSupabaseClient()
      // Keep the auth callback synchronous; data loading belongs to Dashboard.
      const { data: { subscription } } = client.auth.onAuthStateChange((_event, nextSession) => {
        session = nextSession
        authReady = true
      })
      return () => subscription.unsubscribe()
    } catch (error) {
      configError = errorMessage(error, 'Nepodařilo se načíst konfiguraci.')
      authReady = true
    }
  })
</script>

<svelte:head>
  <title>{session ? 'Moje sledování' : 'Přihlášení'} · CryptoWatch</title>
  <meta name="description" content="Sleduj ceny kryptoměn a nastav si vlastní jednorázová upozornění." />
</svelte:head>

{#if !authReady}
  <main class="centered-state">
    <div class="spinner" aria-hidden="true"></div>
    <p role="status">Obnovuji relaci…</p>
  </main>
{:else if configError || !client}
  <main class="centered-state">
    <span class="brand-mark" aria-hidden="true">C</span>
    <h1>Aplikaci se nepodařilo spustit</h1>
    <p>{import.meta.env.DEV ? configError : 'Chybí konfigurace připojení. Kontaktuj správce aplikace.'}</p>
  </main>
{:else if session}
  {#key session.user.id}
    <Dashboard {client} user={session.user} />
  {/key}
{:else}
  <AuthPanel {client} />
{/if}
