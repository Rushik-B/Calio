import { ConversationTurn } from '@prisma/client';

// This type can be used if we need a simplified version of ConversationTurn for the orchestrator's input processing.
// However, for passing history directly, using the Prisma-generated ConversationTurn type is often more robust.
export interface ConversationTurnInput {
  actor: 'USER' | 'ASSISTANT';
  messageText: string;
  timestamp?: Date; // Optional, as Prisma type has it as non-optional with default
  // Add other fields from ConversationTurn if they become relevant for the orchestrator's direct decision-making logic
}

export type OrchestratorActionType =
  | 'call_planner'
  | 'call_event_creator_llm' // Example for future direct LLM calls by orchestrator
  | 'call_event_deleter_llm_for_clarification' // Example for future direct LLM calls by orchestrator
  | 'ask_user_question' // When the orchestrator itself needs to ask for clarification
  | 'respond_directly' // For general chat, simple acknowledgements, or direct answers
  | 'perform_google_calendar_action'; // Example for future direct tool use by orchestrator

export interface OrchestratorDecision {
  actionType: OrchestratorActionType;
  params?: any; // Parameters for the chosen action (e.g., input for planner)
  responseText?: string | null; // If actionType is 'respond_directly' or 'ask_user_question'
  clarificationContextToSave?: any; // If asking a question, context to save for follow-up (relevant for requiresFollowUp)
  reasoning?: string; // For debugging or to provide context for general_chat responses
  // Potentially add requiresFollowUp directly to the decision if orchestrator handles this state.
}

// It can also be useful to have a more specific type for the history passed to the orchestrator's prompt, separate from the DB model
// For now, we'll use the Prisma ConversationTurn type directly in getNextAction function signature. 