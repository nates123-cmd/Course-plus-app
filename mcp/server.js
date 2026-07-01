#!/usr/bin/env node
// Course+ MCP server (local stdio) — lets Claude Desktop read + write your
// Course+ data (cp_* tables), scoped to you via per-user RLS. Claude is the
// client: calls are billed by your Pro/Max subscription, not Course+'s API.
//
// Setup: `npm install` then `npm run login` in this folder, then register in
// claude_desktop_config.json (see README). Set COURSE_MCP_READONLY=1 to disable
// the write tools.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { authedClient } from './lib/client.js'
import * as D from './lib/data.js'

const READONLY = process.env.COURSE_MCP_READONLY === '1'

const sb = await authedClient() // throws (to stderr) if not signed in

const server = new McpServer({ name: 'course-plus', version: '0.1.0' })
const ok = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v, null, 2) }] })
const tool = (name, desc, shape, fn, { write = false } = {}) => {
  if (write && READONLY) return
  server.tool(name, desc, shape, async (args) => {
    try { return ok(await fn(args || {})) }
    catch (e) { return { content: [{ type: 'text', text: 'Error: ' + (e?.message || String(e)) }], isError: true } }
  })
}

// ── read ──
tool('list_areas', 'List your areas / pillars (the top-level grouping).', {}, () => D.listAreas(sb))
tool('list_projects', 'List projects, optionally filtered by area id or status (active|on-hold|idea|sent|archived).',
  { area: z.string().optional(), status: z.string().optional() }, (a) => D.listProjects(sb, a))
tool('get_project', 'Get one project in full: tasks, milestones, where-it-stands updates, and artifacts.',
  { id: z.string() }, (a) => D.getProject(sb, a))
tool('list_tasks', 'List tasks, optionally for one project. status: open (default) | done | all.',
  { project: z.string().optional(), status: z.enum(['open', 'done', 'all']).optional() }, (a) => D.listTasks(sb, a))
tool('list_notes', 'List notes/meetings/artifacts-as-notes, optionally by project or kind (note|meeting|knowledge|artifact).',
  { project: z.string().optional(), kind: z.string().optional() }, (a) => D.listNotes(sb, a))
tool('get_note', 'Get one note/meeting in full — body (markdown), summary, agenda, transcript, action items.',
  { id: z.string() }, (a) => D.getNote(sb, a))
tool('list_artifacts', 'List artifacts (deliverables / raw files / edit guides), optionally for one project.',
  { project: z.string().optional() }, (a) => D.listArtifacts(sb, a))
tool('get_artifact', 'Get one artifact including its full body.', { id: z.string() }, (a) => D.getArtifact(sb, a))
tool('list_inbox', 'List untriaged inbox captures.', {}, () => D.listInbox(sb))

// ── write ──
tool('create_area', 'Create a new area / pillar.', { name: z.string() }, (a) => D.createArea(sb, a), { write: true })
tool('create_project', 'Create a project in an area. status defaults to active.',
  { area: z.string(), name: z.string(), status: z.string().optional(), priority: z.number().int().min(1).max(3).optional() }, (a) => D.createProject(sb, a), { write: true })
tool('update_project', 'Update a project (name, status, priority 1-3, due YYYY-MM-DD, area).',
  { id: z.string(), name: z.string().optional(), status: z.string().optional(), priority: z.number().int().nullable().optional(), due: z.string().nullable().optional(), area: z.string().optional() }, (a) => D.updateProject(sb, a), { write: true })
tool('create_task', 'Add a task to a project. due is YYYY-MM-DD; next=true marks it the surfaced next action; priority 1|2|3 (P1=highest).',
  { project: z.string(), label: z.string(), due: z.string().optional(), next: z.boolean().optional(), waiting: z.string().optional(), priority: z.number().int().min(1).max(3).nullable().optional() }, (a) => D.createTask(sb, a), { write: true })
tool('update_task', 'Update a task (label, done, next, waiting, due YYYY-MM-DD, workType deep|admin|scheduled, priority 1|2|3, notes, status none|next|in-progress|waiting|done).',
  { id: z.string(), label: z.string().optional(), done: z.boolean().optional(), next: z.boolean().optional(), waiting: z.string().nullable().optional(), due: z.string().nullable().optional(), workType: z.string().nullable().optional(), priority: z.number().int().min(1).max(3).nullable().optional(), notes: z.string().nullable().optional(), status: z.string().optional() }, (a) => D.updateTask(sb, a), { write: true })
tool('complete_task', 'Mark a task done.', { id: z.string() }, (a) => D.updateTask(sb, { id: a.id, done: true }), { write: true })
tool('delete_task', 'Delete a task.', { id: z.string() }, (a) => D.deleteTask(sb, a), { write: true })
tool('create_note', 'Create a note or meeting. body is markdown (paragraphs, - bullets, 1. numbered). kind: note|meeting|knowledge|artifact.',
  { kind: z.string().optional(), title: z.string(), project: z.string().nullable().optional(), area: z.string().nullable().optional(), body: z.string().optional(), people: z.array(z.string()).optional(), tags: z.array(z.string()).optional(), summary: z.string().optional(), transcript: z.string().optional() }, (a) => D.createNote(sb, a), { write: true })
tool('update_note', 'Update a note (title, body markdown, summary, tags, people).',
  { id: z.string(), title: z.string().optional(), body: z.string().optional(), summary: z.string().optional(), tags: z.array(z.string()).optional(), people: z.array(z.string()).optional() }, (a) => D.updateNote(sb, a), { write: true })
tool('delete_note', 'Delete a note/meeting.', { id: z.string() }, (a) => D.deleteNote(sb, a), { write: true })
tool('create_artifact', 'Create an artifact (deliverable / raw file / guide) on a project. body is raw text or markdown.',
  { project: z.string(), title: z.string(), body: z.string(), artType: z.string().optional() }, (a) => D.createArtifact(sb, a), { write: true })
tool('add_update', 'Append a "where it stands" status update to a project.', { project: z.string(), body: z.string() }, (a) => D.addUpdate(sb, a), { write: true })
tool('triage_inbox', 'File an inbox capture into a project as a note, removing it from the inbox.', { id: z.string(), project: z.string() }, (a) => D.triageInbox(sb, a), { write: true })

await server.connect(new StdioServerTransport())
console.error(`course-plus MCP ready${READONLY ? ' (read-only)' : ''}.`)
