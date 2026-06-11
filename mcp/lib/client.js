// Supabase client for the Course+ MCP server. Reads the suite creds from the
// app's root .env, and (for the server) loads + refreshes Nate's saved session
// so every query runs AS him → per-user RLS scopes rows correctly.
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))      // mcp/lib
const MCP_DIR = join(HERE, '..')                          // mcp/
const ROOT = join(MCP_DIR, '..')                          // repo root
export const SESSION_PATH = join(MCP_DIR, '.session.json')

// Read VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from env or the app's .env.
export function readEnv() {
  let url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  let anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if ((!url || !anon) && existsSync(join(ROOT, '.env'))) {
    const txt = readFileSync(join(ROOT, '.env'), 'utf8')
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      const v = m[2].replace(/^["']|["']$/g, '')
      if (m[1] === 'VITE_SUPABASE_URL') url = url || v
      if (m[1] === 'VITE_SUPABASE_ANON_KEY') anon = anon || v
    }
  }
  if (!url || !anon) throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (set env or repo .env)')
  return { url, anon }
}

export function newClient() {
  const { url, anon } = readEnv()
  return createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false } })
}

export function saveSession(session) {
  writeFileSync(SESSION_PATH, JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token }, null, 2))
}

// For the server: create a client, restore the saved session, refresh it (so a
// stale access token is replaced), persist the new tokens, and return the client.
export async function authedClient() {
  if (!existsSync(SESSION_PATH)) throw new Error('Not signed in — run `npm run login` in the mcp/ folder first.')
  const saved = JSON.parse(readFileSync(SESSION_PATH, 'utf8'))
  const supabase = newClient()
  await supabase.auth.setSession({ access_token: saved.access_token, refresh_token: saved.refresh_token })
  const { data, error } = await supabase.auth.refreshSession()
  if (error || !data?.session) throw new Error('Session expired — run `npm run login` again. ' + (error?.message || ''))
  saveSession(data.session)
  return supabase
}
