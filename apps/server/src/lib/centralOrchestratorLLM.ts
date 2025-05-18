import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ConversationTurn } from '@prisma/client';
import { OrchestratorDecision, OrchestratorActionType, DeletionCandidate } from '../types/orchestrator';
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
  actionType: z.enum(["call_planner", "respond_directly", "ask_user_question", "ask_user_clarification_for_tool_ambiguity", "perform_google_calendar_action"]),
  params: z.object({
    userInput: z.string().optional(), // User input might be passed to planner
    originalRequestNature: z.enum(["singular", "plural_or_unspecified"]).optional(), // Hint for deletion requests
    // Fields for when actionType is 'ask_user_clarification_for_tool_ambiguity'
    // The candidates themselves are passed in the main prompt to the LLM in this flow
    // but LLM might decide to put some processed version or original query here.
    originalUserQueryForClarification: z.string().optional(), 
    // Params for perform_google_calendar_action
    GCToolName: z.string().optional(), 
    GCToolArgs: z.any().optional(),    
  }).passthrough().optional(), 
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
  // Format history for the prompt, alternating roles if necessary for some models
  // For Gemini, a simple USER/ASSISTANT log should be fine.
  return history
    .map(turn => `${turn.actor === 'USER' ? 'User' : 'Assistant'}: ${turn.messageText}`)
    .join("\n");
}

export async function getNextAction(
  conversationHistory: ConversationTurn[],
  currentUserMessage: string,
  userTimezone: string,
  userCalendarsFormatted: string,
  isClarificationRequest?: boolean // New optional flag
): Promise<OrchestratorDecision> {

  const formattedHistory = formatConversationHistoryForPrompt(conversationHistory);
  let systemPromptContent;

  // Check if the last assistant turn in history has clarification context to resolve
  const lastTurn = conversationHistory.length > 0 ? conversationHistory[conversationHistory.length - 1] : null;
  const lastAssistantTurnWithContext = conversationHistory
    .slice().reverse()
    .find(turn => turn.actor === 'ASSISTANT' && turn.clarificationContext);
  
  let activeClarificationContext: any = null;
  if (lastAssistantTurnWithContext && lastAssistantTurnWithContext.clarificationContext && typeof lastAssistantTurnWithContext.clarificationContext === 'object') {
    activeClarificationContext = lastAssistantTurnWithContext.clarificationContext;
  }

  if (activeClarificationContext && activeClarificationContext.type === 'delete_candidates_for_confirmation') {
    // Mode: Resolve pending clarification for deletion
    const candidates = activeClarificationContext.candidates as DeletionCandidate[]; // Assuming DeletionCandidate type is available
    const originalQuery = activeClarificationContext.originalUserQuery;

    systemPromptContent = `You are a top-level AI orchestrator for a calendar assistant. 
    You previously asked the user to clarify which event(s) to delete from a list of candidates. 
    The user has now responded. Your task is to interpret their response in the context of the candidates and decide on the final deletion action.

    User's Timezone: ${userTimezone}
    Original User Query that led to clarification: "${originalQuery}"
    Candidates previously presented to user:
    ${candidates.map((c, idx) => `${idx + 1}. ${c.summary || c.eventId} (ID: ${c.eventId}, Calendar: ${c.calendarId}, Start: ${c.startTime || 'N/A'})`).join('\n')}
    
    Conversation History (most recent messages lead to this point):
    ${formattedHistory}
    User's Current Response (to your clarification question): "${currentUserMessage}"

    Based on the user's current response, identify which of the candidates (by their eventId and calendarId) they want to delete. 
    - If they confirm deletion of specific items (e.g., "the first one", "delete 1 and 3", "yes, the one at 10am"), prepare to delete them.
    - If they say "none", "cancel", or indicate they don't want to delete any from the list, then no deletion should occur.

    Your available actions are:
    1. 'perform_google_calendar_action': If the user clearly confirms which event(s) to delete. 
       - The 'params.GCToolName' should be 'delete_event_direct'.
       - The 'params.GCToolArgs' should be an array of objects, each like: {"eventId": "...". "calendarId": "..."} for the selected events.
       - 'responseText' should confirm the action (e.g., "Okay, I've deleted [Event Summaries].") or state that no events were deleted if that was the choice.
    2. 'respond_directly': If the user's response is unclear, or if they chose not to delete anything and you just need to acknowledge (e.g., "Okay, no events were deleted.").

    Output your decision ONLY as a single, valid JSON object. Schema:
    {
      "actionType": "perform_google_calendar_action" | "respond_directly",
      "params": { 
        "GCToolName": "delete_event_direct", // If deleting
        "GCToolArgs": [{"eventId": "id1", "calendarId": "calId1"}, ...], // If deleting
        "userInput": "<user's current response>" // Optional, for logging or context
      },
      "responseText": "<Your confirmation or response to the user>",
      "reasoning": "Briefly explain your decision based on user's clarification.",
      "clarificationContextToSave": null // No further context needed usually
    }
    Be as human-like and kind as possible.`;

  } else if (isClarificationRequest) {
    // Mode: Formulate a clarification question (Phase 2 logic)
    systemPromptContent = `You are a top-level AI orchestrator for a calendar assistant. 
    The system has encountered ambiguity after trying to process a user\'s request. 
    Your task is to formulate a clear question to the user to resolve this ambiguity. 
    The user\'s original query and the ambiguous items found by a tool will be provided in the user message (prefixed with SYSTEM_CLARIFICATION_REQUEST).

    User\'s Timezone: ${userTimezone}
    Conversation History (if available):
    ${formattedHistory}

    Based on the SYSTEM_CLARIFICATION_REQUEST, craft a user-facing question. 
    For example, if candidates for deletion are provided, ask the user to specify which one(s) they want to delete, perhaps by listing them with numbers.

    Your available actions are:
    1. 'ask_user_clarification_for_tool_ambiguity': Formulate the question and provide it in 'responseText'. You should also decide what context needs to be saved for the next turn to understand the user\'s answer. This context should be placed in 'clarificationContextToSave'. For example, if you list candidates [A, B, C], then 'clarificationContextToSave' should contain these candidates and their original details so the system can map the user\'s answer (e.g., "the first one") back to the correct item.

    Output your decision ONLY as a single, valid JSON object matching the following schema, with no other surrounding text or markdown:
    {
      "actionType": "ask_user_clarification_for_tool_ambiguity",
      "params": { "originalUserQueryForClarification": "<The user\'s original query that led to ambiguity>" },
      "responseText": "<Your user-facing clarification question listing choices if appropriate>",
      "reasoning": "Briefly explain why you are asking this question.",
      "clarificationContextToSave": { "type": "delete_candidates_for_confirmation", "candidates": [{"eventId": "id1", "summary": "Summary A", "calendarId": "cal1", "startTime": "..."}, ...], "originalUserQuery": "<user\'s original query>" }
    }
    Be as human-like and kind as possible. Ensure the output is nothing but the JSON object.`;
  } else {
    // Mode: Standard request processing (Phase 1 logic)
    systemPromptContent = `You are a top-level AI orchestrator for a calendar assistant. Your primary goal is to understand the user\'s intent based on their latest message and the provided conversation history.

    User\'s Timezone: ${userTimezone}
    User\'s Available Calendars: ${userCalendarsFormatted || 'Not available'}

    Conversation History (if available):
    ${formattedHistory}

    Based on the user\'s message (provided separately) and the conversation history above, decide the best course of action. 

    Your available actions are:
    1. 'call_planner': If the user\'s request seems like a new calendar-related task (creating, listing, updating, deleting events) that requires detailed parsing of dates, times, summaries, etc. The planner is specialized for this.
       - If the request is for a DELETION task, assess if the user is likely asking to delete a SINGLE item (e.g., "delete my meeting with John") or MULTIPLE/UNSPECIFIED items (e.g., "delete my meetings on Monday", "clear my schedule tomorrow"). Include this assessment in the 'params' object as 'originalRequestNature': 'singular' or 'originalRequestNature': 'plural_or_unspecified'.
    2. 'respond_directly': If the user\'s message is a general chat, a greeting, a simple thank you, or if the conversation history indicates the current message doesn\'t require a calendar action. Also use this if you are very confident you can answer a simple question without needing tools. You can also use the 'Conversation History' section to answer direct questions the user might ask about your ongoing conversation.
    3. 'ask_user_question': If the user\'s intent is unclear *before calling any tools or the planner*, and you need to ask a clarifying question before proceeding with any other action.
    
    Output your decision ONLY as a single, valid JSON object matching the following schema, with no other surrounding text or markdown:
    {
      "actionType": "call_planner" | "respond_directly" | "ask_user_question",
      "params": { 
        "userInput": "The input for the planner. If the user's current message is a follow-up referring to details from a previous turn (e.g., 'do that again but change X', 'add those with summary Y'), combine the key details (like times, dates, locations) from the relevant previous turn(s) in the conversation history with the user's current message to form a complete instruction for the planner. For entirely new requests, this will just be the user's current message. Use common sense and do stuff that makes sense badically with the user's conversation in mind.",
        "originalRequestNature": "<If actionType is call_planner AND intent is deletion, specify 'singular' or 'plural_or_unspecified'. Omit otherwise.>"
      },
      "responseText": "If actionType is 'respond_directly' or 'ask_user_question', this is your textual response to the user. Otherwise, this can be omitted. Be as human-like and kind as possible. Act like a personal assistant.",
      "reasoning": "Briefly explain your decision.",
      "clarificationContextToSave": null
    }
    
    Prioritize 'call_planner' for anything that looks like a new calendar modification task. If the user is just saying "hi" or "thanks", use "respond_directly". If very unsure, use "ask_user_question". Be as human-like as possible.
    Ensure the output is nothing but the JSON object.`;
  }

  const messages = [];
  messages.push(new SystemMessage(systemPromptContent));
  
  // Add formatted history as alternating User/Assistant messages if model prefers that, 
  // or as a block. For now, simpler formatting in system prompt. 
  // If needed, could map `conversationHistory` to `HumanMessage` and `AIMessage` instances.
  // For now, the history is part of the system prompt.
  // The key change is ensuring the current user message is a distinct `HumanMessage`.
  if (formattedHistory !== "No previous conversation history.") {
      // This is tricky; some models want clear role separation. For now, history is in system.
      // If issues persist, we might need to map conversationHistory to HumanMessage/AIMessage array. Example:
      // conversationHistory.forEach(turn => {
      //   if (turn.actor === 'USER') messages.push(new HumanMessage(turn.messageText));
      //   else messages.push(new AIMessage(turn.messageText)); 
      // });
  }
  messages.push(new HumanMessage(currentUserMessage)); // Current user message as HumanMessage

  console.log(`[CentralOrchestratorLLM] Getting next action for input: "${currentUserMessage}"`);
  // For debugging the exact messages sent:
  // console.log("[CentralOrchestratorLLM] Messages being sent to LLM:", JSON.stringify(messages, null, 2));

  try {
    const result = await orchestratorLLM.invoke(messages);
    let llmOutput = result.content;

    if (typeof llmOutput !== 'string') {
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

    let finalParams = validatedDecision.params;
    if (validatedDecision.actionType === 'call_planner') {
      if (!finalParams) finalParams = {};
      if (!finalParams.userInput) {
        finalParams.userInput = currentUserMessage;
      }
    } else if (validatedDecision.actionType === 'perform_google_calendar_action') {
        if (!finalParams) finalParams = {}; // Ensure params object exists
        // GCToolName and GCToolArgs should be directly in validatedDecision.params from LLM
        if (!finalParams.GCToolName || !finalParams.GCToolArgs) {
            console.warn("[CentralOrchestratorLLM] 'perform_google_calendar_action' is missing GCToolName or GCToolArgs from LLM. This might lead to errors.");
        }
    }

    return {
      actionType: validatedDecision.actionType as OrchestratorActionType,
      params: finalParams,
      responseText: validatedDecision.responseText,
      reasoning: validatedDecision.reasoning,
      clarificationContextToSave: validatedDecision.clarificationContextToSave
    };

  } catch (error: unknown) {
    console.error("[CentralOrchestratorLLM] Error getting or validating orchestrator decision:", error);
    if (error instanceof ZodError) {
      console.error("[CentralOrchestratorLLM] Zod Validation Errors for LLM output:", JSON.stringify(error.format(), null, 2));
    }
    // Fallback for errors
    let responseText = "I'm having a little trouble understanding right now. Could you please try rephrasing your request?";
    if (activeClarificationContext) { // If error happened during clarification resolution
        responseText = "Sorry, I had trouble processing your choice. Could you try selecting again?";
    }

    return {
      actionType: 'respond_directly', // Fallback to direct response
      responseText: responseText,
      reasoning: `Fallback due to error in orchestrator: ${error instanceof Error ? error.message : String(error)}`,
      clarificationContextToSave: activeClarificationContext || null // Preserve context if error during resolution attempt
    };
  }
} 