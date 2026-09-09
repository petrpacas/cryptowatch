<script lang="ts">
  const milestones = [
    { label: 'Databázové schéma', state: 'migrovatelné' },
    { label: 'Row Level Security', state: 'otestováno' },
    { label: 'Katalog CoinGecko', state: 'synchronizován' },
    { label: 'Vyhledávací RPC', state: 'připraveno' },
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
    <span class="phase">Milník 2</span>
  </nav>

  <section class="hero">
    <div class="eyebrow">Sleduj trh podle sebe</div>
    <h1>Ceny kryptoměn<br /><span>bez neustálého hlídání.</span></h1>
    <p class="intro">
      Databáze umí bezpečně oddělit data uživatelů a vyhledat libovolnou aktivní měnu
      z katalogu CoinGecko. V dalším milníku přibude přihlášení a správa vlastního seznamu.
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
      <h2 id="status-heading">Databáze a katalog jsou připravené</h2>
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
  <span>Data poskytuje CoinGecko</span>
  <span>Postaveno se Svelte a Supabase</span>
</footer>
