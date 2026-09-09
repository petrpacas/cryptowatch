const endpoint = 'http://127.0.0.1:54321/mcp'
let requestId = 0
let sessionId

function parseResponse(body) {
  const dataLines = body
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())

  const payload = dataLines.at(-1) ?? body
  return JSON.parse(payload)
}

async function rpc(method, params) {
  requestId += 1
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
  })

  if (!response.ok) throw new Error(`MCP odpověděl HTTP ${response.status}.`)
  sessionId ??= response.headers.get('mcp-session-id') ?? undefined

  const payload = parseResponse(await response.text())
  if (payload.error) throw new Error(payload.error.message)
  return payload.result
}

try {
  const initialized = await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'cryptowatch-mcp-check', version: '1.0.0' },
  })

  const tools = await rpc('tools/list', {})
  const listTables = tools.tools.find((tool) => tool.name === 'list_tables')
  if (!listTables) throw new Error('MCP nenabízí nástroj list_tables.')

  const tables = await rpc('tools/call', {
    name: listTables.name,
    arguments: { schemas: ['public'] },
  })

  console.log(`MCP: ${initialized.serverInfo?.name ?? 'Supabase'} ${initialized.serverInfo?.version ?? ''}`)
  console.log(`Dostupných nástrojů: ${tools.tools.length}`)

  const tableText = tables.content?.find((item) => item.type === 'text')?.text
  const parsedTables = tableText ? JSON.parse(tableText) : []
  const tableList = Array.isArray(parsedTables) ? parsedTables : (parsedTables.tables ?? [])
  const tableNames = tableList.map((table) =>
    table.name.includes('.') ? table.name : `${table.schema}.${table.name}`,
  )

  console.log(`Tabulky v public: ${tableNames.join(', ') || 'žádné'}`)

  const expectedTables = ['coins', 'watchlist', 'alerts', 'prices', 'notification_events']
  const missingTables = expectedTables.filter(
    (expected) => !tableNames.includes(`public.${expected}`),
  )
  if (missingTables.length > 0) {
    throw new Error(`MCP nevidí očekávané tabulky: ${missingTables.join(', ')}`)
  }

  const tablesWithoutRls = tableList.filter((table) => table.rls_enabled === false)
  if (tablesWithoutRls.length > 0) {
    throw new Error(`RLS není zapnuté na: ${tablesWithoutRls.map((table) => table.name).join(', ')}`)
  }

  if (tables.isError) process.exitCode = 1
} catch (error) {
  console.error(`Kontrola MCP selhala: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
