import { z } from "zod";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { promises as fsPromises } from 'fs';
import path from "path";
import type { calendar_v3 } from "googleapis";

// Schema for event date/time (aligns with Google Calendar API)
const eventDateTimeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format.").optional(),
  dateTime: z.string().datetime({ offset: true, message: "Invalid ISO 8601 dateTime string. Must include offset." }).optional(),
  timeZone: z.string().optional().describe("IANA time zone database name, e.g., 'America/New_York' or 'Europe/Berlin'.")
}).refine(data => data.date || data.dateTime, {
  message: "Either 'date' (for all-day events) or 'dateTime' (for timed events) must be provided for start/end.",
});

// Schema for attendees
const attendeeSchema = z.object({
  email: z.string().min(1, "Attendee email/name cannot be empty."), // Allow names, will be processed later
  displayName: z.string().optional(),
  organizer: z.boolean().optional(),
  self: z.boolean().optional(),
  resource: z.boolean().optional(),
  optional: z.boolean().optional(),
  responseStatus: z.enum(["needsAction", "declined", "tentative", "accepted"]).optional(),
  comment: z.string().optional(),
});

// Schema for event reminders
const reminderOverrideSchema = z.object({
  method: z.enum(["email", "popup"]),
  minutes: z.number().int().positive(),
});

const eventRemindersSchema = z.object({
  useDefault: z.boolean().optional(),
  overrides: z.array(reminderOverrideSchema).optional(),
});

// Schema for source (link attachment)
const eventSourceSchema = z.object({
    url: z.string().url().optional(),
    title: z.string().optional()
});

// Main schema for a single event object to be created by the Event Creator LLM
// This schema should be comprehensive for fields typically used in event creation via API.
export const googleCalendarEventCreateObjectSchema = z.object({
  calendarId: z.string().optional().describe("ID of the calendar to use. Defaults to 'primary' if not specified by LLM and not overridden by explicit user choice."),
  summary: z.string().optional().describe("The summary or title of the event."),
  description: z.string().optional().describe("Detailed description of the event, can include HTML."),
  location: z.string().optional().describe("Geographic location of the event as free-form text."),
  
  start: eventDateTimeSchema.describe("The start time of the event. Required."),
  end: eventDateTimeSchema.describe("The end time of the event. Required."),
  
  attendees: z.array(attendeeSchema).optional().describe("A list of attendees for the event."),
  
  // Recurrence rules (simplified here, Google API supports more complex scenarios)
  // The LLM should be prompted to generate these RRULE strings if recurrence is implied.
  recurrence: z.array(z.string()).optional().describe("List of RRULE, EXRULE, RDATE or EXDATE strings. e.g., ['RRULE:FREQ=WEEKLY;COUNT=5']"),
  
  reminders: eventRemindersSchema.optional().describe("Notification reminders for the event."),
  
  colorId: z.string().optional().describe("The color of the event. This is an ID referring to an entry in the 'eventColors' feed."),
  transparency: z.enum(["opaque", "transparent"]).optional().describe("'opaque' (event blocks time) or 'transparent' (event does not block time)."),
  visibility: z.enum(["default", "public", "private", "confidential"]).optional(),
  
  source: eventSourceSchema.optional().describe("Source from which the event was created, e.g., a link to a meeting document."),

  // Conference data (basic structure, can be expanded if LLM is to generate specific conference types)
  // For now, LLM might just indicate a desire for a conference, and API defaults handle it.
  // Or, it can try to populate createRequest for a new conference.
  conferenceData: z.object({
    createRequest: z.object({
      requestId: z.string().describe("A unique ID for the creation request."),
      conferenceSolutionKey: z.object({
        type: z.string().optional().describe("e.g., 'hangoutsMeet'")
      }).optional(),
      status: z.object({
        statusCode: z.string().optional().describe("e.g., 'success' or 'pending'")
      }).optional()
    }).optional()
  }).optional(),

  // Other potentially useful fields
  guestsCanInviteOthers: z.boolean().optional(),
  guestsCanModify: z.boolean().optional(),
  guestsCanSeeOtherGuests: z.boolean().optional(),
  status: z.enum(["confirmed", "tentative", "cancelled"]).optional().describe("Event status. Usually 'confirmed' for new events."),
  // sequence: z.number().int().optional(), // For updates, to track changes
  // attachments: z.array(...).optional(), // More complex, usually handled via Drive API integrations

}).describe("Schema for a single Google Calendar event to be created.");

// Schema for the list of event objects expected from the Event Creator LLM
export const eventCreationRequestListSchema = z.array(googleCalendarEventCreateObjectSchema);

// Path to the new prompt file
const eventCreatorSystemPromptPath = path.join(process.cwd(), 'src', 'prompts', 'eventCreatorPrompt.md');

// Define a type for the anchor event context
interface AnchorEventContext {
  id?: string | null; // Event ID for updates/deletes
  summary?: string | null;
  start?: { date?: string; dateTime?: string; timeZone?: string } | null;
  end?: { date?: string; dateTime?: string; timeZone?: string } | null;
  calendarId?: string | null;
}

// Schema for conflict detection
export const conflictEventSchema = z.object({
  id: z.string(),
  summary: z.string(),
  start: z.string(),
  end: z.string(),
  calendarId: z.string()
});

export const eventConflictResponseSchema = z.object({
  type: z.literal("conflict_detected"),
  message: z.string().describe("User-friendly message explaining the conflict"),
  proposedEvents: z.array(googleCalendarEventCreateObjectSchema),
  conflictingEvents: z.array(conflictEventSchema),
  suggestions: z.array(z.string()).describe("Array of suggested alternatives")
});

export const eventCreationOrConflictSchema = z.union([
  z.object({
    type: z.literal("events_created"),
    events: eventCreationRequestListSchema
  }),
  eventConflictResponseSchema
]);

// Enhanced function that can return either events or conflict detection
export async function generateEventCreationJSONsWithConflictDetection(params: {
  userInput: string;
  userTimezone: string;
  userCalendarsFormatted: string; 
  currentTimeISO?: string; 
  anchorEventsContext?: AnchorEventContext[];
  existingEventsForConflictCheck?: calendar_v3.Schema$Event[]; // New parameter for conflict checking
  timezoneInfo?: { // NEW: Centralized timezone information
    timezone: string;
    offset: string;
    userLocalTime: string;
    currentTimeInUserTZ: string;
    dates: {
      today: string;
      tomorrow: string;
      yesterday: string;
    };
    isoStrings: {
      todayStart: string;
      todayEnd: string;
      tomorrowStart: string;
      tomorrowEnd: string;
      yesterdayStart: string;
      yesterdayEnd: string;
      currentTime: string;
    };
  };
}): Promise<z.infer<typeof eventCreationOrConflictSchema>> {
  
  let systemPromptContent = await fsPromises.readFile(eventCreatorSystemPromptPath, 'utf-8');

  const model = new ChatGoogleGenerativeAI({
    model: "gemini-2.0-flash",
    temperature: 0.1,
  });

  let humanMessageContent = `Here is the context for creating calendar events:
User Input: "${params.userInput}"
User Timezone: "${params.userTimezone}"
User Calendar List: "${params.userCalendarsFormatted}"
Current Time ISO: "${params.currentTimeISO || new Date().toISOString()}"`;

  // Use centralized timezone information if available
  if (params.timezoneInfo) {
    humanMessageContent += `
Timezone Information (PRE-CALCULATED - DO NOT RECALCULATE):
- Current Time in User TZ: ${params.timezoneInfo.currentTimeInUserTZ}
- User Local Time: ${params.timezoneInfo.userLocalTime}
- Timezone Offset: ${params.timezoneInfo.offset}
- Today's Date: ${params.timezoneInfo.dates.today}
- Tomorrow's Date: ${params.timezoneInfo.dates.tomorrow}
- Yesterday's Date: ${params.timezoneInfo.dates.yesterday}
- Today Start: ${params.timezoneInfo.isoStrings.todayStart}
- Today End: ${params.timezoneInfo.isoStrings.todayEnd}
- Tomorrow Start: ${params.timezoneInfo.isoStrings.tomorrowStart}
- Tomorrow End: ${params.timezoneInfo.isoStrings.tomorrowEnd}

IMPORTANT: Use these PRE-CALCULATED values. Do NOT calculate dates or times yourself.`;
  }

  if (params.anchorEventsContext && params.anchorEventsContext.length > 0) {
    humanMessageContent += `\n\nAnchor Events Context (use these as precise references for timing any new events relative to them):\n${JSON.stringify(params.anchorEventsContext, null, 2)}`;
  }

  if (params.existingEventsForConflictCheck && params.existingEventsForConflictCheck.length > 0) {
    const conflictCheckEvents = params.existingEventsForConflictCheck.map(event => ({
      id: event.id,
      summary: event.summary,
      start: event.start?.dateTime || event.start?.date,
      end: event.end?.dateTime || event.end?.date,
      calendarId: (event as any).calendarId || "primary" // Get calendarId from the event object
    }));
    
    humanMessageContent += `\n\nExisting Events for Conflict Checking:\n${JSON.stringify(conflictCheckEvents, null, 2)}
    
IMPORTANT: Before creating any events, check if the proposed new events would conflict (overlap in time) with any of these existing events. If conflicts are detected:
1. Return a conflict response object with type "conflict_detected"
2. List the conflicting events
3. Provide user-friendly suggestions for resolution
4. Include the proposed events that would cause conflicts

If NO conflicts are detected, proceed with normal event creation and return events with type "events_created".`;
  }

  humanMessageContent += `\n\nBased on ALL this context and your instructions (provided in the system message), please generate either:
1. A JSON list of event objects (if no conflicts) with structure: {"type": "events_created", "events": [...]}
2. A conflict detection response (if conflicts found) with structure: {"type": "conflict_detected", "message": "...", "proposedEvents": [...], "conflictingEvents": [...], "suggestions": [...]}`;
  
  const messages = [
    new SystemMessage(systemPromptContent),
    new HumanMessage(humanMessageContent), 
  ];

  console.log(`[EventCreatorLLM] Generating event JSONs with conflict detection for input: "${params.userInput}", userTimezone: ${params.userTimezone}`);
  if (params.anchorEventsContext) {
    console.log('[EventCreatorLLM] Anchor Events Context:', JSON.stringify(params.anchorEventsContext, null, 2));
  }
  if (params.existingEventsForConflictCheck) {
    console.log(`[EventCreatorLLM] Checking conflicts against ${params.existingEventsForConflictCheck.length} existing events`);
  }

  try {
    const result = await model.invoke(messages);
    let llmOutput = result.content;

    if (typeof llmOutput !== 'string') {
      console.error("[EventCreatorLLM] LLM output was not a string:", llmOutput);
      throw new Error("LLM output is not in the expected string format.");
    }
    console.log("[EventCreatorLLM] Raw LLM output string:", llmOutput);

    // Clean the output: remove markdown code block fences if present
    llmOutput = llmOutput.trim();
    if (llmOutput.startsWith("```json")) {
      llmOutput = llmOutput.substring(7);
      if (llmOutput.endsWith("```")) {
        llmOutput = llmOutput.substring(0, llmOutput.length - 3);
      }
    }
    llmOutput = llmOutput.trim();

    const parsedResponse = JSON.parse(llmOutput);
    const validatedResponse = eventCreationOrConflictSchema.parse(parsedResponse);
    
    console.log("[EventCreatorLLM] Successfully validated response:", JSON.stringify(validatedResponse, null, 2));
    return validatedResponse;

  } catch (error: unknown) {
    console.error("[EventCreatorLLM] Error generating or validating event JSONs:", error);
    if (error instanceof z.ZodError) {
      console.error("[EventCreatorLLM] Zod Validation Errors:", JSON.stringify(error.format(), null, 2));
    }
    // Fallback to non-conflict version
    return {
      type: "events_created",
      events: []
    };
  }
}

// Simple function that just returns event arrays (no conflict detection)
export async function generateEventCreationJSONs(params: {
  userInput: string;
  userTimezone: string;
  userCalendarsFormatted: string; 
  currentTimeISO?: string; 
  anchorEventsContext?: AnchorEventContext[];
  existingEventsForConflictCheck?: calendar_v3.Schema$Event[]; // New parameter for conditional logic evaluation
  timezoneInfo?: { // NEW: Centralized timezone information
    timezone: string;
    offset: string;
    userLocalTime: string;
    currentTimeInUserTZ: string;
    dates: {
      today: string;
      tomorrow: string;
      yesterday: string;
    };
    isoStrings: {
      todayStart: string;
      todayEnd: string;
      tomorrowStart: string;
      tomorrowEnd: string;
      yesterdayStart: string;
      yesterdayEnd: string;
      currentTime: string;
    };
  };
}): Promise<z.infer<typeof eventCreationRequestListSchema>> {
  
  let systemPromptContent = await fsPromises.readFile(eventCreatorSystemPromptPath, 'utf-8');

  const model = new ChatGoogleGenerativeAI({
    model: "gemini-2.0-flash",
    temperature: 0.1,
  });

  let humanMessageContent = `Here is the context for creating calendar events:
User Input: "${params.userInput}"
User Timezone: "${params.userTimezone}"
User Calendar List: "${params.userCalendarsFormatted}"
Current Time ISO: "${params.currentTimeISO || new Date().toISOString()}"`;

  // Use centralized timezone information if available
  if (params.timezoneInfo) {
    humanMessageContent += `
Timezone Information (PRE-CALCULATED - DO NOT RECALCULATE):
- Current Time in User TZ: ${params.timezoneInfo.currentTimeInUserTZ}
- User Local Time: ${params.timezoneInfo.userLocalTime}
- Timezone Offset: ${params.timezoneInfo.offset}
- Today's Date: ${params.timezoneInfo.dates.today}
- Tomorrow's Date: ${params.timezoneInfo.dates.tomorrow}
- Yesterday's Date: ${params.timezoneInfo.dates.yesterday}
- Today Start: ${params.timezoneInfo.isoStrings.todayStart}
- Today End: ${params.timezoneInfo.isoStrings.todayEnd}
- Tomorrow Start: ${params.timezoneInfo.isoStrings.tomorrowStart}
- Tomorrow End: ${params.timezoneInfo.isoStrings.tomorrowEnd}

IMPORTANT: Use these PRE-CALCULATED values. Do NOT calculate dates or times yourself.`;
  }

  if (params.anchorEventsContext && params.anchorEventsContext.length > 0) {
    humanMessageContent += `\n\nAnchor Events Context (use these as precise references for timing any new events relative to them):\n${JSON.stringify(params.anchorEventsContext, null, 2)}`;
  }

  if (params.existingEventsForConflictCheck && params.existingEventsForConflictCheck.length > 0) {
    const conflictCheckEvents = params.existingEventsForConflictCheck.map(event => ({
      id: event.id,
      summary: event.summary,
      start: event.start?.dateTime || event.start?.date,
      end: event.end?.dateTime || event.end?.date,
      calendarId: (event as any).calendarId || "primary" // Get calendarId from the event object
    }));
    
    humanMessageContent += `\n\nExisting Events for Conditional Logic Evaluation:\n${JSON.stringify(conflictCheckEvents, null, 2)}
    
IMPORTANT: If your user input contains conditional language like "if that conflicts", "but if there's a conflict", "unless it overlaps", etc., you MUST evaluate the condition using these existing events:
1. Check if the proposed primary time would conflict (overlap) with any of these existing events
2. If conflict exists, follow the user's alternative instruction (e.g., "schedule it as late as possible", "move it to Friday")
3. Create only ONE event based on the evaluation result
4. Use mathematical overlap detection: start1 < end2 && start2 < end1`;
  }

  humanMessageContent += `\n\nBased on ALL this context and your instructions (provided in the system message), please generate a JSON array of event objects to create.`;
  
  const messages = [
    new SystemMessage(systemPromptContent),
    new HumanMessage(humanMessageContent), 
  ];

  console.log(`[EventCreatorLLM] Generating event JSONs for input: "${params.userInput}", userTimezone: ${params.userTimezone}`);
  if (params.anchorEventsContext) {
    console.log('[EventCreatorLLM] Anchor Events Context:', JSON.stringify(params.anchorEventsContext, null, 2));
  }

  try {
    const result = await model.invoke(messages);
    let llmOutput = result.content;

    if (typeof llmOutput !== 'string') {
      console.error("[EventCreatorLLM] LLM output was not a string:", llmOutput);
      throw new Error("LLM output is not in the expected string format.");
    }
    console.log("[EventCreatorLLM] Raw LLM output string:", llmOutput);

    // Clean the output: remove markdown code block fences if present
    llmOutput = llmOutput.trim();
    if (llmOutput.startsWith("```json")) {
      llmOutput = llmOutput.substring(7);
      if (llmOutput.endsWith("```")) {
        llmOutput = llmOutput.substring(0, llmOutput.length - 3);
      }
    }
    llmOutput = llmOutput.trim();

    const parsedResponse = JSON.parse(llmOutput);
    const validatedResponse = eventCreationRequestListSchema.parse(parsedResponse);
    
    console.log("[EventCreatorLLM] Successfully validated response:", JSON.stringify(validatedResponse, null, 2));
    return validatedResponse;

  } catch (error: unknown) {
    console.error("[EventCreatorLLM] Error generating or validating event JSONs:", error);
    if (error instanceof z.ZodError) {
      console.error("[EventCreatorLLM] Zod Validation Errors:", JSON.stringify(error.format(), null, 2));
    }
    // Return empty array on error
    return [];
  }
} 