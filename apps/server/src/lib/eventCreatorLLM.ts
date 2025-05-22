import { z } from "zod";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { promises as fsPromises } from 'fs';
import path from "path";

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
  email: z.string().email("Invalid email format for attendee."),
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
  summary?: string | null;
  start?: { date?: string; dateTime?: string; timeZone?: string } | null;
  end?: { date?: string; dateTime?: string; timeZone?: string } | null;
  calendarId?: string | null;
}

export async function generateEventCreationJSONs(params: {
  userInput: string;
  userTimezone: string;
  userCalendarsFormatted: string; 
  currentTimeISO?: string; 
  anchorEventsContext?: AnchorEventContext[]; // New optional parameter
}): Promise<z.infer<typeof eventCreationRequestListSchema>> {
  
  let systemPromptContent = await fsPromises.readFile(eventCreatorSystemPromptPath, 'utf-8');
  // DO NOT replace placeholders in the systemPromptContent anymore.
  // systemPromptContent = systemPromptContent.replace("{userInput}", params.userInput); 
  // systemPromptContent = systemPromptContent.replace("{userTimezone}", params.userTimezone);
  // systemPromptContent = systemPromptContent.replace("{userCalendarList}", params.userCalendarsFormatted);
  // if(params.currentTimeISO){
  //     systemPromptContent = systemPromptContent.replace("{currentTimeISO}", params.currentTimeISO); 
  // } else {
  //     systemPromptContent = systemPromptContent.replace("{currentTimeISO}", new Date().toISOString()); 
  // }

  const model = new ChatGoogleGenerativeAI({
    model: "gemini-2.0-flash", // Or your preferred model
    temperature: 0.1, // Low temperature for more deterministic JSON output
    // Ensure model is configured for JSON output if the API supports it explicitly
    // For Gemini, it's usually handled by asking for JSON in the prompt.
  });

  let humanMessageContent = `Here is the context for creating calendar events:
User Input: "${params.userInput}"
User Timezone: "${params.userTimezone}"
User Calendar List: "${params.userCalendarsFormatted}"
Current Time ISO: "${params.currentTimeISO || new Date().toISOString()}"`;

  if (params.anchorEventsContext && params.anchorEventsContext.length > 0) {
    humanMessageContent += `\n\nAnchor Events Context (use these as precise references for timing any new events relative to them):\n${JSON.stringify(params.anchorEventsContext, null, 2)}`;
  }

  humanMessageContent += `\n\nBased on ALL this context and your instructions (provided in the system message), please generate the JSON list of event objects adhering to the schema and examples you were given.`;
  
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

    // Ensure the output is an array (starts with [ and ends with ])
    if (!llmOutput.startsWith("[") || !llmOutput.endsWith("]")) {
        console.warn("[EventCreatorLLM] LLM output does not appear to be a JSON array. Attempting to parse anyway. Output:", llmOutput);
        // If it's a single object, wrap it in an array for robust parsing by the schema
        if (llmOutput.startsWith("{") && llmOutput.endsWith("}")) {
            console.log("[EventCreatorLLM] Wrapping single JSON object output in an array.");
            llmOutput = `[${llmOutput}]`;
        }
        // If it's still not an array, parsing will likely fail, which is caught below.
    }

    const parsedEventList = JSON.parse(llmOutput);
    const validatedEventList = eventCreationRequestListSchema.parse(parsedEventList);
    
    console.log("[EventCreatorLLM] Successfully validated event list:", JSON.stringify(validatedEventList, null, 2));
    return validatedEventList;

  } catch (error: unknown) {
    console.error("[EventCreatorLLM] Error generating or validating event JSONs:", error);
    if (error instanceof z.ZodError) {
      console.error("[EventCreatorLLM] Zod Validation Errors:", JSON.stringify(error.format(), null, 2));
    }
    // In case of error, return an empty list or re-throw, depending on desired handling
    // For now, returning empty list to prevent flow stoppage, but controller should handle this.
    return []; 
  }
} 