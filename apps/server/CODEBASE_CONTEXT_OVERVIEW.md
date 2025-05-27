# Codebase Context Overview

This document provides a detailed overview of the key files, their functionalities, and their interactions within the server-side application. It is intended to serve as a comprehensive context guide, especially for language models assisting in development.

## Table of Contents

1.  [API Endpoint (`src/app/api/chat/route.ts`)](#api-endpoint-srcappapichatroutetets)
2.  [Core Library (`src/lib/`)](#core-library-srclib)
    *   [`auditLog.ts`](#srclibauditlogts)
    *   [`calendarTools.ts`](#srclibcalendartoolsts)
    *   [`centralOrchestratorLLM.ts`](#srclibcentralorchestratorllmts)
    *   [`chatController.ts`](#srclibchatcontrollerts)
    *   [`eventAnalyzer.ts`](#srclibeventanalyzerts)
    *   [`eventCreatorLLM.ts`](#srclibeventcreatorllmts)
    *   [`eventDeleterLLM.ts`](#srclibeventdeleterllmts)
    *   [`eventUpdaterLLM.ts`](#srclibeventupdaterllmts)
    *   [`generalChatHandler.ts`](#srclibgeneralchathandlerts)
    *   [`googleCalendar.ts`](#srclibgooglecalendarts)
    *   [`planner.ts`](#srclibplannerts)
    *   [`prisma.ts`](#srclibprismats)
3.  [Prompts (`src/prompts/`)](#prompts-srcprompts)

---

## 1. API Endpoint (`src/app/api/chat/route.ts`)

This file defines the main API route for handling all chat interactions.

**Primary Function:** `POST(req: NextRequest)`

**Key Responsibilities & Flow:**

1.  **Authentication & Authorization:**
    *   Retrieves and verifies the Clerk session token from the `Authorization` header.
    *   Uses `clerkClient.verifyToken()` to get user claims (`userId` which is `clerkUserId`).
    *   Looks up the internal database `User` ID (`internalUserId`) based on `clerkUserId` using Prisma.
    *   Fetches the user's Google OAuth Access Token from Clerk using `clerkClient.users.getUserOauthAccessToken(userId, "google")`.
    *   Returns `401` or `403` errors if auth/token issues arise.

2.  **Request Parsing:**
    *   Parses the JSON request body (`req.json()`).
    *   Extracts:
        *   `textInput`: The user's message (string, required).
        *   `selectedCalendarIds`: Optional array of calendar IDs the user has selected in the UI.
        *   `userTimezone`: String, defaults to "UTC" if not provided.
        *   `conversationId`: String. If not provided, a new `uuidv4()` is generated.
    *   Logs basic request details (ConvID, User, Input, Timezone).

3.  **Conversation History & Context:**
    *   Fetches recent `ConversationTurn` records from Prisma for the given `conversationId` (ordered by `turnNumber`, `take: 20`).
    *   Determines the `userTurnNumber` for the current message.
    *   Extracts `clarificationContext` from the last assistant turn in history, if present. This context is crucial for resolving pending multi-turn operations (e.g., conflict resolution).

4.  **Logging User Turn:**
    *   Creates a new `ConversationTurn` record in Prisma for the current user's message (`actor: 'USER'`).

5.  **Calendar & Timezone Context Preparation:**
    *   `currentTimeISO`: Current time as an ISO string.
    *   Fetches the user's list of Google Calendars using `googleCalendar.getUserCalendarList()` to provide context to LLMs. Formats this list into a string (`userCalendarsFormatted`).
    *   Determines `assistantTurnNumber`.

6.  **Central Orchestration (`centralOrchestratorLLM.getNextAction()`):**
    *   This is the primary decision-making step.
    *   Calls `getNextAction()` with `orderedHistory`, `textInput`, `userTimezone`, and `userCalendarsFormatted`.
    *   `getNextAction()` returns an `OrchestratorDecision` object, which includes:
        *   `actionType`: The type of action the orchestrator decided upon (e.g., `respond_directly`, `call_planner`, `fetch_context_and_call_planner`, `perform_google_calendar_action`).
        *   `params`: Parameters for the chosen action.
        *   `responseText`: If the orchestrator itself has a direct response.
        *   `reasoning`: The LLM's rationale.
        *   `clarificationContextToSave`: Any context that needs to be saved for future turns if the assistant is asking a question.
        *   `timezoneInfo`: Detailed timezone calculations performed by the orchestrator.
    *   Handles errors from the orchestrator by logging and returning a `500` status.

7.  **Action Execution (based on `OrchestratorDecision.actionType`):**

    *   **`respond_directly` or `ask_user_question`:**
        *   The `orchestratorDecision.responseText` is used as the final message.
        *   If `ask_user_question`, `assistantRequiresFollowUp` is set to `true`, and `clarificationContextToSave` is stored.
        *   Logs the assistant's turn to Prisma and returns the response to the user.

    *   **`call_planner`:**
        *   Invokes `planner.generatePlan()` with input from `orchestratorDecision.params.userInput` (or `textInput`), time/timezone info, calendar list, and orchestrator's `timezoneInfo` and other `params`.
        *   `generatePlan()` returns a `CalendarAction` object (e.g., `{ action: "create_event", params: { ... } }`).
        *   Handles errors from `generatePlan()`.
        *   If a plan is generated, it calls `chatController.executePlan()` with the plan and all necessary context (auth tokens, user details, calendar info, `timezoneInfo` from orchestrator).
        *   `executePlan()` returns an `ExecutePlanResult`, which can be:
            *   A simple string message.
            *   A `ClarificationNeededForDeletion` object.
            *   A `ClarificationNeededForTimeRange` object.
            *   A `ConflictDetectedForCreation` object.
            *   A `CreateEventExecutionResult` object (with `userMessage` and `createdEventsDetails`).
        *   **Clarification Handling:** If `executePlanResult` is a clarification object, `route.ts` re-invokes `centralOrchestratorLLM.getNextAction()` with a system-generated clarification request prompt. The new decision from `getNextAction` (which should be an `ask_user_question` type) is then used to form the response.
        *   **Conflict Handling:** If `executePlanResult` is a conflict object, a user-facing message detailing the conflict and suggestions is constructed.
        *   Logs the assistant's turn (including planner action as `toolCalled`, plan params, and `executePlanResult` as `toolResult`) and returns the final response.
        *   Handles errors from `executePlan()`.

    *   **`fetch_context_and_call_planner`:**
        *   This flow is for when the user's request refers to events not explicitly in the conversation history.
        *   **Step 1: Fetch Context Events:**
            *   Uses `googleCalendar.apiListEvents()` to search for events based on `contextQuery`, `contextTimeMin`, `contextTimeMax`, and `contextCalendarIds` provided by the orchestrator.
            *   Prioritizes searching specified calendars, then selected calendars, then primary.
            *   If no events are found with the specific query, it attempts a broader search within the time range.
            *   The found events (`fetchedAnchorEvents`) are formatted.
            *   Handles errors during context fetching by responding to the user.
        *   **Step 2: Call Planner with Context:**
            *   Calls `planner.generatePlan()` with the original user input and the `fetchedAnchorEvents` merged into `orchestratorDecision.params.anchorEventsContext`.
        *   **Step 3: Execute Plan:**
            *   The rest of the execution (calling `executePlan()`, handling results, logging) is similar to the `call_planner` flow, but `toolResult` will include `fetchedAnchorEvents`.

    *   **`perform_google_calendar_action`:**
        *   For direct Google Calendar operations decided by the orchestrator (typically after a clarification flow).
        *   Currently supports `GCToolName: 'delete_event_direct'`.
        *   Iterates through `GCToolArgs` (an array of event details like `{eventId, calendarId, summary}`) and calls `googleCalendar.apiDeleteEvent()` for each.
        *   Constructs a summary response message.
        *   Logs the assistant's turn and returns the response.

8.  **Database Logging (Assistant's Turn):**
    *   Throughout all flows, after determining the assistant's final response and actions, a `ConversationTurn` record is created in Prisma for the assistant (`actor: 'ASSISTANT'`). This log includes:
        *   `messageText`: The final message sent to the user.
        *   `toolCalled`: Name of the primary tool or action path (e.g., `planner->create_event`, `direct_gc_action->delete_event_direct`, `orchestrator_fallback`).
        *   `toolParams`: Parameters passed to the tool/action.
        *   `toolResult`: Result from the tool/action. For event creations, this includes `createdEventsDetails`.
        *   `requiresFollowUp`: Boolean.
        *   `clarificationContext`: JSON object if the assistant is waiting for user clarification.
        *   `llmPrompt`: The reasoning or main prompt content that led to the assistant's action (often `orchestratorDecision.reasoning`).

9.  **Response to Client:**
    *   Returns a JSON response (e.g., `{ message: "...", conversationId: "..." }`) or an error object.

---

## 2. Core Library (`src/lib/`)

### `srclibauditlogts`

*   **Purpose:** Provides a centralized function for logging audit trails of significant actions, primarily Google Calendar API calls.
*   **Key Function:** `async function logAuditEvent(data: AuditEventData)`
    *   **Input (`AuditEventData`):**
        *   `clerkUserId`: The Clerk user ID.
        *   `action`: A string describing the action (e.g., `calendar.listEvents`).
        *   `status`: `'SUCCESS'`, `'FAILURE'`, or `'PENDING'`.
        *   `requestId?`: Optional request identifier.
        *   `payload?`: `Prisma.InputJsonValue` for any relevant data.
        *   `error?`: Error message if status is `'FAILURE'`.
    *   **Logic:**
        1.  Finds the internal `User.id` from the provided `clerkUserId` using Prisma.
        2.  If the user is not found, logs an error to the console and returns (does not throw, to avoid interrupting the main flow).
        3.  Creates an `AuditEvent` record in the Prisma database with the provided data.
        4.  Catches database errors during logging and prints them to the console (does not re-throw).

### `srclibcalendartoolsts`

*   **Purpose:** Defines schemas for calendar operation parameters and provides LangChain `StructuredTool` wrappers for interacting with the Google Calendar API.
    *   **Note:** The `ARCHITECTURE_EVOLUTION_PLAN.md` suggests dismantling these `StructuredTool` classes into simpler "Skill" functions in the new architecture.
*   **Zod Schemas:**
    *   `eventDateTimeSchemaForTool`: For event start/end times (supports `date` or `dateTime`, `timeZone`).
    *   `attendeeSchemaForTool`: For event attendees (email, displayName, status, etc.).
    *   `createEventParamsSchema`: Detailed schema for event creation parameters. This is designed to align with the output expected from `eventCreatorLLM.ts`. It includes fields like `summary`, `description`, `location`, `start`, `end`, `attendees`, `calendarId`, `recurrence`, `reminders`, `colorId`, `conferenceData`, etc.
    *   `listEventsParamsSchema`: For listing events (`calendarId`, `query`, `timeMin`, `timeMax`, `questionAboutEvents`, `timeZone`).
    *   `deleteEventParamsSchema`: For deleting events (requires `eventId` or `summary`, `calendarId`).
    *   `updateEventParamsSchema`: For updating events (requires `eventId`, and optional fields like `summary`, `description`, `location`, `start`, `end`, `attendees`, `calendarId`).
*   **Helper Function:** `transformToGoogleCalendarEvent()`:
    *   Attempts to convert parameters from Zod schemas (especially `createEventParamsSchema` or `updateEventParamsSchema`) into the format required by the Google Calendar API (`calendar_v3.Schema$Event`).
    *   Its logic seems to be in transition, with parts handling the new detailed `createEventParamsSchema` and fallback logic for older or simpler update structures.
*   **LangChain `StructuredTool` Classes:**
    *   **`CreateEventTool(clerkUserId, googleAccessToken)`:**
        *   `schema`: `createEventParamsSchema`.
        *   `_call(arg)`: Takes the detailed event object (`arg`).
            *   Uses `transformToGoogleCalendarEvent()` to prepare the payload.
            *   Calls `googleCalendar.apiInsertEvent()`.
            *   Returns a JSON string with a user-friendly `message` and `details` (id, summary, htmlLink, start, end, calendarId of the created event).
            *   Handles errors, including Zod validation errors and Google API errors.
    *   **`ListEventsTool(clerkUserId, googleAccessToken)`:**
        *   `schema`: `listEventsParamsSchema`.
        *   `_call(params)`:
            *   Calls `googleCalendar.apiListEvents()`.
            *   If `params.questionAboutEvents` is present, it returns the raw array of `calendar_v3.Schema$Event` objects for further analysis (by `eventAnalyzer.ts`).
            *   Otherwise, it returns a formatted string summarizing the found events.
            *   Handles "no events found" and API errors.
    *   **`UpdateEventTool(clerkUserId, googleAccessToken)`:**
        *   `schema`: `updateEventParamsSchema`.
        *   `_call(arg)`:
            *   Uses `transformToGoogleCalendarEvent()` to prepare the patch payload.
            *   Calls `googleCalendar.apiPatchEvent()`.
            *   Returns a string confirming the update or detailing a failure.
            *   Handles Zod and API errors.

### `srclibcentralorchestratorllmts`

*   **Purpose:** This is the primary AI "brain" of the application. It decides the overall strategy for responding to a user's message by analyzing the conversation history and current input.
*   **LLM Used:** `ChatGoogleGenerativeAI` (Gemini Flash, low temperature for predictability).
*   **Key Function:** `async getNextAction(conversationHistory, currentUserMessage, userTimezone, userCalendarsFormatted, isClarificationRequest?)`
    *   **Inputs:**
        *   `conversationHistory: ConversationTurn[]`
        *   `currentUserMessage: string`
        *   `userTimezone: string`
        *   `userCalendarsFormatted: string` (list of user's Google Calendars)
        *   `isClarificationRequest?: boolean`: Flag indicating if this call is specifically to generate a clarification question (used by `chat/route.ts`).
    *   **Core Logic:**
        1.  **History Formatting:** Calls `formatConversationHistoryForPrompt()` to prepare history for the LLM.
        2.  **Timezone Calculation:** Calls `calculateTimezoneInfo()` to get comprehensive, pre-calculated timezone details (`timezoneInfo` object) to provide to the LLM. This is the *only* place timezone calculations should occur.
        3.  **Mode Determination & System Prompt Selection:**
            *   Checks if an `activeClarificationContext` exists from the last assistant turn in `conversationHistory`.
            *   **Conflict Resolution Mode:** If `activeClarificationContext.type === "conflict_resolution_pending"`, uses a specific system prompt to guide the LLM in interpreting the user's response to a previously identified event creation conflict.
            *   **Deletion Clarification Mode:** If `activeClarificationContext.type === "delete_candidates_for_confirmation"`, uses a system prompt focused on interpreting the user's choice from a list of deletion candidates.
            *   **Time Range Clarification Generation Mode:** If `isClarificationRequest` is true and `currentUserMessage` indicates a "delete_clarify_time_range" system request, uses a prompt to make the LLM formulate a question to the user about the time range for deletion.
            *   **General Clarification Question Generation Mode:** If `isClarificationRequest` is true (and not the time range case), uses a prompt to make the LLM formulate a question based on a `SYSTEM_CLARIFICATION_REQUEST` (e.g., to choose from ambiguous deletion candidates).
            *   **Standard Request Processing Mode:** If none of the above, uses a general-purpose system prompt. This prompt is highly detailed and instructs the LLM on:
                *   Prioritizing active task context resolution (delegated to the modes above if context exists).
                *   Distinguishing between follow-up messages and new requests.
                *   Identifying critical follow-up patterns (event modifications, information requests).
                *   Combining history with current input for complete planner requests.
                *   Mandating `call_planner` for any actual calendar operations (create, list, update, delete).
                *   Using `fetch_context_and_call_planner` if the request refers to events not detailed in recent history (explicit or implicit temporal references like "after work").
                *   Preserving time context from previous turns for follow-ups (e.g., "What about Monday?" after discussing a 7pm event).
                *   Handling relative event creation using `anchorEventsContext`.
                *   Specific rules for deletion intent (singular vs. plural, time scoping for recently created events).
                *   When to use `respond_directly` (non-calendar, non-follow-up chat) or `ask_user_question` (initial ambiguity).
                *   Strict date calculation and ISO8601 formatting rules using the provided `timezoneInfo`.
        4.  **LLM Invocation:** Sends system prompt and current user message to the Gemini LLM.
        5.  **Output Parsing & Validation:**
            *   Trims and cleans the LLM's string output (handles markdown code blocks).
            *   Parses the string as JSON.
            *   Validates the parsed JSON against `llmDecisionSchema` (a Zod schema defining `actionType`, `params`, `responseText`, `reasoning`, `clarificationContextToSave`).
        6.  **Result Construction:**
            *   Populates the `OrchestratorDecision` object. Ensures `params.userInput` is set for `call_planner`.
            *   Includes the `timezoneInfo` object in the returned decision.
        7.  **Error Handling:** If LLM call or parsing fails, returns a fallback `OrchestratorDecision` (usually `respond_directly` with an error message).
*   **Helper Function:** `formatConversationHistoryForPrompt(history: ConversationTurn[])`
    *   Takes an array of `ConversationTurn` objects.
    *   Formats each turn into a readable string: `Turn N (ACTOR): messageText`.
    *   For `ASSISTANT` turns, it appends summaries of `toolCalled` and `toolResult` (intelligently summarizing event details, lists, or short strings from `toolResult`).
    *   Also indicates if the assistant turn `requiresFollowUp` and includes `clarificationContext` type.
    *   Returns a single string representing the conversation history.
*   **Helper Functions:** `calculateTimezoneInfo(userTimezone: string)` & `getTimezoneOffset(timezone: string)`
    *   `getTimezoneOffset`: Uses `Intl.DateTimeFormat` to get the correct GMT offset string (e.g., "-07:00").
    *   `calculateTimezoneInfo`: Provides a comprehensive object with user's local time, offset, current time in user's TZ (ISO8601 with offset), and pre-formatted dates (today, tomorrow, yesterday) and ISO strings for common time boundaries (today/tomorrow/yesterday start/end). This centralization is critical for accurate time handling by LLMs.

### `srclibchatcontrollerts`

*   **Purpose:** This file acts as the execution layer for actions determined by the `planner.ts` (and in the new architecture, it will evolve into the Workflow Engine). It orchestrates calls to specialized LLMs (for JSON generation), calendar tools/API wrappers, and other handlers.
*   **Key Function:** `async executePlan(params: ChatControllerParams)`
    *   **Input (`ChatControllerParams`):**
        *   `plan: CalendarAction` (from `planner.ts`)
        *   `internalDbUserId`, `clerkUserId`, `googleAccessToken`
        *   `explicitCalendarId?`, `selectedCalendarIds?`
        *   `userTimezone`, `textInput`, `userCalendarsFormatted`, `currentTimeISO`
        *   `timezoneInfo?`: Detailed timezone object from the orchestrator.
    *   **Output:** `ExecutePlanResult` (string, or one of the defined object types for clarification, conflict, or creation results).
    *   **Logic (based on `plan.action`):**
        *   **`create_event`:**
            1.  Casts `plan.params` to `CreateEventIntentParams`.
            2.  Fetches existing events from the user's selected/primary calendars for the near future (`apiListEvents`) to be used for code-based conflict detection and conditional logic by the `eventCreatorLLM`.
            3.  Calls `eventCreatorLLM.generateEventCreationJSONs()` with user input, timezone, calendar list, `anchorEventsContext` (if any from planner/orchestrator), and the `existingEventsForConflictCheck`. The `eventCreatorLLM` is expected to handle conditional logic like "if X conflicts, then Y" using these existing events.
            4.  **Code-based Conflict Detection:**
                *   If `eventJSONsToCreate` are returned, calls `checkEventConflicts()` (local helper) to see if these proposed events overlap with `existingEventsForConflictCheck`.
                *   If conflicts exist, calls `generateTimeSlotSuggestions()` (local helper) and returns a `ConflictDetectedForCreation` object containing the proposed events, conflicting events, a message, and suggestions.
            5.  If no code-based conflicts (or if this step is skipped/modified), it iterates through `eventJSONsToCreate` (from `eventCreatorLLM`).
            6.  For each event object, it instantiates `CreateEventTool` and calls its `call()` method.
            7.  Aggregates messages from `CreateEventTool` results.
            8.  Returns a `CreateEventExecutionResult` object containing the combined user message and an array of `createdEventsDetails` (ID, summary, link, start, end, etc., for each successfully created event).
        *   **`list_events`:**
            1.  Parses `plan.params` with `listEventsParamsSchema`.
            2.  Determines `effectiveCalendarId` (explicit, then from params, then primary) and `effectiveTimeZone`.
            3.  **Multi-calendar fetch:** If `selectedCalendarIds` are present and no `explicitCalendarId`, it iterates through `selectedCalendarIds`, calls `apiListEvents` for each, and aggregates results into `fetchedEvents` (adding `calendarId` to each event).
            4.  **Single-calendar fetch:** Otherwise, instantiates `ListEventsTool` and calls its `call()` method.
                *   If `ListEventsTool` returns an array (because `questionAboutEvents` was true), these become `fetchedEvents`.
                *   If it returns a string (summary, no question), this becomes `toolResult` and processing for this case ends.
            5.  **Event Analysis:** If `params.questionAboutEvents` was true:
                *   If `fetchedEvents` exist, formats them into a string context and calls `eventAnalyzer.handleEventAnalysis()`. The result is the `toolResult`.
                *   If no events, sets an appropriate "no events found" message.
            6.  **Simple Summary (No Question):** If no `questionAboutEvents` and `toolResult` isn't already set (e.g., from single-calendar string output), it formats a summary of `fetchedEvents`.
        *   **`update_event`:**
            1.  Casts `plan.params` to `UpdateEventIntentParams`.
            2.  Determines `targetCalendarIdsForUpdate`.
            3.  Fetches events to consider for update:
                *   If `anchorEventsContext` (with real event IDs, usually from `fetch_context_and_call_planner` via orchestrator) is provided in `plan.params`, these are used directly.
                *   Otherwise, calls `apiListEvents` on `targetCalendarIdsForUpdate` with `timeMin`, `timeMax`, `query` from `plan.params`.
            4.  If no events found to consider, returns a "couldn't find events to update" message.
            5.  Calls `eventUpdaterLLM.generateEventUpdateJSONs()` with user input, timezone, the list of `eventsToConsiderForUpdate`, and `targetCalendarIds`.
            6.  If `eventUpdaterLLM` returns no specific events to update, returns an appropriate message.
            7.  Iterates through the update objects from `eventUpdaterLLM`. For each:
                *   Ensures `eventId` and `calendarId` are present and the `calendarId` is among the targets.
                *   Constructs parameters for `UpdateEventTool` (only including fields that are actually being changed).
                *   Instantiates `UpdateEventTool` and calls its `call()` method.
                *   Aggregates results and formulates a summary message indicating success/failure for each attempted update.
        *   **`delete_event`:**
            1.  Casts `plan.params` to `DeleteEventIntentParams`.
            2.  Determines `targetCalendarIdsForDelete`.
            3.  Fetches all events from `targetCalendarIdsForDelete` within the `timeMin`/`timeMax` specified in `plan.params` using `apiListEvents`. These are `eventsToConsiderForDeletion`.
            4.  If no events found in the time range: Returns a `ClarificationNeededForTimeRange` object.
            5.  Calls `eventDeleterLLM.generateEventDeletionJSONs()` with user input, timezone, the `eventsToConsiderForDeletion`, and `targetCalendarIds`.
            6.  **Ambiguity Handling:**
                *   If `plan.params.originalRequestNature` was "singular" but `eventDeleterLLM` identifies multiple events: Returns `ClarificationNeededForDeletion` with the candidates.
                *   If `eventDeleterLLM` is unsure (returns no specific events) but there were potential candidates: Returns `ClarificationNeededForDeletion` with all `eventsToConsiderForDeletion` as candidates.
            7.  If `eventDeleterLLM` returns no specific events to delete (and not an ambiguity case), returns a "couldn't pinpoint specific ones to delete" message.
            8.  Iterates through event IDs/calendarIDs from `eventDeleterLLM`. For each:
                *   Ensures `eventId` and `calendarId` are present and the `calendarId` is among the targets.
                *   Calls `googleCalendar.apiDeleteEvent()`.
                *   Aggregates results and formulates a summary message.
        *   **`general_chat`:**
            1.  Calls `generalChatHandler.handleGeneralChat()` with `textInput`.
*   **Helper functions for conflict detection (used in `create_event`):**
    *   `parseEventDateTime(dateTime: any): Date | null`: Parses Google Calendar's start/end object into a JS `Date`.
    *   `checkEventConflicts(proposedEvents, existingEvents, userTimezone): Promise<ConflictCheckResult>`: Compares proposed event times with existing event times for overlaps.
    *   `generateTimeSlotSuggestions(proposedEvent, existingEvents, userTimezone): string[]`: Creates a list of alternative time slot suggestions if a conflict is found.
    *   `findAvailableSlots(targetDate, duration, existingEvents): Date[]`: Helper to find open slots on a given day.
*   **Defined Result Interfaces:** `CreatedEventDetails`, `ClarificationNeededForDeletion`, `ClarificationNeededForTimeRange`, `ConflictDetectedForCreation`, `CreateEventExecutionResult`, `ExecutePlanResult`.

### `srclibeventanalyzerts`

*   **Purpose:** Uses an LLM to answer user questions based on a provided list of calendar events.
*   **LLM Used:** `ChatGoogleGenerativeAI` (Gemini Flash, low temperature for factual analysis).
*   **Key Function:** `async handleEventAnalysis(userQuestion, eventDataString, userTimezone)`
    *   **Inputs:**
        *   `userQuestion: string`
        *   `eventDataString: string` (pre-formatted string of event details)
        *   `userTimezone: string` (IANA name)
    *   **Logic:**
        1.  Uses a system prompt (`ANALYSIS_SYSTEM_PROMPT` defined inline) that instructs the LLM to:
            *   Answer *only* based on the provided events.
            *   Calculate durations, count events, summarize as needed.
            *   State if information is insufficient.
            *   Format times naturally, using the provided `userTimezone` name if timezone needs to be specified.
            *   Include event summaries when referring to specific events.
            *   Understand varied terminology for event types.
            *   Be meticulous with calculations.
        2.  Constructs a human message combining `userQuestion` and `eventDataString`.
        3.  Invokes the LLM.
        4.  Parses the LLM's response content (handles string or array of text parts).
        5.  Returns the LLM's analytical response string.
        6.  Handles errors by returning an error message.

### `srclibeventcreatorllmts`

*   **Purpose:** Specializes in generating JSON payloads for creating Google Calendar events based on user requests and contextual information.
*   **LLM Used:** `ChatGoogleGenerativeAI` (Gemini Flash, low temperature for precise JSON).
*   **Zod Schemas:** Defines comprehensive schemas for event creation payloads, mirroring Google Calendar API structures:
    *   `eventDateTimeSchema`: For start/end times (date or dateTime, timeZone).
    *   `attendeeSchema`: For attendees.
    *   `reminderOverrideSchema`, `eventRemindersSchema`.
    *   `eventSourceSchema`.
    *   `googleCalendarEventCreateObjectSchema`: The main schema for a single event, including `calendarId`, `summary`, `description`, `location`, `start`, `end`, `attendees`, `recurrence`, `reminders`, `colorId`, `transparency`, `visibility`, `source`, `conferenceData`, `guestsCan...` flags, `status`.
    *   `eventCreationRequestListSchema`: An array of `googleCalendarEventCreateObjectSchema`.
    *   (Also includes schemas for a version with conflict detection: `conflictEventSchema`, `eventConflictResponseSchema`, `eventCreationOrConflictSchema` - though the primary `generateEventCreationJSONs` does not use these directly for its output.)
*   **Key Function:** `async generateEventCreationJSONs(params)`
    *   **Inputs (`params` object):**
        *   `userInput: string`
        *   `userTimezone: string`
        *   `userCalendarsFormatted: string`
        *   `currentTimeISO?: string`
        *   `anchorEventsContext?: AnchorEventContext[]`: Used as precise references for timing new events relative to existing ones.
        *   `existingEventsForConflictCheck?: calendar_v3.Schema$Event[]`: **Crucial for conditional logic.** The prompt instructs the LLM to use these events to evaluate conditions in the `userInput` (e.g., "if X conflicts, then Y").
        *   `timezoneInfo?`: Detailed timezone object from the orchestrator.
    *   **Logic:**
        1.  Reads the system prompt from `src/prompts/eventCreatorPrompt.md`.
        2.  Constructs a detailed human message including all input parameters.
            *   Emphasizes using pre-calculated `timezoneInfo`.
            *   Includes `anchorEventsContext` if provided.
            *   Includes `existingEventsForConflictCheck` and explicitly instructs the LLM to use these for evaluating conditional requests (e.g., "if 11am conflicts with [existing event], schedule at 3pm"). The LLM is expected to perform this conditional check.
        3.  Invokes the Gemini LLM.
        4.  Cleans and parses the LLM's JSON output.
        5.  Validates the parsed list of event objects against `eventCreationRequestListSchema`.
        6.  Returns the array of event objects to be created.
        7.  Handles errors by returning an empty array.
*   **Alternative Function (Potentially for future use or different flow):** `generateEventCreationJSONsWithConflictDetection(params)`
    *   Similar to the above, but its prompt additionally asks the LLM to perform conflict detection itself against `existingEventsForConflictCheck`.
    *   The LLM is expected to return either an `events_created` object or a `conflict_detected` object.
    *   Uses `eventCreationOrConflictSchema` for validation. (The current main flow in `chatController.ts` performs conflict detection in code after calling `generateEventCreationJSONs`).

### `srclibeventdeleterllmts`

*   **Purpose:** Specializes in identifying specific events to be deleted from a provided list, based on user input.
*   **LLM Used:** `ChatGoogleGenerativeAI` (Gemini Flash, low temperature).
*   **Zod Schemas:**
    *   `eventToDeleteSchema`: Defines an object with `eventId`, `calendarId`, optional `summary`, and `reasoningForDeletion`.
    *   `eventDeletionRequestListSchema`: An array of `eventToDeleteSchema`.
*   **Key Function:** `async generateEventDeletionJSONs(params: GenerateEventDeletionJSONsParams)`
    *   **Inputs (`params` object):**
        *   `userInput: string`
        *   `userTimezone: string`
        *   `eventList: EventWithCalendarId[]`: A list of potential events (already fetched by `chatController`) that the LLM should choose from. `EventWithCalendarId` ensures `calendarId` is present.
        *   `targetCalendarIds: string[]`: Calendar IDs the deletion should be confined to.
        *   `currentTimeISO?: string`
        *   `timezoneInfo?`: Detailed timezone object from orchestrator.
    *   **Logic:**
        1.  Reads the system prompt from `src/prompts/eventDeleterPrompt.md`.
        2.  Simplifies `params.eventList` for the prompt (extracts key fields like id, summary, start, end, calendarId).
        3.  Constructs a human message with user input, timezone, target calendar IDs, `timezoneInfo`, and the `simplifiedEventList`. Instructs LLM to only include events from the provided list.
        4.  Invokes the Gemini LLM.
        5.  Cleans the LLM output (handles markdown, extracts JSON array).
        6.  If the LLM output is effectively empty or indicates no events (e.g., textual "no events"), returns an empty array.
        7.  Parses and validates the JSON output against `eventDeletionRequestListSchema`.
        8.  Returns the array of event objects identified for deletion.
        9.  Handles errors by returning an empty array.

### `srclibeventupdaterllmts`

*   **Purpose:** Specializes in identifying events to be updated from a list and determining the specific fields to change, based on user input.
*   **LLM Used:** `ChatGoogleGenerativeAI` (Gemini Flash, low temperature).
*   **Zod Schemas:**
    *   `eventDateTimeUpdateSchema`: Optional start/end time updates.
    *   `eventToUpdateSchema`: Defines an object with `eventId`, `calendarId`, optional new `summary`, `description`, `location`, `start`, `end`, `attendees` (array of emails), and `reasoningForUpdate`.
    *   `eventUpdateRequestListSchema`: An array of `eventToUpdateSchema`.
*   **Key Function:** `async generateEventUpdateJSONs(params: GenerateEventUpdateJSONsParams)`
    *   **Inputs (`params` object):** Similar to `eventDeleterLLM`, including `userInput`, `userTimezone`, `eventList` (potential events to update), `targetCalendarIds`, `currentTimeISO`, `timezoneInfo`.
    *   **Logic:**
        1.  Reads system prompt from `src/prompts/eventUpdaterPrompt.md`.
        2.  Simplifies `params.eventList` for the prompt.
        3.  Constructs a human message with all context, instructing the LLM to only include events from the list and specify updates.
        4.  Invokes Gemini LLM.
        5.  Cleans LLM output, parses, and validates against `eventUpdateRequestListSchema`.
        6.  Returns the array of event update objects.
        7.  Handles errors/empty responses by returning an empty array.

### `srclibgeneralchathandlerts`

*   **Purpose:** Provides a fallback for conversational interactions that are not specific calendar commands.
*   **LLM Used:** `ChatGoogleGenerativeAI` (Gemini 1.5 Flash, standard temperature for chat).
*   **Key Function:** `async handleGeneralChat(userMessage: string)`
    *   **Logic:**
        1.  Uses a system prompt (`APP_CONTEXT` defined inline) that describes the AI's role as an assistant for a Google Calendar management app.
        2.  Instructs the LLM to guide users on calendar functions if their query is vague but related, or engage in general chat otherwise.
        3.  Sends the system prompt and `userMessage` to the LLM.
        4.  Parses LLM response content (handles string or array of text parts).
        5.  Returns the LLM's chat response string.
        6.  Handles errors by returning an error message.

### `srclibgooglecalendarts`

*   **Purpose:** Contains direct wrapper functions for making Google Calendar API calls. It's the lowest level of interaction with the Google API.
*   **Helper Function:** `getCalendarClient(accessToken)`: Creates an OAuth2-authenticated Google Calendar API client instance.
*   **Core API Functions:** Each function takes `clerkUserIdForAudit` and `accessToken`, along with specific parameters for the API call. They all use `getCalendarClient()` and then call the corresponding `google.calendar.events.*` or `google.calendar.calendarList.*` method.
    *   `async listEvents(..., calendarId, options?)`: Lists events.
    *   `async insertEvent(..., calendarId, event)`: Inserts an event.
    *   `async patchEvent(..., calendarId, eventId, eventPatch)`: Updates (patches) an event.
    *   `async deleteEvent(..., calendarId, eventId)`: Deletes an event.
    *   `async getUserCalendarList(...)`: Retrieves the user's list of calendars.
*   **Audit Logging:** Each core API function integrates with `auditLog.ts`:
    *   Calls `logAuditEvent()` on `SUCCESS` with relevant payload (e.g., calendarId, options, event details, createdEventId).
    *   Calls `logAuditEvent()` on `FAILURE` with payload and error message.
*   **Error Handling:** Catches errors from API calls, logs them, and typically returns `null` (for functions expecting data) or `false` (for functions indicating success/failure).

### `srclibplannerts`

*   **Purpose (Current Architecture):** Interprets the user's natural language input and translates it into a structured `CalendarAction` object, which specifies the type of calendar operation (or general chat) and its parameters.
    *   **Note:** The `ARCHITECTURE_EVOLUTION_PLAN.md` indicates this planner's role will significantly change, likely being absorbed or replaced by the more sophisticated Decomposer (`centralOrchestratorLLM`) and specialized Skills.
*   **LLM Used:** `ChatGoogleGenerativeAI` (Gemini Flash, low temperature).
*   **Zod Schemas:**
    *   `plannerActionSchema`: Defines the structure of individual actions the planner can identify (e.g., `create_event_action_params`, `list_events_action_params`).
    *   `calendarActionSchema`: The overall output schema for the planner, containing `action` (enum like `create_event`, `list_events`, etc.) and `params`.
*   **Intent Parameter Interfaces:**
    *   `CreateEventIntentParams`: `userInput`, `userTimezone`, `calendarId?`, `anchorEventsContext?`.
    *   `DeleteEventIntentParams`: `userInput`, `userTimezone`, `calendarId?`, `timeMin?`, `timeMax?`, `query?`, `originalRequestNature?`.
    *   `UpdateEventIntentParams`: `userInput`, `userTimezone`, `calendarId?`, `timeMin?`, `timeMax?`, `query?`, `anchorEventsContext?`.
    *   `AnchorEventContext`: Used to pass details of existing events (summary, start, end, calendarId) when new actions are relative to them.
*   **Type:** `CalendarAction`
    *   Defines the structure `{ action: "action_name", params?: ..., speakableToolResponse?: string }`.
*   **Key Function:** `async generatePlan(userInput, currentTimeISO, userTimezone, userCalendarsFormatted?, orchestratorParams?, timezoneInfo?)`
    *   **Inputs:**
        *   `userInput: string`
        *   `currentTimeISO: string`
        *   `userTimezone: string`
        *   `userCalendarsFormatted?`: String list of user's calendars.
        *   `orchestratorParams?`: Hints from `centralOrchestratorLLM` like `originalRequestNature` (for deletions), `timeMin`/`timeMax` (for scoping deletions of recent events), and `anchorEventsContext`.
        *   `timezoneInfo?`: Detailed timezone object from orchestrator.
    *   **Logic:**
        1.  Reads the system prompt from `src/prompts/calendar.md`.
        2.  Constructs a human message including user input, current time, timezone, calendar list, and any provided `orchestratorParams` and `timezoneInfo`. The prompt guides the LLM on how to use `anchorEventsContext`.
        3.  Invokes the Gemini LLM.
        4.  Cleans and parses the LLM's JSON output.
        5.  Validates the parsed JSON against `calendarActionSchema`.
        6.  Returns the `CalendarAction` object or `null` if parsing/validation fails.
        7.  Includes error handling and a fallback.

### `srclibprismats`

*   **Purpose:** Initializes and exports the Prisma client instance for database interactions.
*   **Typical Content:**
    ```typescript
    import { PrismaClient } from '@prisma/client';
    const prisma = new PrismaClient();
    export default prisma;
    ```
*   This client is used by other modules (e.g., `chat/route.ts`, `auditLog.ts`) to read from and write to the database (e.g., `ConversationTurn`, `User`, `AuditEvent` tables).

---

## 3. Prompts (`src/prompts/`)

This directory contains the system prompts that define the behavior and output format for various LLMs used in the application.

*   **`calendar.md` (For `planner.ts` - current architecture):**
    *   **Role:** Instructs an LLM to act as a "Calendar Task Planner."
    *   **Goal:** Analyze user input and determine the appropriate calendar action (`create_event`, `list_events`, `update_event`, `delete_event`) or `general_chat`.
    *   **Output Format:** Strict JSON object adhering to `calendarActionSchema`, with `action` and `params`.
    *   **Key Instructions:**
        *   Date/Time Parsing: Emphasis on ISO 8601, understanding relative dates ("tomorrow," "next Friday").
        *   Timezone Handling: Use provided `userTimezone` and `currentTimeISO`.
        *   Conflict Avoidance (Guidance): Suggests avoiding conflicts but doesn't perform detection itself.
        *   Parameter Extraction: Details on what parameters to extract for each action (e.g., summary, start/end times for creation; eventId or query for updates/deletions).
        *   Handling Ambiguity: If intent is unclear, default to `general_chat`.
        *   Use of `anchorEventsContext`: If provided, use these existing event details to inform the parameters for new actions (e.g., scheduling relative to an anchor event).
    *   **Evolution Note:** This prompt's role will diminish or be replaced by `orchestratorDecompositionPrompt.md` for the new Decomposer.

*   **`eventCreatorPrompt.md` (For `eventCreatorLLM.ts`):**
    *   **Role:** Expert event creation assistant.
    *   **Goal:** Generate a JSON list of Google Calendar event objects based on detailed user request, timezone, calendar list, current time, anchor events, and existing events for conditional logic.
    *   **Output Format:** A JSON array of objects, where each object conforms to `googleCalendarEventCreateObjectSchema`.
    *   **Key Instructions:**
        *   Meticulously analyze all provided context.
        *   Adhere strictly to the JSON schema for event objects.
        *   Correctly format `start` and `end` times (using `date` for all-day or `dateTime` with offset for timed events).
        *   Use IANA timezone names if `timeZone` is specified.
        *   Utilize `anchorEventsContext` for relative scheduling.
        *   **Conditional Logic (Crucial):** If `existingEventsForConflictCheck` are provided, and user input contains conditional language ("if X conflicts...", "unless Y overlaps..."), the LLM must:
            1.  Evaluate the condition by checking for overlaps between the proposed primary time and the `existingEventsForConflictCheck`.
            2.  Create only ONE event based on the evaluation outcome (either the primary time or the alternative).
            3.  Use mathematical overlap detection: `start1 < end2 && start2 < end1`.
        *   No longer responsible for *final* conflict detection (the prompt used to say this, but `chatController` does code-based conflict detection; the LLM's role here is primarily for *interpreting conditional user requests* based on potential conflicts).

*   **`eventDeleterPrompt.md` (For `eventDeleterLLM.ts`):**
    *   **Role:** Event deletion specialist.
    *   **Goal:** Identify specific events to delete from a provided list based on user input.
    *   **Output Format:** A JSON array of objects, each conforming to `eventToDeleteSchema` (containing `eventId`, `calendarId`, `summary`, `reasoningForDeletion`).
    *   **Key Instructions:**
        *   Only select events from the `List of Potential Events to Delete` provided in the human message.
        *   Match `eventId` and `calendarId` exactly from the list.
        *   Carefully interpret user's intent to pinpoint the correct event(s).
        *   If multiple events match vague criteria, be cautious or select the most likely based on context.
        *   If no events in the list match, return an empty array.
        *   Provide `reasoningForDeletion`.

*   **`eventUpdaterPrompt.md` (For `eventUpdaterLLM.ts`):**
    *   **Role:** Event update specialist.
    *   **Goal:** Identify events to update from a provided list and specify the fields to be changed based on user input.
    *   **Output Format:** A JSON array of objects, each conforming to `eventToUpdateSchema` (containing `eventId`, `calendarId`, and new values for fields like `summary`, `start`, `end`, etc., plus `reasoningForUpdate`).
    *   **Key Instructions:**
        *   Only select events from the `List of Potential Events to Update`.
        *   Match `eventId` and `calendarId` exactly.
        *   Determine which fields of the event need to be updated based on the user's request.
        *   Format updated date/time fields correctly (ISO 8601 with offset).
        *   If no events in the list match or no clear update intent, return an empty array.
        *   Provide `reasoningForUpdate`.

*   **System Prompts within Code (Inline):**
    *   **`centralOrchestratorLLM.ts`:** Contains multiple complex system prompts (selected based on mode: standard, conflict resolution, deletion clarification, etc.) that define its role as a top-level AI orchestrator, rules for decision-making, action types, output JSON schema, and specific instructions for handling follow-ups, context, and timezones. These are highly detailed and critical to its function.
    *   **`eventAnalyzer.ts` (`ANALYSIS_SYSTEM_PROMPT`):** Instructs the LLM to answer questions based *only* on provided event data, perform calculations, and handle missing information gracefully.
    *   **`generalChatHandler.ts` (`APP_CONTEXT`):** Defines the LLM's role as a helpful assistant for a calendar application, guiding it on how to handle general conversation or vague calendar-related queries.

This concludes the detailed overview. This document should provide a solid foundation for any LLM (or human) to understand the current architecture and key functionalities of your application. 