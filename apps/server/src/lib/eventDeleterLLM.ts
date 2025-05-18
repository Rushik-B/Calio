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
    model: "gemini-1.5-flash-latest", 
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

    llmOutput = llmOutput.trim();
    if (llmOutput.startsWith("```json")) {
      llmOutput = llmOutput.substring(7);
      if (llmOutput.endsWith("```")) {
        llmOutput = llmOutput.substring(0, llmOutput.length - 3);
      }
    }
    llmOutput = llmOutput.trim();

    if (!llmOutput.startsWith("[") || !llmOutput.endsWith("]")) {
        console.warn("[EventDeleterLLM] LLM output does not appear to be a JSON array. Attempting to parse. Output:", llmOutput);
        if (llmOutput.startsWith("{") && llmOutput.endsWith("}")) {
            console.log("[EventDeleterLLM] Wrapping single JSON object output in an array.");
            llmOutput = `[${llmOutput}]`;
        } else if (llmOutput === "" || llmOutput.toLowerCase() === "null") {
            console.log("[EventDeleterLLM] LLM output is empty or null, returning empty list.");
            return [];
        }
    }
    if (llmOutput === "") {
        console.log("[EventDeleterLLM] LLM output was an empty string after trimming, returning empty list.");
        return [];
    }

    const parsedEventList = JSON.parse(llmOutput);
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