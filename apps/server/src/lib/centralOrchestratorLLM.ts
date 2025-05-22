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

  return history
    .map((turn) => {
      const messagePrefix = `${turn.actor === "USER" ? "User" : "Assistant"}:`;
      let messageText = turn.messageText;

      if (
        turn.actor === "ASSISTANT" &&
        turn.toolCalled?.startsWith("planner->create_event") &&
        turn.toolResult &&
        Array.isArray(turn.toolResult)
      ) {
        const createdEvents = turn.toolResult as Array<any>; // Assuming this matches CreatedEventDetails structure
        if (createdEvents.length > 0) {
          const eventSummaries = createdEvents
            .map((event) => {
              const summary = event.summary || "Unnamed Event";
              let startTime = "Unknown Start Time";
              if (event.start) {
                if (event.start.dateTime) startTime = event.start.dateTime;
                else if (event.start.date) startTime = `${event.start.date} (all-day)`;
              }
              return `'${summary}' starting ${startTime}`;
            })
            .join("; ");
          // Append this structured summary to the assistant's original message text for the history
          messageText += `\n[System Note: I successfully scheduled: ${eventSummaries}]`;
        }
      }
      // Future enhancement: Could similarly summarize other tool calls/results if useful for orchestrator context.

      return `${messagePrefix} ${messageText}`;
    })
    .join("\n");
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

export async function getNextAction(
  conversationHistory: ConversationTurn[],
  currentUserMessage: string,
  userTimezone: string,
  userCalendarsFormatted: string,
  isClarificationRequest?: boolean // New optional flag
): Promise<OrchestratorDecision> {
  const formattedHistory = formatConversationHistoryForPrompt(conversationHistory);
  
  // Calculate current time in user's timezone for better date reference
  const now = new Date();
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
  
  // Calculate timezone offset for the user's timezone using proper method
  const timezoneOffset = getTimezoneOffset(userTimezone);
  
  let systemPromptContent: string;

  // Check if the last assistant turn in history has clarification context to resolve
  const lastAssistantTurnWithContext = conversationHistory
    .slice()
    .reverse()
    .find((turn) => turn.actor === "ASSISTANT" && turn.clarificationContext);

  let activeClarificationContext: any = null;
  if (
    lastAssistantTurnWithContext &&
    lastAssistantTurnWithContext.clarificationContext &&
    typeof lastAssistantTurnWithContext.clarificationContext === "object"
  ) {
    activeClarificationContext = lastAssistantTurnWithContext.clarificationContext;
  }

  if (
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
    Current Date/Time: ${userLocalTime} (This is the current time in ${userTimezone})
    Timezone Offset: ${timezoneOffset} (Use this exact offset for ISO8601 formatting)
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
    Current Date/Time: ${userLocalTime} (This is the current time in ${userTimezone})
    Timezone Offset: ${timezoneOffset} (Use this exact offset for ISO8601 formatting)

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
    Current Date/Time: ${userLocalTime} (This is the current time in ${userTimezone})
    Timezone Offset: ${timezoneOffset} (Use this exact offset for ISO8601 formatting)

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

    systemPromptContent = `You are a top-level AI orchestrator for a calendar assistant. Your primary goal is to understand the user's intent based on their latest message and the provided conversation history.

    User's Timezone: ${userTimezone}
    User's Available Calendars: ${userCalendarsFormatted || "Not available"}
    Current Date/Time: ${userLocalTime} (This is the current time in ${userTimezone})
    Timezone Offset: ${timezoneOffset} (Use this exact offset for ISO8601 formatting)

    Conversation History (if available):
    ${formattedHistory}
    (When reviewing history, ASSISTANT turns may have a 'toolResult' field if a tool was successfully used, or a 'System Note' if it summarized an action like event creation. The ASSISTANT's actual textual response to the user is in 'messageText'.)

    **Detecting When Existing Event Context Is Needed:**
    Pay careful attention to user requests that reference existing events OR temporal relationships that are NOT detailed in the conversation history. Look for BOTH explicit and implicit references:
    
    **Explicit Event References:**
    - "Schedule a meeting before my class on Thursday"
    - "Add lunch after my dentist appointment tomorrow"
    - "Create a reminder 30 minutes before my flight next week"
    - "Book a follow-up call after my interview on Friday"
    
    **Implicit Temporal References (CRITICAL):**
    - "after work today/tomorrow" → Need to find work events to determine when work ends
    - "before work starts" → Need to find when work begins
    - "after lunch" → Need to find lunch appointments/blocks
    - "before my first meeting" → Need to find the first meeting of the day
    - "after my last appointment" → Need to find the last appointment
    - "between meetings" → Need to find meeting schedule
    - "during my break" → Need to find surrounding events to identify breaks
    - "after hours" → Need to find work schedule
    - "before the weekend" → Need to find Friday's last event
    
    **Key Detection Pattern:** If the user mentions any time relationship (before/after/during/between) with:
    - work, meetings, appointments, lunch, breaks, classes, etc.
    - AND the conversation history does NOT contain specific details about these events for the referenced time period
    - THEN use 'fetch_context_and_call_planner'
    
    If the user references existing events (using explicit terms like "my class", "my appointment" OR implicit temporal relationships like "after work", "before lunch") but the conversation history does NOT contain details about these specific events for the referenced timeframe, you should use the 'fetch_context_and_call_planner' action to first query the calendar for the referenced events.

    **Handling Follow-up Questions & Relative Event Creation:**
    Pay close attention to the last ASSISTANT message in the 'Conversation History'.
    If the user's current message is short and seems to directly follow up on the information the assistant just provided (e.g., User: "What time is that?" after Assistant: "Your next work event is on May 22nd."), you MUST interpret the user's message in that context.
    - If the follow-up implies a new calendar operation based on the context (e.g., User: "Cancel it" after Assistant: "You have a meeting at 2 PM titled 'Project Sync'"), then formulate a comprehensive input for the 'call_planner' action by combining the user's implicit intent with the details from the previous turn. For example, for "Cancel it", the input to the planner might become "Cancel the 'Project Sync' meeting at 2 PM".
    - **Relative Event Creation (IMPORTANT):** If the user's current message asks to create new events relative to an event or events that were explicitly detailed in the recent conversation history (e.g., user says "schedule a follow-up call one week after my meeting with Dr. Lee" after the assistant just confirmed "Meeting with Dr. Lee scheduled for June 3, 3:00 PM - 4:00 PM"), you MUST:
        1.  Identify the anchor event(s) from the conversation history (look at previous ASSISTANT turns for event creation details, or if the assistant listed event details).
        2.  Extract the summary, start (with dateTime or date and timeZone), end (with dateTime or date and timeZone), and calendarId of these anchor event(s).
        3.  Your action should be call_planner.
        4.  In params, userInput should be the user's current raw request for the *new* events (e.g., "schedule a follow-up call one week after my meeting with Dr. Lee").
        5.  In params, you MUST also include an anchorEventsContext array. Each object in this array should represent one anchor event you extracted, containing its summary, start, end, and calendarId.
    - If the follow-up asks for more details about something the assistant just mentioned (e.g., User: "What is the location?" after Assistant: "Your next event is 'Team Lunch'"), and this requires looking up calendar information again, use 'call_planner' with a specific query (e.g., "What is the location of the 'Team Lunch' event?").
    - If the follow-up is a simple acknowledgment or doesn't require a calendar action, 'respond_directly' might be appropriate.

    Based on the user's message (provided separately) and the conversation history (especially the last assistant turn for follow-ups), decide the best course of action.

    Your available actions are:
    1. 'call_planner': If the user's request seems like a new calendar-related task (creating, listing, updating, deleting events) that requires detailed parsing of dates, times, summaries, etc., OR if it's a follow-up question that requires a new calendar operation or re-querying for more details (as described under "Handling Follow-up Questions & Relative Event Creation"). The planner is specialized for this.
       - If the request is for a DELETION task (e.g., "delete the meeting I just scheduled", "remove the events you created earlier"):
         - Assess if the user is likely asking to delete a SINGLE item or MULTIPLE/UNSPECIFIED items. Include this assessment in 'params.originalRequestNature': 'singular' or 'plural_or_unspecified'.
         - **IMPORTANT FOR DELETING RECENTLY CREATED EVENTS:** If the user refers to deleting events "just scheduled" or "you just created", examine the recent ASSISTANT turns in the 'Conversation History'. Look for 'toolResult' or 'System Note' that contains details of created events (like an array of event objects with 'start' and 'end' properties or summaries). If found, calculate a consolidated 'timeMin' and 'timeMax' that encompasses all such recently created events. Pass these 'timeMin' and 'timeMax' values in the 'params' object to the planner. This helps the planner accurately scope the deletion. If no such events are found in history, or the reference is not clearly to *just* created events, let the planner determine timeMin/Max.
    
    2. 'fetch_context_and_call_planner': Use this when the user wants to create, modify, or reference existing events that are NOT detailed in the conversation history. This action will:
       - First query the calendar to find the referenced events
       - Then proceed with planning using the found events as anchor context
       - In params, provide:
         * 'userInput': The user's original request
         * 'contextQuery': Keywords to find the referenced event. For explicit references, use event names (e.g., 'class', 'dentist appointment'). For implicit temporal references, use relevant keywords (e.g., 'work' for 'after work', 'meeting' for 'after my last meeting', 'appointment' for 'before my first appointment')
         * 'contextTimeMin' and 'contextTimeMax': Time range to search for the referenced events (be generous to ensure we find them)
         * 'contextCalendarIds': Array of calendar IDs to search (optional, omit this field entirely to search all calendars, or provide array of specific calendar IDs)
       - Examples of when to use this:
         * "Schedule a meeting before my class on Thursday" (need to find "class on Thursday")
         * "Add travel time before my dentist appointment tomorrow" (need to find "dentist appointment tomorrow")
         * "Create a follow-up after my interview next week" (need to find "interview next week")
         * "Schedule a meeting with Sam after work today" (need to find work events today to determine when work ends)
         * "Book lunch after my morning meetings" (need to find morning meetings to determine when they end)
         * "Add a call before my first appointment tomorrow" (need to find first appointment tomorrow)
         * "Schedule dinner after my last meeting Friday" (need to find last meeting on Friday)

    3. 'respond_directly': If the user's message is a general chat, a greeting, a simple thank you, or if the conversation history (including a recent assistant response) indicates the current message doesn't require a calendar action or can be answered directly from the very recent context of the conversation. For example, if the assistant just listed events and the user asks "is the first one a work event?", and the assistant's previous message text clearly contains this detail, you *could* respond directly if the information is trivial to extract from the immediate past turn. However, for complex extractions or if unsure, prefer 'call_planner'.
    
    4. 'ask_user_question': If the user's intent is unclear *before calling any tools or the planner*, and you need to ask a clarifying question before proceeding with any other action. This should generally not be used for follow-up questions where context is available; instead, use 'call_planner' with a refined query for such cases.
    
    Output your decision ONLY as a single, valid JSON object matching the following schema, with no other surrounding text or markdown:
    {
      "actionType": "call_planner" | "fetch_context_and_call_planner" | "respond_directly" | "ask_user_question",
      "params": {
        "userInput": "The input for the planner. If the user's current message is a follow-up referring to details from a previous turn (e.g., 'do that again but change X', 'add those with summary Y', 'what time is that?'), combine the key details (like times, dates, locations, summaries of events just mentioned by assistant) from the relevant previous turn(s) in the conversation history with the user's current message to form a complete instruction for the planner. For entirely new requests, this will just be the user's current message. Use common sense and formulate a clear, actionable request for the planner.",
        "originalRequestNature": "<If actionType is call_planner AND intent is deletion, specify 'singular' or 'plural_or_unspecified'. Omit otherwise.>",
        "timeMin": "<Optional: If deleting 'just created' events, provide calculated ISO8601 timeMin based on history. Planner will use this. Also applicable if a follow-up implies a time constraint for the planner based on previous turns.>",
        "timeMax": "<Optional: If deleting 'just created' events, provide calculated ISO8601 timeMax based on history. Planner will use this. Also applicable if a follow-up implies a time constraint for the planner based on previous turns.>",
        "anchorEventsContext": "<Optional: If creating new events relative to events detailed in recent conversation history, provide an array of anchor event objects here, each with summary, start, end, and calendarId.>",
        "contextQuery": "<For fetch_context_and_call_planner: Keywords to find the referenced existing event. For explicit references, use event names (e.g., 'class', 'dentist appointment'). For implicit temporal references, use relevant keywords (e.g., 'work' for 'after work', 'meeting' for 'after my last meeting', 'appointment' for 'before my first appointment')>",
        "contextTimeMin": "<For fetch_context_and_call_planner: Start of time range to search for referenced events. MUST use timezone-aware ISO8601 format (e.g., '2025-05-22T00:00:00${timezoneOffset}'). When user says 'today', use current date in their timezone.>",
        "contextTimeMax": "<For fetch_context_and_call_planner: End of time range to search for referenced events. MUST use timezone-aware ISO8601 format (e.g., '2025-05-22T23:59:59${timezoneOffset}'). When user says 'today', use end of current date in their timezone.>",
        "contextCalendarIds": "<For fetch_context_and_call_planner: Array of calendar IDs to search (optional, omit this field entirely to search all calendars, or provide array of specific calendar IDs)>"
      },
      "responseText": "If actionType is 'respond_directly' or 'ask_user_question', this is your textual response to the user. Otherwise, this can be omitted. Be as human-like and kind as possible. Act like a personal assistant.",
      "reasoning": "Briefly explain your decision.",
      "clarificationContextToSave": null
    }
    
    Prioritize 'call_planner' for anything that looks like a new calendar modification task or a contextual follow-up needing calendar data. Use 'fetch_context_and_call_planner' when the user references existing events not in conversation history. If the user is just saying 'hi' or 'thanks', use 'respond_directly'. If very unsure, use 'ask_user_question', but prefer re-querying via planner for ambiguous follow-ups.
    
    **CRITICAL PRIORITY RULE: If the user mentions ANY temporal relationship (before/after/during/between) that references potentially existing events or schedules (work, meetings, appointments, lunch, classes, etc.), and these specific events are NOT detailed in the conversation history, you MUST use 'fetch_context_and_call_planner'. Do NOT default to 'call_planner' for these cases.**
    
    **DATE CALCULATION RULE: When calculating contextTimeMin/contextTimeMax for relative dates:**
    - "today" = current date shown above (${userLocalTime.split(',')[0]})
    - "tomorrow" = next day after current date  
    - Always use the user's timezone (${userTimezone}) for date calculations
    - **CRITICAL**: Always include timezone in ISO8601 format (e.g., "2025-05-22T00:00:00-07:00", not "2025-05-22T00:00:00")
    - Example: If current time is "2025-05-22 14:30:00" and user says "after work today", search from "2025-05-22T00:00:00${timezoneOffset}" to "2025-05-22T23:59:59${timezoneOffset}" for ${userTimezone} timezone
    
    Ensure the output is nothing but the JSON object.`;
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
    };
  }
}
