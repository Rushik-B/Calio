import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ConversationTurn } from "@prisma/client";
import {
  OrchestratorDecision,
  ICAOutput,
  // OrchestratorActionType, // Not directly used here anymore, inferred by AWD
  // DeletionCandidate, // Handled by AWD if needed
  // WorkflowDefinition, // Defined by AWD
} from "../types/orchestrator";
import { ZodError, z } from "zod"; // For parsing LLM JSON output
import fs from "fs"; // Using fs directly for prompt reading
import path from "path";

// Environment variables should be loaded by the main application process

const ICA_PROMPT_PATH = path.join(process.cwd(), 'src', 'prompts', 'intentContextAnalyzerPrompt.md');
const AWD_PROMPT_PATH = path.join(process.cwd(), 'src', 'prompts', 'orchestratorDecompositionPrompt.md');

// LLM for Intent & Context Analysis
const icaLLM = new ChatGoogleGenerativeAI({
  model: "gemini-1.5-flash-latest", // Or your preferred model
  temperature: 0.2, // Fine-tune as needed
});

// LLM for Action & Workflow Decomposition
const awdLLM = new ChatGoogleGenerativeAI({
  model: "gemini-1.5-flash-latest", // Or your preferred model
  temperature: 0.3, // Fine-tune as needed
});

// Schema for the ICA-LLM's expected JSON output (subset of what's in the prompt for validation here)
const icaOutputSchema: z.ZodType<ICAOutput> = z.object({
  analysis: z.object({
    isFollowUp: z.boolean(),
    followUpType: z.string(),
    certainty: z.string(),
  }),
  currentUserMessage: z.string(),
  reconstructedUserInputForPlanner: z.string().nullable(),
  originalRequestContext: z.object({
    assistantLastRelevantTurnNumber: z.number().nullable().optional(),
    assistantLastResponseSummary: z.string().nullable().optional(),
    originalUserQueryText: z.string().nullable().optional(),
    relatedActionTypeFromHistory: z.string().nullable().optional(),
  }).nullable(),
  entitiesInCurrentMessage: z.array(z.string()),
  userIntentSummary: z.string(),
  requiresImmediatePlannerCall: z.boolean(),
  historyForAWD: z.string().nullable(),
  userTimezone: z.string(),
  userCalendarsFormatted: z.string(),
  timezoneInfo: z.object({
    timezone: z.string(),
    offset: z.string(),
    userLocalTime: z.string(),
    currentTimeInUserTZ: z.string(),
    dates: z.object({
      today: z.string(),
      tomorrow: z.string(),
      yesterday: z.string(),
    }),
    isoStrings: z.object({
      todayStart: z.string(),
      todayEnd: z.string(),
      tomorrowStart: z.string(),
      tomorrowEnd: z.string(),
      yesterdayStart: z.string(),
      yesterdayEnd: z.string(),
      currentTime: z.string(),
    }),
  }),
});

// Schema for the AWD-LLM's expected JSON output (main orchestrator decision)
const awdOutputSchema = z.object({
  actionType: z.enum([
    "call_planner",
    "fetch_context_and_call_planner",
    "respond_directly",
    "ask_user_question",
    "ask_user_clarification_for_tool_ambiguity", // Retaining for potential AWD use
    "perform_google_calendar_action",
    "execute_workflow",
  ]).optional(),
  params: z.any().optional(), // Allow any params, specific tools will validate
  workflowDefinition: z.object({
    name: z.string(),
    description: z.string().optional(),
    tasks: z.array(z.object({
      id: z.string(),
      taskType: z.string(),
      params: z.any().optional(),
      dependsOn: z.array(z.string()).optional(),
      humanSummary: z.string().optional(),
      outputVariable: z.string().optional(), // Added for completeness
      status: z.enum(['pending', 'ready', 'running', 'completed', 'failed', 'waiting_for_user']).optional(),
      result: z.any().optional(),
      retries: z.number().optional(),
    }))
  }).nullable().optional(),
  responseText: z.string().nullable().optional(),
  reasoning: z.string().optional(),
  clarificationContextToSave: z.null().describe("MUST ALWAYS be null."), // Enforce null
});

//OG

// Makes a nice string of the conversation history for the LLM to see
function formatConversationHistoryForPrompt(history: ConversationTurn[]): string {
  const HISTORY_LENGTH = 20; // Max turns to include
  if (!history || history.length === 0) {
    return "No previous conversation history.";
  }

  const trimmedHistory = history.length > HISTORY_LENGTH ? history.slice(-HISTORY_LENGTH) : history;

  const formattedTurns = trimmedHistory
    .map((turn) => {
      const turnPrefix = `Turn ${turn.turnNumber} (${turn.actor}):`; // Simplified prefix
      let messageText = turn.messageText;

      if (turn.actor === "ASSISTANT") {
        let actionSummary = "";
        if (turn.toolCalled) {
          actionSummary = `[Action: Called tool '${turn.toolCalled}'.`;
          if (turn.toolResult) {
            let resultSummary = "Processed tool result."; // Default summary

            if (typeof turn.toolResult === 'string' && turn.toolResult.length < 150) {
              resultSummary = turn.toolResult;
            } else if (Array.isArray(turn.toolResult)) {
              if (turn.toolResult.length > 0) {
                const firstItem = turn.toolResult[0];
                // Check if firstItem is an object and has a summary property
                if (typeof firstItem === 'object' && firstItem !== null && 'summary' in firstItem && typeof (firstItem as any).summary === 'string') {
                  resultSummary = `Result included event(s): ${turn.toolResult.map((e: any) => e.summary || 'Unnamed Event').join(', ')}.`;
                } else if (turn.toolResult.length === 1 && typeof firstItem === 'string' && firstItem.length < 100) {
                  resultSummary = `Result: ${firstItem}`;
                } else {
                  resultSummary = `Received ${turn.toolResult.length} items.`;
                }
              } else {
                resultSummary = "Received an empty list/array.";
              }
            } else if (typeof turn.toolResult === 'object' && turn.toolResult !== null) {
              const toolResultObj = turn.toolResult as any; // Cast to any to check for properties
              if (toolResultObj.message && typeof toolResultObj.message === 'string' && toolResultObj.message.length < 100) {
                resultSummary = toolResultObj.message;
              } else if (toolResultObj.id && toolResultObj.summary && typeof toolResultObj.summary === 'string') { // For single created event details
                resultSummary = `Event '${toolResultObj.summary}' (ID: ${toolResultObj.id}).`;
              } else if (toolResultObj.createdEventsDetails && Array.isArray(toolResultObj.createdEventsDetails)) {
                // Handle created events details from CreateEventExecutionResult
                const eventDetails = toolResultObj.createdEventsDetails.map((event: any) => {
                  const startTime = event.start?.dateTime || event.start?.date || 'unknown time';
                  return `'${event.summary || 'Untitled Event'}' (ID: ${event.id}) at ${startTime}`;
                }).join(', ');
                resultSummary = `Created event(s): ${eventDetails}.`;
              } else if (Object.keys(toolResultObj).length > 0 && Object.keys(toolResultObj).length < 4) {
                 resultSummary = JSON.stringify(toolResultObj); // Short JSON objects
              }
            }
            actionSummary += ` ${resultSummary}]`;
          } else {
            actionSummary += " No result available.]";
          }
          messageText += `\n${actionSummary}`;
        }
        
        // DEPRECATED: clarificationContext is no longer used for primary state management.
        // Rely on LLM analyzing conversation history for follow-ups.
        // The requiresFollowUp field still signals if the assistant asked a question.
        if (turn.requiresFollowUp) {
            messageText += `\n[Hint: Assistant was waiting for user input, likely related to its previous message.]`;
        }
      }
      return `${turnPrefix} ${messageText}`;
    })
    .join("\n\n"); // Use double newline for better readability between turns

  return `CONVERSATION HISTORY (Most Recent Turn Last, Max ${HISTORY_LENGTH} Turns):\n${formattedTurns}\n--- END OF HISTORY ---`;
}

// Helper function to calculate timezone offset for the user's timezone using proper method
function getTimezoneOffset(timezone: string): string {
  const date = new Date();
  
  // Create formatter that includes timezone offset
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    timeZoneName: 'longOffset'
  });
  
  // Extract the offset from the formatted string
  const parts = formatter.formatToParts(date);
  const offsetPart = parts.find(part => part.type === 'timeZoneName');
  
  if (offsetPart && offsetPart.value.startsWith('GMT')) {
    // Extract offset like "GMT-07:00" -> "-07:00"
    return offsetPart.value.substring(3);
  }
  
  // Fallback method
  const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const local = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  const offsetMs = local.getTime() - utc.getTime();
  const offsetMinutes = Math.floor(offsetMs / (1000 * 60));
  
  const hours = Math.floor(Math.abs(offsetMinutes) / 60);
  const minutes = Math.abs(offsetMinutes) % 60;
  const sign = offsetMinutes >= 0 ? '+' : '-';
  
  return `${sign}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

// Comprehensive timezone calculation function - this is the ONLY place where timezone calculations should happen
function calculateTimezoneInfo(userTimezone: string) {
  const now = new Date();
  
  // Calculate current time in user's timezone
  const userLocalTime = new Intl.DateTimeFormat('en-CA', {
    timeZone: userTimezone,
    year: 'numeric',
    month: '2-digit', 
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(now);
  
  // Calculate timezone offset
  const timezoneOffset = getTimezoneOffset(userTimezone);
  
  // Parse the user's current date to calculate today, tomorrow, yesterday
  // Handle both formats: "2025-05-23, 15:12:07" and "2025-05-23 15:12:07"
  const normalizedTime = userLocalTime.replace(', ', ' ');
  const [datePart, timePart] = normalizedTime.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = timePart.split(':').map(Number);
  
  // Create date objects for calculations (in user's timezone)
  const userToday = new Date(year, month - 1, day);
  const userTomorrow = new Date(year, month - 1, day + 1);
  const userYesterday = new Date(year, month - 1, day - 1);
  
  // Format dates for use in ISO strings
  const formatDate = (date: Date) => {
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
  };
  
  const todayDate = formatDate(userToday);
  const tomorrowDate = formatDate(userTomorrow);
  const yesterdayDate = formatDate(userYesterday);
  
  // Create common ISO strings that LLMs will need
  const currentTimeInUserTZ = `${datePart}T${timePart}${timezoneOffset}`;
  const todayStart = `${todayDate}T00:00:00${timezoneOffset}`;
  const todayEnd = `${todayDate}T23:59:59${timezoneOffset}`;
  const tomorrowStart = `${tomorrowDate}T00:00:00${timezoneOffset}`;
  const tomorrowEnd = `${tomorrowDate}T23:59:59${timezoneOffset}`;
  const yesterdayStart = `${yesterdayDate}T00:00:00${timezoneOffset}`;
  const yesterdayEnd = `${yesterdayDate}T23:59:59${timezoneOffset}`;
  
  return {
    timezone: userTimezone,
    offset: timezoneOffset,
    userLocalTime,
    currentTimeInUserTZ,
    dates: {
      today: todayDate,
      tomorrow: tomorrowDate,
      yesterday: yesterdayDate
    },
    isoStrings: {
      todayStart,
      todayEnd,
      tomorrowStart,
      tomorrowEnd,
      yesterdayStart,
      yesterdayEnd,
      currentTime: currentTimeInUserTZ
    }
  };
}

async function invokeLLM(llm: ChatGoogleGenerativeAI, systemPrompt: string, userMessage: string): Promise<string> {
  const messages = [new SystemMessage(systemPrompt), new HumanMessage(userMessage)];
  const result = await llm.invoke(messages);
  let llmOutputText = "";
  if (typeof result.content === "string") {
    llmOutputText = result.content;
  } else if (Array.isArray(result.content)) {
    llmOutputText = result.content
      .filter((part) => part.type === "text")
      .map((part) => (part as any).text)
      .join("");
  }
  return llmOutputText.trim().replace(/^```json\s*/, "").replace(/\s*```$/, "");
}

export async function getNextAction(
  conversationHistory: ConversationTurn[],
  currentUserMessage: string,
  userTimezone: string,
  userCalendarsFormatted: string,
  isClarificationRequest?: boolean // This flag is now mainly for system-initiated clarifications, not direct ICA output control
): Promise<OrchestratorDecision> {
  const formattedHistory = formatConversationHistoryForPrompt(conversationHistory);
  const timezoneInfo = calculateTimezoneInfo(userTimezone);

  let icaSystemPrompt: string;
  try {
    icaSystemPrompt = fs.readFileSync(ICA_PROMPT_PATH, 'utf8');
  } catch (error) {
    console.error("[CentralOrchestratorLLM] FATAL: Could not read ICA prompt from ", ICA_PROMPT_PATH, error);
    // Fallback to a very basic prompt if file read fails, to prevent total crash
    icaSystemPrompt = "You are an intent analyzer. Analyze the user message in context of history. Output JSON.";
  }
  
  // Prepare ICA-LLM input specifically
  const icaPromptInputForSystem = `## Inputs:
1. currentUserMessage: ${JSON.stringify(currentUserMessage)}
2. conversationHistory:
${formattedHistory}
3. userTimezone: ${JSON.stringify(userTimezone)}
4. userCalendarsFormatted: ${JSON.stringify(userCalendarsFormatted)}
5. timezoneInfo: ${JSON.stringify(timezoneInfo)}

Your task is to provide a JSON output based on these inputs, adhering to the schema and instructions in your main system prompt.`;

  console.log("[CentralOrchestratorLLM] Invoking ICA-LLM for Intent & Context Analysis");
  let icaRawOutput: string;
  let icaParsedOutput: ICAOutput;

  try {
    icaRawOutput = await invokeLLM(icaLLM, icaSystemPrompt, icaPromptInputForSystem);
    console.log("[CentralOrchestratorLLM] ICA-LLM Raw Output Length:", icaRawOutput.length);
    icaParsedOutput = icaOutputSchema.parse(JSON.parse(icaRawOutput));
    console.log("[CentralOrchestratorLLM] ICA-LLM Output Parsed & Validated Successfully");
  } catch (error) {
    console.error("[CentralOrchestratorLLM] Error during ICA-LLM call or parsing:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown ICA error";
    return {
      actionType: "respond_directly",
      responseText: `I had a problem understanding the context of your message (ICA Error: ${errorMessage.substring(0,100)}). Could you please try rephrasing?`,
      reasoning: `ICA-LLM processing failed: ${errorMessage}`,
      clarificationContextToSave: null,
      timezoneInfo: timezoneInfo,
    };
  }

  // --- AWD-LLM Call --- 
  let awdSystemPrompt: string;
  try {
    awdSystemPrompt = fs.readFileSync(AWD_PROMPT_PATH, 'utf8');
  } catch (error) {
    console.error("[CentralOrchestratorLLM] FATAL: Could not read AWD prompt from ", AWD_PROMPT_PATH, error);
    awdSystemPrompt = "You are an action decomposer. Decide action based on pre-analyzed input. Output JSON.";
  }

  // Prepare AWD-LLM input, which is the output of ICA-LLM plus AWD's own prompt instructions
  const awdPromptInputForSystem = `## Pre-analysis from Intent & Context Analyzer (ICA-LLM):
${JSON.stringify(icaParsedOutput, null, 2)}

Based on this analysis and your main system prompt instructions, determine the final action or workflow.`;
  
  console.log("[CentralOrchestratorLLM] Invoking AWD-LLM for Action & Workflow Decomposition");
  let awdRawOutput: string;
  let awdParsedOutput: Partial<OrchestratorDecision>; // Using partial as some fields are filled later

  try {
    awdRawOutput = await invokeLLM(awdLLM, awdSystemPrompt, awdPromptInputForSystem);
    console.log("[CentralOrchestratorLLM] AWD-LLM Raw Output Length:", awdRawOutput.length);
    const tempAwdParsed = JSON.parse(awdRawOutput);
    awdParsedOutput = awdOutputSchema.parse(tempAwdParsed) as Partial<OrchestratorDecision>;
    console.log("[CentralOrchestratorLLM] AWD-LLM Output Parsed & Validated Successfully");
  } catch (error) {
    console.error("[CentralOrchestratorLLM] Error during AWD-LLM call or parsing:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown AWD error";
    return {
      actionType: "respond_directly",
      responseText: `I had a problem deciding on the next step (AWD Error: ${errorMessage.substring(0,100)}). Could you try again?`,
      reasoning: `AWD-LLM processing failed: ${errorMessage}`,
      clarificationContextToSave: null,
      timezoneInfo: timezoneInfo, // Pass along timezoneInfo
    };
  }

  // Construct the final OrchestratorDecision
  const finalDecision: OrchestratorDecision = {
    actionType: awdParsedOutput.actionType,
    params: awdParsedOutput.params || (awdParsedOutput.actionType === 'call_planner' && icaParsedOutput.reconstructedUserInputForPlanner ? { userInput: icaParsedOutput.reconstructedUserInputForPlanner } : {}),
    workflowDefinition: awdParsedOutput.workflowDefinition,
    responseText: awdParsedOutput.responseText,
    reasoning: awdParsedOutput.reasoning || `ICA: ${icaParsedOutput.userIntentSummary}`, // Combine reasonings
    clarificationContextToSave: null, // Always null as per new design
    timezoneInfo: timezoneInfo, // Carry over the timezone info
  };

  // If AWD decides to call planner, but ICA already reconstructed the input, ensure it's used.
  if (finalDecision.actionType === "call_planner" && 
      icaParsedOutput.reconstructedUserInputForPlanner && 
      (!finalDecision.params?.userInput || finalDecision.params.userInput !== icaParsedOutput.reconstructedUserInputForPlanner)) {
    finalDecision.params = { 
      ...(finalDecision.params || {}), 
      userInput: icaParsedOutput.reconstructedUserInputForPlanner 
    };
    console.log("[CentralOrchestratorLLM] Ensured reconstructedUserInputForPlanner is used for call_planner action.");
  }
  // If AWD doesn't specify userInput for call_planner, and ICA didn't reconstruct, use original.
  else if (finalDecision.actionType === "call_planner" && !finalDecision.params?.userInput) {
     finalDecision.params = { 
      ...(finalDecision.params || {}), 
      userInput: currentUserMessage 
    };
    console.log("[CentralOrchestratorLLM] Used original currentUserMessage for call_planner action as no reconstruction was available.");
  }

  console.log("[CentralOrchestratorLLM] Final Orchestrator Decision type:", 
    finalDecision.workflowDefinition ? "Workflow" : finalDecision.actionType);
  if (finalDecision.workflowDefinition) {
    console.log("[CentralOrchestratorLLM] Workflow details:", {
      name: finalDecision.workflowDefinition.name,
      taskCount: finalDecision.workflowDefinition.tasks.length,
      taskTypes: finalDecision.workflowDefinition.tasks.map(t => t.taskType)
    });
  }

  return finalDecision;
}