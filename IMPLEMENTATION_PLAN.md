# Calendar Agent: Implementation Roadmap (Revised)

## Guiding Principles
- Focus on a solid backend and core functionality first.
- Real authentication and data integration are prioritized.
- UI/UX polish and advanced features will follow a stable core.

## I. Completed Milestones

### A. Project Foundation & Setup
    - Monorepo scaffold (pnpm workspace, mobile: Expo, server: Next.js)
    - Basic Dev-tooling (ESLint, Prettier, TSConfig) - [Note: Husky/Actions deferred]
    - Secret handling skeleton (.env files) - [Note: Cloud secrets deferred]
    - Google Cloud Project & OAuth Credentials acquired

### B. Core Backend - Initial Version
    - PostgreSQL Schema v0 (User, NextAuth models, AuditEvent)
    - Google Calendar API Wrapper (`googleCalendar.ts` for CRUD operations)
    - LLM Planner Setup (LangChain, Gemini, prompt v0 for action/param extraction)
    - Calendar Tools (`CreateEventTool`, `ListEventsTool`, `UpdateEventTool`, `DeleteEventTool` integrated with `googleCalendar.ts` but using mock credentials)
    - `/api/process` Route (Accepts text, uses planner & tools - currently with mock credentials)
    - E2E Smoke Test Script (`e2e:createMeeting` for `/api/process`)

### C. Mobile Shell - Basic Version
    - Expo Chat Screen (Basic UI: ListView, TextInput, Send button)
    - API Client (Basic POST from mobile to `/api/process`)
    - Dev build on device (Expo Go shows chat, can send to backend)

## II. Current Priority: Backend Solidification & Real Authentication

### A. Full Google OAuth Integration (NextAuth.js)
    1. **Configure NextAuth.js Google Provider**:
        - Ensure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are in `.env.development`.
        - Set up the provider in `apps/server/src/app/api/auth/[...nextauth]/route.ts`.
        - Define necessary scopes (e.g., `calendar.events`, `calendar.readonly`, `userinfo.profile`, `userinfo.email`, `offline_access` for refresh token).
    2. **Database Integration for Auth**:
        - Verify NextAuth.js Prisma adapter saves/updates `User` and `Account` tables.
        - Ensure `accessToken`, `refreshToken`, and `expires_at` for Google are stored in the `Account` table.
    3. **Access Token Management & Refresh**:
        - Implement logic within NextAuth.js callbacks or a helper function to handle Google access token refresh using the stored refresh token if an API call indicates an expired token.
        - Ensure calendar API calls always use a valid access token.
    4. **Session Management**:
        - Make `userId` and the (potentially refreshed) `accessToken` available in the server-side session for use by API routes.

### B. Integrate Real Authentication into API & Tools
    1. **Update `/api/process`**:
        - Remove mock `userId` and `accessToken`.
        - Retrieve `userId` and valid `accessToken` from the authenticated user\'s session (using NextAuth.js `getServerSession` or similar).
        - Pass these real credentials to the calendar tools.
    2. **Reliable Audit Logging**:
        - Ensure `logAuditEvent` uses the real `userId` from the session.
        - Verify foreign key constraint issues (P2003 error) are resolved by using valid, existing user IDs.

### C. End-to-End Testing with Real Credentials
    1. **Manual E2E Test**:
        - User logs in via a simple web page for testing auth (NextAuth.js provides default pages, or create a minimal one).
        - Use the `e2e:createMeeting` script or Postman, modified to include authentication (e.g., session cookie if applicable), to send a command to `/api/process`.
        - Verify a real calendar event is created/listed/updated/deleted on the user\'s Google Calendar.
        - Verify audit logs are correctly written with the real `userId`.
    2. **Mobile App Authentication (Basic)**:
        - (Stretch Goal for this phase) Implement a basic "Login with Google" button in the mobile app.
        - This button would open a web browser (e.g., using `expo-web-browser`) to the NextAuth.js sign-in URL.
        - After successful login and redirect, the mobile app needs a way to know it\'s authenticated (e.g., by making an API call to a protected endpoint that returns user info or by managing session state). For MVP, simply getting the server session to work is key.

## III. Next Steps: Core Feature Refinement & MVP Polish (Post-Authentication)

### A. Harden Calendar API Wrapper
    - Review and implement robust retry mechanisms for `googleCalendar.ts` for transient network errors.
    - Consider idempotency for create/update/delete operations (e.g., using a unique request ID if the Google API supports it or by checking for existing similar events before creation).

### B. Mobile App - Enhancements
    - If a proper mobile session/authentication state is established:
        - Conditionally show login/logout buttons.
        - Ensure API calls from mobile are authenticated.
    - Handle API errors gracefully in the UI (e.g., "Login required," "Calendar access denied by user," "Invalid request").

### C. (If time permits) Unit Tests for Core Backend
    - Begin writing unit tests for `googleCalendar.ts` (mocking Google API calls) and `planner.ts`.

## IV. Deferred / Future Enhancements (Post-MVP Core)

### A. Advanced Mobile Features
    - Streaming API responses (SSE with `eventsource-parser`) for a more interactive chat.
    - UI/UX Polish (Dark mode, empty states, animations, improved message bubble styling, context menus).
    - Push Notifications (Expo Push for event reminders or confirmations).
    - Confirmation Modals in the mobile app for sensitive actions (e.g., deleting multiple events).

### B. Advanced Backend Features
    - Diff Builder: Generate a structured diff of calendar changes for user preview.
    - Backend Guardrails: Implement stricter rules for operations touching multiple events or critical events.
    - Rate Limiting for the API.
    - Cost & Latency Logging: Implement the `UsageStats` table and logging for planner calls.
    - Support for "move" event as a distinct, optimized operation if different from general update.

### C. Testing & Quality Assurance
    - Comprehensive Unit Test coverage.
    - E2E Smoke Test Matrix (e.g., using Playwright for web-based auth and API testing, or expanding mobile tests).
    - Security Checklist (OWASP ASVS Level 1 review).
    - Dependency audit and updates.

### D. Deployment & Operations
    - Vercel Production Environment Setup.
    - Production Database (e.g., Supabase aiven_pg, PlanetScale).
    - CI/CD Pipeline (Lint, Test, Build, Deploy).
    - App Store Release (EAS Build, TestFlight, App Store Connect metadata).
    - Monitoring (Uptime, API error rates, Google AI costs, Bug SLAs).
    - Establish a feedback loop for user input and future iterations.

## Scope-Control Commandments (Reiteration)
1.  **Ship MVP with create/list/update/delete only.**
2.  **No local calendar read/write in v1.**
3.  **No recurring-rule editing** beyond full-series move/delete.
4.  **Limit Gemini calls to one per user request** (for now, to manage complexity and cost).
5.  **Any new idea goes to the backlog**—never mid-sprint.