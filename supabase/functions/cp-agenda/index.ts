// cp-agenda — bearer-gated read of the Course+ time-blocked schedule for OpenClaw.
//
// The Course+ Agenda screen (src/screens/Agenda.jsx) reads `placed_blocks` (the
// Today app's schedule). The existing `course-plus` OpenClaw bridge only exposes
// cp_* tables, so the bot can't see the schedule. This standalone function gives
// it a read path — no edits to the course-plus function required.
//
// Auth: custom bearer in the Authorization header (reuses OPENCLAW_CP_SECRET, the
// same secret the course-plus function already uses). Deploy with verify_jwt=false:
//   supabase functions deploy cp-agenda --no-verify-jwt --project-ref xsmnfcmtbpeaccnyinkr
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase; the
// service role bypasses RLS, so we scope explicitly to the owner uuid.
//
// Body: { date?: "yyyy-mm-dd" (default today), days?: N (default 7, 1..31) }
// For "tomorrow": { date: <tomorrow ISO>, days: 1 }.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SECRET = Deno.env.get('OPENCLAW_CP_SECRET')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const OWNER = '24c79501-4011-46c9-a3d3-a716d732d69c' // Nate
const OWNER_COL = 'user_id' // suite convention; change if placed_blocks differs

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'content-type': 'application/json' } })

// decimal hour -> "9:30am"
function fmtHour(h: number) {
  const hr = Math.floor(h), m = Math.round((h - hr) * 60)
  const ap = hr < 12 ? 'am' : 'pm', h12 = hr % 12 === 0 ? 12 : hr % 12
  return `${h12}:${String(m).padStart(2, '0')}${ap}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if ((req.headers.get('authorization') || '') !== `Bearer ${SECRET}`)
    return json({ ok: false, error: 'unauthorized' }, 401)

  let body: any = {}
  try { body = await req.json() } catch { /* empty body ok */ }

  const start: string = body.date || new Date().toISOString().slice(0, 10)
  const span = Math.min(Math.max(Number(body.days) || 7, 1), 31)
  const end = new Date(start + 'T00:00:00')
  end.setDate(end.getDate() + span - 1)
  const endISO = end.toISOString().slice(0, 10)

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data, error } = await sb
    .from('placed_blocks')
    .select('id,date,hour,duration_minutes,type,title,pillar,source')
    .eq(OWNER_COL, OWNER)
    .gte('date', start)
    .lte('date', endISO)
    .order('date', { ascending: true })
    .order('hour', { ascending: true })

  if (error) return json({ ok: false, error: error.message }, 500)

  const byDay: Record<string, any[]> = {}
  for (const b of data ?? []) {
    (byDay[b.date] ||= []).push({
      time: fmtHour(Number(b.hour)),
      end: fmtHour(Number(b.hour) + b.duration_minutes / 60),
      title: b.title,
      kind: b.type,
      pillar: b.pillar ?? null,
    })
  }
  return json({ ok: true, range: { start, end: endISO }, days: byDay, count: (data ?? []).length })
})
