import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

// Capture first, write only on success; a stopped database must not empty the checked-in file.
const types = execFileSync('supabase', ['gen', 'types', 'typescript', '--local', '--schema', 'public'], { encoding: 'utf8' })
if (!types.includes('export type Database =')) throw new Error('Supabase nevrátilo TypeScript schéma.')
writeFileSync('src/lib/database.types.ts', types)
