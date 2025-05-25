import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ConversationTurn } from "@prisma/client";
import {
  OrchestratorDecision,
  OrchestratorActionType,
  DeletionCandidate,
  WorkflowDefinition,
} from "../types/orchestrator";
import { ZodError } from "zod";
import { z } from "zod"; // For parsing LLM JSON output

// Environment variables should be loaded by the main application process (e.g., in route.ts or a global setup)
// Ensure GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY is available in the environment.


//OG

const orchestratorLLM = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash",
  temperature: 0.3, // Lower temperature for more predictable decisions
});

// Schema for the expected JSON output from the LLM for its decision
const llmDecisionSchema = z.object({
  // For simple actions (backward compatibility)
  actionType: z.enum([
    "call_planner",
    "fetch_context_and_call_planner",
    "respond_directly",
    "ask_user_question",
    "ask_user_clarification_for_tool_ambiguity",
    "perform_google_calendar_action",
    "execute_workflow", // New: Indicates a workflow should be executed
  ]).optional(),
  params: z
    .object({
      userInput: z.string().optional(), // User input might be passed to planner
      originalRequestNature: z
        .enum(["singular", "plural_or_unspecified"])
        .nullable()
        .optional(), // Hint for deletion requests
      // Fields for when actionType is 'ask_user_clarification_for_tool_ambiguity'
      // The candidates themselves are passed in the main prompt to the LLM in this flow
      // but LLM might decide to put some processed version or original query here.
      originalUserQueryForClarification: z.string().optional(),
      // Params for perform_google_calendar_action
      GCToolName: z.string().optional(),
      GCToolArgs: z.any().optional(),
      // Params for fetch_context_and_call_planner
      contextQuery: z.string().optional(),
      contextTimeMin: z.string().optional(),
      contextTimeMax: z.string().optional(),
      contextCalendarIds: z.array(z.string()).nullable().optional(),
      timeMin: z.string().nullable().optional(),
      timeMax: z.string().nullable().optional(),
      anchorEventsContext: z
        .array(
          z.object({
            summary: z.string(),
            start: z.string(),
            end: z.string(),
            calendarId: z.string(),
          })
        )
        .nullable()
        .optional(),
    })
    .passthrough()
    .optional(),
  
  // For complex workflows (new capability)
  workflowDefinition: z.object({
    name: z.string(),
    description: z.string().optional(),
    tasks: z.array(z.object({
      id: z.string(),
      taskType: z.string(),
      params: z.any().optional(),
      dependsOn: z.array(z.string()).optional(),
      humanSummary: z.string().optional(),
      outputVariable: z.string().optional(),
      status: z.enum(['pending', 'ready', 'running', 'completed', 'failed', 'waiting_for_user']).optional(),
      result: z.any().optional(),
      retries: z.number().optional(),
    }))
  }).nullable().optional(),
  
  // Common fields
  responseText: z.string().nullable().optional(),
  reasoning: z.string().optional(),
  // We need a way for the LLM to suggest what to save for context if it asks a question
  // This will be structured by the calling route based on OrchestratorDecision type from `../types/orchestrator`
  // THIS FIELD IS DEPRECATED AND WILL BE REMOVED. RELY ON CONVERSATIONAL HISTORY ANALYSIS.
  clarificationContextToSave: z.any().optional(), 
});

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

export async function getNextAction(
  conversationHistory: ConversationTurn[],
  currentUserMessage: string,
  userTimezone: string,
  userCalendarsFormatted: string,
  isClarificationRequest?: boolean // New optional flag
): Promise<OrchestratorDecision> {
  const formattedHistory = formatConversationHistoryForPrompt(conversationHistory);
  
  // CENTRALIZED TIMEZONE CALCULATION - This is the ONLY place where timezone calculations happen
  const timezoneInfo = calculateTimezoneInfo(userTimezone);
  
  // WORKFLOW PAUSED DETECTION - Check if we need to resume a paused workflow
  // This is the ONLY clarificationContext mode we still support for workflow state management
  const lastAssistantTurnWithContext = conversationHistory
    .slice()
    .reverse()
    .find(turn => 
      turn.actor === 'ASSISTANT' && 
      turn.clarificationContext && 
      typeof turn.clarificationContext === 'object' &&
      !Array.isArray(turn.clarificationContext) &&
      (turn.clarificationContext as any).type === 'workflow_paused'
    );

  if (lastAssistantTurnWithContext?.clarificationContext && 
      typeof lastAssistantTurnWithContext.clarificationContext === 'object' &&
      !Array.isArray(lastAssistantTurnWithContext.clarificationContext) &&
      (lastAssistantTurnWithContext.clarificationContext as any).type === 'workflow_paused') {
    // Check if this is a recent workflow pause (within last 3 turns)
    const lastAssistantTurnIndex = conversationHistory.findIndex(turn => turn.id === lastAssistantTurnWithContext.id);
    const isRecentPause = lastAssistantTurnIndex >= conversationHistory.length - 3;
    
    if (isRecentPause) {
      console.log("[CentralOrchestratorLLM] Mode: Workflow Resumption - Detected recent workflow_paused context");
      const contextObj = lastAssistantTurnWithContext.clarificationContext as any;
      return {
        actionType: "execute_workflow",
        params: {
          userInput: currentUserMessage,
          resumeFromPaused: true,
          pausedTaskId: contextObj.pausedTaskId,
          workflowState: contextObj.workflowState
        },
        responseText: null,
        reasoning: "Resuming paused workflow based on user response",
        clarificationContextToSave: null,
        timezoneInfo: timezoneInfo,
      };
    } else {
      console.log("[CentralOrchestratorLLM] Found old workflow_paused context, treating as regular conversation");
    }
  }
  
  let systemPromptContent: string;

  // DEPRECATED: activeClarificationContext is no longer used for primary state management.
  // The LLM will rely on conversation history analysis as per the main prompt.

  // Handle system-initiated clarification request generation FIRST
  if (isClarificationRequest) {
    /* -------------------------------------------------------------------------- */
    /*            Mode: System-initiated Clarification Question Generation        */
    /* -------------------------------------------------------------------------- */
    console.log("[CentralOrchestratorLLM] Mode: System-initiated Clarification Question Generation");
    systemPromptContent = `You are a helpful calendar assistant. The system requires you to ask the user a question to resolve an ambiguity or get more information.
    Based on the following system request, formulate a clear and concise question for the user.
    System Request Details: ${currentUserMessage}
    User's Timezone: ${userTimezone}
    Focus on asking the question naturally. The user's actual response will be handled in a subsequent turn where the main orchestrator analyzes the conversation history.
    Output your question in the 'responseText' field of the JSON object.
    Example output:
    {
      "actionType": "ask_user_question",
      "responseText": "<Your formulated question to the user>",
      "reasoning": "Formulating question based on system request for clarification.",
      "clarificationContextToSave": null 
    }
    `;
  } else {
    /* -------------------------------------------------------------------------- */
    /*      Mode: Standard Request Processing (Handles history analysis)         */
    /* -------------------------------------------------------------------------- */
    console.log("[CentralOrchestratorLLM] Mode: Standard Request Processing with History Analysis");
    let baseWorkflowPrompt = "";
    try {
      const fs = require('fs');
      const path = require('path');
      const promptPath = path.join(process.cwd(), 'src/prompts/orchestratorDecompositionPrompt.md');
      baseWorkflowPrompt = fs.readFileSync(promptPath, 'utf8');
    } catch (error) {
      console.error("[CentralOrchestratorLLM] Could not read orchestratorDecompositionPrompt.md:", error);
      baseWorkflowPrompt = `# Basic Calendar Assistant Orchestrator\n\nYou are a calendar assistant. Decide the best action based on conversation history.`;
    }

    systemPromptContent = `${baseWorkflowPrompt}\n\n## Current Context for Decision Making\nUser's Timezone: ${userTimezone}\nUser's Available Calendars: ${userCalendarsFormatted || "Not available"}\nCurrent Date/Time (in User's TZ): ${timezoneInfo.userLocalTime} (Offset: ${timezoneInfo.offset})\nPre-calculated Timezone ISO Strings (Today, Tomorrow, etc.): ${JSON.stringify(timezoneInfo.isoStrings)}\n\n${formattedHistory}\n\n## Current User Message\n"${currentUserMessage}"\n\n## IMPORTANT ANALYSIS INSTRUCTIONS\nFollow ALL instructions from the main prompt above (regarding CRITICAL follow-up handling, CRITICAL conversational context analysis, complexity assessment, workflow decomposition, and output format). Ensure your output is a single, valid JSON object.`;

    if (!baseWorkflowPrompt || baseWorkflowPrompt.length < 100) {
      systemPromptContent = `You are a top-level AI orchestrator for a calendar assistant.\n      User's Timezone: ${userTimezone}\n      Current Time: ${timezoneInfo.userLocalTime}\n      ${formattedHistory}\n      User Message: "${currentUserMessage}"\n      Respond with valid JSON for a simple action or workflow. Pay close attention to the history for follow-ups and contextual references.`;
    }
  }

  console.log("[CentralOrchestratorLLM] Processing mode:", isClarificationRequest ? "System-initiated Clarification" : "Standard Analysis with History");

  // Complexity analysis for standard mode (i.e., not system-initiated clarification)
  let complexityScore = 0;
  let complexityIndicators: string[] = [];
  
  if (!isClarificationRequest) {
    console.log("[CentralOrchestratorLLM] Analyzing query complexity for:", currentUserMessage);
    
    const multiStepPatterns = [
      /\b(and then|after that|then|next|also|additionally|plus)\b/gi,
      /\b(first.*then|step.*step|1\..*2\.)\b/gi
    ];
    const conditionalPatterns = [
      /\b(if|unless|but don't|except|only if|provided that|when|while|as long as)\b/gi,
      /\b(avoid|don't.*if|unless.*then)\b/gi
    ];
    const batchPatterns = [
      /\b(all|every|each|any|multiple|batch|several)\b.*\b(events?|meetings?|appointments?)\b/gi,
      /\b(events?|meetings?|appointments?)\b.*\b(all|every|each|multiple)\b/gi
    ];
    const crossCalendarPatterns = [
      /\b(work and personal|personal and work|both calendars|sync.*calendar)\b/gi,
      /\b(calendar.*calendar|work.*personal|personal.*work)\b/gi
    ];
    const preferencePatterns = [
      /\b(usual|normal|typical|avoid|don't.*during|my.*time|preferred)\b/gi,
      /\b(gym|lunch|writing|focus|block|routine)\b/gi
    ];
    const timeRelationPatterns = [
      /\b(after work|before lunch|during|around|between.*and)\b/gi,
      /\b(morning|afternoon|evening|when.*free|available)\b/gi
    ];
    
    if (multiStepPatterns.some(pattern => pattern.test(currentUserMessage))) { complexityScore += 2; complexityIndicators.push("Multiple steps"); }
    if (conditionalPatterns.some(pattern => pattern.test(currentUserMessage))) { complexityScore += 2; complexityIndicators.push("Conditional logic"); }
    if (batchPatterns.some(pattern => pattern.test(currentUserMessage))) { complexityScore += 1; complexityIndicators.push("Batch operations"); }
    if (crossCalendarPatterns.some(pattern => pattern.test(currentUserMessage))) { complexityScore += 1; complexityIndicators.push("Cross-calendar"); }
    if (preferencePatterns.some(pattern => pattern.test(currentUserMessage))) { complexityScore += 1; complexityIndicators.push("User preferences"); }
    if (timeRelationPatterns.some(pattern => pattern.test(currentUserMessage))) { complexityScore += 1; complexityIndicators.push("Time relations"); }
    
    console.log(`[CentralOrchestratorLLM] Complexity - Score: ${complexityScore}, Indicators: [${complexityIndicators.join(', ')}]`);
    
    if (complexityScore >= 2) {
      systemPromptContent += `\n\n## COMPLEXITY ANALYSIS RESULT\nThis query scored ${complexityScore} (Indicators: ${complexityIndicators.join(', ')}). Consider using 'execute_workflow'.`;
    } else {
      systemPromptContent += `\n\n## COMPLEXITY ANALYSIS RESULT\nThis query scored ${complexityScore}. Likely a simple action.`;
    }
  }

  try {
    console.log("[CentralOrchestratorLLM] Invoking LLM for decision making");
    
    const messages = [
      new SystemMessage(systemPromptContent),
      new HumanMessage(currentUserMessage),
    ];

    

    const result = await orchestratorLLM.invoke(messages);
    let llmOutputText = "";
    
    if (typeof result.content === "string") {
      llmOutputText = result.content;
    } else if (Array.isArray(result.content)) {
      llmOutputText = result.content
        .filter((part) => part.type === "text")
        .map((part) => (part as any).text)
        .join("");
    }

    console.log("[CentralOrchestratorLLM] Raw LLM output length:", llmOutputText.length);

    const cleanedOutput = llmOutputText
      .trim()
      .replace(/^```json\s*/, "")
      .replace(/\s*```$/, "")
      .replace(/^```\s*/, "")
      .replace(/\s*```$/, "");

    console.log("[CentralOrchestratorLLM] Attempting to parse LLM decision JSON");
    
    let parsedDecision;
    try {
      parsedDecision = JSON.parse(cleanedOutput);
      console.log("[CentralOrchestratorLLM] Successfully parsed JSON decision");
    } catch (parseError) {
      console.error("[CentralOrchestratorLLM] JSON parse error:", parseError);
      throw new Error(`Failed to parse LLM output as JSON: ${parseError}`);
    }

    const validatedDecision = llmDecisionSchema.parse(parsedDecision);
    console.log("[CentralOrchestratorLLM] Decision validated against schema");

    const decision: OrchestratorDecision = {
      actionType: validatedDecision.actionType,
      params: validatedDecision.params || {},
      workflowDefinition: validatedDecision.workflowDefinition ? {
        name: validatedDecision.workflowDefinition.name!,
        description: validatedDecision.workflowDefinition.description,
        tasks: validatedDecision.workflowDefinition.tasks!.map(task => ({
          id: task.id!,
          taskType: task.taskType!,
          params: task.params,
          dependsOn: task.dependsOn,
          humanSummary: task.humanSummary,
          outputVariable: task.outputVariable,
          status: task.status,
          result: task.result,
          retries: task.retries,
        }))
      } : undefined,
      responseText: validatedDecision.responseText,
      reasoning: validatedDecision.reasoning,
      // clarificationContextToSave is now deprecated. It will be set to null or ignored.
      clarificationContextToSave: null, 
      timezoneInfo: timezoneInfo,
    };

    if (decision.actionType === "call_planner" && !decision.params?.userInput) {
      decision.params = decision.params || {};
      decision.params.userInput = currentUserMessage;
    }

    console.log("[CentralOrchestratorLLM] Decision type:", 
      decision.workflowDefinition ? "Workflow" : decision.actionType);
    
    if (decision.workflowDefinition) {
      console.log("[CentralOrchestratorLLM] Workflow details:", {
        name: decision.workflowDefinition.name,
        taskCount: decision.workflowDefinition.tasks.length,
        taskTypes: decision.workflowDefinition.tasks.map(t => t.taskType)
      });
    }

    return decision;

  } catch (error) {
    console.error("[CentralOrchestratorLLM] Error in getNextAction:", error);
    
    const fallbackDecision: OrchestratorDecision = {
      actionType: "respond_directly",
      responseText: "I apologize, but I encountered an issue processing your request. Could you please try rephrasing it?",
      reasoning: `Error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`,
      timezoneInfo: timezoneInfo,
      clarificationContextToSave: null, // Ensure fallback also doesn't try to save old context type
    };
    
    console.log("[CentralOrchestratorLLM] Returning fallback decision due to error");
    return fallbackDecision;
  }
}