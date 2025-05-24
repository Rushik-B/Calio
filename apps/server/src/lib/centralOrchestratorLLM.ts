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
  model: "gemini-2.0-flash", // User changed this from gemini-2.0-flash
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
  }).optional(),
  
  // Common fields
  responseText: z.string().nullable().optional(),
  reasoning: z.string().optional(),
  // We need a way for the LLM to suggest what to save for context if it asks a question
  // This will be structured by the calling route based on OrchestratorDecision type from `../types/orchestrator`
  clarificationContextToSave: z.any().optional(),
});

// Makes a nice string of the conversation history for the LLM to see
function formatConversationHistoryForPrompt(history: ConversationTurn[]): string {
  if (!history || history.length === 0) {
    return "No previous conversation history.";
  }

  const formattedTurns = history
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
        
        if (turn.requiresFollowUp && turn.clarificationContext) {
          const contextSummary = (typeof turn.clarificationContext === 'object' && turn.clarificationContext !== null && (turn.clarificationContext as any).type)
            ? (turn.clarificationContext as any).type
            : 'details';
          messageText += `\n[Context: Waiting for user clarification on ${contextSummary}]`;
        }
      }
      return `${turnPrefix} ${messageText}`;
    })
    .join("\n\n"); // Use double newline for better readability between turns

  return `CONVERSATION HISTORY (Most Recent Turn Last):\n${formattedTurns}\n--- END OF HISTORY ---`;
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
  
  let systemPromptContent: string;

  // Check if the last assistant turn in history has clarification context to resolve
  const lastAssistantTurnWithContext = conversationHistory
    .slice()
    .reverse()
    .find((turn) => turn.actor === "ASSISTANT" && turn.clarificationContext);

  let activeClarificationContext: any = null;
  let activeTaskContext: any = null;
  
  if (
    lastAssistantTurnWithContext &&
    lastAssistantTurnWithContext.clarificationContext &&
    typeof lastAssistantTurnWithContext.clarificationContext === "object"
  ) {
    activeClarificationContext = lastAssistantTurnWithContext.clarificationContext;
    
    // Extract active task context for ongoing scheduling tasks
    if (activeClarificationContext.type === 'conflict_resolution_pending') {
      activeTaskContext = activeClarificationContext;
    } else if (activeClarificationContext.type === 'delete_candidates_for_confirmation') {
      activeTaskContext = activeClarificationContext;
    }
  }

  if (
    activeClarificationContext &&
    activeClarificationContext.type === "conflict_resolution_pending"
  ) {
    /* -------------------------------------------------------------------------- */
    /*              Mode: Resolve pending conflict resolution                    */
    /* -------------------------------------------------------------------------- */

    const originalEventDetails = activeClarificationContext.originalEventDetails;
    const conflictingEvents = activeClarificationContext.conflictingEvents;

    systemPromptContent = `You are a top-level AI orchestrator for a calendar assistant. 
    The user was trying to schedule an event: "${originalEventDetails?.summary || 'event'}" and it conflicted with existing events.
    The user has now provided an alternative suggestion. Your task is to interpret their response and create a new scheduling request.

    User's Timezone: ${userTimezone}
    User's Available Calendars: ${userCalendarsFormatted || "Not available"}
    Current Date/Time: ${timezoneInfo.userLocalTime} (This is the current time in ${userTimezone})
    Timezone Offset: ${timezoneInfo.offset} (Use this exact offset for ISO8601 formatting)
    
    Original Event Details: ${JSON.stringify(originalEventDetails)}
    Conflicting Events: ${JSON.stringify(conflictingEvents)}
    
    Conversation History:
    ${formattedHistory}
    User's Current Response: "${currentUserMessage}"

    Based on the user's response, decide the next step:
    1. **Clear Alternative Time/Date:** If the user suggests a specific alternative (e.g., "6pm instead", "tomorrow at the same time", "make it Friday"), use 'call_planner' action.
       - Combine the original event details with the user's new time/date preference
       - 'params.userInput' should be like: "Schedule ${originalEventDetails?.summary || 'event'} on [new time/date from user]"
    
    2. **General Request for Different Time:** If the user says something general like "find another time", use 'respond_directly' to ask for a more specific preference.
    
    3. **Cancel/Abandon:** If the user wants to cancel or abandon the event creation, use 'respond_directly' to acknowledge.
    
    4. **Unrelated Response:** If the user switches topics completely, interpret naturally and choose the appropriate action.

    Output your decision ONLY as a single, valid JSON object:
    {
      "actionType": "call_planner" | "respond_directly" | "ask_user_question",
      "params": { 
        "userInput": "<For call_planner: combined request with original event + user's new preference>",
      },
      "responseText": "<For respond_directly: your response to the user>",
      "reasoning": "Briefly explain your decision based on user's response.",
      "clarificationContextToSave": null
    }
    Be natural and conversational in your responses.`;

  } else if (
    activeClarificationContext &&
    activeClarificationContext.type === "delete_candidates_for_confirmation"
  ) {
    /* -------------------------------------------------------------------------- */
    /*             Mode: Resolve pending clarification for deletion              */
    /* -------------------------------------------------------------------------- */

    const candidates = activeClarificationContext.candidates as DeletionCandidate[];
    const originalQuery = activeClarificationContext.originalUserQuery;

    systemPromptContent = `You are a top-level AI orchestrator for a calendar assistant. 
    You previously asked the user to clarify which event(s) to delete from a list of candidates because their original request ("${originalQuery}") was ambiguous or matched multiple items.
    The user has now responded. Your task is to interpret their response *in relation to the specific candidates presented* and the original broader query.

    User's Timezone: ${userTimezone}
    User's Available Calendars: ${userCalendarsFormatted || "Not available"}
    Current Date/Time: ${timezoneInfo.userLocalTime} (This is the current time in ${userTimezone})
    Timezone Offset: ${timezoneInfo.offset} (Use this exact offset for ISO8601 formatting)
    Original User Query that led to clarification: "${originalQuery}"
    Candidates previously presented to user for potential deletion:
    ${candidates
      .map(
        (c, idx) =>
          `${idx + 1}. ${c.summary || c.eventId} (ID: ${c.eventId}, Calendar: ${c.calendarId}, Start: ${c.startTime || "N/A"})`
      )
      .join("\n")}
    
    Conversation History (most recent messages lead to this point):
    ${formattedHistory}
    User's Current Response (to your clarification question): "${currentUserMessage}"

    Based on the user's current response, decide the next step:
    1.  **Clear Confirmation of Presented Candidates:** If the user explicitly confirms deleting one or more of the *specific candidates listed above* (e.g., "yes, delete number 1", "the first one", "confirm the meeting with Tom at 4pm"), then your action is 'perform_google_calendar_action'.
        - 'params.GCToolName' should be 'delete_event_direct'.
        - 'params.GCToolArgs' should be an array of objects for *only the confirmed candidates* from the list.
        - 'responseText' should be a short, friendly confirmation like 'Okay, I've deleted [Event Summary]' or 'Alright, those events have been removed.' Do not include event IDs or links.
    2.  **Clear Denial/Cancel:** If the user says "no", "none", "cancel", "don't delete any of those", then your action is 'respond_directly'.
        - 'responseText' should acknowledge this (e.g., "Okay, no events were deleted.").
    3.  **New Information / Broader Scope / Still Ambiguous:** If the user's response does NOT clearly confirm/deny the presented candidates, but instead provides new information (e.g., "it's actually next week", "look for meetings with X instead", "they are all this week"), or is still too vague about the *presented candidates*, your action should be 'call_planner'.
        - The goal is to re-run the search/deletion logic with the new information combined with the original intent.
        - 'params.userInput' should be a rephrased query for the planner, incorporating the user's latest clarification with the original request context (e.g., if original was "delete meetings with X, Y, Z" and user now says "they are this week", then userInput for planner could be "delete meetings with X, Y, Z this week").
        - If the user seems to be changing the entire scope (e.g. "actually, create an event"), also use 'call_planner'.
    4.  **Ask for More Specific Clarification (Rare):** If the response is extremely vague and you cannot determine any of the above, you can use 'ask_user_question'. Look over ${formattedHistory} again before using 'ask_user_question'.

    Output your decision ONLY as a single, valid JSON object. Schema:
    {
      "actionType": "perform_google_calendar_action" | "respond_directly" | "call_planner" | "ask_user_question",
      "params": { 
        "GCToolName": "delete_event_direct", // If deleting presented candidates
        "GCToolArgs": [{"eventId": "id1", "calendarId": "calId1"}, ...], // If deleting presented candidates
        "userInput": "<For call_planner: new/rephrased query incorporating clarification. For others: user's current response for logging>",
        "timeMin": "<Optional: if user provided new time for call_planner>",
        "timeMax": "<Optional: if user provided new time for call_planner>",
        "anchorEventsContext": "<Optional: If creating new events relative to events detailed in recent conversation history, provide an array of anchor event objects here, each with summary, start, end, and calendarId.>"
      },
      "responseText": "<Your confirmation or response to the user. For successful deletions, make it short, friendly, and without event IDs or links (e.g., 'Okay, I've removed that event for you.')>",
      "reasoning": "Briefly explain your decision based on user's clarification relative to candidates and original query.",
      "clarificationContextToSave": null // Usually null after resolving, unless asking another question.
    }
    Be as human-like and kind as possible. If calling planner, ensure the new userInput is comprehensive.`;

  } else if (
    activeClarificationContext &&
    activeClarificationContext.type === "workflow_paused"
  ) {
    /* -------------------------------------------------------------------------- */
    /*                    Mode: Resume paused workflow                           */
    /* -------------------------------------------------------------------------- */

    const workflowState = activeClarificationContext.workflowState;
    const pausedAt = workflowState?.pausedAt;
    const originalUserQuery = activeClarificationContext.originalUserQuery;

    systemPromptContent = `You are a top-level AI orchestrator for a calendar assistant. 
    You previously paused a workflow for user interaction. The workflow was paused at task "${pausedAt}" while processing the original query: "${originalUserQuery}".
    The user has now responded. Your task is to determine how to proceed with the workflow.

    User's Timezone: ${userTimezone}
    User's Available Calendars: ${userCalendarsFormatted || "Not available"}
    Current Date/Time: ${timezoneInfo.userLocalTime} (This is the current time in ${userTimezone})
    Timezone Offset: ${timezoneInfo.offset} (Use this exact offset for ISO8601 formatting)
    
    Paused Workflow State:
    - Workflow ID: ${workflowState?.workflowId}
    - Paused at task: ${pausedAt}
    - Remaining tasks: ${workflowState?.remainingTasks?.length || 0}
    
    Conversation History:
    ${formattedHistory}
    User's Current Response: "${currentUserMessage}"

    Based on the user's response, decide the next step:
    1. **Continue Workflow:** If the user provided the requested information or confirmation, use 'execute_workflow' to resume the paused workflow.
        - Include the current user response as input for the paused task
        - Preserve the existing workflow state and data bus
    2. **Modify Workflow:** If the user wants to change something about the workflow, create a new workflow definition that incorporates their changes.
    3. **Cancel Workflow:** If the user wants to stop the workflow, use 'respond_directly' to acknowledge the cancellation.
    4. **New Request:** If the user is asking for something completely different, analyze it as a new request.

    Output your decision ONLY as a single, valid JSON object:
    {
      "actionType": "execute_workflow" | "respond_directly" | "call_planner" | "ask_user_question",
      "workflowDefinition": { 
        // If resuming or modifying workflow, include the updated workflow definition
        "name": "string",
        "tasks": [...]
      },
      "params": {
        "userInput": "<User's current response>",
        "resumeFromPaused": true, // Indicates this is resuming a paused workflow
        "pausedTaskId": "${pausedAt}",
        "workflowState": ${JSON.stringify(workflowState)}
      },
      "responseText": "<Your response to the user about resuming/modifying/canceling the workflow>",
      "reasoning": "Briefly explain your decision based on user's response.",
      "clarificationContextToSave": null // Clear the paused state after processing
    }
    Be helpful and acknowledge the user's response appropriately.`;

  } else {
    /* -------------------------------------------------------------------------- */
    /*      Mode: Standard request processing & complexity analysis              */
    /* -------------------------------------------------------------------------- */

    // Read the new workflow decomposition prompt
    let workflowPrompt = "";
    try {
      const fs = require('fs');
      const path = require('path');
      const promptPath = path.join(process.cwd(), 'src/prompts/orchestratorDecompositionPrompt.md');
      workflowPrompt = fs.readFileSync(promptPath, 'utf8');
    } catch (error) {
      console.error("[CentralOrchestratorLLM] Could not read workflow decomposition prompt:", error);
      // Fallback to basic workflow-aware prompt if file doesn't exist yet
      workflowPrompt = `# Advanced Calendar Assistant Orchestrator - Query Decomposer

You are an advanced AI orchestrator for a sophisticated calendar assistant. Your primary role is to analyze user requests and determine the optimal execution strategy - either a simple direct action or a complex multi-step workflow.

## Decision Framework

### For Simple Actions (use existing actionType):
- Single calendar operation
- Basic queries  
- General chat
- Follow-up clarifications

### For Complex Workflows (use workflowDefinition):
- Multiple sequential operations
- Conditional logic ("if X then Y")
- Batch operations with filtering
- Cross-calendar synchronization
- Operations requiring user preferences

## Available Simple Action Types:
- call_planner: Standard calendar operations
- fetch_context_and_call_planner: When existing events need to be found first
- respond_directly: General chat, acknowledgments
- ask_user_question: When clarification is needed
- perform_google_calendar_action: Direct API calls

## Task Types for Workflows:
- FindEvents: Search for events
- FilterEvents: Filter event lists
- ExtractAttendees: Get attendees from events
- GenerateEventCreationPayload: Create API payloads
- ExecuteCalendarCreate: Create events
- ExecuteCalendarDeleteBatch: Delete multiple events
- RequestUserConfirmation: Ask for confirmation
- PresentChoicesToUser: Present options

Always output valid JSON with either actionType OR workflowDefinition.`;
    }

    systemPromptContent = `${workflowPrompt}

## Current Context

    User's Timezone: ${userTimezone}
    User's Available Calendars: ${userCalendarsFormatted || "Not available"}
    Current Date/Time: ${timezoneInfo.userLocalTime} (This is the current time in ${userTimezone})
    Timezone Offset: ${timezoneInfo.offset} (Use this exact offset for ISO8601 formatting)

Pre-calculated Timezone Information:
- Today: ${timezoneInfo.dates.today}
- Tomorrow: ${timezoneInfo.dates.tomorrow}
- Yesterday: ${timezoneInfo.dates.yesterday}
- Current time in user TZ: ${timezoneInfo.currentTimeInUserTZ}
- Today start: ${timezoneInfo.isoStrings.todayStart}
- Today end: ${timezoneInfo.isoStrings.todayEnd}
- Tomorrow start: ${timezoneInfo.isoStrings.tomorrowStart}
- Tomorrow end: ${timezoneInfo.isoStrings.tomorrowEnd}

    ${formattedHistory}

## Current User Message
"${currentUserMessage}"

## Analysis Instructions

1. **Complexity Assessment**: Determine if this is a simple request (use existing actionType) or complex request (use workflowDefinition).

2. **Simple Request Indicators**:
   - Single calendar operation
   - Basic queries
   - Follow-up clarifications  
   - General chat

3. **Complex Request Indicators**:
   - Multiple steps with "and" connectors
   - Conditional logic ("if", "unless", "but don't")
   - Batch operations with criteria
   - Cross-calendar operations
   - Operations requiring preferences or external constraints

4. **Follow-up Analysis**: Check if this is a follow-up to previous conversation turns that provides context.

5. **Output Format**: Use the JSON schemas provided in the prompt above.

Ensure your output is a single, valid JSON object with no markdown formatting.`;

    // Keep the original standard mode prompt as fallback
    if (!workflowPrompt || workflowPrompt.length < 100) {
      systemPromptContent = `You are a top-level AI orchestrator for a calendar assistant.
      
      User's Timezone: ${userTimezone}
      Current Time: ${timezoneInfo.userLocalTime}
      
      ${formattedHistory}
      
      User Message: "${currentUserMessage}"
      
      Respond with valid JSON for a simple action.`;
    }
  }

  // Log the processing mode and details
  console.log("[CentralOrchestratorLLM] Processing mode:", 
    activeClarificationContext ? `Clarification (${activeClarificationContext.type})` : "Standard Analysis");

  // Complexity analysis for standard mode
  let complexityScore = 0;
  let complexityIndicators: string[] = [];
  
  if (!activeClarificationContext) {
    console.log("[CentralOrchestratorLLM] Analyzing query complexity for:", currentUserMessage);
    
    // Check for complexity indicators
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
    
    // Score each category
    if (multiStepPatterns.some(pattern => pattern.test(currentUserMessage))) {
      complexityScore += 2;
      complexityIndicators.push("Multiple steps detected");
    }
    
    if (conditionalPatterns.some(pattern => pattern.test(currentUserMessage))) {
      complexityScore += 2;
      complexityIndicators.push("Conditional logic detected");
    }
    
    if (batchPatterns.some(pattern => pattern.test(currentUserMessage))) {
      complexityScore += 1;
      complexityIndicators.push("Batch operations detected");
    }
    
    if (crossCalendarPatterns.some(pattern => pattern.test(currentUserMessage))) {
      complexityScore += 1;
      complexityIndicators.push("Cross-calendar operations detected");
    }
    
    if (preferencePatterns.some(pattern => pattern.test(currentUserMessage))) {
      complexityScore += 1;
      complexityIndicators.push("User preferences detected");
    }
    
    if (timeRelationPatterns.some(pattern => pattern.test(currentUserMessage))) {
      complexityScore += 1;
      complexityIndicators.push("Time relations detected");
    }
    
    console.log(`[CentralOrchestratorLLM] Complexity analysis - Score: ${complexityScore}, Indicators: [${complexityIndicators.join(', ')}]`);
    
    // Enhance system prompt with complexity analysis
    if (complexityScore >= 2) {
      console.log("[CentralOrchestratorLLM] High complexity detected, likely to generate workflow");
      systemPromptContent += `\n\n## COMPLEXITY ANALYSIS RESULT
This query scored ${complexityScore} complexity points with indicators: ${complexityIndicators.join(', ')}.
Based on this analysis, consider using workflowDefinition for this request.`;
    } else {
      console.log("[CentralOrchestratorLLM] Low complexity detected, likely simple action");
      systemPromptContent += `\n\n## COMPLEXITY ANALYSIS RESULT
This query scored ${complexityScore} complexity points. This appears to be a simple request suitable for existing actionType approach.`;
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

    // Clean and parse the output
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

    // Validate the decision against our schema
    const validatedDecision = llmDecisionSchema.parse(parsedDecision);
    console.log("[CentralOrchestratorLLM] Decision validated against schema");

    // Construct the final OrchestratorDecision
    const decision: OrchestratorDecision = {
      // Handle both simple actions and workflows
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
      clarificationContextToSave: validatedDecision.clarificationContextToSave,
      timezoneInfo: timezoneInfo,
    };

    // Ensure userInput is set for call_planner actions
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
    
    // Fallback decision
    const fallbackDecision: OrchestratorDecision = {
      actionType: "respond_directly",
      responseText: "I apologize, but I encountered an issue processing your request. Could you please try rephrasing it?",
      reasoning: `Error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`,
      timezoneInfo: timezoneInfo,
    };
    
    console.log("[CentralOrchestratorLLM] Returning fallback decision due to error");
    return fallbackDecision;
  }
}