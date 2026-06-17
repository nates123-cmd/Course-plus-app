#!/usr/bin/env node
// One-time Google consent for the gmail-ingest edge function. Runs the installed-app
// OAuth loopback flow, then prints the long-lived refresh token + the exact
// `supabase secrets set` commands to wire it into the deployed function.
//
// Prereq: a Google Cloud OAuth client of type "Desktop app" (see EMAIL_FORWARDING.md).
// Pass its credentials via env or you'll be prompted:
//   GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... node scripts/gmail-login.mjs
import { createServer } from 'node:http'
import { createInterface } from 'node:readline/promises'
import { spawn } from 'node:child_process'

const SCOPE = 'https://www.googleapis.com/auth/gmail.modify' // read + label/archive; add gmail.send later if needed

const rl = createInterface({ input: process.stdin, output: process.stdout })
const ask = async (q, fallback) => (process.env[fallback] || (await rl.question(q)).trim())

const clientId = await ask('Google OAuth Client ID: ', 'GMAIL_CLIENT_ID')
const clientSecret = await ask('Google OAuth Client Secret: ', 'GMAIL_CLIENT_SECRET')
if (!clientId || !clientSecret) { console.error('client id + secret required'); process.exit(1) }

// Loopback redirect — Google allows http://127.0.0.1:<any-port> for Desktop clients.
let redirectUri = ''
const code = await new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1')
    if (u.pathname !== '/cb') { res.writeHead(404); res.end(); return }
    const c = u.searchParams.get('code')
    const err = u.searchParams.get('error')
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<html><body style="font-family:sans-serif;padding:40px"><h2>${c ? '✓ Connected — close this tab and return to the terminal.' : '✗ ' + (err || 'no code')}</h2></body></html>`)
    server.close()
    c ? resolve(c) : reject(new Error(err || 'no code'))
  })
  server.listen(0, '127.0.0.1', () => {
    redirectUri = `http://127.0.0.1:${server.address().port}/cb`
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    auth.search = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
      scope: SCOPE, access_type: 'offline', prompt: 'consent',
    }).toString()
    console.log('\nOpen this URL, pick the account you forward mail from, and approve:\n\n' + auth + '\n')
    spawn('open', [auth.toString()]).on('error', () => {}) // best-effort auto-open (macOS)
  })
}).catch((e) => { console.error('\n✗ Consent failed:', e.message); process.exit(1) })

const res = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: clientId, client_secret: clientSecret,
    code, redirect_uri: redirectUri, grant_type: 'authorization_code',
  }),
})
const data = await res.json()
rl.close()
if (!res.ok || !data.refresh_token) {
  console.error('\n✗ Token exchange failed:', data.error_description || data.error || JSON.stringify(data))
  console.error('  (If no refresh_token came back, revoke the app at myaccount.google.com/permissions and rerun — Google only returns it on first consent.)')
  process.exit(1)
}

console.log('\n✓ Got a refresh token. Set these Supabase secrets:\n')
console.log(`supabase secrets set \\
  GMAIL_CLIENT_ID='${clientId}' \\
  GMAIL_CLIENT_SECRET='${clientSecret}' \\
  GMAIL_REFRESH_TOKEN='${data.refresh_token}' \\
  --project-ref xsmnfcmtbpeaccnyinkr\n`)
console.log('Then set OWNER_ID (your auth.users uuid) and INGEST_SECRET (any random string) too — see EMAIL_FORWARDING.md.')
