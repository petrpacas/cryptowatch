<script lang="ts">
  import type { AppClient } from '../lib/supabase'
  import { errorMessage as describeError } from '../lib/errors'

  let { client }: { client: AppClient } = $props()
  let email = $state('')
  let authBusy = $state(false)
  let magicLinkSent = $state(false)
  let errorMessage = $state('')

  async function sendMagicLink() {
    if (authBusy || !email.trim()) return
    authBusy = true
    errorMessage = ''
    try {
      const { error } = await client.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/`, shouldCreateUser: true },
      })
      if (error) throw error
      magicLinkSent = true
    } catch (error) {
      errorMessage = describeError(error, 'Magic link se nepodařilo odeslat.')
    } finally {
      authBusy = false
    }
  }

  async function signInWithGoogle() {
    if (authBusy) return
    authBusy = true
    errorMessage = ''
    try {
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/` },
      })
      if (error) throw error
    } catch (error) {
      errorMessage = describeError(error, 'Google přihlášení se nepodařilo spustit.')
    } finally {
      authBusy = false
    }
  }
</script>

<main class="auth-layout">
  <section class="auth-intro">
    <a class="brand" href="/" aria-label="CryptoWatch – domů">
      <span class="brand-mark" aria-hidden="true">C</span>
      <span>CryptoWatch</span>
    </a>
    <div>
      <p class="eyebrow">Tvůj osobní watchlist</p>
      <h1>Trh se hýbe.<br /><span>Ty nemusíš čekat.</span></h1>
      <p class="intro">Vyber si kryptoměny z katalogu CoinGecko a nastav cenu, při které tě CryptoWatch upozorní.</p>
    </div>
    <p class="data-credit">Cenová data poskytuje CoinGecko</p>
  </section>
  <section class="auth-card" aria-labelledby="login-heading">
    <div>
      <p class="section-kicker">Bez hesla</p>
      <h2 id="login-heading">Přihlášení</h2>
      <p class="muted">Pošleme ti bezpečný přihlašovací odkaz na e-mail.</p>
    </div>
    {#if magicLinkSent}
      <div class="success-panel" role="status">
        <span aria-hidden="true">✓</span>
        <div>
          <strong>Zkontroluj e-mail</strong>
          <p>Odkaz jsme poslali na {email}.</p>
        </div>
      </div>
      <button class="text-button" type="button" onclick={() => (magicLinkSent = false)}>Použít jiný e-mail</button>
    {:else}
      <form class="auth-form" onsubmit={(event) => { event.preventDefault(); void sendMagicLink() }}>
        <label for="email">E-mail</label>
        <input id="email" type="email" autocomplete="email" placeholder="ty@example.com" required bind:value={email} />
        <button class="primary-button" type="submit" disabled={authBusy}>{authBusy ? 'Odesílám…' : 'Poslat magic link'}</button>
      </form>
      <div class="divider"><span>nebo</span></div>
      <button class="google-button" type="button" disabled={authBusy} onclick={signInWithGoogle}>
        <span class="google-mark" aria-hidden="true">G</span>
        Pokračovat přes Google
      </button>
    {/if}
    {#if errorMessage}<p class="message error" role="alert">{errorMessage}</p>{/if}
    {#if import.meta.env.DEV}
      <p class="auth-note">Lokální e-maily otevřeš na <a href="http://localhost:54324" target="_blank" rel="noreferrer">localhost:54324</a>.</p>
    {/if}
  </section>
</main>
