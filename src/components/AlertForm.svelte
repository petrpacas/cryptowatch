<script lang="ts">
  import { parseAlertValues, type Alert, type AlertValues } from '../lib/models'
  import { errorMessage } from '../lib/errors'

  let { alert, coinName, busy, onsave, ontoggle, ondelete }: {
    alert?: Alert
    coinName: string
    busy: boolean
    onsave: (values: AlertValues) => Promise<boolean>
    ontoggle?: () => unknown
    ondelete?: () => unknown
  } = $props()
  let validationError = $state('')

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget as HTMLFormElement
    validationError = ''
    try {
      const saved = await onsave(parseAlertValues(new FormData(form)))
      if (saved && !alert) form.reset()
    } catch (error) {
      validationError = errorMessage(error, 'Alert není platný.')
    }
  }
</script>

<form class={alert ? 'alert-row' : 'new-alert'} class:disabled-alert={alert && !alert.isActive}
  aria-label={`${alert ? 'Upravit alert' : 'Nový alert'} pro ${coinName}`} onsubmit={submit}>
  {#if alert}
    <div class="alert-status">
      <span class:active={alert.isActive} class="status-dot" aria-hidden="true"></span>
      <span>{alert.isActive ? 'Aktivní' : 'Vypnutý'}</span>
    </div>
  {/if}
  <label class="control-field">
    <span>{alert ? 'Podmínka' : 'Nová podmínka'}</span>
    <select name="direction" value={alert?.direction ?? 'above'} disabled={busy}>
      <option value="above">Cena je nad</option>
      <option value="below">Cena je pod</option>
    </select>
  </label>
  <label class="control-field">
    <span>Hranice v USD</span>
    <span class="price-input">
      <span class="currency" aria-hidden="true">$</span>
      <input name="threshold" type="number" min="0.00000001" step="any"
        value={alert?.thresholdUsd ?? ''} placeholder="0.00" required disabled={busy} />
    </span>
  </label>
  {#if alert}
    <div class="alert-actions">
      <button class="mini-button" type="submit" disabled={busy}>Uložit</button>
      <button class="mini-button" type="button" disabled={busy} onclick={ontoggle}>{alert.isActive ? 'Vypnout' : 'Zapnout'}</button>
      <button class="icon-button" type="button" disabled={busy} onclick={ondelete} aria-label={`Smazat alert pro ${coinName}`}>×</button>
    </div>
  {:else}
    <button class="secondary-button" type="submit" disabled={busy}>Přidat alert</button>
  {/if}
  {#if validationError}<p class="message error" role="alert">{validationError}</p>{/if}
</form>
