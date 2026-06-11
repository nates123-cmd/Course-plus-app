// Course+ remote MCP server — one Supabase Edge Function that is BOTH:
//   1. an MCP server over Streamable HTTP (JSON-RPC) — read + write cp_* data
//   2. a minimal OAuth 2.1 authorization server (discovery + DCR + authorize +
//      token, PKCE-enforced) so claude.ai (web) / Claude Desktop can connect.
//
// The host Claude is the client (billed to your subscription). Every data query
// runs AS the signed-in user via their Supabase session → per-user RLS.
//
// Deployed with verify_jwt=false because it implements its own auth (OAuth
// bearer tokens + unauthenticated OAuth discovery endpoints).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Public base URL of this function (used in OAuth metadata — hardcode so it
// can't be spoofed via Host header).
const BASE = Deno.env.get('MCP_BASE_URL') || `${SUPABASE_URL}/functions/v1/mcp`
// Only this email may ever mint a session. Single-tenant safety net.
const ALLOWED_EMAIL = (Deno.env.get('MCP_ALLOWED_EMAIL') || 'nates123@gmail.com').toLowerCase()
const READONLY = Deno.env.get('COURSE_MCP_READONLY') === '1'

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── small utils ──
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const randToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)))
async function sha256b64url(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return b64url(new Uint8Array(buf))
}
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'Access-Control-Expose-Headers': 'mcp-session-id, www-authenticate',
}
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS, ...extra } })
const isAllowedRedirect = (u: string) => {
  try {
    const h = new URL(u)
    if (h.protocol !== 'https:' && !(h.hostname === 'localhost' || h.hostname === '127.0.0.1')) return false
    return ['claude.ai', 'claude.com'].includes(h.hostname) ||
      h.hostname.endsWith('.claude.ai') || h.hostname.endsWith('.claude.com') ||
      h.hostname === 'localhost' || h.hostname === '127.0.0.1'
  } catch { return false }
}

// ── date + markdown helpers (ported from mcp/lib/data.js) ──
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const toYMD = (s?: string | null) => { if (!s) return null; const d = new Date(s); if (isNaN(+d)) return null; return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() } }
const ymdStr = (o: any) => (o && o.y != null) ? `${o.y}-${String(o.m + 1).padStart(2, '0')}-${String(o.d).padStart(2, '0')}` : null
const todayLabel = () => { const d = new Date(); return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` }
const uuid = () => crypto.randomUUID()

const UL = /^[-*•]\s+/, OL = /^\d+[.)]\s+/
function textToBlocks(text: string) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  const blocks: any[] = []; let para: string[] = [], ul: string[] = [], ol: string[] = []
  const fp = () => { if (para.length) { blocks.push({ p: para.join(' ').trim() }); para = [] } }
  const fu = () => { if (ul.length) { blocks.push({ ul: ul.slice() }); ul = [] } }
  const fo = () => { if (ol.length) { blocks.push({ ol: ol.slice() }); ol = [] } }
  for (const raw of lines) {
    const l = raw.trim()
    if (!l) { fp(); fu(); fo(); continue }
    if (UL.test(l)) { fp(); fo(); ul.push(l.replace(/^[-*•]\s+\[?\s?\]?\s*/, '').replace(UL, '').trim()) }
    else if (OL.test(l)) { fp(); fu(); ol.push(l.replace(OL, '').trim()) }
    else { fu(); fo(); para.push(l) }
  }
  fp(); fu(); fo(); return blocks
}
function blocksToText(blocks: any[] = []) {
  return (blocks || []).map((b) => b.p || (b.ul ? b.ul.map((i: string) => '- ' + i).join('\n') : (b.ol ? b.ol.map((i: string, n: number) => `${n + 1}. ${i}`).join('\n') : (b.links ? b.links.map((l: string) => `[[${l}]]`).join(' ') : '')))).filter(Boolean).join('\n\n')
}
const mapTask = (r: any) => ({ id: r.id, project: r.project_id, label: r.label, done: !!r.done, next: !!r.next, waiting: r.waiting || null, due: ymdStr(r.due_date) || r.due || null, workType: r.work_type || null, status: r.task_status || null, notes: r.notes || null, sort: r.sort ?? 0 })
const noteRow = (n: any) => ({ id: n.id, kind: n.kind, title: n.title, project: n.project ?? null, area: n.area ?? null, projects: n.projects || [], people: n.people || [], tags: n.tags || [], date: n.date, updated: n.updated, indexed: true, status: n.status ?? 2, transcript: n.transcript ?? null, summary: n.summary ?? null, agenda: n.agenda ?? null, terms: n.terms || [], actions: n.actions || [], body: n.body || [], related: n.related || [] })
const noteOut = (r: any) => ({ id: r.id, kind: r.kind, title: r.title, project: r.project, area: r.area, projects: r.projects || [], people: r.people || [], tags: r.tags || [], date: r.date, summary: r.summary || null, agenda: r.agenda || null, incomplete: !!r.incomplete, bodyMarkdown: blocksToText(r.body || []), transcript: r.transcript || null, actions: r.actions || [], terms: r.terms || [] })
const must = (e: any) => { if (e) throw new Error(e.message || String(e)) }

// ── data ops (take a user-scoped supabase client) ──
const ops: Record<string, (sb: any, a: any) => Promise<any>> = {
  async list_areas(sb) { const { data, error } = await sb.from('cp_areas').select('*').order('sort'); must(error); return (data || []).map((a: any) => ({ id: a.id, name: a.name })) },
  async create_area(sb, { name }) { const id = uuid(); const { error } = await sb.from('cp_areas').insert({ id, name, open_default: true, sort: 99 }); must(error); return { id, name } },
  async list_projects(sb, { area, status }) {
    let q = sb.from('cp_projects').select('id,name,area_id,status,priority,due,blurb').order('sort')
    if (area) q = q.eq('area_id', area); if (status) q = q.eq('status', status)
    const { data, error } = await q; must(error)
    return (data || []).map((p: any) => ({ id: p.id, name: p.name, area: p.area_id, status: p.status, priority: p.priority ?? null, due: ymdStr(p.due), blurb: p.blurb || null }))
  },
  async get_project(sb, { id }) {
    const [p, tasks, ms, upd, art] = await Promise.all([
      sb.from('cp_projects').select('*').eq('id', id).single(),
      sb.from('cp_tasks').select('*').eq('project_id', id),
      sb.from('cp_milestones').select('*').eq('project_id', id),
      sb.from('cp_updates').select('*').eq('project_id', id).order('created_at', { ascending: false }),
      sb.from('cp_artifacts').select('id,title,art_type,provenance,created_at').eq('project_id', id).order('created_at', { ascending: false }),
    ])
    must(p.error || tasks.error || ms.error || upd.error || art.error)
    const pr = p.data
    return {
      id: pr.id, name: pr.name, area: pr.area_id, status: pr.status, priority: pr.priority ?? null, due: ymdStr(pr.due), blurb: pr.blurb || null, hold: pr.hold || null,
      tasks: (tasks.data || []).map(mapTask).sort((a: any, b: any) => a.sort - b.sort),
      milestones: (ms.data || []).map((r: any) => ({ id: r.id, label: r.label, state: r.state, sub: r.sub || null, due: ymdStr(r.due) })),
      updates: (upd.data || []).map((u: any) => ({ body: u.body, at: u.created_at })),
      artifacts: (art.data || []).map((a: any) => ({ id: a.id, title: a.title, artType: a.art_type, provenance: a.provenance })),
    }
  },
  async create_project(sb, { area, name, status = 'active', priority = null }) { const id = uuid(); const { error } = await sb.from('cp_projects').insert({ id, area_id: area, name, status, priority, sort: 99 }); must(error); return { id, name, area, status } },
  async update_project(sb, { id, name, status, priority, due, area }) {
    const row: any = {}
    if (name != null) row.name = name; if (status != null) row.status = status; if (priority !== undefined) row.priority = priority
    if (due !== undefined) row.due = toYMD(due); if (area != null) row.area_id = area
    const { error } = await sb.from('cp_projects').update(row).eq('id', id); must(error); return { id, ...row }
  },
  async list_tasks(sb, { project, status = 'open' }) {
    let q = sb.from('cp_tasks').select('*').order('sort')
    if (project) q = q.eq('project_id', project)
    if (status === 'open') q = q.eq('done', false); else if (status === 'done') q = q.eq('done', true)
    const { data, error } = await q; must(error); return (data || []).map(mapTask)
  },
  async create_task(sb, { project, label, due, next = false, waiting }) { const id = uuid(); const { error } = await sb.from('cp_tasks').insert({ id, project_id: project, label, done: false, next, waiting: waiting ?? null, due_date: due ? toYMD(due) : null, sort: 99 }); must(error); return { id, project, label } },
  async update_task(sb, { id, label, done, next, waiting, due, workType, notes, status }) {
    const row: any = {}
    if (label != null) row.label = label; if (done != null) row.done = done; if (next != null) row.next = next
    if (waiting !== undefined) row.waiting = waiting; if (due !== undefined) row.due_date = due ? toYMD(due) : null
    if (workType !== undefined) row.work_type = workType; if (notes !== undefined) row.notes = notes; if (status !== undefined) row.task_status = status
    const { error } = await sb.from('cp_tasks').update(row).eq('id', id); must(error); return { id, ...row }
  },
  async complete_task(sb, { id }) { return ops.update_task(sb, { id, done: true }) },
  async delete_task(sb, { id }) { const { error } = await sb.from('cp_tasks').delete().eq('id', id); must(error); return { id, deleted: true } },
  async list_notes(sb, { project, kind }) {
    let q = sb.from('cp_notes').select('id,kind,title,project,area,people,tags,date,summary,incomplete').order('updated_at', { ascending: false })
    if (project) q = q.eq('project', project); if (kind) q = q.eq('kind', kind)
    const { data, error } = await q; must(error)
    return (data || []).map((n: any) => ({ id: n.id, kind: n.kind, title: n.title, project: n.project, area: n.area, people: n.people || [], tags: n.tags || [], date: n.date, summary: n.summary || null, incomplete: !!n.incomplete }))
  },
  async get_note(sb, { id }) { const { data, error } = await sb.from('cp_notes').select('*').eq('id', id).single(); must(error); return noteOut(data) },
  async create_note(sb, { kind = 'note', title, project = null, area = null, body, people, tags, summary, transcript }) {
    const id = uuid()
    const row = noteRow({ id, kind, title: title || 'Untitled', project, area, people, tags, summary, transcript, body: body ? textToBlocks(body) : [], date: todayLabel(), updated: 'now' })
    const { error } = await sb.from('cp_notes').insert(row); must(error); return { id, title: row.title, kind }
  },
  async update_note(sb, { id, title, body, summary, tags, people, status }) {
    const row: any = { updated: 'now', updated_at: new Date().toISOString() }
    if (title != null) row.title = title; if (body != null) row.body = textToBlocks(body); if (summary !== undefined) row.summary = summary
    if (tags != null) row.tags = tags; if (people != null) row.people = people; if (status != null) row.status = status
    const { error } = await sb.from('cp_notes').update(row).eq('id', id); must(error); return { id, updated: true }
  },
  async delete_note(sb, { id }) { const { error } = await sb.from('cp_notes').delete().eq('id', id); must(error); return { id, deleted: true } },
  async list_artifacts(sb, { project }) {
    let q = sb.from('cp_artifacts').select('id,project_id,title,art_type,provenance,created_at').order('created_at', { ascending: false })
    if (project) q = q.eq('project_id', project)
    const { data, error } = await q; must(error)
    return (data || []).map((a: any) => ({ id: a.id, project: a.project_id, title: a.title, artType: a.art_type, provenance: a.provenance }))
  },
  async get_artifact(sb, { id }) { const { data, error } = await sb.from('cp_artifacts').select('*').eq('id', id).single(); must(error); return { id: data.id, project: data.project_id, title: data.title, artType: data.art_type, provenance: data.provenance, body: data.body || '' } },
  async create_artifact(sb, { project, title, body, artType = 'file' }) { const id = uuid(); const { error } = await sb.from('cp_artifacts').insert({ id, project_id: project, title: title || 'Untitled', art_type: artType, provenance: 'Added via Claude (MCP)', body: body ?? '' }); must(error); return { id, title } },
  async add_update(sb, { project, body }) { const id = uuid(); const { error } = await sb.from('cp_updates').insert({ id, project_id: project, body }); must(error); return { id, project } },
  async list_inbox(sb) { const { data, error } = await sb.from('cp_inbox').select('*').order('created_at', { ascending: false }); must(error); return (data || []).map((c: any) => ({ id: c.id, title: c.title, src: c.src, snippet: c.snippet, suggest: c.suggest || null, tags: c.tags || [] })) },
  async triage_inbox(sb, { id, project }) {
    const { data: c, error: e1 } = await sb.from('cp_inbox').select('*').eq('id', id).single(); must(e1)
    const { data: p } = await sb.from('cp_projects').select('area_id').eq('id', project).single()
    const noteId = uuid()
    const { error: e2 } = await sb.from('cp_notes').insert(noteRow({ id: noteId, kind: 'note', title: c.title, project, area: p?.area_id || null, tags: c.tags || [], summary: c.snippet, body: c.snippet ? [{ p: c.snippet }] : [], date: todayLabel(), updated: 'now' }))
    must(e2)
    const { error: e3 } = await admin.from('cp_inbox').delete().eq('id', id); must(e3)
    return { noteId, project, fromInbox: id }
  },
}

// ── tool definitions (name, description, JSON-Schema, write flag) ──
const S = (props: any, required: string[] = []) => ({ type: 'object', properties: props, required })
const str = { type: 'string' }, bool = { type: 'boolean' }, sArr = { type: 'array', items: { type: 'string' } }
const TOOLS = [
  { name: 'list_areas', write: false, description: 'List your areas / pillars (top-level grouping).', inputSchema: S({}) },
  { name: 'list_projects', write: false, description: 'List projects, optionally filtered by area id or status (active|on-hold|idea|sent|archived).', inputSchema: S({ area: str, status: str }) },
  { name: 'get_project', write: false, description: 'Get one project in full: tasks, milestones, where-it-stands updates, artifacts.', inputSchema: S({ id: str }, ['id']) },
  { name: 'list_tasks', write: false, description: 'List tasks, optionally for one project. status: open (default) | done | all.', inputSchema: S({ project: str, status: { type: 'string', enum: ['open', 'done', 'all'] } }) },
  { name: 'list_notes', write: false, description: 'List notes/meetings, optionally by project or kind (note|meeting|knowledge|artifact).', inputSchema: S({ project: str, kind: str }) },
  { name: 'get_note', write: false, description: 'Get one note/meeting in full — body markdown, summary, agenda, transcript, actions.', inputSchema: S({ id: str }, ['id']) },
  { name: 'list_artifacts', write: false, description: 'List artifacts (deliverables / files / edit guides), optionally for one project.', inputSchema: S({ project: str }) },
  { name: 'get_artifact', write: false, description: 'Get one artifact including its full body.', inputSchema: S({ id: str }, ['id']) },
  { name: 'list_inbox', write: false, description: 'List untriaged inbox captures.', inputSchema: S({}) },
  { name: 'create_area', write: true, description: 'Create a new area / pillar.', inputSchema: S({ name: str }, ['name']) },
  { name: 'create_project', write: true, description: 'Create a project in an area. status defaults to active.', inputSchema: S({ area: str, name: str, status: str, priority: { type: 'integer' } }, ['area', 'name']) },
  { name: 'update_project', write: true, description: 'Update a project (name, status, priority 1-3, due YYYY-MM-DD, area).', inputSchema: S({ id: str, name: str, status: str, priority: { type: 'integer' }, due: str, area: str }, ['id']) },
  { name: 'create_task', write: true, description: 'Add a task to a project. due YYYY-MM-DD; next=true surfaces it as the next action.', inputSchema: S({ project: str, label: str, due: str, next: bool, waiting: str }, ['project', 'label']) },
  { name: 'update_task', write: true, description: 'Update a task (label, done, next, waiting, due, workType, notes, status).', inputSchema: S({ id: str, label: str, done: bool, next: bool, waiting: str, due: str, workType: str, notes: str, status: str }, ['id']) },
  { name: 'complete_task', write: true, description: 'Mark a task done.', inputSchema: S({ id: str }, ['id']) },
  { name: 'delete_task', write: true, description: 'Delete a task.', inputSchema: S({ id: str }, ['id']) },
  { name: 'create_note', write: true, description: 'Create a note or meeting. body is markdown (paragraphs, - bullets, 1. numbered).', inputSchema: S({ kind: str, title: str, project: str, area: str, body: str, people: sArr, tags: sArr, summary: str, transcript: str }, ['title']) },
  { name: 'update_note', write: true, description: 'Update a note (title, body markdown, summary, tags, people).', inputSchema: S({ id: str, title: str, body: str, summary: str, tags: sArr, people: sArr }, ['id']) },
  { name: 'delete_note', write: true, description: 'Delete a note/meeting.', inputSchema: S({ id: str }, ['id']) },
  { name: 'create_artifact', write: true, description: 'Create an artifact (deliverable / file / guide) on a project. body is raw text or markdown.', inputSchema: S({ project: str, title: str, body: str, artType: str }, ['project', 'title', 'body']) },
  { name: 'add_update', write: true, description: 'Append a "where it stands" status update to a project.', inputSchema: S({ project: str, body: str }, ['project', 'body']) },
  { name: 'triage_inbox', write: true, description: 'File an inbox capture into a project as a note, removing it from the inbox.', inputSchema: S({ id: str, project: str }, ['id', 'project']) },
].filter((t) => !(READONLY && t.write))

// ── build a user-scoped supabase client from the stored session ──
async function userClient(email: string) {
  const { data: row, error } = await admin.from('cp_mcp_session').select('supa_refresh').eq('email', email).single()
  if (error || !row) throw new Error('No session for ' + email)
  const sb = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const { data, error: e2 } = await sb.auth.refreshSession({ refresh_token: row.supa_refresh })
  if (e2 || !data?.session) throw new Error('Session expired — reconnect the Course+ connector.')
  // persist the rotated refresh token
  await admin.from('cp_mcp_session').update({ supa_refresh: data.session.refresh_token, updated_at: new Date().toISOString() }).eq('email', email)
  await sb.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token })
  return sb
}

// ── OAuth: validate a bearer access token → email ──
async function emailForToken(token: string | null): Promise<string | null> {
  if (!token) return null
  const { data } = await admin.from('cp_mcp_tokens').select('email,expires_at,kind').eq('token', token).eq('kind', 'access').maybeSingle()
  if (!data) return null
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null
  return data.email
}

// ── MCP JSON-RPC handler ──
async function handleRpc(msg: any, email: string) {
  const { id, method, params } = msg
  const reply = (result: any) => ({ jsonrpc: '2.0', id, result })
  if (method === 'initialize') {
    return reply({ protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'course-plus', version: '0.2.0' } })
  }
  if (method === 'ping') return reply({})
  if (method === 'tools/list') return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
  if (method === 'tools/call') {
    const name = params?.name, args = params?.arguments || {}
    const tool = TOOLS.find((t) => t.name === name)
    if (!tool) return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${name}` } }
    if (READONLY && tool.write) return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Server is read-only' } }
    try {
      const sb = await userClient(email)
      const out = await ops[name](sb, args)
      return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] })
    } catch (e) {
      return reply({ content: [{ type: 'text', text: 'Error: ' + ((e as Error)?.message || String(e)) }], isError: true })
    }
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } }
}

// ── OAuth login page ──
function loginPage(q: URLSearchParams) {
  const redirect_uri = q.get('redirect_uri') || ''
  const state = q.get('state') || ''
  const code_challenge = q.get('code_challenge') || ''
  const ok = isAllowedRedirect(redirect_uri) && q.get('code_challenge_method') === 'S256'
  if (!ok) return new Response('Invalid authorization request (need https claude.ai redirect + PKCE S256).', { status: 400 })
  const esc = (s: string) => s.replace(/[<>"&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', '&': '&amp;' }[c]!))
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Course+</title><style>
:root{--bg:#f6f5f2;--card:#fff;--ink:#1a1d1b;--mut:#6b716e;--grn:#277059;--line:#e4e2dd}
*{box-sizing:border-box;font-family:'Hanken Grotesk',-apple-system,system-ui,sans-serif}
body{background:var(--bg);color:var(--ink);margin:0;display:grid;place-items:center;min-height:100vh}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:32px;width:340px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
h1{font-size:19px;margin:0 0 4px}p{color:var(--mut);font-size:13px;margin:0 0 20px;line-height:1.5}
label{font-size:12px;color:var(--mut);display:block;margin:0 0 6px}
input{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:9px;font-size:15px;margin:0 0 14px;outline:none}
input:focus{border-color:var(--grn)}
button{width:100%;padding:11px;background:var(--grn);color:#fff;border:0;border-radius:9px;font-size:14px;font-weight:600;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
.msg{font-size:12px;margin:12px 0 0;min-height:16px}.err{color:#b4341f}.hide{display:none}
</style></head><body><div class="card">
<h1>Connect Course+</h1><p>Sign in to let Claude read and write your Course+ workspace.</p>
<div id="s1"><label>Email</label><input id="email" type="email" autocomplete="email" placeholder="you@example.com">
<button id="send">Send code</button></div>
<div id="s2" class="hide"><label>8-digit code (check your email)</label><input id="code" inputmode="numeric" placeholder="••••••••" maxlength="8">
<button id="verify">Verify &amp; connect</button></div>
<p class="msg" id="msg"></p></div>
<script>
const R=${JSON.stringify({ redirect_uri, state, code_challenge })};
const $=(i)=>document.getElementById(i),msg=$("msg");
function err(t){msg.textContent=t;msg.className="msg err"}
function ok(t){msg.textContent=t;msg.className="msg"}
$("send").onclick=async()=>{const email=$("email").value.trim();if(!email)return err("Enter your email");
 $("send").disabled=true;ok("Sending…");
 const r=await fetch("authorize/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email})});
 const d=await r.json();$("send").disabled=false;
 if(!r.ok){err(d.error||"Could not send code");return}
 $("s1").className="hide";$("s2").className="";ok("Code sent to "+email);$("code").focus();$("verify").dataset.email=email};
$("verify").onclick=async()=>{const email=$("verify").dataset.email,token=$("code").value.replace(/\\D/g,"");
 if(token.length<6)return err("Enter the code");$("verify").disabled=true;ok("Verifying…");
 const r=await fetch("authorize/verify",{method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({email,token,redirect_uri:R.redirect_uri,state:R.state,code_challenge:R.code_challenge})});
 const d=await r.json();
 if(!r.ok){$("verify").disabled=false;err(d.error||"Verification failed");return}
 ok("Connected — returning to Claude…");window.location=d.redirect};
</script></body></html>`
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS } })
}

// ── main router ──
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  const url = new URL(req.url)
  const m = url.pathname.match(/\/mcp(\/.*)?$/)
  const sub = (m?.[1] || '/').replace(/\/+$/, '') || '/'

  // ── OAuth discovery ──
  if (sub === '/.well-known/oauth-protected-resource') {
    return json({ resource: BASE, authorization_servers: [BASE] })
  }
  if (sub === '/.well-known/oauth-authorization-server') {
    return json({
      issuer: BASE,
      authorization_endpoint: `${BASE}/authorize`,
      token_endpoint: `${BASE}/token`,
      registration_endpoint: `${BASE}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['course'],
    })
  }

  // ── Dynamic Client Registration (RFC 7591) — accept any client ──
  if (sub === '/register' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    return json({
      client_id: 'cp-' + randToken(8),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: body.redirect_uris || [],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }, 201)
  }

  // ── authorize (login page) ──
  if (sub === '/authorize' && req.method === 'GET') return loginPage(url.searchParams)

  // send OTP
  if (sub === '/authorize/send' && req.method === 'POST') {
    const { email } = await req.json().catch(() => ({}))
    if (!email || email.toLowerCase() !== ALLOWED_EMAIL) return json({ error: 'This email is not authorized for Course+.' }, 403)
    const authc = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
    const { error } = await authc.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true })
  }

  // verify OTP → mint auth code
  if (sub === '/authorize/verify' && req.method === 'POST') {
    const { email, token, redirect_uri, state, code_challenge } = await req.json().catch(() => ({}))
    if (!email || email.toLowerCase() !== ALLOWED_EMAIL) return json({ error: 'Email not authorized.' }, 403)
    if (!isAllowedRedirect(redirect_uri) || !code_challenge) return json({ error: 'Invalid request.' }, 400)
    const authc = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
    const { data, error } = await authc.auth.verifyOtp({ email, token: String(token).replace(/\D/g, ''), type: 'email' })
    if (error || !data?.session) return json({ error: error?.message || 'Invalid code.' }, 400)
    const lc = email.toLowerCase()
    await admin.from('cp_mcp_session').upsert({ email: lc, supa_refresh: data.session.refresh_token, updated_at: new Date().toISOString() })
    const code = randToken(24)
    const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    await admin.from('cp_mcp_codes').insert({ code, code_challenge, redirect_uri, email: lc, supa_refresh: data.session.refresh_token, expires_at: expires })
    const sep = redirect_uri.includes('?') ? '&' : '?'
    const redirect = `${redirect_uri}${sep}code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ''}`
    return json({ redirect })
  }

  // ── token endpoint ──
  if (sub === '/token' && req.method === 'POST') {
    const ct = req.headers.get('content-type') || ''
    let p: Record<string, string> = {}
    if (ct.includes('application/json')) p = await req.json().catch(() => ({}))
    else { const f = new URLSearchParams(await req.text()); f.forEach((v, k) => (p[k] = v)) }

    if (p.grant_type === 'authorization_code') {
      const { data: row } = await admin.from('cp_mcp_codes').select('*').eq('code', p.code || '').maybeSingle()
      if (!row) return json({ error: 'invalid_grant' }, 400)
      await admin.from('cp_mcp_codes').delete().eq('code', p.code)
      if (new Date(row.expires_at) < new Date()) return json({ error: 'invalid_grant', error_description: 'code expired' }, 400)
      if (row.redirect_uri !== p.redirect_uri) return json({ error: 'invalid_grant', error_description: 'redirect mismatch' }, 400)
      const challenge = await sha256b64url(p.code_verifier || '')
      if (challenge !== row.code_challenge) return json({ error: 'invalid_grant', error_description: 'PKCE failed' }, 400)
      const access = randToken(), refresh = randToken()
      const accessExp = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
      await admin.from('cp_mcp_tokens').insert([
        { token: access, kind: 'access', email: row.email, expires_at: accessExp },
        { token: refresh, kind: 'refresh', email: row.email, expires_at: null },
      ])
      return json({ access_token: access, token_type: 'Bearer', expires_in: 30 * 24 * 3600, refresh_token: refresh, scope: 'course' }, 200, { 'Cache-Control': 'no-store' })
    }

    if (p.grant_type === 'refresh_token') {
      const { data: row } = await admin.from('cp_mcp_tokens').select('*').eq('token', p.refresh_token || '').eq('kind', 'refresh').maybeSingle()
      if (!row) return json({ error: 'invalid_grant' }, 400)
      const access = randToken()
      const accessExp = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
      await admin.from('cp_mcp_tokens').insert({ token: access, kind: 'access', email: row.email, expires_at: accessExp })
      return json({ access_token: access, token_type: 'Bearer', expires_in: 30 * 24 * 3600, scope: 'course' }, 200, { 'Cache-Control': 'no-store' })
    }
    return json({ error: 'unsupported_grant_type' }, 400)
  }

  // ── MCP endpoint (root) — requires bearer ──
  if (sub === '/') {
    const auth = req.headers.get('authorization') || ''
    const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null
    const email = await emailForToken(bearer)
    if (!email) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...CORS, 'WWW-Authenticate': `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource"` },
      })
    }
    if (req.method === 'GET') return new Response(null, { status: 405, headers: CORS })
    const payload = await req.json().catch(() => null)
    if (!payload) return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400)
    // batch or single
    if (Array.isArray(payload)) {
      const out = []
      for (const msg of payload) { if (msg?.id !== undefined && msg?.id !== null) out.push(await handleRpc(msg, email)) else await handleRpc(msg, email) }
      return json(out)
    }
    // notification (no id) → 202
    if (payload.id === undefined || payload.id === null) { await handleRpc(payload, email).catch(() => {}); return new Response(null, { status: 202, headers: CORS }) }
    return json(await handleRpc(payload, email))
  }

  return new Response('Not found', { status: 404, headers: CORS })
})
