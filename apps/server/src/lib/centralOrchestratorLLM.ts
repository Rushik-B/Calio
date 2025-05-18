import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ConversationTurn } from '@prisma/client';
import { OrchestratorDecision, OrchestratorActionType } from '../types/orchestrator';
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
  actionType: z.enum(["call_planner", "respond_directly", "ask_user_question"]),
  params: z.any().optional(), // Can be refined later if specific structures are needed for certain params
  responseText: z.string().nullable().optional(),
  reasoning: z.string().optional(),
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
  userCalendarsFormatted: string
): Promise<OrchestratorDecision> {

  const formattedHistory = formatConversationHistoryForPrompt(conversationHistory);

  // System prompt now more general, user message will be separate.
  const systemPromptContent = `You are a top-level AI orchestrator for a calendar assistant. Your primary goal is to understand the user\'s intent based on their latest message and the provided conversation history.

User\'s Timezone: ${userTimezone}
User\'s Available Calendars: ${userCalendarsFormatted || 'Not available'}

Conversation History (if available):
${formattedHistory}

Based on the user\'s message (provided separately) and the conversation history above, decide the best course of action. 

Your available actions are:
1. 'call_planner': If the user\'s request seems like a new calendar-related task (creating, listing, updating, deleting events) that requires detailed parsing of dates, times, summaries, etc. The planner is specialized for this.
2. 'respond_directly': If the user\'s message is a general chat, a greeting, a simple thank you, or if the conversation history indicates the current message doesn\'t require a calendar action. Also use this if you are very confident you can answer a simple question without needing tools. You can also use the 'Conversation History' section to answer direct questions the user might ask about your ongoing conversation.
3. 'ask_user_question': If the user\'s intent is unclear, and you need to ask a clarifying question before proceeding with any other action.

Output your decision ONLY as a single, valid JSON object matching the following schema, with no other surrounding text or markdown:
{
  "actionType": "call_planner" | "respond_directly" | "ask_user_question",
  "params": { /* if actionType is 'call_planner', this can be an empty object for now or contain {"userInput": "<original user message>"} */ },
  "responseText": "If actionType is 'respond_directly' or 'ask_user_question', this is your textual response to the user. Otherwise, this can be omitted. Be as human-like and kind as possible. Act like a personal assistant.",
  "reasoning": "Briefly explain your decision."
}

Prioritize 'call_planner' for anything that looks like a new calendar modification task. If the user is just saying "hi" or "thanks", use "respond_directly". If very unsure, use "ask_user_question". Be as human-like as possible.
Ensure the output is nothing but the JSON object.`;

  // Construct messages array with history and current user message
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
    if (validatedDecision.actionType === 'call_planner' && (!finalParams || Object.keys(finalParams).length === 0)) {
      finalParams = { userInput: currentUserMessage }; 
    }

    return {
      actionType: validatedDecision.actionType as OrchestratorActionType,
      params: finalParams,
      responseText: validatedDecision.responseText,
      reasoning: validatedDecision.reasoning,
    };

  } catch (error: unknown) {
    console.error("[CentralOrchestratorLLM] Error getting or validating orchestrator decision:", error);
    if (error instanceof ZodError) {
      console.error("[CentralOrchestratorLLM] Zod Validation Errors for LLM output:", JSON.stringify(error.format(), null, 2));
    }
    return {
      actionType: 'respond_directly',
      responseText: "I'm having a little trouble understanding right now. Could you please try rephrasing your request?",
      reasoning: `Fallback due to error in orchestrator: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
} 