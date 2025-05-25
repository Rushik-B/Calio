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
  | 'fetch_context_and_call_planner' // New: Query calendar for context, then call planner
  | 'call_event_creator_llm' // Example for future direct LLM calls by orchestrator
  | 'call_event_deleter_llm_for_clarification' // Example for future direct LLM calls by orchestrator
  | 'ask_user_question' // When the orchestrator itself needs to ask for clarification *before* any tool/planner
  | 'ask_user_clarification_for_tool_ambiguity' // When a tool/planner execution was ambiguous and needs user input
  | 'respond_directly' // For general chat, simple acknowledgements, or direct answers
  | 'perform_google_calendar_action' // Example for future direct tool use by orchestrator
  | 'execute_workflow'; // New: For complex multi-step workflows

export interface DeletionCandidate {
  eventId: string;
  calendarId: string;
  summary?: string;
  // Add other relevant details like start time to help user identify
  startTime?: string; 
}

// Task interface for workflow-based operations
export interface Task {
  id: string; // Unique ID for this task instance in the workflow (e.g., "find_friday_meetings")
  taskType: string; // Predefined type of operation (see task types below)
  params?: any; // Parameters specific to this taskType (optional to match Zod schema)
  dependsOn?: string[]; // IDs of tasks that must complete successfully before this one starts
  status?: 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'waiting_for_user'; // Execution status
  result?: any; // Output of this task, stored in workflow context
  outputVariable?: string; // Key under which to store result in workflowContext.dataBus
  humanSummary?: string; // A brief description of what this task does, for logging/debugging
  retries?: number; // Number of times this task has been retried
}

// Workflow definition containing multiple tasks
export interface WorkflowDefinition {
  name: string; // e.g., "ClearFridayAndNotify", "RescheduleMorningClasses"
  tasks: Task[];
  description?: string; // Optional description of what this workflow accomplishes
}

// Available task types for the workflow engine
export type TaskType = 
  // Data Retrieval
  | 'FetchPreference'
  | 'FindEvents' 
  | 'GetEventDetails'
  | 'CheckAvailability'
  | 'GetContactDetails'
  // Data Processing
  | 'FilterEvents'
  | 'SortEvents'
  | 'ExtractAttendees'
  | 'CalculateDuration'
  | 'FindTimeIntersection'
  | 'IdentifySpecificEventsFromList'
  | 'IdentifyMissingEvents'
  // Action Formulation
  | 'GenerateEventCreationPayload'
  | 'GenerateEventCreationPayloadBatch'
  | 'GenerateEventUpdatePayload'
  | 'GenerateEventUpdatePayloadBatch'
  | 'GenerateDeletionCandidateList'
  | 'SuggestLighteningStrategies'
  | 'FindAlternativeSlotsBatch'
  // Action Execution
  | 'ExecuteCalendarCreate'
  | 'ExecuteCalendarCreateBatch'
  | 'ExecuteCalendarUpdate'
  | 'ExecuteCalendarUpdateBatch'
  | 'ExecuteCalendarDelete'
  | 'ExecuteCalendarDeleteBatch'
  | 'SendNotificationPlaceholder'
  // User Interaction
  | 'RequestUserConfirmation'
  | 'PresentChoicesToUser'
  | 'RequestMissingInformation'
  | 'FormatFinalResponse'
  // Workflow Control (advanced)
  | 'BranchOnCondition'
  | 'LoopOverItems';

export interface OrchestratorDecision {
  // For simple, single-action decisions (backward compatibility)
  actionType?: OrchestratorActionType;
  params?: {
    userInput?: string;
    originalRequestNature?: "singular" | "plural_or_unspecified"; // Hint for planner
    // For 'perform_google_calendar_action'
    GCToolName?: 'delete_event_direct' | string; // e.g. 'delete_event_direct'
    GCToolArgs?: any; // Arguments for the direct GC call
    // For 'ask_user_clarification_for_tool_ambiguity'
    ambiguousCandidates?: DeletionCandidate[]; // Candidates that caused ambiguity
    originalUserQueryForClarification?: string; // The user query that led to ambiguity
    // For 'fetch_context_and_call_planner'
    contextQuery?: string; // Query to find referenced events (e.g., "class on Thursday")
    contextTimeMin?: string; // Time range for finding referenced events
    contextTimeMax?: string; // Time range for finding referenced events
    contextCalendarIds?: string[] | null; // Specific calendars to search (optional)
    timeMin?: string | null; // For other actions
    timeMax?: string | null; // For other actions
    anchorEventsContext?: Array<{
      summary: string;
      start: string;
      end: string;
      calendarId: string;
    }> | null; // Existing anchor events context
    [key: string]: any;
  } | any; 
  
  // For complex, multi-step decisions (new workflow capability)
  workflowDefinition?: WorkflowDefinition;
  
  // Common fields for both simple and complex decisions
  responseText?: string | null; 
  /**
   * @deprecated This field is deprecated and will be removed in a future version. 
   * The system now relies on conversational history analysis for follow-ups.
   * This will always be null in responses from centralOrchestratorLLM.
   */
  clarificationContextToSave?: any | null; 
  reasoning?: string; 
  // Centralized timezone information
  timezoneInfo?: {
    timezone: string;
    offset: string;
    userLocalTime: string;
    currentTimeInUserTZ: string;
    dates: {
      today: string;
      tomorrow: string;
      yesterday: string;
    };
    isoStrings: {
      todayStart: string;
      todayEnd: string;
      tomorrowStart: string;
      tomorrowEnd: string;
      yesterdayStart: string;
      yesterdayEnd: string;
      currentTime: string;
    };
  };
}

// It can also be useful to have a more specific type for the history passed to the orchestrator's prompt, separate from the DB model
// For now, we'll use the Prisma ConversationTurn type directly in getNextAction function signature.