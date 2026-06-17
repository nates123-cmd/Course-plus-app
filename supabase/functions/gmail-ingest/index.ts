// gmail-ingest — pull forwarded mail from a Gmail label into the Course+ Inbox.
//
// Flow (runs on a schedule, see EMAIL_FORWARDING.md):
//   1. Refresh a Google access token from a stored refresh token (one-time consent
//      via scripts/gmail-login.mjs).
//   2. List messages carrying the trigger label (default "course-plus").
//   3. For each new message: parse subject / from / plaintext body, optionally
//      route to a project from a leading [Project] / #project subject token,
//      insert a cp_inbox row (under OWNER_ID, bypassing RLS with the service key),
//      record it in cp_email_seen, then strip the trigger label so it is not
//      re-ingested.
//
// Auth: callers must present INGEST_SECRET (header x-ingest-secret or ?key=).
// This endpoint is deployed with verify_jwt=false so cron/pg_net can hit it.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const OWNER_ID = Deno.env.get('OWNER_ID')! // Nate's auth.users uuid — rows file under him
const INGEST_SECRET = Deno.env.get('INGEST_SECRET') || '' // shared secret guarding the endpoint

const G_CLIENT_ID = Deno.env.get('GMAIL_CLIENT_ID')!
const G_CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET')!
// One or more refresh tokens, comma-separated — one per forwarding account.
const G_REFRESH_TOKENS = (Deno.env.get('GMAIL_REFRESH_TOKEN') || '')
  .split(',').map((t) => t.trim()).filter(Boolean)
const LABEL = Deno.env.get('GMAIL_LABEL') || 'course-plus'
const MAX = Number(Deno.env.get('GMAIL_MAX') || '25')

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const G = 'https://gmail.googleapis.com/gmail/v1/users/me'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-ingest-secret, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } })

// ── Google: refresh token → access token ──────────────────────────────
async function googleToken(refresh: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: G_CLIENT_ID, client_secret: G_CLIENT_SECRET,
      refresh_token: refresh, grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error('Google token: ' + (data.error_description || data.error || res.status))
  return data.access_token as string
}

async function gFetch(token: string, path: string, init?: RequestInit) {
  const res = await fetch(G + path, {
    ...init,
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...(init?.headers || {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Gmail ${path}: ` + (data.error?.message || res.status))
  return data
}

// ── base64url → utf-8 string ──────────────────────────────────────────
function b64url(s: string): string {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(norm)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

// Strip HTML to readable-ish plaintext (only used when no text/plain part exists).
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|tr|h\d|li)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n').trim()
}

// Walk the MIME tree; prefer text/plain, fall back to text/html.
function extractBody(payload: any): string {
  let plain = '', html = ''
  const walk = (part: any) => {
    if (!part) return
    const mime = part.mimeType || ''
    const data = part.body?.data
    if (data) {
      if (mime === 'text/plain') plain += b64url(data)
      else if (mime === 'text/html') html += b64url(data)
    }
    ;(part.parts || []).forEach(walk)
  }
  walk(payload)
  const out = plain.trim() || htmlToText(html)
  return out.slice(0, 8000) // generous cap — becomes the note body on triage
}

function header(payload: any, name: string): string {
  const h = (payload?.headers || []).find((x: any) => x.name?.toLowerCase() === name.toLowerCase())
  return h?.value || ''
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// A leading [Token] / (Token) / #Token in the subject targets a project.
// Returns { project, cleanTitle } or null. Matches project name OR id.
function routeFromSubject(subject: string, projects: { id: string; name: string }[]) {
  const m = subject.match(/^\s*(?:\[([^\]]+)\]|\(([^)]+)\)|#(\S+))\s*(.*)$/)
  if (!m) return null
  const token = (m[1] || m[2] || m[3] || '').trim()
  const rest = (m[4] || '').trim()
  const nt = norm(token)
  if (!nt) return null
  const hit = projects.find((p) => norm(p.name) === nt || norm(p.id) === nt)
    || projects.find((p) => norm(p.name).startsWith(nt) && nt.length >= 3)
  if (!hit) return null
  return { project: hit.id, cleanTitle: rest || subject }
}

// ── ingest one account ────────────────────────────────────────────────
// acct prefixes the dedup/inbox keys so two accounts can never collide on a
// shared Gmail message id (ids are unique per-mailbox, not globally).
async function ingestAccount(refresh: string, acct: number, projList: { id: string; name: string }[]) {
  const token = await googleToken(refresh)

  // Resolve trigger label id (needed to strip it after ingest).
  const labels = await gFetch(token, '/labels')
  const want = norm(LABEL) // tolerate "Course Plus" / "course-plus" / "Course+"
  const labelObj = (labels.labels || []).find((l: any) => l.name === LABEL)
    || (labels.labels || []).find((l: any) => norm(l.name) === want)
  if (!labelObj) {
    const names = (labels.labels || []).map((l: any) => l.name).join(', ')
    throw new Error(`Gmail label "${LABEL}" not found. Labels present: ${names}`)
  }
  const labelId = labelObj.id

  // List messages carrying the trigger label.
  const list = await gFetch(token, `/messages?maxResults=${MAX}&q=${encodeURIComponent('label:' + LABEL)}`)
  const ids: string[] = (list.messages || []).map((m: any) => m.id)
  if (!ids.length) return { scanned: 0, items: [] as any[] }

  // Which have we already filed? (keys are namespaced per account)
  const keys = ids.map((id) => `${acct}:${id}`)
  const { data: seenRows } = await admin.from('cp_email_seen').select('message_id').in('message_id', keys)
  const seen = new Set((seenRows || []).map((r: any) => r.message_id))

  const items: any[] = []
  for (const id of ids) {
    const key = `${acct}:${id}`
    if (seen.has(key)) continue
    const msg = await gFetch(token, `/messages/${id}?format=full`)
    const payload = msg.payload || {}
    const subject = header(payload, 'Subject') || '(no subject)'
    const from = header(payload, 'From')
    const body = extractBody(payload)

    const route = routeFromSubject(subject, projList)
    const suggest = route ? { project: route.project, confidence: 0.99 } : null
    const title = route ? route.cleanTitle : subject

    const fromName = from.replace(/<[^>]+>/, '').replace(/"/g, '').trim() || from
    const snippet = (fromName ? `From: ${fromName}\n\n` : '') + body

    const row = {
      id: `email-${acct}-${id}`,
      user_id: OWNER_ID,
      title,
      src: 'Email',
      src_icon: '📧',
      snippet,
      suggest,
      tags: ['email'],
    }
    const { error: insErr } = await admin.from('cp_inbox').upsert(row, { onConflict: 'user_id,id' })
    if (insErr) throw new Error('cp_inbox insert: ' + insErr.message)

    await admin.from('cp_email_seen').upsert({ message_id: key, user_id: OWNER_ID }, { onConflict: 'message_id' })

    // Strip the trigger label so it never re-ingests (also mark read).
    await gFetch(token, `/messages/${id}/modify`, {
      method: 'POST',
      body: JSON.stringify({ removeLabelIds: [labelId, 'UNREAD'] }),
    }).catch(() => {}) // label-strip best-effort; cp_email_seen still dedupes

    items.push({ acct, id, title, project: route?.project || null })
  }

  return { scanned: ids.length, items }
}

// ── handler ───────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const url = new URL(req.url)
  const presented = req.headers.get('x-ingest-secret') || url.searchParams.get('key') || ''
  if (INGEST_SECRET && presented !== INGEST_SECRET) return json({ error: 'unauthorized' }, 401)

  try {
    if (!G_REFRESH_TOKENS.length) return json({ error: 'no GMAIL_REFRESH_TOKEN set' }, 500)

    // Projects for subject-prefix routing (fetched once, shared across accounts).
    const { data: projects } = await admin.from('cp_projects').select('id,name').eq('user_id', OWNER_ID)
    const projList = (projects || []) as { id: string; name: string }[]

    let scanned = 0
    const items: any[] = []
    const errors: string[] = []
    for (let i = 0; i < G_REFRESH_TOKENS.length; i++) {
      try {
        const r = await ingestAccount(G_REFRESH_TOKENS[i], i, projList)
        scanned += r.scanned
        items.push(...r.items)
      } catch (e) {
        // One bad account (e.g. missing label) must not sink the others.
        errors.push(`account ${i}: ${(e as Error)?.message || String(e)}`)
      }
    }

    return json({ ingested: items.length, scanned, items, ...(errors.length ? { errors } : {}) })
  } catch (e) {
    return json({ error: (e as Error)?.message || String(e) }, 500)
  }
})
