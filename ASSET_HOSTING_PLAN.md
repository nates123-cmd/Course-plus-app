# Course+ asset hosting + AI interpretation — build plan

Goal: host/view screenshots, PDFs, etc. in Course+ and make them interpretable by
the AI surfaces. Decided backend = **Supabase Storage** (NOT the Beelink). 1GB free
bucket, separate from the 500MB DB limit, loads from anywhere, zero new infra.

## Core pattern: "interpret once, markdown forever"
Deepseek has NO vision. So on upload, interpret the asset ONCE with a Claude vision
model and store the result as markdown (`extracted_md`). After that, EVERY engine
(Claude + Deepseek) reads the markdown as plain text. The original file is only used
for human viewing + (optional) re-extraction.

## Proxy facts (already verified — no edge-fn change needed)
The shared `claude` edge proxy (`xsmnfcmtbpeaccnyinkr`, `verify_jwt:true`) forwards
`messages` VERBATIM to api.anthropic.com. So content blocks pass straight through:
- Images: `{type:'image', source:{type:'base64', media_type, data}}` — works today.
- PDFs:   `{type:'document', source:{type:'base64', media_type:'application/pdf', data}}`
  — GA on Claude 4.x, version header `2023-06-01` already set, no beta flag needed.
- RULE: extraction MUST hard-pin a Claude model (e.g. `claude-sonnet-4-6`). The
  deepseek path can't take blocks and would 400. Bypass the `course.ai` toggle.
- `max_tokens` cap is 4096 — fine for extracted MD.

## Steps
1. **Bucket** `cp-assets`, private. Path `{user.id}/{uuid}.{ext}` (copy the
   `scribe-audio` RLS pattern in `src/lib/transcribe.js`). Signed URLs for viewing.

2. **Table `cp_assets`** (per-user RLS, additive migration):
   `id uuid pk · user_id uuid default auth.uid() · project_id uuid? · note_id uuid? ·
    filename text · mime text · size_bytes int · storage_path text · kind text
    (image|pdf|other) · extracted_md text · extract_status text
    (pending|done|error|skipped) · created_at timestamptz default now()`
   RLS: `user_id = auth.uid()` for all ops. Also add storage.objects policies for the
   `cp-assets` bucket scoped to the user-id path prefix.

3. **`src/lib/assets.js`** (new):
   - `uploadAsset(file, {projectId, noteId})` -> upload to bucket -> insert row
     (status `pending`) -> fire `extractToMarkdown(row)` async.
   - `extractToMarkdown(asset)` -> download bytes -> base64 -> build image/document
     block -> `claudeVision()` with a transcription prompt -> save `extracted_md`,
     set status `done`/`error`.
   - `listAssets({projectId, noteId})`, `signedUrl(storage_path)`, `deleteAsset(id)`
     (also removes the bucket object), `reExtract(id)`.

4. **`src/lib/claude.js`** — add `claudeVision(blocks, opts)`: POST
   `{messages:[{role:'user', content: blocks}], model:'claude-sonnet-4-6', ...}`
   via the existing `postClaude`. Forces a Claude model, ignores the deepseek toggle.

5. **UI** — `AssetUploader` + `AssetList` components (file picker + drag/drop).
   Wire into `src/screens/Note.jsx` and `src/screens/Project.jsx`. Inline view:
   `<img>` for images via signed URL, link/iframe for PDFs, collapsible
   `extracted_md` with a "re-extract" button + status pill.

6. **Context payoff** — in `src/DataContext.jsx` digest builders (`projectDigest`),
   append each asset's `extracted_md`. THIS is what lets Generate-with-AI + Ask +
   Deepseek "read" a PDF: they read the markdown Claude already produced. Mirror the
   existing artifact-body inlining (1200-char gist for project scope).

7. **Guards** — cap/downscale uploads ~10MB (Anthropic img ~5MB, PDF ~32MB/100pg).
   Show extract status in UI. Deploy: `build:gh-pages` from the **MAIN checkout**
   (worktree symlinks node_modules -> stale build), push gh-pages, bump SW version.

## Scope
~2 new files (`assets.js`, asset components), edits to `claude.js`, `Note.jsx`,
`Project.jsx`, `DataContext.jsx`, 1 migration, 1 bucket. No Beelink, no
mixed-content, no new edge fn.
