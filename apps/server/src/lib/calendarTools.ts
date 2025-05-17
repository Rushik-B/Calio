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

  private userId: string;
  private accessToken: string;

  constructor(userId: string, accessToken: string) {
    super();
    this.userId = userId;
    this.accessToken = accessToken;
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
        return "Error: Both start and end times are strictly required for event creation.";
    }
    // The refine in eventDateTimeSchemaForTool checks for date OR dateTime, 
    // but CreateEventTool itself should enforce that *both* start and end objects are present.

    let eventForGoogleApi: calendar_v3.Schema$Event;
    try {
        // Attempt to transform/map the arg to the structure Google's API expects.
        // If createEventParamsSchema is identical to googleCalendarEventCreateObjectSchema,
        // and that is already GAPI compliant, this transform might be very direct.
        eventForGoogleApi = transformToGoogleCalendarEvent(arg);
    } catch (transformError: any) {
        console.error("[CreateEventTool] Error transforming event parameters:", transformError);
        return `Error preparing event data: ${transformError.message}`;
    }

    // Ensure calendarId is not accidentally nested inside eventForGoogleApi if it came from arg top-level
    // (transformToGoogleCalendarEvent should handle this by not touching calendarId if it's not a direct event property)

    try {
      const createdEvent = await apiInsertEvent(
        this.userId,
        this.accessToken,
        calendarId, // Use the top-level calendarId from arg
        eventForGoogleApi
      );
      if (createdEvent && createdEvent.id) {
        return `Event created successfully. ID: ${createdEvent.id}, Summary: ${createdEvent.summary || '(No summary)'}, Link: ${createdEvent.htmlLink || '(No link)'}`;
      }
      return "Failed to create event: No event data returned from API or ID missing.";
    } catch (error) {
      // ... (existing error handling)
      if (error instanceof z.ZodError) {
        return `Validation Error during CreateEventTool execution: ${error.message}`;
      }
      console.error("Error in CreateEventTool API call:", error);
      const gaxiosError = error as any;
      let errorMessage = gaxiosError.message;
      if (gaxiosError.response && gaxiosError.response.data && gaxiosError.response.data.error) {
        const googleError = gaxiosError.response.data.error;
        errorMessage = `${googleError.message} (Code: ${googleError.code}${googleError.errors ? ', Details: ' + JSON.stringify(googleError.errors) : ''})`;
      }
      return `Error creating event: ${errorMessage}`;
    }
  }
}

export class ListEventsTool extends StructuredTool {
  name = "list_events_tool";
  description = "Lists calendar events. Can filter by query, timeMin, timeMax, and calendarId. Also handles timeZone.";
  schema = listEventsParamsSchema;
  private userId: string;
  private accessToken: string;

  constructor(userId: string, accessToken: string) {
    super();
    this.userId = userId;
    this.accessToken = accessToken;
  }

  protected async _call(params: ListEventsParams): Promise<string> {
    const validatedParams = this.schema.parse(params);
    const { calendarId, query, timeMin, timeMax, timeZone, questionAboutEvents } = validatedParams;

    console.log(
      `[ListEventsTool] User ${this.userId} listing events from calendar: ${calendarId}, query: ${query}, timeMin: ${timeMin}, timeMax: ${timeMax}, timeZone: ${timeZone}, question: ${questionAboutEvents}`
    );

    try {
      const events = await apiListEvents(this.userId, this.accessToken, calendarId, {
        q: query,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: "startTime",
        timeZone: timeZone,
      });

      if (!events || events.length === 0) {
        if (questionAboutEvents) {
          return `No events found in calendar '${calendarId}' for the period to answer your question: "${questionAboutEvents}".`;
        }
        return "No events found matching your criteria.";
      }

      if (questionAboutEvents) {
        const eventDetails = events.map(event => ({
          id: event.id,
          summary: event.summary,
          start: event.start?.dateTime || event.start?.date,
          end: event.end?.dateTime || event.end?.date,
          description: event.description,
          location: event.location,
          calendarId: calendarId
        }));
        const eventContextForLLM = events
        .map(
          (event) =>
            `Event: ${event.summary || "N/A"}\nStart: ${
              event.start?.dateTime || event.start?.date || "N/A"
            }\nEnd: ${event.end?.dateTime || event.end?.date || "N/A"}`
        )
        .join("\n---\n");
        return eventContextForLLM;
      }

      const eventListString = events
        .map(
          (event) =>
            `Summary: ${event.summary}, Start: ${
              event.start?.dateTime || event.start?.date
            }`
        )
        .join("; ");
      return `Found ${events.length} event(s): ${eventListString}`;
    } catch (error: any) {
      console.error("[ListEventsTool] Error:", error);
      const errorMessage = error.response?.data?.error?.message || error.message || "Failed to list events due to an unknown error.";
      if (error.errors && Array.isArray(error.errors) && error.errors.length > 0) {
        return `Failed to list events: ${error.errors[0].message}`;
      }
      return `Failed to list events: ${errorMessage}`;
    }
  }
}

export class DeleteEventTool extends StructuredTool {
  name = "delete_event_tool";
  description =
    "Tool to delete a calendar event. Input should be an object with eventId. If eventId is not known, provide summary to attempt deletion by summary (less reliable). Can optionally specify calendarId.";
  schema = deleteEventParamsSchema;

  private userId: string;
  private accessToken: string;

  constructor(userId: string, accessToken: string) {
    super();
    this.userId = userId;
    this.accessToken = accessToken;
  }

  protected async _call(
    arg: z.infer<typeof deleteEventParamsSchema>
  ): Promise<string> {
    try {
      if (!arg.eventId && arg.summary) {
        // If only summary is provided, we might need to list events first to find the ID.
        // This is a simplified approach; a real app might need a more robust way to handle this.
        console.warn("Attempting to delete event by summary. This is less reliable and not fully implemented here. Prefer using eventId.");
        // For now, let's say we can't delete by summary directly with the current apiDeleteEvent
        // We'd need to list events, find the matching one, then get its ID.
        // This would be a more complex operation.
        // return "Deletion by summary requires finding the event ID first. This feature is not fully implemented in the tool. Please provide an event ID.";

        // For demonstration, let's assume the LLM *might* provide an eventId it found somehow.
        // Or, the user *must* provide eventId for this tool. The description asks for eventId.
        // The schema allows summary as a fallback for the LLM, but the tool itself needs an ID.
        // The `deleteEvent` in googleCalendar.ts *requires* an eventId.
        // If the planner sends a summary, it's up to the controller to resolve it to an ID.
        // The tool itself should operate with an ID.

        // Let's refine the logic: if no eventId, we can't proceed directly.
        // The controller should handle this pre-tool call.
        // For now, if planner gives summary but no ID, this tool as-is will fail if it tries to call apiDeleteEvent.

        // Let's assume for this tool, `eventId` is crucial.
        // If it's not present, it indicates a mismatch or a need for a prior step (like list and pick).
        return "Cannot delete event: `eventId` is required. If you only have a summary, try listing events to find the ID.";
      }

      if (arg.eventId) {
        const success = await apiDeleteEvent(this.userId, this.accessToken, arg.calendarId, arg.eventId);
        return success
          ? `Event with ID \'${arg.eventId}\' deleted successfully from calendar \'${arg.calendarId}\'.`
          : `Failed to delete event with ID \'${arg.eventId}\' from calendar \'${arg.calendarId}\'. It might not exist or an error occurred.`;
      }
      // This case should be caught by the refine in Zod schema, but as a fallback:
      return "Cannot delete event: `eventId` must be provided.";

    } catch (error) {
      if (error instanceof z.ZodError) {
        return `Validation Error for DeleteEventTool: ${error.message}`;
      }
      console.error("Error in DeleteEventTool:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return `Error occurred while deleting event: ${errorMessage}`;
    }
  }
}

export class UpdateEventTool extends StructuredTool {
  name = "update_event_tool";
  description =
    "Tool to update an existing calendar event. Input must include eventId and fields to update (summary, startTime (ISO 8601 UTC), endTime (ISO 8601 UTC), attendees (array of emails)). Can optionally specify calendarId.";
  schema = updateEventParamsSchema;

  private userId: string;
  private accessToken: string;

  constructor(userId: string, accessToken: string) {
    super();
    this.userId = userId;
    this.accessToken = accessToken;
  }

  protected async _call(
    arg: z.infer<typeof updateEventParamsSchema>
  ): Promise<string> {
    try {
      const eventPatch = transformToGoogleCalendarEvent(arg);
      // Ensure eventId is present, which is guaranteed by the schema
      const result = await apiPatchEvent(
        this.userId,
        this.accessToken,
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
