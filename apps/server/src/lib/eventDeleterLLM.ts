import { z } from "zod";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { promises as fsPromises } from 'fs';
import path from "path";
import type { calendar_v3 } from "googleapis";

// Schema for a single event object to be identified for deletion by the LLM
export const eventToDeleteSchema = z.object({
  eventId: z.string().describe("The ID of the event to delete. Must match an ID from the provided event list."),
  calendarId: z.string().describe("The calendar ID to which the event belongs. Must match the calendarId from the provided event list."),
  summary: z.string().optional().describe("The summary of the event, for confirmation/logging."),
  reasoningForDeletion: z.string().optional().describe("A brief explanation from the LLM on why this event was chosen for deletion.")
}).describe("Schema for a single Google Calendar event to be identified for deletion.");

// Schema for the list of event objects expected from the Event Deleter LLM
export const eventDeletionRequestListSchema = z.array(eventToDeleteSchema);

const eventDeleterSystemPromptPath = path.join(process.cwd(), 'src', 'prompts', 'eventDeleterPrompt.md');

// Define a more specific type for the events we expect to process,
// ensuring calendarId is present.
interface EventWithCalendarId extends calendar_v3.Schema$Event {
  calendarId: string;
}

interface GenerateEventDeletionJSONsParams {
  userInput: string;
  userTimezone: string;
  eventList: EventWithCalendarId[]; // Use the more specific type here
  targetCalendarIds: string[]; 
  currentTimeISO?: string; 
}

export async function generateEventDeletionJSONs(
  params: GenerateEventDeletionJSONsParams
): Promise<z.infer<typeof eventDeletionRequestListSchema>> {
  
  let systemPromptContent = await fsPromises.readFile(eventDeleterSystemPromptPath, 'utf-8');

  const model = new ChatGoogleGenerativeAI({
    model: "gemini-2.0-flash", 
    temperature: 0.1, 
  });

  const simplifiedEventList = params.eventList.map(event => ({
    id: event.id,
    summary: event.summary,
    description: event.description,
    start: event.start,
    end: event.end,
    location: event.location,
    calendarId: event.calendarId // This is now valid due to EventWithCalendarId type
  }));

  const humanMessageContent = `Here is the context for deleting calendar events:
User Input: "${params.userInput}"
User Timezone: "${params.userTimezone}"
Target Calendar IDs: ${JSON.stringify(params.targetCalendarIds)}
List of Potential Events to Delete (from Target Calendars):
${JSON.stringify(simplifiedEventList, null, 2)}

Based on this context and your instructions (provided in the system message), please generate the JSON list of event objects to delete, adhering to the schema. Only include events that are in the provided list and match the user's intent for deletion.`;

  const messages = [
    new SystemMessage(systemPromptContent),
    new HumanMessage(humanMessageContent), 
  ];

  console.log(`[EventDeleterLLM] Generating event deletion JSONs for input: "${params.userInput}"`);

  try {
    const result = await model.invoke(messages);
    let llmOutput = result.content;

    if (typeof llmOutput !== 'string') {
      console.error("[EventDeleterLLM] LLM output was not a string:", llmOutput);
      throw new Error("LLM output is not in the expected string format.");
    }
    console.log("[EventDeleterLLM] Raw LLM output string:", llmOutput);

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
            console.warn("[EventDeleterLLM] JSON array match found but content is empty. Original output:", llmOutput);
            return []; // Treat as no valid JSON found
        }
    } else if (jsonString.startsWith("```")) { // Handle cases like ```[]```
        const simplifiedJsonMatch = jsonString.match(/```\s*([\s\S]*?)\s*```/);
        if (simplifiedJsonMatch && simplifiedJsonMatch[1]) {
            jsonString = simplifiedJsonMatch[1].trim();
        } else {
            console.warn("[EventDeleterLLM] Found markdown fences but could not extract JSON. Original output:", llmOutput);
            return [];
        }
    } else {
        // If no clear JSON block is found, and the output isn't an array, it's likely problematic.
        // However, if the LLM just returns `[]` without markdown, it should be handled.
        // If it's not starting with `[` it's definitely not a simple array string.
        if (!jsonString.startsWith("[")) {
            console.warn("[EventDeleterLLM] LLM output does not appear to be a JSON array and no JSON block was extracted. Original output:", llmOutput);
            // Check for common non-JSON responses indicating no events
             if (llmOutput.toLowerCase().includes("no events") || llmOutput.toLowerCase().includes("empty list") || llmOutput.toLowerCase().includes("cannot identify")) {
                console.log("[EventDeleterLLM] LLM indicated no events to delete through text, returning empty list.");
                return [];
            }
            // If it's none of the above, it's an unexpected format.
            throw new Error("LLM output is not in the expected JSON array format and does not indicate an empty list through text.");
        }
    }
    
    // At this point, jsonString *should* be the JSON array string, or an empty string if LLM legitimately outputted nothing.
    if (jsonString === "" || jsonString.toLowerCase() === "null") {
        console.log("[EventDeleterLLM] LLM output is effectively empty or null after extraction, returning empty list.");
        return [];
    }

    const parsedEventList = JSON.parse(jsonString); // This might still throw if jsonString is not valid JSON
    const validatedEventList = eventDeletionRequestListSchema.parse(parsedEventList);
    
    console.log("[EventDeleterLLM] Successfully validated event deletion list:", JSON.stringify(validatedEventList, null, 2));
    return validatedEventList;

  } catch (error: unknown) {
    console.error("[EventDeleterLLM] Error generating or validating event deletion JSONs:", error);
    if (error instanceof z.ZodError) {
      console.error("[EventDeleterLLM] Zod Validation Errors:", JSON.stringify(error.format(), null, 2));
    }
    return []; 
  }
} 