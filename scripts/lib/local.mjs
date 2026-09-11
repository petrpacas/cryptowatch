export function assertLocalUrl(value) {
  if (!value || !URL.canParse(value)) throw new Error('Chybí platná lokální Supabase URL.')
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Tento skript je určený pouze pro lokální Supabase. Zkontroluj VITE_SUPABASE_URL.')
  }
}
