# API Documentation: /api/calendars/list

This endpoint retrieves the list of Google Calendars accessible to the authenticated user.

## Endpoint

`GET /api/calendars/list`

## Authentication

-   The client MUST include a Clerk session token in the `Authorization` header.
-   Format: `Authorization: Bearer <YOUR_CLERK_SESSION_TOKEN>`

## Request Body

None for GET request.

## Responses

### 1. Successful Calendar List Retrieval

If the calendar list is successfully fetched, the response will be a JSON array of calendar objects. The HTTP status code will be `200 OK`.

Each calendar object in the array typically includes:
- `id` (string): The unique identifier for the calendar.
- `summary` (string): The user-visible name of the calendar.
- `primary` (boolean, optional): Indicates if this is the user's primary calendar.
- `accessRole` (string): The level of access the user has to this calendar (e.g., "owner", "writer", "reader").

**Example Success:**

```json
[
  {
    "id": "user@example.com",
    "summary": "My Main Calendar",
    "primary": true,
    "accessRole": "owner"
  },
  {
    "id": "custom_calendar_id_123",
    "summary": "Work Calendar",
    "primary": false,
    "accessRole": "writer"
  },
  {
    "id": "family_calendar_id_456",
    "summary": "Family Events",
    "accessRole": "reader"
  }
]
```

### 2. Error Responses

Various errors can occur, similar to the `/api/chat` endpoint.

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

-   **Status Code:** `403 Forbidden`
    -   If the user is authenticated but the Google OAuth token cannot be found.
    **Example:**
    ```json
    {
      "error": "Google OAuth token not found. Please ensure your Google account is connected and calendar permissions are granted."
    }
    ```

#### b. Server-Side Errors

-   **Status Code:** `500 Internal Server Error`
    -   Failed to fetch Google OAuth token (unexpected error).
    -   Failed to retrieve calendar list from Google (e.g., Google API error).
    **Example:**
    ```json
    {
      "error": "Failed to retrieve calendar list."
    }
    ```
    ```json
    {
      "error": "Failed to fetch Google OAuth token: <Specific error>"
    }
    ```

