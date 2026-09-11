import { test, expect, type Page } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'

const apiUrl = 'http://127.0.0.1:54321'
const user = { id: 'user-one', email: 'review@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
const coin = { id: 'bitcoin', name: 'Bitcoin', symbol: 'btc', coingecko_url: 'https://www.coingecko.com/en/coins/bitcoin', is_watched: false }
const price = { price_usd: 60000, provider_updated_at: '2026-09-11T10:00:00Z', fetched_at: '2026-09-11T10:02:00Z' }

type AlertRow = { id: string; watchlist_id: string; direction: string; threshold_usd: number; is_active: boolean }

async function mockApi(page: Page, signedIn = true) {
  let watched = false
  let alerts: AlertRow[] = []
  let refreshes = 0
  let failLoad = false
  let failAdd = false
  const writes: string[] = []
  if (signedIn) {
    await page.addInitScript(({ user }) => {
      localStorage.setItem('sb-127-auth-token', JSON.stringify({
        access_token: 'test-access-token', refresh_token: 'test-refresh-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600,
        token_type: 'bearer', user,
      }))
    }, { user })
  }
  await page.route(`${apiUrl}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data })
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
    if (url.pathname.endsWith('/logout')) return json({})
    if (url.pathname.endsWith('/user')) return json(user)
    if (url.pathname.endsWith('/otp')) return json({})
    if (url.pathname.endsWith('/search_coins')) return json([{ ...coin, is_watched: watched }])
    if (url.pathname.endsWith('/refresh-prices')) {
      refreshes++
      return json({ watchedCoins: 1, failedBatches: 0, pricesUpdated: 1, eventsCreated: 0, failures: [] })
    }
    if (url.pathname.endsWith('/watchlist')) {
      if (method === 'POST') {
        if (failAdd) return json({ message: 'Testovací chyba přidání' }, 500)
        watched = true; writes.push('add'); return json(null, 201)
      }
      if (method === 'DELETE') { watched = false; alerts = []; writes.push('remove'); return json(null) }
      if (failLoad) return json({ message: 'Testovací výpadek databáze' }, 500)
      return json(watched ? [{ id: 'watch-one', coin_id: coin.id, coins: { ...coin, is_active: true, prices: refreshes ? price : null } }] : [])
    }
    if (url.pathname.endsWith('/alerts')) {
      if (method === 'POST') {
        alerts.push({ id: 'alert-one', ...request.postDataJSON() })
        alerts[0]!.is_active = true
        writes.push('create-alert')
      }
      if (method === 'PATCH') { Object.assign(alerts[0]!, request.postDataJSON()); writes.push('update-alert') }
      if (method === 'DELETE') { alerts = []; writes.push('delete-alert') }
      return json(method === 'GET' ? alerts : null)
    }
    throw new Error(`Unexpected API request: ${method} ${url.pathname}`)
  })
  return {
    writes,
    failLoad: (value: boolean) => { failLoad = value },
    failAdd: (value: boolean) => { failAdd = value },
    get refreshes() { return refreshes },
  }
}

async function addBitcoin(page: Page) {
  const search = page.getByRole('searchbox', { name: 'Hledat kryptoměnu' })
  await search.fill('bitcoin')
  await page.getByRole('button', { name: 'Přidat', exact: true }).click()
  await expect(search).toHaveValue('')
  await expect(search).toBeFocused()
  await expect(page.locator('.search-results')).toHaveCount(0)
  await expect(page.locator('.search-panel').getByRole('status')).toContainText('Bitcoin je nyní ve sledovaných.')
  await expect(page.getByRole('heading', { name: 'Bitcoin', exact: true })).toBeVisible()
}

test('watchlist, manual refresh and alert lifecycle work after component split', async ({ page }) => {
  const state = await mockApi(page)
  await page.goto('/')
  await addBitcoin(page)
  await page.getByRole('button', { name: 'Aktualizovat ceny' }).click()
  await expect(page.locator('.watchlist-section').getByRole('status')).toContainText('Aktualizované ceny: 1.')
  await expect(page.getByText('Načteno', { exact: false })).toBeVisible()
  expect(state.refreshes).toBe(1)

  const form = page.getByRole('form', { name: 'Nový alert pro Bitcoin' })
  await form.getByRole('spinbutton').fill('65000')
  await form.getByRole('button', { name: 'Přidat alert' }).click()
  await expect(form.getByRole('spinbutton')).toHaveValue('')
  const edit = page.getByRole('form', { name: 'Upravit alert pro Bitcoin' })
  await edit.getByRole('spinbutton').fill('70000')
  await edit.getByRole('button', { name: 'Uložit' }).click()
  await expect(page.locator('.coin-card').getByRole('status')).toContainText('Alert byl uložen.')
  await edit.getByRole('button', { name: 'Vypnout', exact: true }).click()
  await expect(edit.getByText('Vypnutý')).toBeVisible()
  await edit.getByRole('button', { name: 'Zapnout', exact: true }).click()
  await expect(edit.getByText('Aktivní', { exact: true })).toBeVisible()
  await edit.getByRole('button', { name: 'Smazat alert pro Bitcoin' }).click()
  await expect(edit).toHaveCount(0)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Odebrat Bitcoin ze sledovaných včetně alertů' }).click()
  await expect(page.getByText('Zatím nic nesleduješ')).toBeVisible()
  await expect(page.locator('.watchlist-section').getByRole('status')).toContainText('Bitcoin byla odebrána.')
  expect(state.writes).toEqual(['add', 'create-alert', 'update-alert', 'update-alert', 'update-alert', 'delete-alert', 'remove'])
})

test('failed loads stay distinct from an empty watchlist and can be retried', async ({ page }) => {
  const state = await mockApi(page)
  state.failLoad(true)
  await page.goto('/')
  await expect(page.locator('.watchlist-section').getByRole('alert')).toContainText('Testovací výpadek')
  await expect(page.getByText('Zatím nic nesleduješ')).toHaveCount(0)
  state.failLoad(false)
  await page.getByRole('button', { name: 'Zkusit znovu' }).click()
  await expect(page.getByText('Zatím nic nesleduješ')).toBeVisible()
})

test('logging out discards an outstanding search', async ({ page }) => {
  await mockApi(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/rest/v1/rpc/search_coins', async (route) => {
    await gate
    await route.fulfill({ json: [coin] }).catch(() => {})
  })
  await page.goto('/')
  const request = page.waitForRequest('**/rest/v1/rpc/search_coins')
  await page.getByRole('searchbox').fill('bitcoin')
  await request
  await page.getByRole('button', { name: 'Odhlásit' }).click()
  release()
  await expect(page.getByRole('heading', { name: 'Přihlášení' })).toBeVisible()
  await expect(page.getByRole('searchbox')).toHaveCount(0)
})

test('login and populated dashboard pass automated a11y and fit the viewport', async ({ page }, testInfo) => {
  await mockApi(page)
  await page.goto('/')
  await addBitcoin(page)
  await page.screenshot({ path: testInfo.outputPath('dashboard-or-login.png'), fullPage: true })
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Odhlásit' }).click()
  await expect(page.getByRole('heading', { name: 'Přihlášení' })).toBeVisible()
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('magic link reports success and recovers from provider errors', async ({ page }) => {
  await mockApi(page, false)
  await page.goto('/')
  await page.route('**/auth/v1/otp**', (route) => route.fulfill({ status: 429, json: { msg: 'Zkus to později', code: 'over_email_send_rate_limit' } }))
  await page.getByRole('textbox', { name: 'E-mail', exact: true }).fill('review@example.test')
  await page.getByRole('button', { name: 'Poslat magic link' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Poslat magic link' })).toBeEnabled()
  await page.unroute('**/auth/v1/otp**')
  await page.getByRole('button', { name: 'Poslat magic link' }).click()
  await expect(page.getByRole('status')).toContainText('Zkontroluj e-mail')
})

test('a rejected refresh releases controls and displays a useful cooldown message', async ({ page }) => {
  await mockApi(page)
  await page.goto('/')
  await addBitcoin(page)
  await page.route('**/functions/v1/refresh-prices', (route) => route.fulfill({ status: 429, json: { error: 'rate limited' } }))
  await page.getByRole('button', { name: 'Aktualizovat ceny' }).click()
  await expect(page.locator('.watchlist-section').getByRole('alert')).toContainText('jednou za minutu')
  await expect(page.getByRole('button', { name: 'Aktualizovat ceny' })).toBeEnabled()
})

test('an add error stays with the catalog and does not look like a watchlist load failure', async ({ page }) => {
  const state = await mockApi(page)
  state.failAdd(true)
  await page.goto('/')
  await page.getByRole('searchbox', { name: 'Hledat kryptoměnu' }).fill('bitcoin')
  await page.getByRole('button', { name: 'Přidat', exact: true }).click()
  await expect(page.locator('.search-panel').getByRole('alert')).toContainText('Testovací chyba přidání')
  await expect(page.locator('.watchlist-section').getByText('Seznam se nepodařilo načíst')).toHaveCount(0)
  await expect(page.getByText('Zatím nic nesleduješ')).toBeVisible()
})

test('a superseded search cannot replace newer results; Escape closes the results', async ({ page }) => {
  await mockApi(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/rest/v1/rpc/search_coins', async (route) => {
    if (route.request().postDataJSON().search_query === 'bitcoin') {
      await gate
      await route.fulfill({ json: [coin] }).catch(() => {})
    } else {
      await route.fulfill({ json: [{ ...coin, id: 'ethereum', name: 'Ethereum', symbol: 'eth' }] })
    }
  })
  await page.goto('/')
  const input = page.getByRole('searchbox')
  const first = page.waitForRequest('**/rest/v1/rpc/search_coins')
  await input.fill('bitcoin')
  await first
  await input.fill('ethereum')
  await expect(page.locator('.search-results')).toContainText('Ethereum')
  release()
  await expect(page.locator('.search-results')).not.toContainText('Bitcoin')
  await input.press('Escape')
  await expect(input).toHaveValue('')
  await expect(page.locator('.search-results')).toHaveCount(0)
})
