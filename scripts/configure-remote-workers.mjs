import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'

process.loadEnvFile(process.env.CRYPTOWATCH_FUNCTIONS_ENV ?? 'supabase/functions/.env')

const workerSecret = process.env.WORKER_SECRET
const explicitProjectRef = process.env.SUPABASE_PROJECT_REF?.trim()

if (!workerSecret || workerSecret.startsWith('replace-') || workerSecret.length < 24) {
  throw new Error('Doplň do supabase/functions/.env WORKER_SECRET o délce alespoň 24 znaků.')
}

async function getProjectRef() {
  if (explicitProjectRef) return explicitProjectRef

  try {
    return (await readFile('supabase/.temp/project-ref', 'utf8')).trim()
  } catch {
    throw new Error(
      'Projekt není propojený. Spusť supabase link --project-ref <project-ref> nebo nastav SUPABASE_PROJECT_REF.',
    )
  }
}

function sqlLiteral(value) {
  if (value.includes('\0')) throw new Error('Hodnota nesmí obsahovat nulový znak.')
  return `'${value.replaceAll("'", "''")}'`
}

function runRemoteSql(statement) {
  return new Promise((resolve, reject) => {
    const child = spawn('supabase', ['db', 'query', '--linked'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.replaceAll(workerSecret, '[redacted]').trim() || stdout.replaceAll(workerSecret, '[redacted]').trim() || `supabase db query skončil s kódem ${code}`))
    })
    child.stdin.end(statement)
  })
}

const projectRef = await getProjectRef()
if (!/^[a-z]{20}$/.test(projectRef)) {
  throw new Error('Supabase project ref musí obsahovat přesně 20 malých písmen.')
}

const functionsUrl = `https://${projectRef}.supabase.co/functions/v1`

await runRemoteSql(`
  select private.configure_cryptowatch_workers(
    ${sqlLiteral(functionsUrl)},
    ${sqlLiteral(workerSecret)}
  );
`)

const response = await fetch(`${functionsUrl}/sync-coins`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-worker-secret': workerSecret,
  },
  body: '{}',
})
const result = await response.json().catch(() => null)

if (!response.ok) {
  throw new Error(`První vzdálená synchronizace katalogu selhala: ${JSON.stringify(result)}`)
}

console.log(`Produkční Vault, cron a katalog (${result.active} aktivních měn) jsou připravené: OK`)
