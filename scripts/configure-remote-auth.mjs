import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

process.loadEnvFile?.('.env')
process.loadEnvFile?.('supabase/functions/.env')

const publicSiteUrl = process.argv[2]?.replace(/\/$/, '')
const explicitProjectRef = process.env.SUPABASE_PROJECT_REF?.trim()
const googleClientId = process.env.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID
const googleClientSecret = process.env.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET
const resendApiKey = process.env.RESEND_API_KEY
const resendFrom = process.env.RESEND_FROM?.trim()

if (!publicSiteUrl || !URL.canParse(publicSiteUrl) || new URL(publicSiteUrl).protocol !== 'https:') {
  throw new Error('Předej produkční HTTPS URL, například: npm run auth:configure:remote -- https://web.netlify.app')
}

for (const [name, value] of Object.entries({
  SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: googleClientId,
  SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET: googleClientSecret,
  RESEND_API_KEY: resendApiKey,
  RESEND_FROM: resendFrom,
})) {
  if (!value || /replace|example|your_|placeholder/i.test(value)) {
    throw new Error(`Doplň produkční hodnotu ${name} do příslušného ignorovaného env souboru.`)
  }
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

function parseSender(value) {
  const match = value.match(/^(.+?)\s*<([^<>]+)>$/)
  const email = (match?.[2] ?? value).trim()
  const name = match?.[1]?.trim().replace(/^['"]|['"]$/g, '') || 'CryptoWatch'

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('RESEND_FROM musí být e-mail nebo tvar CryptoWatch <alerts@example.com>.')
  }

  return { email, name }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} skončil s kódem ${code}`))
    })
  })
}

const projectRef = await getProjectRef()
if (!/^[a-z]{20}$/.test(projectRef)) {
  throw new Error('Supabase project ref musí obsahovat přesně 20 malých písmen.')
}

const sender = parseSender(resendFrom)
const siteHostname = new URL(publicSiteUrl).hostname
const previewUrl = `https://**--${siteHostname}/**`
const config = `project_id = ${JSON.stringify(projectRef)}

[auth]
site_url = ${JSON.stringify(publicSiteUrl)}
additional_redirect_urls = [
  ${JSON.stringify(`${publicSiteUrl}/**`)},
  ${JSON.stringify('http://localhost:5173/**')},
  ${JSON.stringify('http://127.0.0.1:5173/**')},
  ${JSON.stringify(previewUrl)},
]

[auth.email.smtp]
enabled = true
host = "smtp.resend.com"
port = 587
user = "resend"
pass = "env(RESEND_API_KEY)"
admin_email = ${JSON.stringify(sender.email)}
sender_name = ${JSON.stringify(sender.name)}

[auth.external.google]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)"
redirect_uri = ""
url = ""
skip_nonce_check = false
email_optional = false
`

const temporaryRoot = await mkdtemp(join(tmpdir(), 'cryptowatch-auth-'))

try {
  const supabaseDirectory = join(temporaryRoot, 'supabase')
  await mkdir(supabaseDirectory)
  await writeFile(join(supabaseDirectory, 'config.toml'), config, { mode: 0o600 })
  await run('supabase', [
    'config',
    'push',
    '--project-ref',
    projectRef,
    '--workdir',
    temporaryRoot,
    '--yes',
  ], {
    env: {
      ...process.env,
      SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: googleClientId,
      SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET: googleClientSecret,
      RESEND_API_KEY: resendApiKey,
    },
  })
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}

console.log(`Produkční Auth URL, Google provider a Resend SMTP jsou nastavené pro ${publicSiteUrl}: OK`)
