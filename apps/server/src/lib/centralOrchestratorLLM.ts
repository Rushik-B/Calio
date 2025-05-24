import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ConversationTurn } from "@prisma/client";
import {
  OrchestratorDecision,
  OrchestratorActionType,
  DeletionCandidate,
} from "../types/orchestrator";
import { ZodError } from "zod";
import { z } from "zod"; // For parsing LLM JSON output

// Environment variables should be loaded by the main application process (e.g., in route.ts or a global setup)
// Ensure GOOGLE_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY is available in the environment.

const orchestratorLLM = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash", // User changed this from gemini-2.0-flash
  temperature: 0.3, // Lower temperature for more predictable decisions
});

// Schema for the expected JSON output from the LLM for its decision
const llmDecisionSchema = z.object({
  actionType: z.enum([
    "call_planner",
    "fetch_context_and_call_planner",
    "respond_directly",
    "ask_user_question",
    "ask_user_clarification_for_tool_ambiguity",
    "perform_google_calendar_action",
  ]),
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
  responseText: z.string().nullable().optional(),
  reasoning: z.string().optional(),
  // We need a way for the LLM to suggest what to save for context if it asks a question
  // This will be structured by the calling route based on OrchestratorDecision type from `../types/orchestrator`
  clarificationContextToSave: z.any().optional(),
});

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

// Calculate timezone offset for the user's timezone using proper method
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
    isClarificationRequest &&
    currentUserMessage.includes(
      "SYSTEM_CLARIFICATION_REQUEST: Type: delete_clarify_time_range"
    )
  ) {
    /* -------------------------------------------------------------------------- */
    /*      Mode: Formulate a clarification question for deletion time range      */
    /* -------------------------------------------------------------------------- */

    let originalQuery = "their previous request";
    let attemptedTimeMin = "an earlier specified start time";
    let attemptedTimeMax = "an earlier specified end time";

    try {
      const detailsMatch = currentUserMessage.match(/Details: ([\s\S]*)\. Task:/);
      if (detailsMatch && detailsMatch[1]) {
        const details = JSON.parse(detailsMatch[1]);
        originalQuery = details.originalQuery || originalQuery;
        attemptedTimeMin = details.attemptedTimeMin || attemptedTimeMin;
        attemptedTimeMax = details.attemptedTimeMax || attemptedTimeMax;
      }
    } catch (e) {
      console.error(
        "[CentralOrchestratorLLM] Error parsing time range clarification details:",
        e
      );
    }

    systemPromptContent = `You are a top-level AI orchestrator for a calendar assistant. 
    The system attempted to find events for deletion based on the user's request: "${originalQuery}", looking between ${attemptedTimeMin} and ${attemptedTimeMax}, but no events were found in that specific time frame.
    Your task is to ask the user a clear question to get a corrected or new time range for their deletion request. You can also offer them to cancel the deletion.

    User's Timezone: ${userTimezone}
    User's Available Calendars: ${userCalendarsFormatted || "Not available"}
    Current Date/Time: ${timezoneInfo.userLocalTime} (This is the current time in ${userTimezone})
    Timezone Offset: ${timezoneInfo.offset} (Use this exact offset for ISO8601 formatting)

    Conversation History (if available):
    ${formattedHistory}

    Based on this, craft a user-facing question.
    For example: "I couldn't find any events for '${originalQuery}' in the time range ${attemptedTimeMin} to ${attemptedTimeMax}. Would you like to try a different date range, or perhaps specify the event name more clearly?"

    Your available actions are:
    1. 'ask_user_question': Formulate the question and provide it in 'responseText'. Save the original query in 'clarificationContextToSave' so if the user provides a new time range, the system knows what original deletion request it was for.

    Output your decision ONLY as a single, valid JSON object matching the following schema, with no other surrounding text or markdown:
    {
      "actionType": "ask_user_question",
      "params": { "originalUserQueryForClarification": "${originalQuery}" },
      "responseText": "<Your user-facing clarification question about the time range>",
      "reasoning": "Asking user to clarify or provide a new time range for deletion as no events were found in the previously attempted range.",
      "clarificationContextToSave": { "type": "delete_clarify_time_range_pending", "originalUserQuery": "${originalQuery}" }
    }
    Be as human-like and kind as possible. Ensure the output is nothing but the JSON object.`;
  } else if (isClarificationRequest) {
    /* -------------------------------------------------------------------------- */
    /*             Mode: Formulate a clarification question (Phase 2)             */
    /* -------------------------------------------------------------------------- */

    systemPromptContent = `You are a top-level AI orchestrator for a calendar assistant. 
    The system has encountered ambiguity after trying to process a user's request. 
    Your task is to formulate a clear question to the user to resolve this ambiguity. 
    The user's original query and the ambiguous items found by a tool will be provided in the user message (prefixed with SYSTEM_CLARIFICATION_REQUEST).

    User's Timezone: ${userTimezone}
    User's Available Calendars: ${userCalendarsFormatted || "Not available"}
    Current Date/Time: ${timezoneInfo.userLocalTime} (This is the current time in ${userTimezone})
    Timezone Offset: ${timezoneInfo.offset} (Use this exact offset for ISO8601 formatting)

    Conversation History (if available):
    ${formattedHistory}

    Based on the SYSTEM_CLARIFICATION_REQUEST, craft a user-facing question. 
    For example, if candidates for deletion are provided, ask the user to specify which one(s) they want to delete, perhaps by listing them with numbers.

    Your available actions are:
    1. 'ask_user_clarification_for_tool_ambiguity': Formulate the question and provide it in 'responseText'. You should also decide what context needs to be saved for the next turn to understand the user's answer. This context should be placed in 'clarificationContextToSave'. For example, if you list candidates [A, B, C], then 'clarificationContextToSave' should contain these candidates and their original details so the system can map the user's answer (e.g., "the first one") back to the correct item.

    Output your decision ONLY as a single, valid JSON object matching the following schema, with no other surrounding text or markdown:
    {
      "actionType": "ask_user_clarification_for_tool_ambiguity",
      "params": { "originalUserQueryForClarification": "<The user's original query that led to ambiguity>" },
      "responseText": "<Your user-facing clarification question listing choices if appropriate>",
      "reasoning": "Briefly explain why you are asking this question.",
      "clarificationContextToSave": { "type": "delete_candidates_for_confirmation", "candidates": [{"eventId": "id1", "summary": "Summary A", "calendarId": "cal1", "startTime": "..."}, ...], "originalUserQuery": "<user's original query>" }
    }
    Be as human-like and kind as possible. Ensure the output is nothing but the JSON object.`;
  } else {
    /* -------------------------------------------------------------------------- */
    /*               Mode: Standard request processing (Phase 1 logic)            */
    /* -------------------------------------------------------------------------- */

    systemPromptContent = `You are a top-level AI orchestrator for a calendar assistant. Your primary goal is to understand the user's intent based on their latest message and the provided conversation history.\n\n    User's Timezone: ${userTimezone}\n    User's Available Calendars: ${userCalendarsFormatted || "Not available"}\n    Current Date/Time: ${timezoneInfo.userLocalTime} (This is the current time in ${userTimezone})\n    Timezone Offset: ${timezoneInfo.offset} (Use this exact offset for ISO8601 formatting)\n\n    ${formattedHistory}\n    (When reviewing history, ASSISTANT turns may have an '[Action: ...]' note detailing tools called and their outcomes, or '[Context: Waiting for user clarification...]' if the assistant asked a question. The ASSISTANT's actual textual response to the user is in 'messageText'.)\n\n    **PRIORITY 1 - Active Task Context Resolution (Absolute Priority):**\n    FIRST, check the very end of the Conversation History for any an ASSISTANT turn with '[Context: Waiting for user clarification...]'. This indicates an active task requiring resolution (e.g., conflict resolution, deletion confirmation, ambiguity clarification).\n    If such a context exists, your primary goal is to interpret the CURRENT user message as an answer to the assistant's pending question or clarification request. Your action should be guided by the specific active task context (e.g., 'conflict_resolution_pending', 'delete_candidates_for_confirmation').\n    These active clarification contexts take ABSOLUTE PRIORITY over any other interpretation. (Handled by earlier 'if/else if' blocks in the code if \`activeClarificationContext\` is set).\n\n    **PRIORITY 2 - Follow-up Detection vs. New Request:**\n    If there is NO active task context from PRIORITY 1, carefully review the LAST turn in the Conversation History (it could be USER or ASSISTANT).\n    1.  **Is the CURRENT user message a direct follow-up to the LAST turn?**\n        **KEY FOLLOW-UP PATTERNS TO DETECT:**\n        \n        **A) Event Modification Follow-ups (CRITICAL):**\n        - Last Turn (Assistant): \"Event created successfully: 'Haircut'. It starts on [date/time]. [Action: ... Created event(s): 'Haircut' (ID: abc123) at [time].]\" \n          Current User Message: \"Wait, make that haircut at 3pm\" OR \"Change it to 3pm\" OR \"Make that 3pm instead\" \n          Interpretation: This IS a follow-up. User wants to UPDATE the haircut event just created.\n          \n        - Last Turn (Assistant): \"I've scheduled 'Meeting with John' for tomorrow 2pm. [Action: ... Created event(s): 'Meeting with John' (ID: xyz789) at ...]\" \n          Current User Message: \"Actually, move that to Friday\" \n          Interpretation: This IS a follow-up. User wants to UPDATE the meeting just created.\n\n        **B) Information Follow-ups:** \n        - Last Turn (Assistant): \"Your next work day is May 22, 2025. [Action: Called tool 'planner->list_events'. Processed tool result.]\" \n          Current User Message: \"What time?\" \n          Interpretation: This IS a follow-up. The user means \"What time is my work on May 22, 2025?\".\n\n        **C) Request Clarification Follow-ups:** \n        - Last Turn (User): \"Schedule dentist appointment for tomorrow at 10am.\" \n          Current User Message: \"Also add a reminder for it.\" \n          Interpretation: This IS a follow-up to the user's own previous request. They are adding details.\n\n        **CRITICAL FOLLOW-UP INDICATORS:** \n        - Words like \"that\", \"it\", \"make that\", \"change that\", \"move that\", \"update that\" \n        - Time modifications: \"at 3pm\", \"to 3pm\", \"3pm instead\", \"earlier\", \"later\" \n        - Reference to recently mentioned events without full context\n\n    2.  **If it IS a follow-up:** Your \`params.userInput\` for the planner MUST combine the necessary context from the LAST turn with the user's current message to form a complete, actionable request.\n        - Example for \"What time?\" after work day info: \`userInput: \"What time is my work on May 22, 2025?\"\`\n        - Example for changing time: \`userInput: \"Update the 'Haircut' event scheduled for tomorrow at 10am to 3pm instead.\"\`\n        - **CRITICAL**: For event modifications, look for created event details in '[Action: ... Created event(s): ...]' notes and include specific event ID/summary in the userInput.\n        The actionType will likely be \`call_planner\`.\n\n    3.  **If it is NOT a clear follow-up OR if it's a completely new topic:** Process the CURRENT user message as a new, standalone request. The history provides general context, but the immediate last turn isn't the direct anchor.\n\n    **PRIORITY 3 - Calendar Operations Detection (for New Requests or Follow-ups that become Calendar Ops):**\n    If the user wants to DELETE, CANCEL, REMOVE, CREATE, UPDATE, or LIST any calendar events (either as a new request or as a follow-up that implies a calendar operation), you MUST use 'call_planner'. NEVER use 'respond_directly' for actual calendar operations. Words like \"delete that [event]\", \"cancel my [meeting]\", \"[event] is cancelled\" always trigger 'call_planner'.\n\n    **Detecting When Existing Event Context Is Needed (for New Requests or if Follow-up Lacks Detail):**\n    Pay careful attention to user requests that reference existing events OR temporal relationships that are NOT detailed in the conversation history. Look for BOTH explicit and implicit references:\n\n    **Explicit Event References:**\n    - \"Schedule a meeting before my class on Thursday\"\n    - \"Add lunch after my dentist appointment tomorrow\"\n\n    **Implicit Temporal References (CRITICAL):**\n    - \"after work today/tomorrow\" → Need to find work events to determine when work ends\n    - \"before work starts\" → Need to find when work begins\n\n    **Key Detection Pattern:** If the user mentions any time relationship (before/after/during/between) with:\n    - work, meetings, appointments, lunch, breaks, classes, etc.\n    - AND the conversation history (especially the recent turns including any '[Action: ...]' notes) does NOT contain specific details about these events for the referenced time period\n    - THEN use 'fetch_context_and_call_planner'\n\n    **Event Modification Detection (for New Requests or if Follow-up Lacks Detail):**\n    If the user wants to update/edit existing events, look for these patterns:\n    - **Direct edit references**: \"change my meeting\", \"move my appointment\"\n    - **Event identification + modification**: \"my dentist appointment tomorrow\" + \"move it to Friday\"\n    - AND the conversation history does NOT contain details about the specific event being referenced (check event IDs or summaries in '[Action: ...]' notes)\n    - THEN use 'fetch_context_and_call_planner' to find the target event first\n\n    If the user references existing events (using explicit terms or implicit temporal relationships) but the conversation history does NOT contain details about these specific events for the referenced timeframe, you should use the 'fetch_context_and_call_planner' action to first query the calendar for the referenced events.\n\n    **CRITICAL - Time Context Preservation for Follow-ups or Vague Dates:**\n    If the user mentions an alternative day/date WITHOUT specifying a time (e.g., \"What about Monday?\", \"How about tomorrow?\", \"Try Friday instead\"), and the recent conversation history (especially the LAST ASSISTANT or USER turn) contains a specific time for a similar event or the subject of discussion, you MUST preserve that original time:\n\n    Examples:\n    - Previous: User \"pilates class at 7pm on sunday\" → Current User: \"What about Monday?\" → Planner \`userInput\`: \"Schedule pilates class at 7pm on Monday\"\n    - Previous: User \"meeting at 2pm tomorrow\" → Current User: \"Make it Wednesday\" → Planner \`userInput\`: \"Schedule meeting at 2pm on Wednesday\"\n\n    Look for the most recent event details (time, duration, title) mentioned in the conversation and combine them with the user's new preference.\n\n    **CRITICAL - Conflict Resolution Follow-ups (Handled by Specific Mode - see PRIORITY 1):\n    If there is an active 'conflict_resolution_pending' context (indicated by '[Context: Waiting... conflict_resolution_pending]'), the user's response is ALWAYS a conflict resolution follow-up. This is handled by a dedicated mode. Your general follow-up logic here is secondary to that.\n\n    **Relative Event Creation (IMPORTANT - for New Requests or if Follow-up Initiates Creation):**\n    If the user's current message asks to create new events relative to an event or events that were explicitly detailed in the recent conversation history (e.g., user says \"schedule a follow-up call one week after my meeting with Dr. Lee\" after the assistant just confirmed \"Meeting with Dr. Lee scheduled for June 3, 3:00 PM - 4:00 PM. [Action: ... Event 'Meeting with Dr. Lee' (ID: abc).]\"), you MUST:\n        1.  Identify the anchor event(s) from the conversation history (look at previous ASSISTANT turns for event creation details in '[Action: ...]' notes, or if the assistant listed event details).\n        2.  Extract the summary, start (with dateTime or date and timeZone), end (with dateTime or date and timeZone), and calendarId of these anchor event(s).\n        3.  Your action should be call_planner.\n        4.  In params, userInput should be the user's current raw request for the *new* events (e.g., \"schedule a follow-up call one week after my meeting with Dr. Lee\").\n        5.  In params, you MUST also include an anchorEventsContext array. Each object in this array should represent one anchor event you extracted, containing its summary, start, end, and calendarId.\n\n    Based on the user's message and the conversation history (especially the last assistant turn for follow-ups), decide the best course of action.\n\n    Your available actions are:\n    1. 'call_planner': If the user's request involves ANY calendar operation (creating, listing, updating, deleting events) that requires actual execution, OR if it's a follow-up question that requires a new calendar operation or re-querying for more details. **CRITICAL**: If the user wants to delete, cancel, remove, or modify ANY event, you MUST use 'call_planner' - NEVER just respond with text. The planner is specialized for this.\n       - If the request is for a DELETION task (e.g., \"delete the meeting I just scheduled\", \"remove the events you created earlier\"):\n         - Assess if the user is likely asking to delete a SINGLE item or MULTIPLE/UNSPECIFIED items. Include this assessment in 'params.originalRequestNature': 'singular' or 'plural_or_unspecified'.\n         - **IMPORTANT FOR DELETING RECENTLY CREATED/MENTIONED EVENTS:** If the user refers to deleting events \"just scheduled\", \"you just created\", or uses demonstrative words like \"that [event]\", \"this [event]\", examine the recent ASSISTANT turns in the 'Conversation History'. Look for '[Action: ... Event \\'Name\\' (ID: xyz).]' notes. If found, calculate a consolidated 'timeMin' and 'timeMax' that encompasses all such recently created/mentioned events. Pass these values in the 'params' object to help the planner accurately scope the deletion.\n         - **DELETION WITH CONTEXT:** If user says \"Delete that Zumba class\" and recent conversation shows a Zumba class was created/mentioned, the userInput should be \"Delete the Zumba class that was just scheduled/mentioned\" with appropriate time constraints.\n\n    2. 'fetch_context_and_call_planner': Use this when the user wants to create, modify, or reference existing events that are NOT detailed in the conversation history (i.e., not mentioned with details in recent '[Action: ...]' notes or assistant messages). This action will:\n       - First query the calendar to find the referenced events\n       - Then proceed with planning using the found events as anchor context\n       - In params, provide:\n         * 'userInput': The user's original request\n         * 'contextQuery': Keywords to find the referenced event. For explicit references, use event names (e.g., 'class', 'dentist appointment'). For implicit temporal references, use relevant keywords (e.g., 'work' for 'after work', 'meeting' for 'after my last meeting', 'appointment' for 'before my first appointment')\n         * 'contextTimeMin' and 'contextTimeMax': Time range to search for the referenced events (be generous to ensure we find them)\n         * 'contextCalendarIds': Array of calendar IDs to search (optional, omit this field entirely to search all calendars, or provide array of specific calendar IDs)\n       - Examples of when to use this:\n         * \"Schedule a meeting before my class on Thursday\" (need to find \"class on Thursday\" IF not mentioned in history)\n         * \"Add travel time before my dentist appointment tomorrow\" (need to find \"dentist appointment tomorrow\" IF not mentioned in history)\n         * \"Schedule a meeting with Sam after work today\" (need to find work events today IF work schedule not in history)\n         * \"Move my dentist appointment to tomorrow\" (need to find \"dentist appointment\" IF not in history to update it)\n\n    3. 'respond_directly': **ONLY** for non-calendar operations like greetings, thanks, general chat, or informational questions that don't require calendar actions AND are NOT follow-ups to prior calendar-related interactions. **NEVER** use this for deletion, creation, modification, or any actual calendar operations - those MUST go to 'call_planner'.\n\n    **DELETION DETECTION - CRITICAL RULES (applies to new requests and follow-ups that become deletions):**\n    If the user says ANY of these, use 'call_planner' (NEVER respond_directly):\n    - \"Delete [event]\", \"Remove [event]\", \"Cancel [event]\"\n    - \"Delete that [class/meeting/appointment]\"\n    - \"[Event] has been cancelled\", \"[Event] is cancelled\"\n    - Any variation expressing intent to remove/delete calendar events\n\n    4. 'ask_user_question': If the user's intent is unclear *before calling any tools or the planner*, AND it's not a follow-up that can be resolved with context, and you need to ask a clarifying question before proceeding with any other action. This should generally not be used for follow-up questions where context is available; instead, use 'call_planner' with a refined query for such cases.\n\n    Output your decision ONLY as a single, valid JSON object matching the following schema, with no other surrounding text or markdown:\n    {\n      "actionType": "call_planner" | "fetch_context_and_call_planner" | "respond_directly" | "ask_user_question",\n      "params": {\n        "userInput": "The input for the planner. If the user's current message is a follow-up referring to details from a previous turn, combine ALL relevant details from the conversation history with the user's current message to form a complete instruction. CRITICAL: If the user suggests an alternative day/date without a time (e.g., 'What about Monday?'), you MUST find the original time from recent conversation and include it (e.g., 'Schedule pilates class at 7pm on Monday'). For entirely new requests, this will just be the user's current message. Always provide a complete, actionable request for the planner.",\n        "originalRequestNature": "<If actionType is call_planner AND intent is deletion, specify 'singular' or 'plural_or_unspecified'. Omit otherwise.> ",\n        "timeMin": "<Optional: If deleting 'just created' events, provide calculated ISO8601 timeMin based on history. Planner will use this. Also applicable if a follow-up implies a time constraint for the planner based on previous turns.> ",\n        "timeMax": "<Optional: If deleting 'just created' events, provide calculated ISO8601 timeMax based on history. Planner will use this. Also applicable if a follow-up implies a time constraint for the planner based on previous turns.> ",\n        "anchorEventsContext": "<Optional: If creating new events relative to events detailed in recent conversation history (check [Action:...] notes for IDs/summaries), provide an array of anchor event objects here, each with summary, start, end, and calendarId. Ensure IDs are included if known from history.> ",\n        "contextQuery": "<For fetch_context_and_call_planner: Keywords to find the referenced existing event. For explicit references, use event names (e.g., 'class', 'dentist appointment'). For implicit temporal references, use relevant keywords (e.g., 'work' for 'after work', 'meeting' for 'after my last meeting', 'appointment' for 'before my first appointment')> ",\n        "contextTimeMin": "<For fetch_context_and_call_planner: Start of time range to search for referenced events. MUST use timezone-aware ISO8601 format (e.g., '2025-05-22T00:00:00${timezoneInfo.offset}'). When user says 'today', use current date in their timezone.> ",\n        "contextTimeMax": "<For fetch_context_and_call_planner: End of time range to search for referenced events. MUST use timezone-aware ISO8601 format (e.g., '2025-05-22T23:59:59${timezoneInfo.offset}'). When user says 'today', use end of current date in their timezone.> ",\n        "contextCalendarIds": "<For fetch_context_and_call_planner: Array of calendar IDs to search (optional, omit this field entirely to search all calendars, or provide array of specific calendar IDs)> "
      },\n      "responseText": "If actionType is 'respond_directly' or 'ask_user_question', this is your textual response to the user. Otherwise, this can be omitted. Be as human-like and kind as possible. Act like a personal assistant.",\n      "reasoning": "Briefly explain your decision, especially how you interpreted the user's intent in relation to the conversation history (follow-up or new request).",\n      "clarificationContextToSave": null // This is typically null for standard mode, set by clarification modes.\n    }\n\n    Prioritize understanding if the user is making a follow-up or a new request based on the immediate conversation history. Then, determine the appropriate calendar action or context fetching needed.\n\n    **CRITICAL PRIORITY RULE (Reiteration): If the user mentions ANY temporal relationship (before/after/during/between) that references potentially existing events or schedules (work, meetings, appointments, lunch, classes, etc.), and these specific events are NOT detailed in the conversation history (check '[Action: ...]' notes), you MUST use 'fetch_context_and_call_planner'. Do NOT default to 'call_planner' for these cases.**\n\n    **DATE CALCULATION RULE: When calculating contextTimeMin/contextTimeMax for relative dates:**\n    - \"today\" = current date shown above (${timezoneInfo.userLocalTime.split(',')[0]})\n    - \"tomorrow\" = next day after current date\n    - Always use the user's timezone (${userTimezone}) for date calculations\n    - **CRITICAL**: Always include timezone in ISO8601 format (e.g., \"2025-05-22T00:00:00-07:00\", not \"2025-05-22T00:00:00\")\n    - Example: If current time is \"2025-05-22 14:30:00\" and user says \"after work today\", search from \"2025-05-22T00:00:00${timezoneInfo.offset}\" to \"2025-05-22T23:59:59${timezoneInfo.offset}\" for ${userTimezone} timezone\n\n    Ensure the output is nothing but the JSON object.`;
  }

  /* --------------------------- Build LLM message array --------------------------- */

  const messages: Array<any> = [];
  messages.push(new SystemMessage(systemPromptContent));

  // The formatted history is included within the system prompt; if needed, we could map turns to individual messages.
  messages.push(new HumanMessage(currentUserMessage));

  console.log(
    `[CentralOrchestratorLLM] Getting next action for input: "${currentUserMessage}"`
  );

  try {
    const result = await orchestratorLLM.invoke(messages);
    let llmOutput: any = result.content;

    if (typeof llmOutput !== "string") {
      console.error("[CentralOrchestratorLLM] LLM output was not a string:", llmOutput);
      throw new Error("LLM output is not in the expected string format.");
    }

    console.log("[CentralOrchestratorLLM] Raw LLM output string:", llmOutput);

    llmOutput = llmOutput.trim();

    if (llmOutput.startsWith("```json")) {
      llmOutput = llmOutput.substring(7);
      if (llmOutput.endsWith("```")) {
        llmOutput = llmOutput.substring(0, llmOutput.length - 3);
      }
    }

    llmOutput = llmOutput.trim();

    const parsedDecision = JSON.parse(llmOutput);
    const validatedDecision = llmDecisionSchema.parse(parsedDecision);

    console.log("[CentralOrchestratorLLM] Validated decision:", validatedDecision);

    let finalParams = validatedDecision.params || {};

    if (validatedDecision.actionType === "call_planner") {
      if (!finalParams.userInput) {
        finalParams.userInput = currentUserMessage;
      }
    } else if (validatedDecision.actionType === "perform_google_calendar_action") {
      if (!finalParams) finalParams = {}; // Ensure params object exists
      // GCToolName and GCToolArgs should be directly in validatedDecision.params from LLM
      if (!finalParams.GCToolName || !finalParams.GCToolArgs) {
        console.warn(
          "[CentralOrchestratorLLM] 'perform_google_calendar_action' is missing GCToolName or GCToolArgs from LLM. This might lead to errors."
        );
      }
    }

    return {
      actionType: validatedDecision.actionType as OrchestratorActionType,
      params: finalParams,
      responseText: validatedDecision.responseText,
      reasoning: validatedDecision.reasoning,
      clarificationContextToSave: validatedDecision.clarificationContextToSave,
      timezoneInfo: timezoneInfo,
    };
  } catch (error: unknown) {
    console.error(
      "[CentralOrchestratorLLM] Error getting or validating orchestrator decision:",
      error
    );

    if (error instanceof ZodError) {
      console.error(
        "[CentralOrchestratorLLM] Zod Validation Errors for LLM output:",
        JSON.stringify(error.format(), null, 2)
      );
    }

    // Fallback for errors
    let responseText =
      "I'm having a little trouble understanding right now. Could you please try rephrasing your request?";

    if (activeClarificationContext) {
      // If error happened during clarification resolution
      responseText =
        "Sorry, I had trouble processing your choice. Could you try selecting again?";
    }

    return {
      actionType: "respond_directly",
      responseText,
      reasoning: `Fallback due to error in orchestrator: ${
        error instanceof Error ? error.message : String(error)
      }`,
      clarificationContextToSave: activeClarificationContext || null,
      timezoneInfo: timezoneInfo,
    };
  }
}
