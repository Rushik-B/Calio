# API Documentation: /api/chat

This document provides instructions for frontend developers on how to interact with the `/api/chat` endpoint to perform Google Calendar operations based on natural language text input.

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
  "calendarId": "primary",
  "selectedCalendarIds": ["user@example.com", "calendar_id_2"]
}
```

-   `text` (string, required): The user's input string.
-   `calendarId` (string, optional): The specific Google Calendar ID to perform the action on.
    - For `create_event`: This will be the calendar where the event is created. If not provided, the system may infer one based on the text or default to the user's primary calendar.
    - For `list_events`, `update_event`, `delete_event`: This specifies the calendar for the operation. If not provided, it typically defaults to the primary calendar, or the system may search across accessible calendars if identifying events by summary.
-   `selectedCalendarIds` (array of strings, optional): An array of Google Calendar IDs that the user has selected or has active in the frontend.
    - This is primarily used for `list_events` actions where neither the user's text nor the `calendarId` parameter specifies a single calendar. In such cases, if `selectedCalendarIds` is provided, the system will attempt to fetch and aggregate events from all calendars in this list.
    - If omitted or empty, and no specific `calendarId` is determined for `list_events`, it will typically default to the primary calendar.

## Responses

The API will attempt to process the text, plan a calendar action, and execute it.

### 1. Successful Calendar Action

If the calendar action is successfully planned and executed, the response will be a JSON object with a `message` field detailing the outcome. The HTTP status code will be `200 OK`.

**Example Success (Event Created):**

```json
{
  "message": "Event created successfully. ID: <event_id>, Summary: <event_summary>, Link: <html_link>"
}
```

**Example Success (Events Listed):**

```json
{
  "message": "Found 2 event(s): ID: <id1>, Summary: <summary1>, Start: <dateTime1>; ID: <id2>, Summary: <summary2>, Start: <dateTime2>"
}
```

**Example Success (No Events Found):**

```json
{
  "message": "No events found matching your criteria."
}
```

**Example Success (Event Deleted):**

```json
{
  "message": "Event with ID '<event_id>' deleted successfully."
}
```

**Example Success (Event Updated):**

```json
{
  "message": "Event with ID '<event_id>' updated successfully. Summary: <event_summary>, Link: <html_link>"
}
```

### 2. Planner Could Not Determine Action ("unknown")

If the AI planner understands the request but cannot map it to a specific calendar action (e.g., the query is too vague or not calendar-related), the response will indicate this. The HTTP status code will be `200 OK` (as the system processed the request as expected) but the message will guide the user.

**Example ("unknown" action):**

```json
{
  "message": "The planner could not determine a specific calendar action from your request. Please try rephrasing.",
  "details": "Optional reasoning from the planner."
}
```

### 3. Error Responses

Various errors can occur. Error responses will include an `error` field and potentially a `details` field for more specific information (like validation errors).

#### a. Authentication/Authorization Errors

-   **Status Code:** `401 Unauthorized`
    -   If `Authorization` header is missing.
    -   If the token is malformed or invalid.
    **Example:**
    ```json
    {
      "error": "Authorization header is missing"
    }
    ```
    ```json
    {
      "error": "Unauthorized: Invalid token. User ID (sub) not found in token claims"
    }
    ```

-   **Status Code:** `403 Forbidden`
    -   If the user is authenticated but the Google OAuth token cannot be found (e.g., Google account not connected, or calendar permissions not granted).
    **Example:**
    ```json
    {
      "error": "Google OAuth token not found. Please ensure your Google account is connected and calendar permissions are granted."
    }
    ```

#### b. Bad Request Errors

-   **Status Code:** `400 Bad Request`
    -   Invalid JSON in request body.
    -   Missing `text` field in the request body.
    -   Planner could not generate a plan from the input (different from "unknown" action, more like a planner failure).
    -   Parameter validation failed for the specific calendar action (e.g., invalid date format for `startTime`).
    -   Unknown action type returned by the planner (should be rare).
    **Example (Invalid JSON):**
    ```json
    {
      "error": "Invalid JSON in request body."
    }
    ```
    **Example (Missing text field):**
    ```json
    {
      "error": "Request body must contain a 'text' field as a string."
    }
    ```
    **Example (Planner failed to generate plan):**
    ```json
    {
      "error": "Could not generate a plan from the input."
    }
    ```
    **Example (Parameter Validation Error for Tool):**
    ```json
    {
      "error": "Parameter validation failed for the calendar action.",
      "details": { /* Zod error formatting */ }
    }
    ```

#### c. Server-Side Errors

-   **Status Code:** `500 Internal Server Error`
    -   Failed to fetch Google OAuth token (unexpected error).
    -   Planner failed with an unexpected error.
    -   Error performing the actual calendar action with the tool (e.g., Google API error).
    -   Google OAuth token could not be retrieved (safeguard).
    **Example:**
    ```json
    {
      "error": "Failed to fetch Google OAuth token: Unknown error fetching Google OAuth token."
    }
    ```
    ```json
    {
      "error": "Planner failed: Unknown planner error"
    }
    ```
    ```json
    {
      "error": "Error performing calendar action: <Specific error message from the tool/Google API>"
    }
    ```

## Summary of Response Handling

The frontend should primarily check the HTTP status code:
-   `200 OK`: The request was processed.
    -   Check the `message` field. If it indicates a specific calendar action was performed, display it.
    -   If `message` indicates an "unknown" action (and `details` might be present), guide the user to rephrase.
-   `400 Bad Request`: User input error or validation error. Display the `error` and potentially `details`.
-   `401 Unauthorized`: Authentication issue. Potentially prompt for re-login or check token.
-   `403 Forbidden`: User authenticated, but lacks permissions for Google Calendar access. Guide user to connect Google account or grant permissions.
-   `500 Internal Server Error`: A server-side problem occurred. Display a generic error message.

Consider logging the `error` and `details` fields for debugging purposes on the frontend when errors occur. 

