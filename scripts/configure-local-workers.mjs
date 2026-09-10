import { spawn } from 'node:child_process'

process.loadEnvFile?.('.env')
process.loadEnvFile?.('supabase/functions/.env')

const container = 'supabase_db_cryptowatch'
const workerSecret = process.env.WORKER_SECRET
const browserSupabaseUrl = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const cronFunctionsUrl = 'http://host.docker.internal:54321/functions/v1'

if (!workerSecret || workerSecret.startsWith('replace-') || workerSecret.length < 24) {
  throw new Error('Doplň do supabase/functions/.env WORKER_SECRET o délce alespoň 24 znaků.')
}

function sqlLiteral(value) {
  if (value.includes('\0')) throw new Error('Hodnota nesmí obsahovat nulový znak.')
  return `'${value.replaceAll("'", "''")}'`
}

function runSql(statement) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'exec',
      '-i',
      container,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-X',
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || `psql skončil s kódem ${code}`))
    })
    child.stdin.end(statement)
  })
}

await runSql(`
  select private.configure_cryptowatch_workers(
    ${sqlLiteral(cronFunctionsUrl)},
    ${sqlLiteral(workerSecret)}
  );
`)

const response = await fetch(`${browserSupabaseUrl}/functions/v1/sync-coins`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-worker-secret': workerSecret,
  },
  body: '{}',
})
const result = await response.json().catch(() => null)
if (!response.ok) {
  throw new Error(`První synchronizace katalogu selhala: ${JSON.stringify(result)}`)
}

console.log(`Vault a tři cron úlohy jsou připravené; katalog obsahuje ${result.active} aktivních měn: OK`)
