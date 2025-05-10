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
const P_PROMPT_PATH = path.resolve(__dirname, "../prompts/calendar.md");
const MASTER_PROMPT = fs.readFileSync(P_PROMPT_PATH, "utf-8");

//--------------------------------------------------
// 1.  Imports & Zod validation schema
//--------------------------------------------------
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

/**
 * Zod — for **runtime validation** *after* Gemini responds.
 */
const calendarActionSchema = z.object({
  action: z.enum([
    "create_event",
    "list_events",
    "update_event",
    "delete_event",
    "unknown",
  ]),
  params: z
    .object({
      summary: z.string().optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
      attendees: z.array(z.string()).optional(),
      eventId: z.string().optional(),
      // Allow other params in Zod for flexibility during parsing, 
      // even if not strictly defined in the JSON schema sent to LLM.
    }).catchall(z.any())
    .optional(),
  reasoning: z.string().optional(),
});
export type CalendarAction = z.infer<typeof calendarActionSchema>;

/**
 * Flat JSON-Schema — no $ref, no definitions.
 * This is what we actually ship to Gemini.
 */
const jsonParameters = {
  type: "object",
  properties: {
    action: {
      type: "string",
      description: "Type of calendar operation",
      enum: [
        "create_event",
        "list_events",
        "update_event",
        "delete_event",
        "unknown",
      ],
    },
    params: {
      type: "object",
      description: "Action-specific parameters. Include relevant details like summary, startTime, endTime, attendees, eventId etc., based on the user query and the chosen action. For create_event, startTime and endTime are crucial.",
      properties: {
        summary: { type: "string", description: "The summary or title of the event." },
        startTime: { type: "string", description: "The start date and time of the event in ISO 8601 format (e.g., YYYY-MM-DDTHH:mm:ssZ)." },
        endTime: { type: "string", description: "The end date and time of the event in ISO 8601 format. Required for creating events. If the user doesn't specify a duration, assume a 1-hour duration." },
        attendees: { type: "array", items: { type: "string" }, description: "List of attendee email addresses or names." },
        eventId: { type: "string", description: "The ID of the event to update or delete." },
        // Adding a generic query parameter for list_events
        query: { type: "string", description: "A general query string for searching events, used with list_events." },
        timeMin: { type: "string", description: "The minimum start time for listing events (ISO 8601 format), used with list_events." },
        timeMax: { type: "string", description: "The maximum start time for listing events (ISO 8601 format), used with list_events." },
      },
      // Temporarily allow additionalProperties for params to see if LLM returns more data
      additionalProperties: true, 
      required: ["startTime", "endTime"] // Tentatively make endTime required here for create_event
      // We'll handle the defaulting logic in CreateEventTool if LLM omits it despite this.
    },
    reasoning: {
      type: "string",
      description: "Brief reasoning for why this action and parameters were selected.",
    },
  },
  required: ["action"],
  additionalProperties: false, // Keep this false for the outer object
} as const;

//--------------------------------------------------
// 2.  Set up Gemini with the function tool
//--------------------------------------------------
const model = new ChatGoogleGenerativeAI({
  model: "gemini-1.5-flash-latest",
  temperature: 0.2,
});

const llmWithTools = model.bind({
  tools: [
    {
      type: "function",
      function: {
        name: "calendar_action_planner",
        description:
          "Return the calendar action the user wants and any parameters. Infer date/time details carefully.", // Slightly more guidance
        parameters: jsonParameters,
      },
    },
  ],
  tool_choice: { type: "function", function: { name: "calendar_action_planner" } },
});

//--------------------------------------------------
// 3.  Main helper
//--------------------------------------------------
export async function generatePlan(
  text: string,
  currentTimeISO?: string
): Promise<CalendarAction | null> {
  console.log(`[Planner] Received text: "${text}"`);
  if (currentTimeISO) {
    console.log(`[Planner] Current time context: ${currentTimeISO}`);
  }

  try {
    let systemPromptContent = MASTER_PROMPT;
    if (currentTimeISO) {
      // More detailed instruction for the LLM about handling timezones, complementing calendar.md
      const currentTimeMessage = `SYSTEM NOTE: Current date and time is ${currentTimeISO} (UTC). Interpret relative dates (e.g., 'tomorrow') based on this UTC time. For times of day (e.g., '3 pm') provided by the user without an explicit timezone, assume they refer to a common local time (e.g., US Eastern Time for general North American context if no other cues). However, you MUST ensure that the final startTime and endTime parameters you generate are fully resolved to UTC in ISO 8601 format.`;
      systemPromptContent = `${currentTimeMessage}\n\n${MASTER_PROMPT}`;
    }

    const messages = [
      new SystemMessage(systemPromptContent),
      new HumanMessage(text),
    ];
    const result = await llmWithTools.invoke(messages);
    console.log('[Planner] LLM Result (raw):', JSON.stringify(result, null, 2)); // Log the raw result

    let args: unknown; // Changed from any to unknown

    const toolCall = result.tool_calls?.[0];

    if (toolCall && toolCall.args) {
      console.log("[Planner] Found tool call in LLM response.");
      args = toolCall.args;
    } else if (typeof result.content === 'string') {
      console.log("[Planner] No tool call, attempting to parse content as JSON.");
      try {
        // Extract JSON from ```json ... ``` or if it's plain JSON
        const contentStr = result.content;
        const jsonMatch = contentStr.match(/```json\n([\s\S]*?)\n```/);
        const jsonToParse = jsonMatch ? jsonMatch[1] : contentStr;
        args = JSON.parse(jsonToParse);
      } catch (e) {
        console.error("[Planner] Failed to parse content as JSON:", e);
        console.error("[Planner] Raw content from LLM:", result.content);
        return null;
      }
    } else {
      console.error("[Planner] No function call or parsable content in LLM response.");
      return null;
    }

    // Use your updated calendarActionSchema for parsing
    const parsed = calendarActionSchema.safeParse(args);

    if (!parsed.success) {
      console.error("[Planner] Validation error:", parsed.error.format());
      console.error("[Planner] Raw arguments from LLM:", args); // Log the raw args if Zod fails
      return null;
    }

    console.log("[Planner] Parsed action:", parsed.data);
    return parsed.data;
  } catch (err) {
    console.error("[Planner] Error generating plan:", err);
    return null;
  }
}

//--------------------------------------------------
// 4.  Quick test runner (Removed as it's unused)
//--------------------------------------------------
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
    const plan = await generatePlan(input, nowISO);

    console.log("\n--- Test Planner Output ---");
    if (plan && plan.params) {
      console.log("Action    :", plan.action);
      console.log("Params    :", plan.params);
      console.log("Reasoning :", plan.reasoning);

      let toolResult = "No specific tool execution for this action.";

      // Dummy values for testing tool instantiation
      const DUMMY_USER_ID = "test-user-id";
      const DUMMY_ACCESS_TOKEN = "test-access-token";

      if (plan.action === "create_event") {
        const validatedParams = createEventParamsSchema.safeParse(plan.params);
        if (validatedParams.success) {
          const createTool = new CreateEventTool(DUMMY_USER_ID, DUMMY_ACCESS_TOKEN);
          toolResult = await createTool.call(validatedParams.data);
        } else {
          toolResult = "Parameter validation failed for CreateEventTool: " + validatedParams.error.format();
          console.error("CreateEventTool param validation error:", validatedParams.error.format());
        }
      } else if (plan.action === "list_events") {
        const validatedParams = listEventsParamsSchema.safeParse(plan.params);
        if (validatedParams.success) {
          const listTool = new ListEventsTool(DUMMY_USER_ID, DUMMY_ACCESS_TOKEN);
          toolResult = await listTool.call(validatedParams.data);
        } else {
          toolResult = "Parameter validation failed for ListEventsTool: " + validatedParams.error.format();
          console.error("ListEventsTool param validation error:", validatedParams.error.format());
        }
      } else if (plan.action === "update_event") {
        const validatedParams = updateEventParamsSchema.safeParse(plan.params);
        if (validatedParams.success) {
          const updateTool = new UpdateEventTool(DUMMY_USER_ID, DUMMY_ACCESS_TOKEN);
          toolResult = await updateTool.call(validatedParams.data);
        } else {
          toolResult = "Parameter validation failed for UpdateEventTool: " + validatedParams.error.format();
          console.error("UpdateEventTool param validation error:", validatedParams.error.format());
        }
      } else if (plan.action === "delete_event") {
        const validatedParams = deleteEventParamsSchema.safeParse(plan.params);
        if (validatedParams.success) {
          const deleteTool = new DeleteEventTool(DUMMY_USER_ID, DUMMY_ACCESS_TOKEN);
          toolResult = await deleteTool.call(validatedParams.data);
        } else {
          toolResult = "Parameter validation failed for DeleteEventTool: " + validatedParams.error.format();
          console.error("DeleteEventTool param validation error:", validatedParams.error.format());
        }
      } // Add more else if blocks for other tools if necessary

      console.log("Tool Result:", toolResult);
    } else if (plan) {
      console.log("Action    :", plan.action);
      console.log("Reasoning :", plan.reasoning);
    } else {
      console.log("Failed to generate a plan for the input.");
    }
  }
}
*/

// Uncomment to run: pnpm exec ts-node src/lib/planner.ts
//testPlanner();
