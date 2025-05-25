import { z } from "zod";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { promises as fsPromises } from 'fs';
import path from "path";
import type { calendar_v3 } from "googleapis";

// Schema for event date/time updates (similar to eventCreatorLLM)
const eventDateTimeUpdateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format.").optional(),
  dateTime: z.string().datetime({ offset: true, message: "Invalid ISO 8601 dateTime string. Must include offset." }).optional(),
  timeZone: z.string().optional().describe("IANA time zone database name, e.g., 'America/New_York' or 'Europe/Berlin'.")
}).optional();

// Schema for a single event object to be identified and updated by the LLM
export const eventToUpdateSchema = z.object({
  eventId: z.string().describe("The ID of the event to update. Must match an ID from the provided event list."),
  calendarId: z.string().describe("The calendar ID to which the event belongs. Must match the calendarId from the provided event list."),
  summary: z.string().optional().describe("New summary/title for the event."),
  description: z.string().optional().describe("New description for the event."),
  location: z.string().optional().describe("New location for the event."),
  start: eventDateTimeUpdateSchema.describe("New start time for the event."),
  end: eventDateTimeUpdateSchema.describe("New end time for the event."),
  attendees: z.array(z.string()).optional().describe("New list of attendee email addresses."),
  reasoningForUpdate: z.string().optional().describe("A brief explanation from the LLM on why this event was chosen for update and what changes are being made.")
}).describe("Schema for a single Google Calendar event to be identified for update.");

// Schema for the list of event objects expected from the Event Updater LLM
export const eventUpdateRequestListSchema = z.array(eventToUpdateSchema);

const eventUpdaterSystemPromptPath = path.join(process.cwd(), 'src', 'prompts', 'eventUpdaterPrompt.md');

// Define a more specific type for the events we expect to process,
// ensuring calendarId is present.
interface EventWithCalendarId extends calendar_v3.Schema$Event {
  calendarId: string;
}

interface GenerateEventUpdateJSONsParams {
  userInput: string;
  userTimezone: string;
  eventList: EventWithCalendarId[]; // Use the more specific type here
  targetCalendarIds: string[]; 
  currentTimeISO?: string; 
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
}

export async function generateEventUpdateJSONs(
  params: GenerateEventUpdateJSONsParams
): Promise<z.infer<typeof eventUpdateRequestListSchema>> {
  
  let systemPromptContent = await fsPromises.readFile(eventUpdaterSystemPromptPath, 'utf-8');

  const model = new ChatGoogleGenerativeAI({
    model: "gemini-2.0-flash", 
    temperature: 0.2, 
  });

  const simplifiedEventList = params.eventList.map(event => ({
    id: event.id,
    summary: event.summary,
    description: event.description,
    start: event.start,
    end: event.end,
    location: event.location,
    attendees: event.attendees,
    calendarId: event.calendarId // This is now valid due to EventWithCalendarId type
  }));

  const humanMessageContent = `Here is the context for updating calendar events:
User Input: "${params.userInput}"
User Timezone: "${params.userTimezone}"
Target Calendar IDs: ${JSON.stringify(params.targetCalendarIds)}
Current Time: "${params.currentTimeISO || new Date().toISOString()}"
${params.timezoneInfo ? `
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

IMPORTANT: Use these PRE-CALCULATED values. Do NOT calculate dates or times yourself.
` : ''}
List of Potential Events to Update (from Target Calendars):
${JSON.stringify(simplifiedEventList, null, 2)}

Based on this context and your instructions (provided in the system message), please generate the JSON list of event objects to update, adhering to the schema. Only include events that are in the provided list and match the user's intent for updating.`;

  const messages = [
    new SystemMessage(systemPromptContent),
    new HumanMessage(humanMessageContent), 
  ];

  console.log(`[EventUpdaterLLM] Generating event update JSONs for input: "${params.userInput}"`);

  try {
    const result = await model.invoke(messages);
    let llmOutput = result.content;

    if (typeof llmOutput !== 'string') {
      console.error("[EventUpdaterLLM] LLM output was not a string:", llmOutput);
      throw new Error("LLM output is not in the expected string format.");
    }
    console.log("[EventUpdaterLLM] Raw LLM output string:", llmOutput);

    let jsonString = llmOutput.trim();

    // Attempt to extract JSON array if surrounded by markdown or other text
    const jsonArrayMatch = jsonString.match(/```json\s*([\s\S]*?)\s*```|(\[[\s\S]*\])/);

    if (jsonArrayMatch) {
        // Prioritize the content within ```json ... ``` if present, otherwise take the first direct array match
        jsonString = jsonArrayMatch[1] || jsonArrayMatch[2];
        if (jsonString) {
            jsonString = jsonString.trim();
        } else {
            // This case should ideally not be hit if the regex is correct and there's a match
            console.warn("[EventUpdaterLLM] JSON array match found but content is empty. Original output:", llmOutput);
            return []; // Treat as no valid JSON found
        }
    } else if (jsonString.startsWith("```")) { // Handle cases like ```[]```
        const simplifiedJsonMatch = jsonString.match(/```\s*([\s\S]*?)\s*```/);
        if (simplifiedJsonMatch && simplifiedJsonMatch[1]) {
            jsonString = simplifiedJsonMatch[1].trim();
        } else {
            console.warn("[EventUpdaterLLM] Found markdown fences but could not extract JSON. Original output:", llmOutput);
            return [];
        }
    } else {
        // If no clear JSON block is found, and the output isn't an array, it's likely problematic.
        // However, if the LLM just returns `[]` without markdown, it should be handled.
        // If it's not starting with `[` it's definitely not a simple array string.
        if (!jsonString.startsWith("[")) {
            console.warn("[EventUpdaterLLM] LLM output does not appear to be a JSON array and no JSON block was extracted. Original output:", llmOutput);
            // Check for common non-JSON responses indicating no events
             if (llmOutput.toLowerCase().includes("no events") || llmOutput.toLowerCase().includes("empty list") || llmOutput.toLowerCase().includes("cannot identify")) {
                console.log("[EventUpdaterLLM] LLM indicated no events to update through text, returning empty list.");
                return [];
            }
            // If it's none of the above, it's an unexpected format.
            throw new Error("LLM output is not in the expected JSON array format and does not indicate an empty list through text.");
        }
    }
    
    // At this point, jsonString *should* be the JSON array string, or an empty string if LLM legitimately outputted nothing.
    if (jsonString === "" || jsonString.toLowerCase() === "null") {
        console.log("[EventUpdaterLLM] LLM output is effectively empty or null after extraction, returning empty list.");
        return [];
    }

    const parsedEventList = JSON.parse(jsonString); // This might still throw if jsonString is not valid JSON
    const validatedEventList = eventUpdateRequestListSchema.parse(parsedEventList);
    
    // Additional validation: Check for logical errors
    for (const event of validatedEventList) {
      if (event.start?.dateTime && event.end?.dateTime) {
        const startTime = new Date(event.start.dateTime);
        const endTime = new Date(event.end.dateTime);
        
        if (endTime <= startTime) {
          console.warn(`[EventUpdaterLLM] Logical error detected: End time (${event.end.dateTime}) is before or equal to start time (${event.start.dateTime}) for event ${event.eventId}. Returning empty array for safety.`);
          return [];
        }
      }
    }
    
    console.log("[EventUpdaterLLM] Successfully validated event update list:", JSON.stringify(validatedEventList, null, 2));
    return validatedEventList;

  } catch (error: unknown) {
    console.error("[EventUpdaterLLM] Error generating or validating event update JSONs:", error);
    if (error instanceof z.ZodError) {
      console.error("[EventUpdaterLLM] Zod Validation Errors:", JSON.stringify(error.format(), null, 2));
    }
    return []; 
  }
} 