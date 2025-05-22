// src/lib/planner.ts
//--------------------------------------------------
// 0.  Runtime setup
//--------------------------------------------------
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env.development") });

// Read the master prompt from calendar.md
// const P_PROMPT_PATH = path.resolve(__dirname, "../prompts/calendar.md"); // Not used directly here anymore
// const MASTER_PROMPT = fs.readFileSync(P_PROMPT_PATH, "utf-8"); // Not used directly here anymore

//--------------------------------------------------
// 1.  Imports & Zod validation schema
//--------------------------------------------------
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { ZodError } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { promises as fsPromises } from 'fs';

/**
 * Zod — for **runtime validation** *after* Gemini responds.
 */
const calendarActionSchema = z.object({
  actionType: z.enum(["create_event", "list_events", "update_event", "delete_event", "general_chat"]).describe("The type of calendar action to perform. This is a mandatory field."),
  calendarId: z.string().optional().describe("The ID of the calendar to use. Defaults to 'primary'. Users might specify this e.g., 'work calendar', 'personal calendar'. You should try to map this to a known ID if possible based on context, otherwise pass it as received if it looks like an ID."),
  eventId: z.string().optional().describe("The ID of the event to update or delete."),
  summary: z.string().optional().describe("The summary or title of the event."),
  description: z.string().optional().describe("The detailed description of the event."),
  location: z.string().optional().describe("The location of the event."),
  start: z.string().optional().describe("The start time of the event in ISO 8601 format. If the user specifies a date but no time for a new event, assume it's an all-day event starting on that date. For queries spanning a whole day (e.g. 'on Thursday') in the user's timezone (provided as {userTimezone}), this should be the beginning of that day in that timezone (e.g., YYYY-MM-DDT00:00:00+offset or YYYY-MM-DDT00:00:00 if the timezone is UTC)."),
  end: z.string().optional().describe("The end time of the event in ISO 8601 format. If the user specifies a date but no time for a new event, this should be the start of the following day for an all-day event. For queries spanning a whole day (e.g. 'on Thursday') in the user's timezone (provided as {userTimezone}), this should be the end of that day in that timezone (e.g., YYYY-MM-DDT23:59:59.999+offset or YYYY-MM-DDT23:59:59.999 if the timezone is UTC)."),
  query: z.string().optional().describe("The search query for listing events."),
  timeMin: z.string().optional().describe("The minimum time for listing events in ISO 8601 format. For queries spanning a whole day (e.g. 'on Thursday') in the user's timezone (provided as {userTimezone}), this should be the beginning of that day in that timezone (e.g., YYYY-MM-DDT00:00:00+offset or YYYY-MM-DDT00:00:00 if the timezone is UTC)."),
  timeMax: z.string().optional().describe("The maximum time for listing events in ISO 8601 format. For queries spanning a whole day (e.g. 'on Thursday') in the user's timezone (provided as {userTimezone}), this should be the end of that day in that timezone (e.g., YYYY-MM-DDT23:59:59.999+offset or YYYY-MM-DDT23:59:59.999 if the timezone is UTC)."),
  attendees: z.array(z.string()).optional().describe("A list of email addresses of attendees for the event."),
  questionAboutEvents: z.string().optional().describe("If the user is asking a question ABOUT events (e.g., 'how much work do I have?', 'Am I free?') rather than just listing them, put their core question here. This triggers a secondary analysis step."),
  reasoning: z.string().optional().describe("For 'general_chat' actionType, this field should contain the LLM's reasoning for choosing general_chat, or context for the fallback. For other actions, it's not typically used unless there's a specific ancillary reason.")
}).describe("Parameters for the calendar action, including the mandatory actionType.");

const jsonParameters = zodToJsonSchema(calendarActionSchema);

//--------------------------------------------------
// 2.  Set up Gemini with the function tool (This initial setup might be redundant if re-declared in generatePlan)
//--------------------------------------------------
// const model = new ChatGoogleGenerativeAI({ // This global model isn't used by generatePlan after its own declaration
//   model: "gemini-2.0-flash",
//   temperature: 0.2,
// });

// const llmWithTools = model.bind({ // This global llmWithTools isn't used by generatePlan
//   tools: [
//     {
//       type: "function",
//       function: {
//         name: "calendar_action_planner",
//         description:
//           "Return the calendar action the user wants, including a specific actionType, and any parameters. Infer date/time details carefully.",
//         parameters: jsonParameters,
//       },
//     },
//   ],
//   tool_choice: { type: "function", function: { name: "calendar_action_planner" } },
// });

//--------------------------------------------------
// 3.  Main helper
//--------------------------------------------------
const calendarSystemPromptPath = path.join(process.cwd(), 'src', 'prompts', 'calendar.md');

// Interface RawLLMResponse removed as it's not explicitly used after refactor. Args are directly parsed.

export type CalendarActionParams = z.infer<typeof calendarActionSchema>;

export interface CreateEventIntentParams {
  userInput: string;
  userTimezone: string;
  calendarId?: string;
  anchorEventsContext?: AnchorEventContext[]; // Added to match what planner actually sends
}

export interface DeleteEventIntentParams {
  userInput: string;
  userTimezone: string;
  calendarId?: string; // Calendar ID if planner can determine it
  timeMin?: string;    // Optional: From planner for scoping event search
  timeMax?: string;    // Optional: From planner for scoping event search
  query?: string;      // Optional: From planner for scoping event search
  originalRequestNature?: "singular" | "plural_or_unspecified"; // Hint from orchestrator
}

// Define a type for the anchor event context, matching eventCreatorLLM.ts
interface AnchorEventContext {
  summary?: string | null;
  start?: { date?: string; dateTime?: string; timeZone?: string } | null;
  end?: { date?: string; dateTime?: string; timeZone?: string } | null;
  calendarId?: string | null;
}

export type CalendarAction = {
    action: "create_event" | "list_events" | "update_event" | "delete_event" | "general_chat";
    params?: CalendarActionParams | CreateEventIntentParams | DeleteEventIntentParams | { userInput: string; userTimezone: string; calendarId?: string; anchorEventsContext?: AnchorEventContext[] }; // Updated for create_event with anchor context
    speakableToolResponse?: string;
};

export async function generatePlan(
  userInput: string,
  currentTimeISO: string,
  userTimezone: string,
  userCalendarsFormatted?: string,
  orchestratorParams?: { 
    originalRequestNature?: "singular" | "plural_or_unspecified"; 
    timeMin?: string; // Added for type safety from orchestrator
    timeMax?: string; // Added for type safety from orchestrator
    anchorEventsContext?: AnchorEventContext[]; // Added to receive orchestrator hints
    [key: string]: any 
  }
): Promise<CalendarAction | null> {
  let calendarSystemPrompt = await fsPromises.readFile(calendarSystemPromptPath, 'utf-8');
  
  calendarSystemPrompt = calendarSystemPrompt.replace("{currentTimeISO}", currentTimeISO);
  calendarSystemPrompt = calendarSystemPrompt.replace("{userTimezone}", userTimezone);
  
  if (userCalendarsFormatted) {
    calendarSystemPrompt = calendarSystemPrompt.replace("{userCalendarList}", userCalendarsFormatted);
  } else {
    calendarSystemPrompt = calendarSystemPrompt.replace("{userCalendarList}", "Not available or could not be fetched.");
  }

  let userInputForPlannerLLM = userInput;
  if (orchestratorParams?.anchorEventsContext && orchestratorParams.anchorEventsContext.length > 0) {
    const anchorContextString = orchestratorParams.anchorEventsContext.map(event => {
      let eventParts = [];
      if (event.summary) eventParts.push(`Summary: '${event.summary}'`);
      if (event.start?.dateTime) eventParts.push(`Start: '${event.start.dateTime}'`);
      else if (event.start?.date) eventParts.push(`Start Date: '${event.start.date}'`);
      if (event.end?.dateTime) eventParts.push(`End: '${event.end.dateTime}'`);
      else if (event.end?.date) eventParts.push(`End Date: '${event.end.date}'`);
      if (event.calendarId) eventParts.push(`Calendar ID: '${event.calendarId}'`);
      return eventParts.join(", ");
    }).join("; ");
    
    userInputForPlannerLLM = `The user's request '${userInput}' is in reference to the following event(s): [${anchorContextString}]. Please process the user's request based on this context. User's original request for the new event: "${userInput}"`;
    console.log(`[Planner] Prepended anchor context to userInput: ${userInputForPlannerLLM}`);
  }

  const model = new ChatGoogleGenerativeAI({
    model: "gemini-2.0-flash",
    temperature: 0.2,
  });

  const llmWithTools = model.bind({
    tools: [
      {
        type: "function",
        function: {
          name: "calendar_action_planner",
          description:
            `Determine the user's desired calendar actionType (create_event, list_events, update_event, delete_event, general_chat) and all relevant parameters. Infer date/time details carefully, considering the user's timezone: ${userTimezone}. The actionType field is mandatory.`,
          parameters: jsonParameters, // jsonParameters now includes actionType
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "calendar_action_planner" } }, 
  });

  const messages = [
    new SystemMessage(calendarSystemPrompt),
    new HumanMessage(userInputForPlannerLLM),
  ];

  console.log(`[Planner] Generating plan for input: "${userInputForPlannerLLM}", currentTime: ${currentTimeISO}, userTimezone: ${userTimezone}`);

  try {
    const result = await llmWithTools.invoke(messages);
    console.log("[Planner] LLM result:", JSON.stringify(result, null, 2));

    let rawArgs: any;
    let llmToolName: string | undefined;

    if (result.tool_calls && result.tool_calls.length > 0) {
        const toolCall = result.tool_calls[0];
        llmToolName = toolCall.name; 
        rawArgs = toolCall.args;
        console.log(`[Planner] Found tool call in LLM response. Tool Name: ${llmToolName}, Args:`, JSON.stringify(rawArgs, null,2));
    } else if (result.content && typeof result.content === 'string') {
        let contentToParse = result.content.trim();
        if (contentToParse.startsWith("```json")) {
            contentToParse = contentToParse.substring(7);
            if (contentToParse.endsWith("```")) {
                contentToParse = contentToParse.substring(0, contentToParse.length - 3);
            }
        }
        contentToParse = contentToParse.trim();

        if (contentToParse.startsWith("{") && contentToParse.endsWith("}")) {
            try {
                const jsonContent = JSON.parse(contentToParse);
                rawArgs = jsonContent;
                llmToolName = "calendar_action_planner"; // Assume this if parsing JSON content
                console.log(`[Planner] Parsed JSON from direct text content. Assumed Tool Name: ${llmToolName}, Args:`, JSON.stringify(rawArgs, null, 2));
            } catch (e) {
                console.warn("[Planner] Failed to parse JSON from direct text content, treating as general_chat:", contentToParse, e);
                return {
                    action: "general_chat",
                    // Ensure params is of type CalendarActionParams for general_chat
                    params: { actionType: "general_chat", reasoning: `Planner LLM fallback due to JSON parse error in content: "${result.content}". Original user query: "${userInput}".` }
                };
            }
        } else {
            console.log("[Planner] LLM response content is not a tool call or parsable JSON, treating as general_chat:", result.content);
            return {
                action: "general_chat",
                params: { actionType: "general_chat", reasoning: `Planner LLM fallback due to non-JSON direct text response: "${result.content}". Original user query: "${userInput}".` }
            };
        }
    } else {
      console.warn("[Planner] LLM response did not contain tool_calls or content, defaulting to general_chat.");
      return {
          action: "general_chat",
          params: { actionType: "general_chat", reasoning: `Planner LLM response was empty or malformed. Original user query: "${userInput}".` }
      };
    }

    if (llmToolName === "calendar_action_planner") {
        try {
            const validatedParams = calendarActionSchema.parse(rawArgs || {});
            const determinedAction = validatedParams.actionType; // Directly use actionType from LLM
            
            console.log(`[Planner] LLM determined action: ${determinedAction}`);

            // If orchestrator provided timeMin/timeMax, use them directly, overriding LLM's extraction for these fields.
            // This is crucial for "delete events just created" scenarios where orchestrator calculates the scope.
            let finalParamsForAction = { ...validatedParams };
            if (orchestratorParams?.timeMin && orchestratorParams?.timeMax && determinedAction === "delete_event") {
                console.log(`[Planner] Overriding timeMin/timeMax with values from orchestrator: ${orchestratorParams.timeMin}, ${orchestratorParams.timeMax}`);
                finalParamsForAction.timeMin = orchestratorParams.timeMin as string;
                finalParamsForAction.timeMax = orchestratorParams.timeMax as string;
            }

            if (determinedAction === "create_event") {
                // If LLM says "create_event", we still pass to specialized Event Creator LLM
                // The specialized LLM will handle parameter extraction for creation more robustly.
                console.log(`[Planner] Action type 'create_event' identified. Passing to specialized Event Creator LLM logic.`);
                return {
                    action: "create_event", // This is the final action for the system
                    params: { // CreateEventIntentParams for the downstream service
                        userInput: userInput, // IMPORTANT: Use the original userInput for the event creator, not the augmented one
                        userTimezone: userTimezone,
                        calendarId: finalParamsForAction.calendarId, 
                        anchorEventsContext: orchestratorParams?.anchorEventsContext // Pass through anchor context
                    }
                };
            } else if (determinedAction === "delete_event") {
                console.log(`[Planner] Action type 'delete_event' identified. Passing to specialized Event Deleter LLM logic.`);
                return {
                    action: "delete_event",
                    params: { // DeleteEventIntentParams for the downstream service
                        userInput: userInput, // IMPORTANT: Use the original userInput for the event deleter
                        userTimezone: userTimezone,
                        calendarId: finalParamsForAction.calendarId,
                        timeMin: finalParamsForAction.timeMin, // Could be from orchestrator or LLM
                        timeMax: finalParamsForAction.timeMax, // Could be from orchestrator or LLM
                        query: finalParamsForAction.query,
                        originalRequestNature: orchestratorParams?.originalRequestNature // Pass the hint
                    }
                };
            } else if (determinedAction === "general_chat") {
                return {
                    action: "general_chat",
                    params: { 
                        ...finalParamsForAction, // Pass all params from LLM for general_chat
                        actionType: "general_chat", // Ensure actionType is set
                        reasoning: finalParamsForAction.reasoning || `LLM classified as general_chat. Original query: "${userInput}". LLM params: ${JSON.stringify(rawArgs)}`
                    }
                };
            } else { 
                 // For list_events, update_event
                 // These actions will use the parameters directly as validated.
                 console.log(`[Planner] Determined action: ${determinedAction}. Using validated params.`);
                 return {
                    action: determinedAction, // e.g., "list_events", "update_event"
                    params: finalParamsForAction, // These are CalendarActionParams, possibly with overridden timeMin/Max
                };
            }
        } catch (error) {
            if (error instanceof ZodError) {
                console.error("[Planner] Zod validation error for LLM args (actionType may be missing/invalid):", error.format());
                console.error("[Planner] Invalid args received from LLM:", JSON.stringify(rawArgs, null, 2));
                return {
                    action: "general_chat",
                    params: { actionType: "general_chat", reasoning: `Parameter validation failed for LLM arguments (actionType missing/invalid?): ${error.message}. LLM raw args: ${JSON.stringify(rawArgs)}` },
                };
            }
            console.error("[Planner] Error processing LLM output after validation:", error);
            return {
                action: "general_chat",
                params: { actionType: "general_chat", reasoning: `Error processing LLM output: ${error instanceof Error ? error.message : String(error)}` },
            };
        }
    } else {
        console.warn(`[Planner] LLM tool name was not 'calendar_action_planner' (was: ${llmToolName}). Defaulting to general_chat.`);
        return {
            action: "general_chat",
            params: { actionType: "general_chat", reasoning: `LLM tool name was unexpected: ${llmToolName}. Raw args: ${JSON.stringify(rawArgs)}` }
        };
    }

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error in planner execution";
    console.error("[Planner] Error during LLM call or overall processing:", error);
    return {
        action: "general_chat",
        params: { actionType: "general_chat", reasoning: `Planner execution failed: ${message}. Original user query: "${userInput}".` },
    };
  }
}

// Helper function to determine the actual calendar action based on the validated parameters extracted by the LLM.
// function determineActualActionFromParams(params: CalendarActionParams, userInputForContext: string, userTimezoneForContext: string): CalendarAction['action'] {
//     const lowerUserInput = userInputForContext.toLowerCase();

//     // Keywords that strongly suggest a specific intent
//     const createKeywords = ["schedule", "create", "add", "book", "new event", "set up", "put on my calendar", "i have", "block out"];
//     const listKeywords = ["what's on", "show me", "do i have anything", "am i free", "what does my schedule look like", "list my events", "view my calendar"];
//     const updateKeywords = ["update", "change", "modify", "reschedule", "move"];
//     const deleteKeywords = ["delete", "remove", "cancel"];

//     // 1. Check for Update/Delete first (most specific due to eventId)
//     if (params.eventId) {
//         if (updateKeywords.some(keyword => lowerUserInput.includes(keyword)) || 
//             (params.summary || params.description || params.location || params.start || params.end || params.attendees)) {
//             console.log(`[Planner] Determined action: update_event (eventId present with update signals)`);
//             return "update_event";
//         }
//         // If eventId is present and other fields are mostly empty, or delete keywords are used.
//         const paramKeys = Object.keys(params).filter(k => params[k as keyof CalendarActionParams] !== undefined);
//         const relevantNonIdKeys = paramKeys.filter(k => k !== 'eventId' && k !== 'calendarId');
//         if (deleteKeywords.some(keyword => lowerUserInput.includes(keyword)) || relevantNonIdKeys.length === 0) {
//             console.log(`[Planner] Determined action: delete_event (eventId present with delete signals or minimal other params)`);
//             return "delete_event";
//         }
//         // If eventId is present but signals are ambiguous, it might still be an update if fields are being changed.
//         if (relevantNonIdKeys.length > 0) {
//              console.log(`[Planner] Determined action: update_event (eventId present with other params, defaulting to update)`);
//             return "update_event";
//         }
//     }

//     // 2. Check for explicit List Events intent
//     if (params.questionAboutEvents) {
//         console.log(`[Planner] Determined action: list_events (questionAboutEvents present)`);
//         return "list_events";
//     }
//     if (listKeywords.some(keyword => lowerUserInput.includes(keyword))) {
//         // If list keywords are present, and no strong create keywords override, it's a list event.
//         if (!createKeywords.some(keyword => lowerUserInput.includes(keyword) && (params.summary || params.start || params.end))){
//             console.log(`[Planner] Determined action: list_events (listKeywords present)`);
//             return "list_events";
//         }
//     }
//     // If timeMin or timeMax are primary parameters (and not overridden by strong create intent)
//     if ((params.timeMin || params.timeMax || params.query) && !params.questionAboutEvents) {
//         let isStrongCreate = createKeywords.some(keyword => lowerUserInput.includes(keyword));
//         // If LLM provided summary/start/end with create keywords, it might be a confused create intent.
//         let hasMinimalCreateParams = params.summary || params.start || params.end;
//         if (isStrongCreate && hasMinimalCreateParams) {
//             console.log(`[Planner] Potential create_event despite timeMin/Max due to keywords and params. Proceeding to create_event logic.`);
//             // Fall through to create_event checks
//         } else if (!isStrongCreate) {
//             console.log(`[Planner] Determined action: list_events (timeMin/Max/query present without strong create override)`);
//             return "list_events";
//         }
//     }

//     // 3. Check for Create Event intent (more aggressively now)
//     // Prioritize keywords if they suggest creation, even if LLM parameter extraction is imperfect.
//     const hasCreateKeyword = createKeywords.some(keyword => lowerUserInput.includes(keyword));
//     const hasExplicitTimeOrSummary = params.summary || params.start || params.end || params.location; // Any hint of event details

//     if (hasCreateKeyword) {
//         if (hasExplicitTimeOrSummary || lowerUserInput.match(/\d{1,2}(am|pm|:\d{2})|today|tomorrow|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i)) {
//             console.log(`[Planner] Determined action: create_event (createKeywords present with time/summary hints)`);
//             return "create_event";
//         }
//         // If create keyword but no other info, could be a vague create request for specialized LLM
//         console.log(`[Planner] Determined action: create_event (createKeywords present, details to be fleshed out by EventCreatorLLM)`);
//         return "create_event";
//     }
//     // If no strong create keyword, but params suggest creation (e.g. LLM correctly parsed summary & start)
//     if (params.summary && params.start && !params.eventId) {
//         console.log(`[Planner] Determined action: create_event (summary and start present without eventId)`);
//         return "create_event";
//     }

//     // 4. Fallback to general_chat if no clear intent is found after the above checks
//     console.log(`[Planner] Could not determine specific calendar action. Input: "${userInputForContext}". Params: ${JSON.stringify(params)}. Falling back to general_chat.`);
//     return "general_chat";
// } // End of determineActualActionFromParams (commented out for deletion)

//--------------------------------------------------
// 4.  Quick test runner (Removed as it's unused)
//--------------------------------------------------
// ... (rest of the commented out testPlanner function remains unchanged)
// Ensure the testPlanner and its related schema imports (createEventParamsSchema etc.) would also need adjustment
// if it were to be used, as they would now rely on `actionType` within the params.
// For now, as it is commented out, no direct changes are made to it.

/* // Original testPlanner function commented out/removed
async function testPlanner() {
  if (
    !process.env.GOOGLE_API_KEY &&
    !process.env.GOOGLE_GENERATIVE_AI_API_KEY
  ) {
    console.error(
      "ERROR: Set GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY in your env.",
    );
    return;
  }

  // Get current time in ISO format for testing
  const nowISO = new Date().toISOString();

  const inputs = [
    "Schedule a meeting with John for tomorrow at 2 pm to discuss the project budget.",
    "What's on my calendar for next Monday?",
    "Delete the meeting about the budget.",
    "Change the meeting 'Project Kickoff' with event ID projKickoff123 to next Friday at 10am."
  ];

  for (const input of inputs) {
    console.log(`\n--- Processing Input: "${input}" ---`);
    // Pass the current time to generatePlan for the test runner
    const plan = await generatePlan(input, nowISO, 'America/New_York'); // Added a dummy timezone for testing

    console.log("\n--- Test Planner Output ---");
    if (plan && plan.params && 'actionType' in plan.params) { // Check if params is CalendarActionParams
      const params = plan.params as CalendarActionParams; // Type assertion
      console.log("Action    :", plan.action);
      console.log("ActionType:", params.actionType); // Log the actionType from LLM
      console.log("Params    :", params);
      // Reasoning is now part of params if actionType is general_chat
      if (params.actionType === "general_chat" && params.reasoning) {
        console.log("Reasoning :", params.reasoning);
      }

      // Dummy tool execution part would need more significant rewrite
      // as tool selection now depends on plan.action which is derived from params.actionType
      // For brevity, skipping detailed rewrite of this test section as it's commented out.
      let toolResult = "No specific tool execution for this action in test runner or dummy tool not implemented.";
      console.log("Tool Result (dummy):", toolResult);

    } else if (plan && plan.action === "create_event" && plan.params && 'userInput' in plan.params) { // Check if params is CreateEventIntentParams
        const params = plan.params as CreateEventIntentParams;
        console.log("Action    :", plan.action);
        console.log("Params (for EventCreatorLLM):", params);
        let toolResult = "Create event intent identified, would pass to EventCreatorLLM.";
        console.log("Tool Result (dummy):", toolResult);
    } else if (plan) {
      console.log("Action    :", plan.action); // Should be general_chat if params are not in expected shape
      if(plan.params && 'reasoning' in plan.params && typeof plan.params.reasoning === 'string'){
         console.log("Reasoning :", plan.params.reasoning);
      } else if (plan.params) {
        console.log("Params    :", plan.params)
      }
    } else {
      console.log("Failed to generate a plan for the input.");
    }
  }
}
*/

// Uncomment to run: pnpm exec ts-node src/lib/planner.ts
//testPlanner();
