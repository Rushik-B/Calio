# API Documentation: /api/chat

This document provides instructions for frontend developers on how to interact with the `/api/chat` endpoint to perform Google Calendar operations based on natural language text input and maintain conversational context.

## Endpoint

`POST /api/chat`

## Authentication

-   The client MUST include a Clerk session token in the `Authorization` header.
-   Format: `Authorization: Bearer <YOUR_CLERK_SESSION_TOKEN>`

## Request Body

The request body MUST be a JSON object with the following structure:

```json
{
  "text": "Your natural language query for the calendar (e.g., '''Schedule a meeting tomorrow at 3 pm with John''')",
  "userTimezone": "America/New_York", // IANA timezone name
  "conversationId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", // Optional: UUID of the current conversation
  "calendarId": "primary", // Optional: Specific calendar for the action
  "selectedCalendarIds": ["user@example.com", "calendar_id_2"] // Optional: For multi-calendar list operations
}
```

-   `text` (string, required): The user's input string.
-   `userTimezone` (string, required): The IANA timezone name for the user (e.g., "America/New_York", "Europe/London"). This is crucial for correct date/time interpretation. If not provided, the backend defaults to "UTC", which might lead to incorrect event timings.
-   `conversationId` (string, optional): A UUID representing the current conversation. 
    -   If this is the first message in a conversation, omit this field or send `null`. The backend will generate a new `conversationId` and return it.
    -   For subsequent messages in the same conversation, the frontend MUST send the `conversationId` received from the previous backend response.
    -   This allows the backend to maintain conversational context and memory.
-   `calendarId` (string, optional): The specific Google Calendar ID to perform the action on.
    - For `create_event`: This will be the calendar where the event is created. If not provided, the system may infer one based on the text or default to the user's primary calendar.
    - For `list_events`, `update_event`, `delete_event`: This specifies the calendar for the operation. If not provided, it typically defaults to the primary calendar, or the system may search across accessible calendars if identifying events by summary.
-   `selectedCalendarIds` (array of strings, optional): An array of Google Calendar IDs that the user has selected or has active in the frontend.
    - This is primarily used for `list_events` actions where neither the user's text nor the `calendarId` parameter specifies a single calendar. In such cases, if `selectedCalendarIds` is provided, the system will attempt to fetch and aggregate events from all calendars in this list.
    - If omitted or empty, and no specific `calendarId` is determined for `list_events`, it will typically default to the primary calendar.

## Responses

The API will attempt to process the text, plan a calendar action, and execute it. **All responses (success and error) will now include a `conversationId` field.**

### 1. Successful Calendar Action

If the calendar action is successfully planned and executed, the response will be a JSON object with a `message` field detailing the outcome and a `conversationId`. The HTTP status code will be `200 OK`.

**Example Success (Event Created):**

```json
{
  "message": "Event created successfully. ID: <event_id>, Summary: <event_summary>, Link: <html_link>",
  "conversationId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

**Example Success (Events Listed):**

```json
{
  "message": "Found 2 event(s): ID: <id1>, Summary: <summary1>, Start: <dateTime1>; ID: <id2>, Summary: <summary2>, Start: <dateTime2>",
  "conversationId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

**Note on Future Enhancements for Clarification:**
In future versions, for ambiguous actions (e.g., deleting one of multiple events), the `message` field might become an object to support clarification dialogues:
```json
// Future possibility for clarification responses
{
  "message": {
    "text": "I found 5 meetings. Which one did you mean? ...",
    "requiresFollowUp": true,
    "clarificationContext": { /* ... data about the ambiguous items ... */ }
  },
  "conversationId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```
Frontend should be prepared to handle `message` as either a string or an object for forward compatibility, though currently it is expected to be a string or a simple JSON representation of the tool's direct output.

### 2. Planner Could Not Determine Action ("unknown")

If the AI planner understands the request but cannot map it to a specific calendar action (e.g., the query is too vague or not calendar-related), the response will indicate this. The HTTP status code will be `200 OK`. The response will include the `conversationId`.

**Example ("unknown" action):**

```json
{
  "message": "The planner could not determine a specific calendar action from your request. Please try rephrasing.",
  "details": "Optional reasoning from the planner.",
  "conversationId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

### 3. Error Responses

Various errors can occur. Error responses will include an `error` field, a `conversationId`, and potentially a `details` field for more specific information (like validation errors).

#### a. Authentication/Authorization Errors

-   **Status Code:** `401 Unauthorized`
    -   If `Authorization` header is missing.
    -   If the token is malformed or invalid.
    **Example:**
    ```json
    {
      "error": "Authorization header is missing",
      "conversationId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" // or null if conversation couldn't be established
    }
    ```
    ```json
    {
      "error": "Unauthorized: Invalid token. User ID (sub) not found in token claims",
      "conversationId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    }
    ```

-   **Status Code:** `403 Forbidden`
    -   If the user is authenticated but the Google OAuth token cannot be found (e.g., Google account not connected, or calendar permissions not granted).
    **Example:**
    ```json
    {
      "error": "Google OAuth token not found. Please ensure your Google account is connected and calendar permissions are granted.",
      "conversationId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    }
    ```

#### b. Bad Request Errors

-   **Status Code:** `400 Bad Request`
    -   Invalid JSON in request body.
    -   Missing `text` field or `userTimezone` in the request body.
    -   Planner could not generate a plan from the input.
    -   Parameter validation failed for the specific calendar action.
    **Example (Invalid JSON):**
    ```json
    {
      "error": "Invalid JSON in request body.",
      "conversationId": null // conversationId might be null if body parsing failed early
    }
    ```
    **Example (Missing text field):**
    ```json
    {
      "error": "Request body must contain a 'text' field as a string.",
      "conversationId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    }
    ```
    **Example (Parameter Validation Error for Tool):**
    ```json
    {
      "error": "Parameter validation failed for the calendar action.",
      "details": { /* Zod error formatting */ },
      "conversationId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    }
    ```

#### c. Server-Side Errors

-   **Status Code:** `500 Internal Server Error`
    -   Failed to fetch Google OAuth token (unexpected error).
    -   Planner failed with an unexpected error.
    -   Error performing the actual calendar action with the tool.
    -   Internal database errors related to conversation logging (user should not be blocked but error indicates backend issue).
    **Example:**
    ```json
    {
      "error": "Planner failed: Unknown planner error",
      "conversationId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    }
    ```

## Summary of Response Handling

The frontend should primarily check the HTTP status code:
-   `200 OK`: The request was processed. 
    -   Store/update the `conversationId` from the response.
    -   Check the `message` field. If it indicates a specific calendar action was performed, display it. (Be mindful of future object structure for `message`.)
    -   If `message` indicates an "unknown" action, guide the user to rephrase.
-   `400 Bad Request`: User input error or validation error. Store/update `conversationId`. Display `error` and `details`.
-   `401 Unauthorized`: Authentication issue. Store/update `conversationId`. Prompt for re-login or check token.
-   `403 Forbidden`: User lacks permissions for Google Calendar. Store/update `conversationId`. Guide user.
-   `500 Internal Server Error`: Server-side problem. Store/update `conversationId`. Display generic error.

Always retrieve and store the `conversationId` from the response to maintain context for the next request in the conversation.

