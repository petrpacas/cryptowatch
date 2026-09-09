<script lang="ts">
  const milestones = [
    { label: 'Svelte 5 + TypeScript', state: 'připraveno' },
    { label: 'Lokální Supabase', state: 'připraveno' },
    { label: 'Supabase MCP', state: 'připojeno' },
  ]
</script>

<svelte:head>
  <title>CryptoWatch</title>
</svelte:head>

<main>
  <nav aria-label="Hlavní navigace">
    <a class="brand" href="/" aria-label="CryptoWatch – domů">
      <span class="brand-mark" aria-hidden="true">C</span>
      <span>CryptoWatch</span>
    </a>
    <span class="phase">Milník 1</span>
  </nav>

  <section class="hero">
    <div class="eyebrow">Sleduj trh podle sebe</div>
    <h1>Ceny kryptoměn<br /><span>bez neustálého hlídání.</span></h1>
    <p class="intro">
      Základ aplikace je připravený. V dalších milnících přibude přihlášení, vlastní seznam
      sledovaných měn a jednorázová cenová upozornění.
    </p>

    <div class="actions">
      <a class="primary" href="http://localhost:54323" target="_blank" rel="noreferrer">
        Otevřít Supabase Studio
        <span aria-hidden="true">↗</span>
      </a>
      <a class="secondary" href="https://svelte.dev/docs" target="_blank" rel="noreferrer">
        Dokumentace Svelte
      </a>
    </div>
  </section>

  <section class="status" aria-labelledby="status-heading">
    <div>
      <p class="section-kicker">Stav projektu</p>
      <h2 id="status-heading">Pevný základ pro další práci</h2>
    </div>

    <ul>
      {#each milestones as milestone}
        <li>
          <span class="check" aria-hidden="true">✓</span>
          <span>{milestone.label}</span>
          <small>{milestone.state}</small>
        </li>
      {/each}
    </ul>
  </section>
</main>

<footer>
  <span>Data později poskytne CoinGecko</span>
  <span>Postaveno se Svelte a Supabase</span>
</footer>
