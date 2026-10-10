# CLAUDE.md — Shringaar

Multi-vendor jewellery storefront with an in-browser AR try-on. React 18 + Vite 5 + TypeScript
(strict) + Supabase. **Not deployed.** Read this file, then `memory/MEMORY.md`.

---

## 1. Start every session here

**Read [`memory/MEMORY.md`](./memory/MEMORY.md) before doing anything else.** It is the index — it
routes you to the detail file for whatever you are about to touch, and it carries the honesty rules
that override convenience.

**Before deciding what to work on, read both:**

- [`memory/current-state.md`](./memory/current-state.md) — what actually works, what does not, and
  what is explicitly **unverified**. Do not re-derive this from the code; it is recorded.
- [`memory/tasks.md`](./memory/tasks.md) — the priority queue, blockers, and acceptance criteria.
  Work from the top unless the user directs otherwise.

**Before modifying a subsystem, read its memory file first:**

| Touching | Read |
| --- | --- |
| Module layout, the service boundary, routing | [`memory/architecture.md`](./memory/architecture.md) |
| Try-on: camera, MediaPipe, anchors, calibration, renderers | [`memory/ar-engine.md`](./memory/ar-engine.md) |
| Uploads, try-on assets, GLB validation, anything about 3D | [`memory/asset-pipeline.md`](./memory/asset-pipeline.md) |
| Supabase schema, RLS, storage, sign-in | [`memory/database-and-auth.md`](./memory/database-and-auth.md) |
| Tests, builds, environment variables, deployment | [`memory/testing-and-deployment.md`](./memory/testing-and-deployment.md) |
| Why something load-bearing is the way it is | [`memory/decisions.md`](./memory/decisions.md) |
| The product, users, business model, scope | [`memory/project-overview.md`](./memory/project-overview.md) |
| Resuming after a break | [`memory/session-log.md`](./memory/session-log.md) |

`arch.md` §5, §8, §9 · `design.md` (D1–D22, §7) · `task.md` remain the deep record and are **not**
duplicated in `memory/`. Follow them when memory points there.

---

## 2. Precedence — code beats memory

Memory is a summary and it can go stale. **When memory and the source disagree, the source is
right.**

- If a memory file names a function, file, constant, or flag, **verify it still exists** before
  relying on it. Grep for it. If it is gone, fix the memory in the same session.
- If a change makes a memory file wrong, update it — do not leave a contradiction behind.
- Never treat a memory file as evidence that something was verified. `current-state.md` is where
  verification state is recorded, and it distinguishes verified from unverified on purpose.

---

## 3. Keep memory current

Update the **relevant** file — not all of them — at a meaningful checkpoint. That means: a feature
completes, architecture or schema changes, a significant decision is made, a hard bug is fixed, tests
or a build are run, a limitation is found, a blocker appears, or the plan changes. Not after every
trivial edit.

**When you finish a substantial task, write the exact next step into
[`memory/session-log.md`](./memory/session-log.md) before stopping.** A precise next action —
*"verify the live Supabase migration state against `supabase/migrations/`"*, not *"continue with the
backend"* — is what makes a new session resumable.

**Never write into memory:** secrets, tokens, credentials, `.env` values, private face images, large
source dumps, or narrative repetition of what the code already says.

---

## 4. Context compaction

Compaction can happen without warning. **Do not rely on the conversation history surviving.**

**Before a long or multi-step task, and whenever context is getting tight**, write the following
into `memory/session-log.md` (a short block is enough — not an essay):

- The objective, in one sentence.
- Files changed, by path.
- Commands run **and their results**, verbatim where it matters (test counts, build output, errors).
- Unresolved errors, open assumptions, decisions pending.
- **The exact next action.**

**After a compaction or at the start of a resumed session**, reconstruct state from disk rather than
from memory of the conversation:

1. Read `memory/MEMORY.md`, then `current-state.md`, `tasks.md`, and `session-log.md`.
2. Run `git status` — the working tree is the ground truth for what changed.
3. Resume from the **last verified checkpoint**, not from wherever the narration stopped.

---

## 5. Accuracy — non-negotiable

- Separate **verified** from **unverified** from **proposed**. Never present one as another.
- **Never mark something planned as implemented.**
- **Never claim a test, build, device run, or visual result passed unless it was actually run in
  this session** — quote the real output.
- Name paths, function names, commands, and error text rather than describing them vaguely.
- Remove obsolete statements instead of leaving them to mislead.
- The full honesty list lives in [`memory/MEMORY.md`](./memory/MEMORY.md). It includes the ones that
  are easy to get wrong: **a photo is not a 3D model**; **landmarks 234 and 454 are not earlobes**;
  **only earrings have a try-on solver**; **never put the service-role key in browser code**.

---

## 6. Working in this repo

```bash
npm run check     # tsc --noEmit && vitest run   ← run this before claiming anything is green
npm run dev       # port 5173, uses .env.local (live Supabase today)
npm run build     # tsc --noEmit && vite build
```

Two facts that bite, detailed in `memory/testing-and-deployment.md`: `globals: false` is load-bearing
(every test file must `import { describe, it, expect } from 'vitest'`), and test files **are**
typechecked by `tsc --noEmit`, which `npm run build` runs first.

Layering rules are in [`memory/architecture.md`](./memory/architecture.md) and `arch.md` §9. They are
checkable, not aspirational: `features/seller` must not import `features/storefront`; consumers reach
the service only through `lib/seller.ts` + `getSellerService()`; `lib/` must not import from
`features/`; no secrets in `src/`.

**The AR engine needs no backend.** To exercise demo mode, blank the Supabase variables:
`VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite --port 5199 --strictPort`.

---

## 7. Environment

`.env.local` (gitignored) currently holds **both** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`,
so `npm run dev` selects the **live** Supabase adapter, not the demo one. Only the publishable/anon
key belongs in a `VITE_` variable — anything `VITE_`-prefixed is inlined into the shipped bundle.

Camera access requires a secure context: `http://localhost` qualifies, a plain `http://` LAN address
does not.
