# Event Creation Flow Documentation

This document outlines the end-to-end process for creating calendar events based on user's natural language input.

## 1. API Route Handler (`src/app/api/chat/route.ts`)

*   **Entry Point:** Receives the HTTP POST request from the frontend.
*   **Key Inputs from Request Body:**
    *   `text`: The user's natural language query (e.g., "I have work next week on tuesday and Monday from 11-2pm and 1-2 pm resp").
    *   `userTimezone`: The user's IANA timezone string (e.g., "America/Vancouver").
    *   `selectedCalendarIds` (optional): Array of calendar IDs the user might have pre-selected in the UI.
    *   `explicitCalendarId` (optional): A specific calendar ID the user might have chosen for this query.
*   **Authentication & Authorization:**
    *   Verifies Clerk session token.
    *   Fetches Google OAuth Access Token for the user via Clerk.
*   **Data Preparation for Planner & Controller:**
    *   `currentTimeISO`: Generates the current timestamp in ISO format (e.g., `2025-05-17T01:19:35.984Z`).
    *   `userCalendarsFormatted`: Calls `getUserCalendarList` (from `src/lib/googleCalendar.ts`) to fetch the user's Google Calendar list. This list is then formatted into a string like `(Name: "Work", ID: "work_id@example.com"), (Name: "Personal", ID: "user@gmail.com")`.
*   **Calls Planner:**
    *   Invokes `generatePlan` from `src/lib/planner.ts`.
    *   **Passes to `generatePlan`:**
        *   `userInput`: The `text` from the request.
        *   `currentTimeISO`: The current ISO timestamp.
        *   `userTimezone`: From the request.
        *   `userCalendarsFormatted`: The formatted string of user's calendars.
*   **Calls Controller:**
    *   Receives the `plan` object from `generatePlan`.
    *   Invokes `executePlan` from `src/lib/chatController.ts`.
    *   **Passes to `executePlan` (as part of `ChatControllerParams`):**
        *   `plan`: The object returned by the planner.
        *   `userId`: Clerk user ID.
        *   `googleAccessToken`: The fetched Google OAuth token.
        *   `explicitCalendarId`: From the request.
        *   `selectedCalendarIds`: From the request.
        *   `userTimezone`: From the request.
        *   `textInput`: The original user query (`text`).
        *   `userCalendarsFormatted`: The formatted calendar list.
        *   `currentTimeISO`: The current ISO timestamp.
*   **Response:** Sends the result from `executePlan` back to the frontend.

## 2. Planner (`src/lib/planner.ts`)

*   **Function: `generatePlan`**
    *   **Key Inputs:**
        *   `userInput`: The user's raw text query.
        *   `currentTimeISO`: Current ISO timestamp.
        *   `userTimezone`: User's IANA timezone.
        *   `userCalendarsFormatted`: Formatted string of user's calendars.
    *   **Core Logic:**
        *   Loads the main planner prompt from `src/prompts/calendar.md`.
        *   Injects `currentTimeISO`, `userTimezone`, and `userCalendarsFormatted` into the prompt.
        *   Uses `ChatGoogleGenerativeAI` model (`gemini-2.0-flash`) with function calling (`calendar_action_planner`) to interpret the `userInput`. The function's schema is derived from `calendarActionSchema`.
        *   Parses the LLM's response (which should be parameters for `calendar_action_planner`).
    *   **Function: `determineActualActionFromParams`**
        *   **Inputs:**
            *   `params`: The parameters extracted by the LLM (conforming to `CalendarActionParams`).
            *   `userInputForContext`: The original user input.
            *   `userTimezoneForContext`: The user's timezone.
        *   **Logic:** Analyzes the extracted `params` and `userInputForContext` to decide the definitive action (`create_event`, `list_events`, `update_event`, `delete_event`, or `general_chat`). For "create event" queries, it's designed to be more aggressive in classifying as `create_event` to pass it to the specialized `EventCreatorLLM`.
    *   **Output of `generatePlan` (for a "create event" intent):**
        *   An object like:
            ```json
            {
              "action": "create_event",
              "params": { // Conforms to CreateEventIntentParams
                "userInput": "I have work next week on tuesday and Monday from 11-2pm and 1-2 pm resp",
                "userTimezone": "America/Vancouver",
                "calendarId": "f73467aaf0fe39410e76ead78bb938e1414e839b3811cbc152d5644d11be929f@group.calendar.google.com" // Optional, if planner extracted a confident calendarId hint
              }
            }
            ```
        *   The `calendarId` in `params` is a hint; the `EventCreatorLLM` will make the final decision based on its own logic and the full `userCalendarList`.

## 3. Chat Controller (`src/lib/chatController.ts`)

*   **Function: `executePlan`**
    *   **Key Inputs (`ChatControllerParams`):**
        *   `plan`: The plan object from `generatePlan`.
        *   `userId`, `googleAccessToken`, `explicitCalendarId`, `selectedCalendarIds`, `userTimezone`, `textInput`, `userCalendarsFormatted`, `currentTimeISO`.
    *   **Logic for `plan.action === "create_event"`:**
        *   Extracts `userInput` and `userTimezone` from `plan.params` (which are `CreateEventIntentParams`).
        *   Optionally uses `plan.params.calendarId` as a hint if present.
        *   Calls `generateEventCreationJSONs` from `src/lib/eventCreatorLLM.ts`.
        *   **Passes to `generateEventCreationJSONs`:**
            *   `userInput`: The original user query from `plan.params.userInput`.
            *   `userTimezone`: The user's timezone from `plan.params.userTimezone`.
            *   `userCalendarsFormatted`: The full formatted calendar list (received by `executePlan`).
            *   `currentTimeISO`: The current ISO timestamp (received by `executePlan`).
        *   Receives a list of event data objects from `generateEventCreationJSONs`.
        *   Iterates through each event data object:
            *   Instantiates `CreateEventTool` (from `src/lib/calendarTools.ts`) with `userId` and `googleAccessToken`.
            *   Calls `CreateEventTool.call(eventData)` for each event.
            *   The `eventData` here is an object that should conform to `createEventParamsSchema` (defined in `calendarTools.ts`), which `googleCalendarEventCreateObjectSchema` (output by `EventCreatorLLM`) is designed to be compatible with.
        *   Aggregates results from each tool call.
    *   **Output:** A string message summarizing the outcome of the event creation(s) (or other actions).

## 4. Event Creator LLM (`src/lib/eventCreatorLLM.ts`)

*   **Function: `generateEventCreationJSONs`**
    *   **Key Inputs:**
        *   `userInput`: The user's raw text query.
        *   `userTimezone`: User's IANA timezone.
        *   `userCalendarsFormatted`: Formatted string of user's calendars.
        *   `currentTimeISO`: Current ISO timestamp.
    *   **Core Logic:**
        *   Loads the specialized event creation prompt from `src/prompts/eventCreatorPrompt.md`. This prompt guides the LLM to output a JSON *list* of event objects.
        *   The prompt content is passed as a `SystemMessage`.
        *   The `userInput`, `userTimezone`, `userCalendarsFormatted`, and `currentTimeISO` are passed within a structured `HumanMessage`.
        *   Uses `ChatGoogleGenerativeAI` model (`gemini-2.0-flash`).
        *   Parses the LLM's JSON string response.
        *   Validates the parsed list against `eventCreationRequestListSchema` (an array of `googleCalendarEventCreateObjectSchema`).
            *   `googleCalendarEventCreateObjectSchema` defines the detailed structure for a single event, including fields like `summary`, `start` (with `dateTime` and `timeZone`), `end` (with `dateTime` and `timeZone`), `calendarId`, `attendees`, `reminders`, etc.
            *   `eventDateTimeSchema` (part of `googleCalendarEventCreateObjectSchema`) uses `z.string().datetime({ offset: true, ... })` for `dateTime` fields, requiring full ISO 8601 with offset.
    *   **Output:** A JavaScript array of event objects. Each object represents a single event to be created and conforms to `googleCalendarEventCreateObjectSchema`. Example:
        ```json
        [
          {
            "summary": "Work",
            "start": { "dateTime": "2025-05-27T11:00:00-07:00", "timeZone": "America/Vancouver" },
            "end": { "dateTime": "2025-05-27T14:00:00-07:00", "timeZone": "America/Vancouver" },
            "calendarId": "f73467aaf0fe39410e76ead78bb938e1414e839b3811cbc152d5644d11be929f@group.calendar.google.com"
          },
          // ... potentially other event objects
        ]
        ```

## 5. Calendar Tools (`src/lib/calendarTools.ts`)

*   **Class: `CreateEventTool`**
    *   **Constructor Inputs:** `userId`, `accessToken`.
    *   **Schema:** `createEventParamsSchema`. This schema defines the expected structure of the argument passed to the `_call` method. It is designed to be compatible with the output of the `EventCreatorLLM` (`googleCalendarEventCreateObjectSchema`).
        *   `eventDateTimeSchemaForTool` (part of `createEventParamsSchema`) uses `z.string().datetime({ offset: true, ... })` for `dateTime` fields.
    *   **Method: `_call(arg)`**
        *   **Input `arg`:** A single event data object (from the list generated by `EventCreatorLLM`), which should conform to `createEventParamsSchema`.
        *   **Logic:**
            *   The `arg` (which is one of the detailed event objects) is passed to `transformToGoogleCalendarEvent`.
            *   `transformToGoogleCalendarEvent` maps fields from `createEventParamsSchema` structure to the `calendar_v3.Schema$Event` structure required by the Google Calendar API.
            *   Calls `apiInsertEvent` (from `src/lib/googleCalendar.ts`) with `userId`, `accessToken`, `calendarId` (from `arg`), and the transformed event object.
        *   **Output:** A string confirming success or detailing an error.

## 6. Google Calendar API Wrapper (`src/lib/googleCalendar.ts`)

*   **Function: `insertEvent`**
    *   **Key Inputs:** `userId`, `accessToken`, `calendarId`, `event` (Google Calendar API `Schema$Event` object).
    *   **Logic:**
        *   Gets an authenticated Google Calendar API client.
        *   Calls `calendar.events.insert(...)`.
        *   Logs the audit event.
    *   **Output:** The created Google Calendar event object or `null` on error.

This flow ensures that natural language for creating one or more events is processed through a specialized LLM, validated, and then executed by dedicated tools interacting with the Google Calendar API.



![Event Flowchart](/extras/flowchart-event-creation.svg)

