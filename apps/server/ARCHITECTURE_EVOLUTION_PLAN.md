# Architectural Evolution Plan: Towards a Task-Based Workflow Engine

## 1. Introduction: The Challenge of Complexity

Our current calendar agent architecture, while effective for straightforward commands, faces significant challenges when confronted with complex, multi-faceted user queries. Requests involving:
- Multiple sequential actions
- Conditional logic
- Implicit context and user preferences
- Cross-cutting constraints
- Ambiguity requiring clarification

...are difficult to handle robustly with a single-pass planner that attempts to distill the entire request into one action.

**Examples of Challenging Queries:**
*   "Reschedule all my afternoon classes this month to mornings, but don't touch the ones on Mondays and leave time for lunch."
*   "Clear my calendar next Friday for travel and notify anyone I had meetings with."
*   "Can you move my Friday meetings to a time when everyone is available next week, but make sure I don't miss my gym?"
*   Follow-up: User: "What's my week look like?" Then: "Can you make Thursday lighter?" Then: "Move the team meeting but not the check-in."
*   "Don't schedule anything during my writing block, but if it's urgent, let me approve exceptions."
*   "Sync my work and personal calendars for the next month, but don't copy over events marked 'private'."

This document outlines a plan to evolve our architecture into a more powerful **Task-Based Workflow Engine**, capable of intelligently decomposing and executing such complex requests.

## 2. Proposed Architecture: Task-Based Workflow Engine

The core idea is to shift from a single "plan" to a dynamic "workflow" composed of smaller, manageable **tasks**.

**Key Components:**

### 2.1. Query Decomposer / Chief Orchestrator (Evolved `centralOrchestratorLLM.ts`)
*   **Role:** The intelligent front-door. Analyzes complex user input and decomposes it into a sequence or dependency graph of `Tasks`. For simple requests, it can still output a single, direct action.
*   **Input:** User query, conversation history (including `clarificationContext` from previous turns), user timezone, available calendars, current time, active clarification context (if any).
*   **Output:**
    *   For simple queries: A single `OrchestratorDecision` with `actionType` and `params` (largely as current).
    *   For complex queries: An `OrchestratorDecision` containing a `workflowDefinition: { name: string, tasks: Task[] }`.
*   **Task Definition (`Task` interface):**
    ```typescript
    // (To be defined in src/types/orchestrator.ts or a new src/types/workflow.ts)
    interface Task {
      id: string; // Unique ID for this task instance in the workflow (e.g., "find_friday_meetings")
      taskType: string; // Predefined type of operation (see examples below)
      // Parameters specific to this taskType. Structure depends on the taskType.
      // Examples:
      // For "FindEvents": { criteria: { dateRange: { start: string, end: string }, keywords?: string[], calendarIds?: string[] }, outputVariable: "fridayEvents" }
      // For "FilterEvents": { inputEventsRef: "fridayEvents", filterLogic: { dayOfWeek: "Monday", action: "exclude" }, outputVariable: "filteredFridayEvents" }
      // For "GenerateEventPayload": { details: { summary: string, start: string, end: string }, outputVariable: "eventApiPayload" }
      params: any; 
      dependsOn?: string[]; // IDs of tasks that must complete successfully before this one starts (e.g., ["find_friday_meetings"])
      status?: 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'waiting_for_user'; // Execution status
      result?: any; // Output of this task, stored in workflow context under `params.outputVariable` or a default name.
      retries?: number; // Number of times this task has been retried
      humanSummary?: string; // A brief description of what this task does, for logging/debugging (e.g., "Finding all meetings on Friday")
    }
    ```
*   **Example `taskType` values:**
    *   Data Retrieval: `FetchPreference`, `FindEvents`, `GetEventDetails`, `CheckAvailability`, `GetContactDetails`
    *   Data Processing: `FilterEvents`, `SortEvents`, `ExtractAttendees`, `CalculateDuration`, `FindTimeIntersection`
    *   Action Formulation: `GenerateEventCreationPayload`, `GenerateEventUpdatePayload`, `GenerateDeletionCandidateList`
    *   Action Execution: `ExecuteCalendarCreate`, `ExecuteCalendarUpdateBatch`, `ExecuteCalendarDeleteBatch`, `SendNotificationPlaceholder` (initially just text)
    *   User Interaction: `RequestUserConfirmation`, `PresentChoicesToUser`, `RequestMissingInformation`
    *   Workflow Control: `BranchOnCondition`, `LoopOverItems` (more advanced)
*   **Prompt Engineering Strategy for Decomposer:**
    *   The system prompt for `centralOrchestratorLLM.ts` will need to be extensively reworked.
    *   It must include a clear definition of the `Task` schema and various `taskType`s with their expected `params`.
    *   Provide multiple few-shot examples of complex user queries and their corresponding `workflowDefinition` (list of `Task` objects).
    *   Instruct the LLM to think step-by-step, identify necessary information, dependencies, and when user interaction is needed.
    *   Example Prompt Snippet (Conceptual):
        ```
        # ... (previous instructions about role, timezone, etc.) ...
        ## Complex Query Decomposition into Tasks:
        If the user's request requires multiple steps, information gathering, or conditional logic, you MUST decompose it into a workflow.
        A workflow consists of a list of tasks. Each task has an 'id', 'taskType', 'params', and optional 'dependsOn'.

        ### Available Task Types & Parameters:
        - taskType: "FetchPreference"
          params: { prefKey: string (e.g., "gym_schedule"), outputVariable: string }
          description: Fetches a user preference.
        - taskType: "FindEvents"
          params: { criteria: { dateRange?: { startISO: string, endISO: string }, date?: string, dayOfWeek?: string, timeOfDay?: string, keywords?: string[], eventIds?: string[], calendarIds?: string[] }, userTimezone: string, outputVariable: string }
          description: Finds events matching criteria.
        # ... (many more task types defined here) ...

        ### Example Decompositions:
        User Query: "Clear my calendar next Friday for travel and notify anyone I had meetings with."
        Workflow Output:
        {
          "workflowDefinition": {
            "name": "ClearFridayAndNotify",
            "tasks": [
              { "id": "find_friday_events", "taskType": "FindEvents", "params": { "criteria": { "date": "next_friday" }, "userTimezone": "{userTimezone}", "outputVariable": "friday_events_to_clear" } },
              { "id": "get_attendees", "taskType": "ExtractAttendees", "params": { "eventsRef": "friday_events_to_clear", "outputVariable": "attendees_to_notify" }, "dependsOn": ["find_friday_events"] },
              // ... more tasks for delete, create travel event, notify ...
            ]
          }
        }
        # ... (more examples) ...
        ```
*   **`dependsOn` Practicality:** The Workflow Engine (in `chatController.ts`) will use this. A task is `ready` if all tasks listed in its `dependsOn` array have `status: 'completed'`.

### 2.2. Task Executor / Workflow Engine (Evolved `chatController.ts`)
*   **Role:** Receives the `workflowDefinition` (or a single action) from the Decomposer. Manages the step-by-step execution of tasks, orchestrating calls to "Skills" and handling data flow.
*   **Workflow Context (`workflowContext`):**
    *   An in-memory object or a more persistent store (if workflows can be long-lived or paused across multiple user interactions). Initially, in-memory for a single request lifecycle is fine.
    *   Structure:
        ```typescript
        interface WorkflowContext {
          workflowId: string; // Could be conversationId or a new UUID
          originalUserQuery: string;
          tasks: Task[]; // The full list of tasks, with statuses and results being updated
          dataBus: { [variableName: string]: any }; // Stores results of tasks, e.g., dataBus['fridayEvents'] = [...]
          currentUserTurn: number;
          // Potentially logs of skill executions for debugging
        }
        ```
*   **`dispatchTaskToSkill` Logic:**
    *   This function within `chatController.ts` will act like a router.
    *   It could use a simple `switch(task.taskType)` or a more sophisticated skill registry:
        `const skillRegistry: { [taskType: string]: Skill } = { "FindEvents": findEventsSkill, ... };`
    *   It prepares the `SkillExecutionInput` by fetching necessary data from `workflowContext.dataBus` (e.g., if `task.params.eventsRef` is "fridayEvents", it fetches `workflowContext.dataBus.fridayEvents`).
*   **Error Handling Strategies:**
    *   **Retry:** For transient errors (e.g., network timeout calling a Skill), the task can be retried (up to `task.retries` limit).
    *   **Alternative Path:** If a skill offers alternative outputs (e.g., `FindEvents` finds nothing, but the workflow can proceed), the Decomposer might have defined a conditional branch.
    *   **Escalate to Decomposer:** For more complex failures where the current plan is invalid, the `chatController` could re-invoke the `centralOrchestratorLLM` with the current workflow state and error, asking for a revised `taskList`.
    *   **Ask User:** If essential information is missing or an unrecoverable error occurs, a `RequestMissingInformation` or `InformUserOfError` task can be dynamically added or a standard error message returned.

### 2.3. "Skills" - Granular Capabilities & Tools
*   **More Examples:**
    *   **Direct API Wrappers (from `googleCalendar.ts` via `calendarTools.ts` initially):**
        *   `skillApiListEvents(params: { calendarId, timeMin, timeMax, q, ... })`
        *   `skillApiInsertEvent(params: { calendarId, eventPayload })`
        *   `skillApiPatchEvent(params: { calendarId, eventId, eventPatchPayload })`
        *   `skillApiDeleteEvent(params: { calendarId, eventId })`
    *   **Deterministic Code Modules (New files in `src/lib/skills/`):**
        *   `skillFilterEvents(params: { events: Event[], criteria: FilterCriteria })`: Takes a list of events and filter rules.
        *   `skillSortEvents(params: { events: Event[], sortBy: string, order: 'asc'|'desc' })`
        *   `skillExtractEventAttendees(params: { events: Event[] })`: Returns a unique list of attendee emails.
        *   `skillCalculateTimeDifference(params: { startTimeISO: string, endTimeISO: string })`
        *   `skillFormatDateForDisplay(params: { isoDate: string, format: string, timezone: string })`
    *   **Focused LLM Calls (Refactoring existing `event...LLM.ts` files, or new skills):**
        *   **Old `eventCreatorLLM.ts` (broad):** Input: "Schedule lunch with team next Tuesday at 1 pm for an hour."
        *   **New `skillGenerateEventApiPayload(params: { summary, startDateTime, endDateTime, attendeesMailList, calendarId, userTimezone, ...full details... })` (focused):** Input is already fully structured. Output is the precise Google Calendar API JSON. The prompt for this skill's LLM would be: "You are a JSON formatter. Given these event details, create a Google Calendar API event object: {summary: '...', start: {dateTime: '...'}, ...}".
        *   `skillIdentifyEventCandidatesFromList(params: { events: Event[], userQueryFragment: string, criteriaDescription: string })`: Given a list of events and a fuzzy user description (e.g., "the meeting about the budget"), this LLM helps pinpoint the exact event ID(s).
    *   **User Interaction Skills (New in `src/lib/skills/userInteractionSkills.ts`):**
        *   `skillRequestUserConfirmation(params: { message: string, options?: ['Yes', 'No'] })`: Sets `task.status = 'waiting_for_user'`, `task.result` will store user's choice.
        *   `skillPresentChoicesToUser(params: { message: string, choices: Array<{id: string, label: string}> })`
*   **Refined `SkillExecutionInput` and `SkillExecutionOutput`:**
    ```typescript
    // In src/types/workflow.ts or similar
    interface SkillExecutionInput {
      params: any; // Parameters from the Task definition
      // Provides access to data from previous tasks and global workflow info
      workflowDataBus: { [variableName: string]: any }; 
      userTimezone: string;
      googleAccessToken?: string; // If skill needs to make API calls
      clerkUserId?: string;
      internalDbUserId?: string;
    }

    interface SkillExecutionOutput {
      success: boolean;
      // Data produced by the skill, to be stored in workflowDataBus using task's outputVariable name
      data?: any; 
      // User-facing message if this skill directly results in one (e.g., for confirmation tasks)
      userResponseMessage?: string; 
      // If true, workflow engine should expect next user input to be related to this task
      requiresFollowUp?: boolean; 
      // Context to save for follow-up, if any
      clarificationContextToSave?: any;
      errorMessage?: string;
    }
    ```

### 2.5. User Preference Store & API (`src/lib/preferences.ts`)
*   **Example `value` JSON in `UserPreference` model:**
    *   `key: "gym_schedule"` -> `value: { dayOfWeek: "Monday", startTime: "18:00", endTime: "19:30", calendarId: "personal_xyz" }` or `value: [{ day: "Mo", start:"18:00", end:"19:00"}, {day:"We", ...}]`
    *   `key: "lunch_hours"` -> `value: { defaultStart: "12:30", defaultEnd: "13:15" }`
    *   `key: "writing_block_config"` -> `value: { days: ["Tuesday", "Thursday"], startTime: "09:00", endTime: "11:00", allowExceptionsWithApproval: true }`
*   **How a Skill/Decomposer uses a preference:**
    1.  Decomposer identifies need for preference (e.g., "don't miss my gym").
    2.  Outputs task: `{ id: "get_gym_pref", taskType: "FetchPreference", params: { prefKey: "gym_schedule", outputVariable: "userGymSchedule" } }`
    3.  Workflow Engine executes this task using `PreferenceSkill`.
    4.  `PreferenceSkill` calls `getUserPreference(userId, "gym_schedule")`.
    5.  Result `(e.g., { dayOfWeek: "Monday", ... })` is stored in `workflowContext.dataBus.userGymSchedule`.
    6.  Later task, e.g., `FindAvailableSlot`, receives `userGymSchedule` from the data bus and uses it as a constraint.

## 3. Detailed Impact on Current Files & Structure (Enhanced)

*   **`src/app/api/chat/route.ts`:**
    *   **`POST` function:**
        *   After `orchestratorDecision = await getNextAction(...)`.
        *   Add logic: `if (orchestratorDecision.workflowDefinition && orchestratorDecision.workflowDefinition.tasks.length > 0)` then `await executeWorkflow(orchestratorDecision.workflowDefinition, ...)` (new function, likely in `chatController.ts`).
        *   Else (simple action), proceed with modified `executePlan` or a new `executeSimpleAction` function.
        *   Saving `ConversationTurn`: Will need to accommodate workflow outcomes. The `toolCalled` might become `workflow_execution`, `toolParams` could be the initial `workflowDefinition`, and `toolResult` a summary of the workflow's final state or key outcomes. Individual task executions might be logged separately for detailed debugging if needed, or aggregated.

*   **`src/lib/centralOrchestratorLLM.ts` (Decomposer):**
    *   **`getNextAction()`:** Needs to parse the LLM output which could now be a `workflowDefinition`. The Zod schema for LLM output will need to include this new structure.
    *   **Prompt (`prompts/orchestratorDecompositionPrompt.md` - New Prompt File):** This will be a new, highly detailed prompt, replacing or heavily augmenting `prompts/calendar.md` for complex cases. It will contain the Task schema, Skill catalog (abstracted), and decomposition examples.

*   **`src/lib/planner.ts`:**
    *   `generatePlan()`: Its direct invocation from `chat/route.ts` might be removed.
    *   Could become a Skill: `skillAttemptSimplePlan(params: { userInput, userTimezone, ...})`. The Decomposer might decide to call this skill for moderately complex but still single-shot queries that don't need a full workflow but are too complex for a direct `actionType` decision.
    *   The complex parameter extraction it currently does would largely be handled by the Decomposer assigning params to specific tasks, or by more focused data extraction skills.

*   **`src/lib/chatController.ts` (Workflow Engine):**
    *   Rename `executePlan` to something like `handleOrchestratorOutput`.
    *   **NEW `executeWorkflow(workflowDef: WorkflowDefinition, commonParams: CommonExecutionParams)` function:**
        *   Initializes `WorkflowContext`.
        *   Contains the main loop: identify ready tasks, `dispatchTaskToSkill`, update context.
        *   Handles `dependsOn` logic.
        *   Manages pause/resume for user interaction tasks (e.g., by saving workflow state to `clarificationContext` and reloading it).
    *   **NEW `dispatchTaskToSkill(task: Task, workflowCtx: WorkflowContext)` function:**
        *   Switch/registry to call the correct skill function.
        *   Passes `task.params` and relevant parts of `workflowCtx.dataBus` to the skill.
        *   Updates `task.status` and `task.result` (in `workflowCtx.dataBus[task.params.outputVariable || task.id + '_result']`).

*   **`src/lib/eventCreatorLLM.ts`, `src/lib/eventDeleterLLM.ts`, `src/lib/eventUpdaterLLM.ts`:**
    *   Functions like `generateEventCreationJSONs` become skills, e.g., `skillGenerateCreatePayloads(params: { eventDetailsList: Array<{summary, start, end,...}>, userTimezone })`.
    *   Prompts (`prompts/eventCreatorPrompt.md`, etc.) are simplified: "Given these exact event details, produce Google Calendar API JSON. Adhere to timezone and formatting rules." They no longer parse user intent, only format data.

*   **`src/lib/calendarTools.ts` & `src/lib/googleCalendar.ts`:**
    *   `calendarTools.ts`: The `StructuredTool` classes will likely be dismantled. The core logic (calling `googleCalendar.ts` functions) will be wrapped into simple Skill functions. E.g., `skillApiInsertEvent` directly calls `apiInsertEvent` from `googleCalendar.ts`.
    *   `googleCalendar.ts`: Functions like `apiInsertEvent` are the direct low-level skills.

*   **`src/types/orchestrator.ts`:**
    ```typescript
    // (Potentially move Task & WorkflowDefinition to a new src/types/workflow.ts)
    export interface Task {
      id: string;
      taskType: string;
      params: any;
      dependsOn?: string[];
      status?: 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'waiting_for_user';
      result?: any; // Stored in a well-known place in workflow context
      outputVariable?: string; // Key under which to store result in workflowContext.dataBus
      humanSummary?: string;
      retries?: number;
    }

    export interface WorkflowDefinition {
      name: string; // e.g., "ClearFridayAndNotify"
      tasks: Task[];
    }

    export interface OrchestratorDecision {
      actionType?: OrchestratorActionType; // For simple actions
      params?: any; // Params for the simple action
      workflowDefinition?: WorkflowDefinition; // For complex, multi-step actions
      responseText?: string | null;
      reasoning?: string | null;
      clarificationContextToSave?: any | null; // Could store paused workflow state here
      timezoneInfo?: any;
    }
    // ... (OrchestratorActionType remains as is for simple actions) ...
    ```

*   **NEW: `src/lib/skills/` (Directory):**
    *   `calendarApiSkills.ts`: Wrappers for `googleCalendar.ts` functions, conforming to `Skill` interface.
    *   `dataProcessingSkills.ts`: E.g., `filterEventsSkill`, `sortEventsSkill`.
    *   `llmBasedSkills.ts`: Wrappers for focused LLM calls (e.g., refactored `eventCreatorLLM` logic).
    *   `userInteractionSkills.ts`: `skillRequestUserConfirmation`.
    *   `preferenceSkills.ts`: `skillFetchUserPreference`.

*   **NEW: `src/lib/preferences.ts`:** (As defined in section 2.5)

*   **`structure.txt`:** Update with new files/dirs.

## 4. Workflow Examples for Complex Queries (Expanded)

### Query 4 (Multi-turn Context): User: "What's my week look like?" Then: "Can you make Thursday lighter?" Then: "Move the team meeting but not the check-in."

**Turn 1: "What's my week look like?"**
*   **Decomposer (`centralOrchestratorLLM`):** Outputs simple action.
    *   `OrchestratorDecision: { actionType: "call_planner", params: { userInput: "What's my week look like?", list_events_details: { timeMin: "start_of_this_week_iso", timeMax: "end_of_this_week_iso" } } }`
*   **Workflow Engine (`chatController` via `planner` -> `ListEventsSkill`):**
    *   Fetches events for the week.
    *   Presents them formatted to the user.
    *   `ConversationTurn.toolResult` stores the listed events.

**Turn 2: "Can you make Thursday lighter?"** (User implies context from Turn 1)
*   **Decomposer:**
    *   Recognizes follow-up. Accesses `previousTurn.toolResult` (the listed events).
    *   `workflowDefinition`:
        1.  `{ id: "filter_thursday", taskType: "FilterEvents", params: { eventsRef: "previous_turn_listed_events", criteria: { dayOfWeek: "Thursday" }, outputVariable: "thursday_events" } }`
        2.  `{ id: "propose_lighten_options", taskType: "SuggestLighteningStrategies", params: { eventsRef: "thursday_events", userQuery: "make Thursday lighter", outputVariable: "lightening_proposals" } }` (This skill might be LLM-based to suggest *how* to make it lighter: move, shorten, delegate specific events).
        3.  `{ id: "ask_user_strategy", taskType: "PresentChoicesToUser", params: { message: "Okay, for Thursday's events: [summarize thursday_events]. How would you like to make it lighter? e.g., move some, shorten some?", choicesRef: "lightening_proposals" }, dependsOn: ["propose_lighten_options"] }`
*   **Workflow Engine:** Executes, presents options.

**Turn 3: "Move the team meeting but not the check-in."** (User responds to choices from Turn 2)
*   **Decomposer:**
    *   Uses `clarificationContext` (which has `thursday_events` and `lightening_proposals`).
    *   Parses "team meeting" and "check-in" against `thursday_events`.
    *   `workflowDefinition`:
        1.  `{ id: "identify_targets", taskType: "IdentifySpecificEventsFromList", params: { eventsRef: "thursday_events_from_context", includeSummaries: ["team meeting"], excludeSummaries: ["check-in"], outputVariable: "events_to_move" } }`
        2.  `{ id: "find_new_slots_for_targets", taskType: "FindAlternativeSlotsBatch", params: { eventsRef: "events_to_move", originalQuery: "Move the team meeting", constraints: [], outputVariable: "new_slot_proposals" }, dependsOn: ["identify_targets"] }`
        3.  `{ id: "confirm_moves", taskType: "RequestUserConfirmation", params: { messageTemplate: "Okay, I can move '{eventSummary}' to {newTime}. Proceed?", itemsRef: "new_slot_proposals" }, dependsOn: ["find_new_slots_for_targets"] }`
        4.  `{ id: "execute_updates", taskType: "ExecuteCalendarUpdateBatch", params: { updatesRef: "new_slot_proposals_confirmed" }, condition: "confirm_moves.result.confirmed == true", dependsOn: ["confirm_moves"] }`
*   **Workflow Engine:** Executes...

### Query 5: "Sync my work and personal calendars for the next month, but don't copy over events marked 'private'."

**Decomposition -> `taskList`:**

1.  `{ id: "fetch_work_prefs", taskType: "FetchPreference", params: { prefKey: "work_calendar_id", outputVariable: "workCalId" } }`
2.  `{ id: "fetch_personal_prefs", taskType: "FetchPreference", params: { prefKey: "personal_calendar_id", outputVariable: "personalCalId" } }`
3.  `{ id: "find_work_events", taskType: "FindEvents", params: { criteria: { calendarIdsRef: "workCalId", dateRange: { start: "now", end: "now+1month" } }, outputVariable: "workEvents" }, dependsOn: ["fetch_work_prefs"] }`
4.  `{ id: "find_personal_events", taskType: "FindEvents", params: { criteria: { calendarIdsRef: "personalCalId", dateRange: { start: "now", end: "now+1month" } }, outputVariable: "personalEvents" }, dependsOn: ["fetch_personal_prefs"] }`
5.  `{ id: "filter_private_work", taskType: "FilterEvents", params: { eventsRef: "workEvents", excludeCriteria: { visibility: "private" }, outputVariable: "publicWorkEvents" }, dependsOn: ["find_work_events"] }`
6.  `{ id: "filter_private_personal", taskType: "FilterEvents", params: { eventsRef: "personalEvents", excludeCriteria: { visibility: "private" }, outputVariable: "publicPersonalEvents" }, dependsOn: ["find_personal_events"] }`
7.  `{ id: "identify_to_copy_to_personal", taskType: "IdentifyMissingEvents", params: { sourceEventsRef: "publicWorkEvents", targetEventsRef: "publicPersonalEvents", outputVariable: "work_to_copy_to_personal" }, dependsOn: ["filter_private_work", "filter_private_personal"] }`
8.  `{ id: "identify_to_copy_to_work", taskType: "IdentifyMissingEvents", params: { sourceEventsRef: "publicPersonalEvents", targetEventsRef: "publicWorkEvents", outputVariable: "personal_to_copy_to_work" }, dependsOn: ["filter_private_work", "filter_private_personal"] }`
9.  `{ id: "generate_payloads_for_personal", taskType: "GenerateEventCreationPayloadBatch", params: { eventDetailsListRef: "work_to_copy_to_personal", targetCalendarIdRef: "personalCalId", outputVariable: "payloads_for_personal_cal" }, dependsOn: ["identify_to_copy_to_personal", "fetch_personal_prefs"] }`
10. `{ id: "generate_payloads_for_work", taskType: "GenerateEventCreationPayloadBatch", params: { eventDetailsListRef: "personal_to_copy_to_work", targetCalendarIdRef: "workCalId", outputVariable: "payloads_for_work_cal" }, dependsOn: ["identify_to_copy_to_work", "fetch_work_prefs"] }`
11. `{ id: "confirm_sync", taskType: "RequestUserConfirmation", params: { messageTemplate: "I found X events from Work to copy to Personal, and Y events from Personal to copy to Work (excluding private ones). Proceed with sync?", details: { toPersonalCountRef: "work_to_copy_to_personal.length", toWorkCountRef: "personal_to_copy_to_work.length" } }, dependsOn: ["generate_payloads_for_personal", "generate_payloads_for_work"] }`
12. `{ id: "execute_copy_to_personal", taskType: "ExecuteCalendarCreateBatch", params: { payloadsRef: "payloads_for_personal_cal" }, condition: "confirm_sync.result.confirmed == true", dependsOn: ["confirm_sync"] }`
13. `{ id: "execute_copy_to_work", taskType: "ExecuteCalendarCreateBatch", params: { payloadsRef: "payloads_for_work_cal" }, condition: "confirm_sync.result.confirmed == true", dependsOn: ["confirm_sync"] }`
14. `{ id: "final_sync_response", taskType: "FormatFinalResponse", params: { ... }, dependsOn: ["execute_copy_to_personal", "execute_copy_to_work"]}`

**Execution Highlights:**
*   `IdentifyMissingEvents` skill would compare two lists of events to find which ones are not present in the other (based on a unique identifier or strong similarity).
*   This demonstrates a more complex dependency graph.

## 5. Phased Implementation Strategy (Enhanced)

**Phase 1: Core Decomposer & Workflow Engine (Proof of Concept)**
*   **Sub-steps:**
    1.  Define initial `Task` and `WorkflowDefinition` interfaces in `src/types/`.
    2.  Modify `OrchestratorDecision` to include optional `workflowDefinition`.
    3.  **Focus on `centralOrchestratorLLM.ts`:** Create `prompts/orchestratorDecompositionPrompt.md`. Start with 2-3 examples for ONE simple multi-step query type (e.g., "Find events on Friday and tell me how many there are"). Goal: LLM outputs a valid `taskList` for this pattern.
    4.  Update Zod schema for `getNextAction()` to parse this new output.
    5.  **`chatController.ts`:** Implement `handleOrchestratorOutput`. If `workflowDefinition` exists, call a new (basic) `executeWorkflow`.
    6.  **`executeWorkflow` (basic):** Sequentially iterate tasks. Implement `dispatchTaskToSkill` (switch-based for 2-3 skills).
    7.  **Core Skills:**
        *   `Skill: FindEvents` (in `src/lib/skills/calendarApiSkills.ts`, wraps `apiListEvents`).
        *   `Skill: CountItems` (in `src/lib/skills/dataProcessingSkills.ts`).
        *   `Skill: FormatSimpleResponse` (in `src/lib/skills/userInteractionSkills.ts`).
    8.  **Data Bus:** Simple object in `workflowContext` to pass `task.result` using `task.params.outputVariable`.
    9.  **Test:** End-to-end for the selected query pattern.
*   **Key Questions:** Can the LLM reliably output the `taskList`? Can the workflow engine execute it sequentially? Is data passed correctly?

**Phase 2: Expanding Skills & Decomposition Logic**
*   **Sub-steps:**
    1.  **CRUD Skills:** Implement `skillGenerateCreatePayload`, `skillExecuteCalendarCreate`, `skillExecuteDeleteBatch`, `skillGenerateUpdatePayload`, `skillExecuteCalendarUpdateBatch`. Refactor existing `event...LLM.ts` and `calendarTools.ts` logic into these skills.
    2.  **Decomposer Enhancement:** Add examples to its prompt for simple CRUD sequences (e.g., "delete event X then create event Y").
    3.  **`dependsOn` Implementation:** Enhance `executeWorkflow` in `chatController.ts` to respect `dependsOn` by checking status of prerequisite tasks before dispatching a task.
    4.  **Context Management Refinement:** Ensure robust passing of event IDs, lists of events, etc., through the `dataBus`.
    5.  **Test:** Queries like "Delete my 10am meeting tomorrow and schedule a new one at 2pm."
*   **Key Questions:** Can dependencies be managed? Are CRUD operations working reliably via skills?

**Phase 3: User Preferences & Richer User Interaction**
*   **Sub-steps:**
    1.  Implement `UserPreference` model in `prisma.schema.prisma` and `src/lib/preferences.ts` with `getUserPreference/setUserPreference`.
    2.  Create `skillFetchUserPreference`.
    3.  **Decomposer Enhancement:** Add examples for queries that imply preference usage (e.g., "don't schedule during my gym time" -> LLM adds task to fetch "gym_schedule").
    4.  Skills like `FindAvailableSlotSkill` (new) should accept constraint parameters derived from preferences.
    5.  Implement `skillRequestUserConfirmation` and `skillPresentChoicesToUser`.
    6.  Enhance `executeWorkflow` and `clarificationContext` to handle `task.status = 'waiting_for_user'`, save workflow state, and resume upon user's next message.
    7.  **Test:** Queries involving preferences and simple confirmations.
*   **Key Questions:** Can preferences be fetched and used by tasks? Can workflows pause for user input and resume correctly?

**Phase 4: Advanced Features & Robustness (Iterative)**
*   **Sub-steps (examples):**
    1.  **Advanced Constraint Skills:** `skillCheckAgainstDynamicConstraints`.
    2.  **Undo Skill:** Requires detailed audit logging for `ExecuteCalendar...` skills.
    3.  **Group Availability Skills:** `skillFindGroupAvailability` (might need to call Google Calendar free/busy API if available, or process multiple calendars).
    4.  **True Notifications:** (Placeholder skill initially, then potential email/other integration).
    5.  **Error Handling & Retries:** Implement retry logic in `executeWorkflow` for tasks. Define better error reporting to the user.
    6.  **Decomposer - Continuous Improvement:** Add more complex decomposition examples to the prompt. Consider techniques for prompt compression if it becomes too large. Explore "Chain of Thought" or "Self-Critique" patterns for the Decomposer LLM if its output quality is an issue.
*   **Key Questions:** How to handle partial successes/failures in batch operations? How to make the Decomposer more robust to novel phrasing?

## 6. Benefits and Challenges (Expanded Mitigation)

**Benefits:** (As previously stated)
*   Handles True Complexity, Modularity, Maintainability, Scalability, Clarity, Improved Accuracy.

**Challenges & Potential Mitigations:**
*   **Decomposer Intelligence:**
    *   **Mitigation:** Extensive prompt engineering with diverse examples is key. Start with a limited set of complex patterns and expand. Use a powerful LLM model for this component. Regularly evaluate its output and refine the prompt. Consider a "human feedback loop" for correcting bad decompositions initially.
*   **Workflow State Management:**
    *   **Mitigation:** For workflows paused for user input, serialize the essential `WorkflowContext` (or a subset of it) into `ConversationTurn.clarificationContext`. Ensure a robust deserialization process when the user responds. For very long-running potential workflows (future), consider a more persistent store than just the conversation turn.
*   **Defining "Skill" Granularity:**
    *   **Mitigation:** Start with slightly coarser skills if unsure, then break them down if they become too monolithic or hard to reuse. Aim for skills that represent a logical unit of work that might be independently useful.
*   **Potential Latency:**
    *   **Mitigation:** Optimize individual skills. Use faster LLM models for focused, simpler skill-based LLM calls. Parallelize independent tasks where possible (advanced). Provide feedback to the user if a complex operation will take time (e.g., "Okay, I'm working on rescheduling those classes, this might take a moment...").
*   **Error Handling & Recovery in Workflows:**
    *   **Mitigation:** Define clear error-handling logic in the Workflow Engine. For critical steps, the Decomposer can define fallback tasks. For unrecoverable errors within a task, the workflow could pause and present the issue to the user for guidance, or attempt a simplified alternative. Log errors comprehensively.
*   **Testing Complexity:**
    *   **Mitigation:** Unit test individual Skills. Integration test common sequences of tasks. Use a corpus of diverse and complex test queries for end-to-end testing. Start with a core set of queries and expand.

This architectural evolution is a significant step towards creating a truly intelligent and versatile calendar assistant. It embraces the complexity of human language and calendar management by adopting a more structured, adaptable, and powerful processing model. 