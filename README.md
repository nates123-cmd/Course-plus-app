# Scribe

Single-user, Claude-connected notes & reference app (desktop) — part of the
Personal OS suite, sibling to Course. Retrieval-first, calm, agency-first.

Recreated from the high-fidelity design handoff in `design_ref/`. See
[BUILD.md](./BUILD.md) for build state and the remaining screen-port work.

## Dev
```
npm install
cp .env.example .env   # fill in suite Supabase creds
npm run dev
```

Stack: Vite + React + supabase-js. Shared suite Supabase project, 8-digit email
OTP auth, JWT-gated `claude` edge proxy. Graphite monochrome theme, Hanken
Grotesk, Tabler icons.
