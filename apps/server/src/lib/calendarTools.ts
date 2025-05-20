import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  insertEvent as apiInsertEvent,
  listEvents as apiListEvents,
  patchEvent as apiPatchEvent,
  deleteEvent as apiDeleteEvent,
} from "./googleCalendar"; // Assuming googleCalendar.ts is in the same directory
import type { calendar_v3 } from "googleapis";

// Updated schema for event date/time, aligning with Google Calendar API structure
const eventDateTimeSchemaForTool = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format.").optional(),
  dateTime: z.string().datetime({ offset: true, message: "Invalid ISO 8601 dateTime string. Must include offset." }).optional(),
  timeZone: z.string().optional()
}).refine(data => data.date || data.dateTime, {
  message: "Either 'date' or 'dateTime' must be provided for start/end.",
});

// Updated schema for attendees, aligning with Google Calendar API structure
const attendeeSchemaForTool = z.object({
  email: z.string().email("Invalid email format for attendee."),
  displayName: z.string().optional(),
  organizer: z.boolean().optional(),
  self: z.boolean().optional(),
  resource: z.boolean().optional(),
  optional: z.boolean().optional(),
  responseStatus: z.enum(["needsAction", "declined", "tentative", "accepted"]).optional(),
  comment: z.string().optional(),
});

// Updated schema for CreateEventTool parameters to match Event Creator LLM output
export const createEventParamsSchema = z.object({
  summary: z.string().optional().describe("Summary or title of the event."),
  description: z.string().optional().describe("Detailed description of the event."),
  location: z.string().optional().describe("Location of the event."),
  start: eventDateTimeSchemaForTool.describe("Start time of the event. Must include date or dateTime."),
  end: eventDateTimeSchemaForTool.describe("End time of the event. Must include date or dateTime."),
  attendees: z.array(attendeeSchemaForTool).optional().describe("Array of attendee objects."),
  calendarId: z.string().optional().default('primary').describe("ID of the calendar to use. Defaults to 'primary'."),
  // Include other fields that Event Creator LLM might provide and CreateEventTool should pass to Google API
  recurrence: z.array(z.string()).optional().describe("Recurrence rules (RRULE, EXRULE, etc.)."),
  reminders: z.object({ // Simplified for now, matching googleCalendarEventCreateObjectSchema structure
    useDefault: z.boolean().optional(),
    overrides: z.array(z.object({
        method: z.enum(["email", "popup"]),
        minutes: z.number().int().positive(),
    })).optional(),
  }).optional(),
  colorId: z.string().optional(),
  transparency: z.enum(["opaque", "transparent"]).optional(),
  visibility: z.enum(["default", "public", "private", "confidential"]).optional(),
  source: z.object({ url: z.string().url().optional(), title: z.string().optional() }).optional(),
  conferenceData: z.object({ createRequest: z.object({ requestId: z.string(), conferenceSolutionKey: z.object({ type: z.string().optional() }).optional(), status: z.object({ statusCode: z.string().optional() }).optional() }).optional() }).optional(),
  guestsCanInviteOthers: z.boolean().optional(),
  guestsCanModify: z.boolean().optional(),
  guestsCanSeeOtherGuests: z.boolean().optional(),
  status: z.enum(["confirmed", "tentative", "cancelled"]).optional(),
});

// Define the actual parameters for the list events action
export const listEventsParamsSchema = z.object({
  calendarId: z.string().default("primary"),
  query: z.string().optional(),
  timeMin: z.string().datetime({ offset: true, message: "Invalid datetime string for timeMin. Must be an ISO 8601 string, optionally with offset." }).optional(),
  timeMax: z.string().datetime({ offset: true, message: "Invalid datetime string for timeMax. Must be an ISO 8601 string, optionally with offset." }).optional(),
  questionAboutEvents: z.string().optional(),
  timeZone: z.string().optional(),
});

export type ListEventsParams = z.infer<typeof listEventsParamsSchema>;

// Schema for DeleteEventTool parameters
export const deleteEventParamsSchema = z
  .object({
    eventId: z.string().optional(),
    summary: z.string().optional(), // LLM might use summary if eventId is unknown
    calendarId: z.string().optional().default('primary'), // ID of the calendar to use
  })
  .refine(
    (data) => data.eventId || data.summary,
    "Either eventId or summary must be provided to delete an event."
  );

// Schema for UpdateEventTool parameters
export const updateEventParamsSchema = z.object({
  eventId: z.string().describe("ID of the event to update. This is required."),
  summary: z.string().optional().describe("New summary or title for the event."),
  description: z.string().optional().describe("New detailed description for the event."),
  location: z.string().optional().describe("New location for the event."),
  start: z.string().optional().describe("New start time in ISO 8601 format."),   // Changed from startTime
  end: z.string().optional().describe("New end time in ISO 8601 format."),       // Changed from endTime
  attendees: z.array(z.string()).optional().describe("New list of attendee email addresses. This will replace existing attendees."),
  calendarId: z.string().optional().default('primary').describe("ID of the calendar where the event resides. Defaults to 'primary'."),
});

// Helper to transform Zod params to Google API params
// THIS HELPER NEEDS SIGNIFICANT REVISION or might be deprecated if LLM output is direct enough.
// For now, focusing on the schema change. The _call method of CreateEventTool will need to adapt.
function transformToGoogleCalendarEvent(
  params: z.infer<typeof createEventParamsSchema> | z.infer<typeof updateEventParamsSchema>
): calendar_v3.Schema$Event {
  const event: calendar_v3.Schema$Event = {};

  if ('start' in params && typeof params.start === 'object') { 
    const createParams = params as z.infer<typeof createEventParamsSchema>; 
    if (createParams.summary) event.summary = createParams.summary;
    if (createParams.description) event.description = createParams.description;
    if (createParams.location) event.location = createParams.location;
    
    event.start = createParams.start as calendar_v3.Schema$EventDateTime;
    event.end = createParams.end as calendar_v3.Schema$EventDateTime;

    if (createParams.attendees) {
      event.attendees = createParams.attendees.map(att => ({ 
        email: att.email, 
        displayName: att.displayName,
        organizer: att.organizer,
        self: att.self,
        resource: att.resource,
        optional: att.optional,
        responseStatus: att.responseStatus,
        comment: att.comment,
      }));
    }

    if (createParams.recurrence) event.recurrence = createParams.recurrence;
    if (createParams.reminders) {
        event.reminders = createParams.reminders as { 
            useDefault?: boolean; 
            overrides?: calendar_v3.Schema$EventReminder[]; 
        };
    }
    if (createParams.colorId) event.colorId = createParams.colorId;
    if (createParams.transparency) event.transparency = createParams.transparency;
    if (createParams.visibility) event.visibility = createParams.visibility;
    if (createParams.source) {
        event.source = createParams.source as { 
            title?: string; 
            url?: string; 
        };
    }
    if (createParams.conferenceData) event.conferenceData = createParams.conferenceData as calendar_v3.Schema$ConferenceData;
    if (createParams.guestsCanInviteOthers !== undefined) event.guestsCanInviteOthers = createParams.guestsCanInviteOthers;
    if (createParams.guestsCanModify !== undefined) event.guestsCanModify = createParams.guestsCanModify;
    if (createParams.guestsCanSeeOtherGuests !== undefined) event.guestsCanSeeOtherGuests = createParams.guestsCanSeeOtherGuests;
    if (createParams.status) event.status = createParams.status;
    
    if (event.start && !event.end && event.start.dateTime) {
        console.warn("[transformToGoogleCalendarEvent] End time missing for timed event. Google API might default or error. LLM should provide this.");
    }

  } else if ('eventId' in params && typeof params.start === 'object') { 
    const updateParams = params as any; // Fallback for now
    if (updateParams.summary) event.summary = updateParams.summary;
    if (updateParams.description) event.description = updateParams.description;
    if (updateParams.location) event.location = updateParams.location;
    if (updateParams.start) event.start = updateParams.start; // Assume it's already correct object or needs transformation
    if (updateParams.end) event.end = updateParams.end;     // Same assumption
    if (updateParams.attendees) event.attendees = updateParams.attendees.map((email: string) => ({ email })); // Old structure

  } else {
      // Fallback to old logic if params don't match new createEvent structure (e.g. for updateEvent if its schema hasn't changed)
      // This part of the function might become mostly for updateEvent or get deprecated for createEvent.
      const Pstart = (params as any).start; 
      let Pend = (params as any).end;     

      if (!Pend && Pstart && typeof Pstart === 'string' && Pstart.includes('T') && 'summary' in params && !('eventId' in params)) { 
        const startDate = new Date(Pstart);
        if (!isNaN(startDate.getTime())) {
          startDate.setHours(startDate.getHours() + 1);
          Pend = startDate.toISOString();
        }
      }
      if (Pstart && typeof Pstart === 'string') {
        if (Pstart.includes('T')) { event.start = { dateTime: Pstart }; }
        else { event.start = { date: Pstart }; }
      }
      if (Pend && typeof Pend === 'string') {
        if (Pend.includes('T')) { event.end = { dateTime: Pend }; }
        else { event.end = { date: Pend }; }
      }
      if ((params as any).attendees) {
        event.attendees = (params as any).attendees.map((email: string) => ({ email }));
      }
      // other simple fields from old structure
      if((params as any).summary) event.summary = (params as any).summary;
      if((params as any).description) event.description = (params as any).description;
      if((params as any).location) event.location = (params as any).location;
  }

  return event;
}

export class CreateEventTool extends StructuredTool {
  name = "create_event_tool";
  description = "Tool to create a new calendar event. Input should be a detailed event object.";
  schema = createEventParamsSchema; // Uses the new, more detailed schema

  private clerkUserId: string;
  private googleAccessToken: string;

  constructor(clerkUserId: string, googleAccessToken: string) {
    super();
    this.clerkUserId = clerkUserId;
    this.googleAccessToken = googleAccessToken;
  }

  protected async _call(
    arg: z.infer<typeof createEventParamsSchema> // arg is now the detailed event object
  ): Promise<string> {
    // The `arg` should now be a single, detailed event object matching the new `createEventParamsSchema`.
    // The `transformToGoogleCalendarEvent` helper will attempt to convert this to Google API format.
    // Or, if `arg` is already very close to Google API format, transformation might be minimal.

    const { calendarId = "primary" } = arg; // calendarId still at top level of arg

    // Critical: Ensure `start` and `end` are present as per schema refinement, or handle error.
    if (!arg.start || !arg.end) {
        // This should ideally be caught by Zod schema validation if start/end are not optional there.
        // However, createEventParamsSchema makes start/end objects required, but their internal date/dateTime are optional.
        // The refine on eventDateTimeSchemaForTool ensures date or dateTime.
        // The top-level createEventParamsSchema itself doesn't currently enforce that 'start' and 'end' have valid populated content beyond being objects.
        // This check is a safeguard.
        return JSON.stringify({ 
          message: "Error: Both start and end time objects, each containing a valid 'date' or 'dateTime', are strictly required for event creation.",
          details: null 
        });
    }

    let eventForGoogleApi: calendar_v3.Schema$Event;
    try {
        eventForGoogleApi = transformToGoogleCalendarEvent(arg);
    } catch (transformError: any) {
        console.error("[CreateEventTool] Error transforming event parameters:", transformError);
        return JSON.stringify({
          message: `Error preparing event data: ${transformError.message}`,
          details: null
        });
    }

    try {
      const createdEvent = await apiInsertEvent(
        this.clerkUserId,
        this.googleAccessToken,
        calendarId, // Use the top-level calendarId from arg
        eventForGoogleApi
      );
      if (createdEvent && createdEvent.id) {
        // Construct a more user-friendly message
        let message = `Event created successfully: '${createdEvent.summary || "(No summary)"}'.`;
        if (createdEvent.start?.dateTime) {
          message += ` It starts on ${new Date(createdEvent.start.dateTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
        } else if (createdEvent.start?.date) {
          message += ` It's an all-day event on ${new Date(createdEvent.start.date + 'T00:00:00').toLocaleDateString(undefined, { dateStyle: 'medium' })}`; // Adjust for proper date display
        }
        if (createdEvent.end?.dateTime) {
          message += ` and ends on ${new Date(createdEvent.end.dateTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.`;
        } else if (createdEvent.end?.date && createdEvent.start?.date !== createdEvent.end.date) { // Only show end date if different for all-day
            const endDate = new Date(createdEvent.end.date + 'T00:00:00');
            // Google API's end date for all-day events is exclusive, so subtract a day for display if it makes sense
            // Or simply state it ends *before* this date.
            // For simplicity, let's just state the date if different and significant.
            // A common pattern is for the all-day end date to be the day *after* the event visually ends.
            // We'll just show the date for now.
            message += ` It concludes before ${new Date(endDate).toLocaleDateString(undefined, { dateStyle: 'medium' })}.`;
        }
        if (createdEvent.htmlLink) {
          message += ` You can view it here: ${createdEvent.htmlLink}`;
        }

        return JSON.stringify({
          message: message.trim(),
          details: {
            id: createdEvent.id,
            summary: createdEvent.summary,
            htmlLink: createdEvent.htmlLink,
            start: createdEvent.start, // Will include dateTime, date, timeZone
            end: createdEvent.end,     // Will include dateTime, date, timeZone
            calendarId: calendarId // Add calendarId used for creation
          }
        });
      }
      return JSON.stringify({
        message: "Failed to create event: No event data returned from API or ID missing.",
        details: null
      });
    } catch (error) {
      // ... (existing error handling)
      if (error instanceof z.ZodError) {
        return JSON.stringify({
          message: `Validation Error during CreateEventTool execution: ${error.message}`,
          details: null
        });
      }
      console.error("Error in CreateEventTool API call:", error);
      const gaxiosError = error as any;
      let errorMessage = gaxiosError.message;
      if (gaxiosError.response && gaxiosError.response.data && gaxiosError.response.data.error) {
        const googleError = gaxiosError.response.data.error;
        errorMessage = `${googleError.message} (Code: ${googleError.code}${googleError.errors ? ', Details: ' + JSON.stringify(googleError.errors) : ''})`;
      }
      return JSON.stringify({
        message: `Error creating event: ${errorMessage}`,
        details: null
      });
    }
  }
}

export class ListEventsTool extends StructuredTool {
  name = "list_events_tool";
  description = "Lists calendar events. Can filter by query, timeMin, timeMax, and calendarId. Also handles timeZone. If a 'questionAboutEvents' is provided, raw event data will be fetched for further analysis.";
  schema = listEventsParamsSchema;
  private clerkUserId: string;
  private googleAccessToken: string;

  constructor(clerkUserId: string, googleAccessToken: string) {
    super();
    this.clerkUserId = clerkUserId;
    this.googleAccessToken = googleAccessToken;
  }

  protected async _call(params: ListEventsParams): Promise<calendar_v3.Schema$Event[] | string> {
    const validatedParams = this.schema.parse(params);
    const { calendarId, query, timeMin, timeMax, timeZone, questionAboutEvents } = validatedParams;

    console.log(
      `[ListEventsTool] User ${this.clerkUserId} listing events from calendar: ${calendarId}, query: ${query}, timeMin: ${timeMin}, timeMax: ${timeMax}, timeZone: ${timeZone}, question: ${questionAboutEvents}`
    );

    try {
      const events = await apiListEvents(this.clerkUserId, this.googleAccessToken, calendarId, {
        q: query,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: "startTime",
        timeZone: timeZone,
      });

      if (!events || events.length === 0) {
        if (questionAboutEvents) {
          // If a question was asked, but no events found, return an empty array for the analyzer.
          return []; 
        }
        return "No events found matching your criteria.";
      }

      if (questionAboutEvents) {
        // If there's a question, return the raw events for analysis by chatController
        return events; 
      }

      // If no question, format a simple string summary
      const eventListString = events
        .map(
          (event) =>
            `Summary: ${event.summary || "(No summary)"}, Start: ${
              event.start?.dateTime || event.start?.date || "N/A"
            }`
        )
        .join("; ");
      return `Found ${events.length} event(s): ${eventListString}`;

    } catch (error: any) {
      console.error("[ListEventsTool] Error:", error);
      const errorMessage = error.response?.data?.error?.message || error.message || "Failed to list events due to an unknown error.";
      // Consider if this should throw or return a more structured error
      return `Failed to list events: ${errorMessage}`;
    }
  }
}

export class UpdateEventTool extends StructuredTool {
  name = "update_event_tool";
  description =
    "Tool to update an existing calendar event. Input must include eventId and fields to update (summary, startTime (ISO 8601 UTC), endTime (ISO 8601 UTC), attendees (array of emails)). Can optionally specify calendarId.";
  schema = updateEventParamsSchema;

  private clerkUserId: string;
  private googleAccessToken: string;

  constructor(clerkUserId: string, googleAccessToken: string) {
    super();
    this.clerkUserId = clerkUserId;
    this.googleAccessToken = googleAccessToken;
  }

  protected async _call(
    arg: z.infer<typeof updateEventParamsSchema>
  ): Promise<string> {
    try {
      const eventPatch = transformToGoogleCalendarEvent(arg);
      // Ensure eventId is present, which is guaranteed by the schema
      const result = await apiPatchEvent(
        this.clerkUserId,
        this.googleAccessToken,
        arg.calendarId,
        arg.eventId,
        eventPatch
      );
      if (result && result.id) {
        return `Event with ID \'${result.id}\' updated successfully on calendar \'${arg.calendarId}\'. Summary: ${result.summary}, Link: ${result.htmlLink}`;
      }
      return `Failed to update event with ID \'${arg.eventId}\' on calendar \'${arg.calendarId}\'. It might not exist or an error occurred.`;
    } catch (error) {
      if (error instanceof z.ZodError) {
        return `Validation Error for UpdateEventTool: ${error.message}`;
      }
      console.error("Error in UpdateEventTool:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return `Error occurred while updating event: ${errorMessage}`;
    }
  }
}

// Example of how these tools might be instantiated (testing this would require actual userId/accessToken)
// async function testTools() {
//   const MOCK_USER_ID = "test-user-id";
//   const MOCK_ACCESS_TOKEN = "test-access-token"; // THIS IS FAKE

//   // Create Tool
//   const createTool = new CreateEventTool(MOCK_USER_ID, MOCK_ACCESS_TOKEN);
//   const createResult = await createTool.call({
//     summary: "Test Event from Tool",
//     startTime: new Date(Date.now() + 3600 * 1000).toISOString(), // 1 hour from now
//     endTime: new Date(Date.now() + 7200 * 1000).toISOString(),   // 2 hours from now
//     attendees: ["test@example.com"],
//     calendarId: "primary", // Example
//   });
//   console.log("CreateEventTool test result:", createResult);

//   // List Tool
//   const listTool = new ListEventsTool(MOCK_USER_ID, MOCK_ACCESS_TOKEN);
//   const listResult = await listTool.call({ timeMin: new Date().toISOString(), calendarId: "primary" }); // Example
//   console.log("ListEventsTool test result:", listResult);

//   // Assume we got an eventId from listing or creation to test update/delete
//   // const eventIdToModify = "some-valid-event-id-from-google";

//   // if (eventIdToModify) {
//   //   // Update Tool
//   //   const updateTool = new UpdateEventTool(MOCK_USER_ID, MOCK_ACCESS_TOKEN);
//   //   const updateResult = await updateTool.call({
//   //     eventId: eventIdToModify,
//   //     summary: "Updated Test Event Title",
//   //     calendarId: "primary", // Example
//   //   });
//   //   console.log("UpdateEventTool test result:", updateResult);

//   //   // Delete Tool
//   //   const deleteTool = new DeleteEventTool(MOCK_USER_ID, MOCK_ACCESS_TOKEN);
//   //   const deleteResult = await deleteTool.call({ eventId: eventIdToModify, calendarId: "primary" }); // Example
//   //   console.log("DeleteEventTool test result:", deleteResult);
//   // } else {
//   //   console.log("Skipping update/delete tests as no eventIdToModify was provided.");
//   // }
// }

// testTools(); // This would make actual API calls if uncommented and valid credentials used.
