import { readFileSync, writeFileSync } from 'node:fs'
import { magicLinkEmail } from '../supabase/functions/_shared/email-layout.ts'

const path = 'supabase/templates/magic-link.html'
const html = `${magicLinkEmail()}\n`
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== html) throw new Error('Auth šablona není aktuální. Spusť npm run emails:build.')
} else {
  writeFileSync(path, html)
}
