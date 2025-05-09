# 🚀 Calendar Agent — Solo‑Developer Implementation Roadmap

Below is a **lean, explicit, deliverable‑driven plan** tuned for a single developer who must ship a usable MVP quickly **and** leave a clear upgrade path for v2. Each sprint is **exactly 1 week**; durations are realistic for one focused person (~15‑20 hrs/week).

---

## Phase 0 — Project Bootstrapping *(Sprint 0)*

| Deliverable                  | Definition of Done                                                                                | Status          | Notes                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------- |
| **Monorepo scaffold**        | `pnpm init` workspace with two packages: `apps/mobile` (Expo) and `apps/server` (Next.js 14).     | ✅ Done         |                                                                  |
| **Dev‑tooling baseline**     | Shared `eslint`, `prettier`, `tsconfig`, `husky` pre‑commit, GitHub Actions lint workflow passes. | ⚠️ Partially Done | Husky & GitHub Actions removed for now                           |
| **Secret handling skeleton** | `.env.development` + Vercel *and* Expo EAS secrets defined (dummy values).                        | ⚠️ Partially Done | Local `.env` files created; Cloud secrets deferred             |
| **Cloud anchors**            | • Vercel project created<br>• Supabase free‑tier project spun up (Postgres + Auth)                | ⏳ **Deferred** | Will set up Vercel/Supabase before Phase 6 deployment         |
| **Keys acquired**            | Google AI Studio / Vertex AI API key, GCP project + OAuth credentials created and stored in secrets.                  | ⚠️ Partially Done | GCP Project + OAuth Credentials ✅; Google AI Key deferred to Phase 2 |

> ⏳ **Time‑box:** 3 days. Ship when `pnpm dev` (both apps) runs with zero TypeScript errors.

---

## Phase 1 — Deterministic Calendar Core *(Sprints 1‑2)*

### Sprint 1 — Auth & Schema

| Deliverable             | DoD                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| **Postgres schema v0**  | `prisma migrate dev` creates `User`, `OAuthToken`, `AuditEvent`.                                        |
| **Google OAuth flow**   | User can log in via Google on **localhost:3000/api/auth/google** and refresh token is stored encrypted. |
| **Controller skeleton** | `CalendarController.createEvent()` → inserts a stub "Hello‑World" event into user's primary calendar.   |
| **Postman collection**  | One click hits `/api/calendar/hello` and verifies calendar insertion.                                   |

### Sprint 2 — CRUD Wrapper & Tests

| Deliverable                     | DoD                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| **`googleCalendar.ts` wrapper** | Implements `listEvents`, `insertEvent`, `patchEvent`, `deleteEvent`, each with retry + idempotency. |
| **Unit tests (Jest)**           | ⏳ **Deferred** 80 %+ coverage of wrapper using **fake‑calendar** stub server.                                      |
| **Audit logging**               | Every call writes to `AuditEvent` with `status`, `requestId`.                                       |

---

## Phase 2 — LLM Planner MVP *(Sprints 3‑4)*

### Sprint 3 — Tooling & Prompt v0

| Deliverable               | DoD                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| **LangChain agent setup** | `planner.plan(text)` returns JSON with `{action, params}` constrained by zod schema using Google Gemini via `@langchain/google-genai`.  |
| **Two tools implemented** | `CreateEventTool`, `ListEventsTool` registered with dummy controller (unit tests deferred).         |
| **Prompt v0**             | Stored in `/prompts/calendar.md`, includes 3 few‑shot examples (tuned for Gemini if needed).   |

### Sprint 4 — End‑to‑End NL → Calendar

| Deliverable            | DoD                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| **/api/process route** | Accepts `text`, returns `{assistantMsg, diff}` payload.                                   |
| **Smoke test script**  | `pnpm run e2e:createMeeting "Coffee with Alex tomorrow 2pm"` creates real calendar event. |
| **Cost & latency log** | Each planner call writes tokens + ms to Postgres `UsageStats`.                            |

---

## Phase 3 — Mobile Chat Shell *(Sprints 3‑4 in parallel)*

> **Overlap allowed:** Sprint 3 tasks start after Phase 1 is stable; work evenings in parallel.

| Deliverable             | DoD                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------- |
| **Expo chat screen**    | ListView of messages, TextInput, send button.                                      |
| **API client**          | `POST /api/process` and stream assistant reply via SSE (use `eventsource-parser`). |
| **Dev build on device** | Expo Go shows chat; sending text "Ping" gets "Pong" back from stub.                |

---

## Phase 4 — Confirmation Loop & Push *(Sprints 5‑6)*

### Sprint 5 — Preview Diff & Approve

| Deliverable            | DoD                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------- |
| **Diff builder**       | Controller returns minimal diff JSON (`{type:'move', from:'…', to:'…'}`) ready for UI. |
| **Mobile modal**       | Renders diff; "Approve / Reject" buttons POST to `/api/executePlan`.                   |
| **Backend guardrails** | Plans touching > 5 events require confirmation; otherwise auto‑execute.                |

### Sprint 6 — Notifications

| Deliverable            | DoD                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| **Expo push tokens**   | Stored in `User.pushToken`.                                                                |
| **Server push sender** | `sendPush(userId, title, body, data)` module working.                                      |
| **Happy‑path flow**    | Planner decides > threshold, server pushes, user taps notification → app opens diff modal. |

---

## Phase 5 — Hardening & Polish *(Sprint 7)*

| Deliverable                   | DoD                                                               |
| ----------------------------- | ----------------------------------------------------------------- |
| **Rate limiter**              | 100 requests / 15 min / IP via `@vercel/edge‑rate‑limit`.         |
| **Sentry integrated**         | Mobile & server errors visible on dashboard.                      |
| **Security checklist passed** | OWASP ASVS level 1, dependency audit zero highs.                  |
| **Smoke‑test matrix**         | 10 scripted NL commands run via Playwright + iOS simulator green. |
| **UI cleanup**                | Dark‑mode, empty‑state illustrations, 60 fps scroll.              |

---

## Phase 6 — Production Launch *(Sprints 8‑9)*

### Sprint 8 — Backend Production

| Deliverable                      | DoD                                                       |
| -------------------------------- | --------------------------------------------------------- |
| **Vercel production env**        | `vercel --prod` succeeds; `api.` subdomain live.          |
| **PlanetScale/Supabase prod DB** | Schema migrated, read replica configured.                 |
| **CI/CD**                        | Push → lint → test → preview → prod with manual approval. |

### Sprint 9 — App Store Release

| Deliverable             | DoD                                                                      |
| ----------------------- | ------------------------------------------------------------------------ |
| **EAS build (iOS)**     | `eas submit --platform ios --profile production` uploaded to TestFlight. |
| **App Store meta**      | 5 screenshots, privacy policy, support URL.                              |
| **Internal test round** | 3 testers run build, file < 5 blocker bugs.                              |
| **App Review passed**   | Binary approved, *manual release* staged.                                |

---

## Phase 7 — Post‑Launch Ops *(Ongoing, bi‑weekly)*

| Routine               | KPI / Target                                                                 |
| --------------------- | ---------------------------------------------------------------------------- |
| **Uptime monitoring** | 99 % rolling 7‑day via Vercel checks.                                        |
| **Google AI cost**    | < $20/month until 500 MAU (Adjust based on Gemini pricing).                  |
| **Bug SLA**           | Critical prod bug fixed < 48 h.                                              |
| **Feedback loop**     | Notion board triaged weekly, next sprint tasks selected every second Monday. |

---

## Aggressive But Realistic Timeline

| Week | Milestone                      |
| ---- | ------------------------------ |
| 0    | Repo scaffold pushed           |
| 1    | Google OAuth works             |
| 2    | CRUD wrapper + tests green     |
| 3    | LangChain planner returns JSON |
| 4    | NL → calendar live via cURL    |
| 5    | Mobile chat prototype          |
| 6    | Confirmation diff & push       |
| 7    | Security pass + polished UI    |
| 8    | Backend prod deploy            |
| 9    | TestFlight live                |
| 10   | Public App Store launch 🚀     |

---

### Scope‑control commandments

1. **Ship MVP with *create*/ *list*/ *move* only.**
2. **No local calendar read/write in v1.**
3. **No recurring‑rule editing** beyond full‑series move.
4. **Limit Gemini calls to one per user request.**
5. **Any new idea goes to Phase 7 backlog—never mid‑sprint.**

Stick to the deliverables above; if a task isn't explicitly listed, defer it.  
Finish each sprint with something runnable, demoable, and commit‑tagged.  

