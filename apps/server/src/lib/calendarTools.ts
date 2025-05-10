import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  insertEvent as apiInsertEvent,
  listEvents as apiListEvents,
  patchEvent as apiPatchEvent,
  deleteEvent as apiDeleteEvent,
} from "./googleCalendar"; // Assuming googleCalendar.ts is in the same directory
import type { calendar_v3 } from "googleapis";

// Define the actual parameters for the create event action
export const createEventParamsSchema = z.object({
  summary: z.string().optional(),
  startTime: z.string().optional(), // Should be ISO 8601 string
  endTime: z.string().optional(), // Should be ISO 8601 string
  attendees: z.array(z.string()).optional(), // Array of email addresses
});

// Define the actual parameters for the list events action
export const listEventsParamsSchema = z.object({
  query: z.string().optional(),
  timeMin: z.string().optional(), // ISO 8601 string
  timeMax: z.string().optional(), // ISO 8601 string
});

// Schema for DeleteEventTool parameters
export const deleteEventParamsSchema = z
  .object({
    eventId: z.string().optional(),
    summary: z.string().optional(), // LLM might use summary if eventId is unknown
  })
  .refine(
    (data) => data.eventId || data.summary,
    "Either eventId or summary must be provided to delete an event."
  );

// Schema for UpdateEventTool parameters
export const updateEventParamsSchema = z.object({
  eventId: z.string(), // eventId is required to know which event to update
  summary: z.string().optional(),
  startTime: z.string().optional(), // Should be ISO 8601 string
  endTime: z.string().optional(), // Should be ISO 8601 string
  attendees: z.array(z.string()).optional(), // Array of email addresses
});

// Helper to transform Zod params to Google API params
function transformToGoogleCalendarEvent(
  params: z.infer<typeof createEventParamsSchema> | z.infer<typeof updateEventParamsSchema>
): calendar_v3.Schema$Event {
  const event: calendar_v3.Schema$Event = {};
  if (params.summary) event.summary = params.summary;
  
  const PstartTime = params.startTime;
  let PendTime = params.endTime;

  // Default duration for create_event if endTime is missing and startTime is present
  // This check specifically targets createEventParamsSchema structure implicitly
  // For update, we assume if startTime is being updated, endTime should also be provided if it needs changing.
  if (!PendTime && PstartTime && 'summary' in params && !('eventId' in params)) { // Heuristic to detect create event context
    const startDate = new Date(PstartTime);
    if (!isNaN(startDate.getTime())) {
      startDate.setHours(startDate.getHours() + 1);
      PendTime = startDate.toISOString();
      console.log(`[transformToGoogleCalendarEvent] endTime not provided for new event, defaulting to 1 hour later: ${PendTime}`);
    }
  }

  if (PstartTime) event.start = { dateTime: PstartTime, timeZone: "UTC" }; 
  if (PendTime) event.end = { dateTime: PendTime, timeZone: "UTC" }; 
  
  if (params.attendees) {
    const validAttendees = params.attendees.filter(email => {
      // Basic email validation regex (not exhaustive, but good enough for common cases)
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const isValid = emailRegex.test(email);
      if (!isValid) {
        console.warn(`[transformToGoogleCalendarEvent] Filtering out invalid attendee email: ${email}`);
      }
      return isValid;
    });
    if (validAttendees.length > 0) {
      event.attendees = validAttendees.map((email) => ({ email }));
    }
  }
  return event;
}


export class CreateEventTool extends StructuredTool {
  name = "create_event_tool";
  description =
    "Tool to create a new calendar event. Input should be an object with event details like summary, startTime (ISO 8601 UTC), endTime (ISO 8601 UTC), attendees (array of emails).";
  schema = createEventParamsSchema;

  private userId: string;
  private accessToken: string;

  constructor(userId: string, accessToken: string) {
    super();
    this.userId = userId;
    this.accessToken = accessToken;
  }

  protected async _call(
    arg: z.infer<typeof createEventParamsSchema>
  ): Promise<string> {
    try {
      const googleEvent = transformToGoogleCalendarEvent(arg);
      const result = await apiInsertEvent(
        this.userId,
        this.accessToken,
        googleEvent
      );
      if (result && result.id) {
        return `Event created successfully. ID: ${result.id}, Summary: ${result.summary}, Link: ${result.htmlLink}`;
      }
      return "Failed to create event or no ID returned.";
    } catch (error) {
      if (error instanceof z.ZodError) {
        return `Validation Error for CreateEventTool: ${error.message}`;
      }
      console.error("Error in CreateEventTool:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return `Error occurred while creating event: ${errorMessage}`;
    }
  }
}

export class ListEventsTool extends StructuredTool {
  name = "list_events_tool";
  description =
    "Tool to list calendar events. Input should be an object with query parameters like query, timeMin (ISO 8601 UTC), timeMax (ISO 8601 UTC).";
  schema = listEventsParamsSchema;

  private userId: string;
  private accessToken: string;

  constructor(userId: string, accessToken: string) {
    super();
    this.userId = userId;
    this.accessToken = accessToken;
  }

  protected async _call(
    arg: z.infer<typeof listEventsParamsSchema>
  ): Promise<string> {
    try {
      const options: calendar_v3.Params$Resource$Events$List = {
        q: arg.query,
        timeMin: arg.timeMin,
        timeMax: arg.timeMax,
        singleEvents: true,
        orderBy: "startTime",
      };
      const events = await apiListEvents(this.userId, this.accessToken, options);
      if (events && events.length > 0) {
        return `Found ${events.length} event(s): ${events
          .map((e) => `ID: ${e.id}, Summary: ${e.summary}, Start: ${e.start?.dateTime || e.start?.date}`)
          .join("; ")}`;
      } else if (events) {
        return "No events found matching your criteria.";
      }
      return "Failed to list events.";
    } catch (error) {
      if (error instanceof z.ZodError) {
        return `Validation Error for ListEventsTool: ${error.message}`;
      }
      console.error("Error in ListEventsTool:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return `Error occurred while listing events: ${errorMessage}`;
    }
  }
}

export class DeleteEventTool extends StructuredTool {
  name = "delete_event_tool";
  description =
    "Tool to delete a calendar event. Input should be an object with eventId. If eventId is not known, provide summary to attempt deletion by summary (less reliable).";
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
        const success = await apiDeleteEvent(this.userId, this.accessToken, arg.eventId);
        return success
          ? `Event with ID '${arg.eventId}' deleted successfully.`
          : `Failed to delete event with ID '${arg.eventId}'. It might not exist or an error occurred.`;
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
    "Tool to update an existing calendar event. Input must include eventId and fields to update (summary, startTime (ISO 8601 UTC), endTime (ISO 8601 UTC), attendees (array of emails)).";
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
        arg.eventId,
        eventPatch
      );
      if (result && result.id) {
        return `Event with ID '${result.id}' updated successfully. Summary: ${result.summary}, Link: ${result.htmlLink}`;
      }
      return `Failed to update event with ID '${arg.eventId}'. It might not exist or an error occurred.`;
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
//   });
//   console.log("CreateEventTool test result:", createResult);

//   // List Tool
//   const listTool = new ListEventsTool(MOCK_USER_ID, MOCK_ACCESS_TOKEN);
//   const listResult = await listTool.call({ timeMin: new Date().toISOString() });
//   console.log("ListEventsTool test result:", listResult);

//   // Assume we got an eventId from listing or creation to test update/delete
//   // const eventIdToModify = "some-valid-event-id-from-google";

//   // if (eventIdToModify) {
//   //   // Update Tool
//   //   const updateTool = new UpdateEventTool(MOCK_USER_ID, MOCK_ACCESS_TOKEN);
//   //   const updateResult = await updateTool.call({
//   //     eventId: eventIdToModify,
//   //     summary: "Updated Test Event Title",
//   //   });
//   //   console.log("UpdateEventTool test result:", updateResult);

//   //   // Delete Tool
//   //   const deleteTool = new DeleteEventTool(MOCK_USER_ID, MOCK_ACCESS_TOKEN);
//   //   const deleteResult = await deleteTool.call({ eventId: eventIdToModify });
//   //   console.log("DeleteEventTool test result:", deleteResult);
//   // } else {
//   //   console.log("Skipping update/delete tests as no eventIdToModify was provided.");
//   // }
// }

// testTools(); // This would make actual API calls if uncommented and valid credentials used. 