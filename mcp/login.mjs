#!/usr/bin/env node
// One-time login for the Course+ MCP server. Emails you an 8-digit OTP, verifies
// it, and saves the session (refresh token) to mcp/.session.json so the server
// can act as you (per-user RLS). Re-run if the session ever expires.
import { createInterface } from 'node:readline/promises'
import { newClient, saveSession, SESSION_PATH } from './lib/client.js'

const rl = createInterface({ input: process.stdin, output: process.stdout })
const supabase = newClient()

try {
  const email = (await rl.question('Course+ email: ')).trim()
  if (!email) throw new Error('email required')
  const { error: e1 } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
  if (e1) throw e1
  console.log(`\nSent an 8-digit code to ${email}.`)
  const token = (await rl.question('Enter the code: ')).replace(/\D/g, '').slice(0, 8)
  const { data, error: e2 } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
  if (e2) throw e2
  if (!data?.session) throw new Error('no session returned')
  saveSession(data.session)
  console.log(`\n✓ Signed in. Session saved to ${SESSION_PATH}`)
  console.log('  Add the server to Claude Desktop (see mcp/README.md), then restart Desktop.')
} catch (e) {
  console.error('\n✗ Login failed:', e?.message || e)
  process.exitCode = 1
} finally {
  rl.close()
}
