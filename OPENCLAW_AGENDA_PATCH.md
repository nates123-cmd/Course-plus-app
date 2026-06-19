# OpenClaw → Course+ Agenda patch (deploy from Mac)

**Problem:** OpenClaw can't pull "my schedule for tomorrow." The Course+ **Agenda**
screen reads the **`placed_blocks`** table (the time-blocked schedule the **Today**
app writes — see `src/screens/Agenda.jsx`). OpenClaw's `course-plus` edge function
only reads `cp_*` tables, so it has no path to `placed_blocks`.

**Fix:** add an `agenda` read resource to the `course-plus` edge function, then add
it to the bot skill. Both steps below. Deploy from the Mac (source lives in
`~/Desktop/openclaw-beelink/`; needs `supabase` CLI — neither is on the Beelink).

---

## 1. Edge function — add to the `action:"read"` resource switch

`placed_blocks` columns (from `Agenda.jsx`): `id, date (ISO yyyy-mm-dd), hour
(decimal, e.g. 9.5), duration_minutes, type, title, pillar, source` + a per-user
owner column. **CONFIRM the owner column name** — suite `cp_*` tables use
`user_id`; `placed_blocks` almost certainly does too. Owner uuid =
`24c79501-4011-46c9-a3d3-a716d732d69c`.

Adapt the client var name (`admin` / `supabase` / `sb`) to whatever the existing
function uses. The function runs with the **service role**, so it must filter by
owner explicitly (no RLS auth context).

```ts
// resource: "agenda" — the time-blocked schedule from placed_blocks (what the
// Course+ Agenda screen shows). Defaults to today + the next 6 days, matching the
// app's 7-day window. Pass { date: "yyyy-mm-dd" } to anchor a different start day
// and { days: N } to widen/narrow. For "tomorrow": { date: <tomorrow>, days: 1 }.
if (resource === "agenda") {
  const start = (body.date as string) || new Date().toISOString().slice(0, 10);
  const span = Math.min(Math.max(Number(body.days) || 7, 1), 31);
  const end = new Date(start + "T00:00:00");
  end.setDate(end.getDate() + span - 1);
  const endISO = end.toISOString().slice(0, 10);

  const { data, error } = await admin
    .from("placed_blocks")
    .select("id,date,hour,duration_minutes,type,title,pillar,source")
    .eq("user_id", OWNER_UUID)            // <-- confirm column name
    .gte("date", start)
    .lte("date", endISO)
    .order("date", { ascending: true })
    .order("hour", { ascending: true });

  if (error) return json({ ok: false, error: error.message }, 500);

  // group by day for a compact, bot-friendly payload
  const byDay: Record<string, any[]> = {};
  for (const b of data ?? []) {
    (byDay[b.date] ??= []).push({
      time: fmtHour(b.hour),
      end: fmtHour(b.hour + b.duration_minutes / 60),
      title: b.title,
      kind: b.type,
      pillar: b.pillar ?? null,
    });
  }
  return json({ ok: true, range: { start, end: endISO }, days: byDay });
}

// helper (decimal hour -> "9:30am"); place near the other formatters
function fmtHour(h: number) {
  const hr = Math.floor(h), m = Math.round((h - hr) * 60);
  const ap = hr < 12 ? "am" : "pm", h12 = hr % 12 === 0 ? 12 : hr % 12;
  return `${h12}:${String(m).padStart(2, "0")}${ap}`;
}
```

Deploy: `supabase functions deploy course-plus` (from the bundle/project that owns
the function).

---

## 2. Bot skill — add to `/home/openclaw/.openclaw/skills/course-plus/SKILL.md`

Under the `## READ` resource list, add:

> - `agenda` — the time-blocked schedule (from `placed_blocks`, what the Course+
>   Agenda screen shows). Defaults to today + next 6 days. Pass `date:"yyyy-mm-dd"`
>   to anchor a day and `days:N` to size the window. For tomorrow:
>   `{"action":"read","resource":"agenda","date":"<tomorrow ISO>","days":1}`.

Then recreate the container so it re-reads the skill:
`docker compose up -d --no-build` (run as the `openclaw` user — see `/openclaw`).

**Order matters:** deploy the edge function (step 1) *before* adding the skill
entry (step 2), or the bot will call `resource:"agenda"` and get an error.

---

## Verify
Telegram the bot: *"what's on my schedule tomorrow?"* → it should call
`agenda` with tomorrow's date and read back the blocks.
