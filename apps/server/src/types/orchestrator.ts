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
  | 'ask_user_question' // When the orchestrator itself needs to ask for clarification *before* any tool/planner
  | 'ask_user_clarification_for_tool_ambiguity' // When a tool/planner execution was ambiguous and needs user input
  | 'respond_directly' // For general chat, simple acknowledgements, or direct answers
  | 'perform_google_calendar_action'; // Example for future direct tool use by orchestrator

export interface DeletionCandidate {
  eventId: string;
  calendarId: string;
  summary?: string;
  // Add other relevant details like start time to help user identify
  startTime?: string; 
}

export interface OrchestratorDecision {
  actionType: OrchestratorActionType;
  params?: {
    userInput?: string;
    originalRequestNature?: "singular" | "plural_or_unspecified"; // Hint for planner
    // For 'perform_google_calendar_action'
    GCToolName?: 'delete_event_direct' | string; // e.g. 'delete_event_direct'
    GCToolArgs?: any; // Arguments for the direct GC call
    // For 'ask_user_clarification_for_tool_ambiguity'
    ambiguousCandidates?: DeletionCandidate[]; // Candidates that caused ambiguity
    originalUserQueryForClarification?: string; // The user query that led to ambiguity
  } | any; 
  responseText?: string | null; 
  clarificationContextToSave?: {
    type: 'delete_candidates_for_confirmation' | string; // Type of context being saved
    candidates?: DeletionCandidate[]; // List of candidates if type is 'delete_candidates_for_confirmation'
    originalUserQuery?: string;
    // other context fields
  } | any; 
  reasoning?: string; 
}

// It can also be useful to have a more specific type for the history passed to the orchestrator's prompt, separate from the DB model
// For now, we'll use the Prisma ConversationTurn type directly in getNextAction function signature. 