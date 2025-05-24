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

This document outlines a plan to evolve our architecture into a more powerful **Task-Based Workflow Engine**, capable of intelligently decomposing and executing such complex requests.

## 2. Proposed Architecture: Task-Based Workflow Engine

The core idea is to shift from a single "plan" to a dynamic "workflow" composed of smaller, manageable **tasks**.

**Key Components:**

### 2.1. Query Decomposer / Chief Orchestrator (Evolved `centralOrchestratorLLM.ts`)
*   **Role:** The intelligent front-door. Analyzes complex user input and decomposes it into a sequence or dependency graph of `Tasks`. For simple requests, it can still output a single, direct action.
*   **Input:** User query, conversation history, user timezone, available calendars, current time, active clarification context.
*   **Output:**
    *   For simple queries: A single `OrchestratorDecision` (like current `actionType` + `params`).
    *   For complex queries: An `OrchestratorDecision` containing a `taskList: Task[]`.
*   **Task Definition:**
    ```typescript
    interface Task {
      id: string; // Unique ID for this task instance in the workflow
      taskType: string; // e.g., "FindEvents", "FilterEvents", "GenerateEventPayload", "ExecuteCalendarUpdate", "RequestUserConfirmation"
      params: any; // Parameters specific to this taskType
      dependsOn?: string[]; // IDs of tasks that must complete before this one starts
      status?: 'pending' | 'ready' | 'running' | 'completed' | 'failed';
      result?: any; // Output of this task, to be used by dependent tasks
      retries?: number;
    }
    ```
*   **Prompt Engineering:** Requires significant enhancement with examples of decomposing complex queries into task lists. It needs to understand sequencing, data dependencies, and when human-in-the-loop (clarification/confirmation) is required.

### 2.2. Task Executor / Workflow Engine (Evolved `chatController.ts`)
*   **Role:** Receives the `taskList` from the Decomposer (if a complex query) or a single action. Manages the execution of tasks in the correct order, handling data flow between them.
*   **Logic:**
    *   Manages a "workflow context" for the current request, holding the state and results of all tasks.
    *   Identifies tasks ready to run (dependencies met).
    *   Dispatches tasks to the appropriate "Skill" for execution.
    *   Updates task statuses and stores results in the workflow context.
    *   Handles task failures (e.g., retry, escalate to Decomposer for replanning, or ask user for clarification).
    *   Aggregates results to form the final response to the user.
*   **State Management:** The workflow context is key. It could include:
    *   `workflowId` (linked to `conversationId`)
    *   `originalUserQuery`
    *   `taskList` (with evolving statuses and results)
    *   `intermediateData` (e.g., `foundEvents`, `userPreferences`, `confirmedSlots`)

### 2.3. "Skills" - Granular Capabilities & Tools
*   **Role:** The actual workers that perform specific actions. These are invoked by the Workflow Engine based on `taskType`.
*   **Sources:**
    *   **Direct API Wrappers:** Existing functions in `googleCalendar.ts` (e.g., `apiListEvents`, `apiInsertEvent`) become fine-grained skills.
    *   **Deterministic Code Modules:** New TypeScript modules for specific logic (e.g., `filterEventListByCriteria`, `calculateTravelTime`, `formatNotificationMessage`).
    *   **Focused LLM Calls:**
        *   Existing specialized LLMs (`eventCreatorLLM.ts`, etc.) are refocused. Instead of broad intent parsing, they perform specific sub-tasks like "given these fully specified event details, generate the Google Calendar API JSON payload." Their prompts become simpler and more targeted.
        *   New focused LLMs might be introduced (e.g., "given user query and event list, identify which events match these vague criteria").
    *   **User Interaction Skills:** `RequestUserConfirmation`, `PresentChoicesToUser`.
*   **Skill Interface (Conceptual):**
    ```typescript
    interface SkillExecutionInput {
      params: any; // Parameters from the Task
      workflowContext: any; // Access to prior task results and overall context
    }
    interface SkillExecutionOutput {
      success: boolean;
      result?: any;
      errorMessage?: string;
    }
    type Skill = (input: SkillExecutionInput) => Promise<SkillExecutionOutput>;
    ```

### 2.4. Context Manager (Integrated within Workflow Engine)
*   **Role:** Manages the flow of data (results) from one task to another within a single complex user request.
*   **Example:** The output of a `FindEvents` task (`foundEventList`) becomes an input parameter for a subsequent `FilterEvents` task or an `UpdateEventFields` task.

### 2.5. User Preference Store & API
*   **Role:** Persistently store and retrieve user-specific preferences that influence calendar operations.
*   **`prisma.schema.prisma` Changes:**
    ```prisma
    model UserPreference {
      id        String   @id @default(cuid())
      userId    String   // Foreign key to your User model
      key       String   // e.g., "lunch_hours", "gym_schedule", "writing_block_days", "boss_email"
      value     Json     // Flexible JSON to store preference details
      createdAt DateTime @default(now())
      updatedAt DateTime @updatedAt
      user      User     @relation(fields: [userId], references: [id])
      @@unique([userId, key])
    }
    ```
*   **`src/lib/preferences.ts` (New File):**
    *   `async function getUserPreference(userId: string, key: string): Promise<any | null>`
    *   `async function setUserPreference(userId: string, key: string, value: any): Promise<UserPreference>`
*   **Usage:** Skills or the Decomposer can query these preferences. E.g., "don't miss my gym" -> Decomposer outputs a task to fetch "gym_schedule" preference -> subsequent scheduling tasks use this data.

### 2.6. Constraint Engine (Future Enhancement)
*   **Role:** A more advanced system for defining and applying complex rules and constraints during scheduling (e.g., "always leave 30 mins buffer," "prioritize personal calendar in mornings unless X").
*   **Initial Implementation:** Constraints can be hardcoded logic within relevant skills or passed as parameters by the Decomposer.

### 2.7. Clarification & Interaction Module (Evolved from current clarification logic)
*   **Role:** When the Decomposer or a Skill encounters ambiguity or needs user input, this module formats the question and manages the interaction.
*   **Enhanced `clarificationContext`:** The `clarificationContext` in `ConversationTurn` will need to store not just the immediate question, but also the state of the ongoing workflow, so the user's response can be routed back correctly to resume the workflow.

## 3. Detailed Impact on Current Files & Structure

*   **`src/app/api/chat/route.ts`:**
    *   Will still handle initial request validation, auth, and fetching conversation history.
    *   The main logic will involve calling the `centralOrchestratorLLM`.
    *   If the orchestrator returns a single action, it proceeds somewhat like today (calling `executePlan` which might be refactored).
    *   If it returns a `taskList`, it passes this to the (evolved) `chatController` to manage the workflow.
    *   Handles saving the final user-facing response and workflow outcome to `ConversationTurn`.

*   **`src/lib/centralOrchestratorLLM.ts` (Decomposer):**
    *   **Prompt (`calendar.md` or a new orchestrator-specific prompt):** Major rewrite. Needs many examples of complex queries and their decomposition into `taskLists`. The schema for `Task` and `taskList` needs to be clearly defined in the prompt.
    *   **Output Schema (`OrchestratorDecision` in `src/types/orchestrator.ts`):**
        ```typescript
        // In src/types/orchestrator.ts
        export interface Task { /* as defined above */ }

        export interface OrchestratorDecision {
          actionType?: OrchestratorActionType; // For simple, direct actions
          params?: any; // Params for the simple action
          taskList?: Task[]; // For complex, multi-step actions
          responseText?: string | null; // If orchestrator itself wants to respond/ask
          reasoning?: string | null;
          clarificationContextToSave?: any | null;
          timezoneInfo?: any; // Existing
        }
        ```
    *   `getNextAction()` function will parse the LLM output and return this extended `OrchestratorDecision`.

*   **`src/lib/planner.ts`:**
    *   Its role might significantly diminish or change.
    *   If the `centralOrchestratorLLM` becomes very good at decomposition, the `planner.ts` might only be invoked by a specific `PlanSimpleRequest` task type if the orchestrator decides a traditional planning step is still needed for a sub-problem.
    *   Alternatively, `planner.ts` could be refactored into a "Simple Action Formulator Skill" – if the orchestrator decides on a simple `create_event` and has some fuzzy params, this skill could try to firm up those params before passing to a `GenerateEventPayload` skill.

*   **`src/lib/chatController.ts` (Workflow Engine):**
    *   This file sees major expansion. The `executePlan` function might be the entry point.
    *   If `plan.taskList` exists:
        *   Initialize workflow context.
        *   Loop:
            *   Find ready tasks (dependencies met).
            *   Select a task to execute.
            *   `dispatchTaskToSkill(task, workflowContext)`: This new function will switch on `task.taskType` and call the appropriate Skill.
            *   Update `task.status` and `task.result`.
            *   If a task is `RequestUserConfirmation`, format `responseText` and set `requiresFollowUp`. The workflow pauses.
        *   When all tasks complete, formulate final response.
    *   If `plan.actionType` (simple action) exists:
        *   Could delegate to a simplified version of its current logic, or directly to a skill.

*   **`src/lib/eventCreatorLLM.ts`, `src/lib/eventDeleterLLM.ts`, `src/lib/eventUpdaterLLM.ts`:**
    *   These become more focused "JSON Payload Generation Skills" or "Candidate Identification Skills."
    *   **Prompts (`eventCreatorPrompt.md`, etc.):** Heavily simplified. They will receive very specific inputs from a task (e.g., "User wants to create an event with summary 'X', start 'Y', on calendar 'Z'. Generate the Google Calendar API JSON.") and won't need to parse broad user intent.
    *   Their primary job is to translate structured task parameters into the exact JSON needed by `googleCalendar.ts` API wrappers or to identify specific event IDs from a list based on precise criteria.
    *   `generateEventCreationJSONs` might be renamed `skillGenerateCreatePayload`.

*   **`src/lib/calendarTools.ts` & `src/lib/googleCalendar.ts`:**
    *   Functions within these (e.g., `apiInsertEvent`, `apiListEvents`) become the low-level "Calendar API Skills."
    *   The `StructuredTool` classes in `calendarTools.ts` might be unwrapped or adapted. The Workflow Engine will call the underlying Google API functions more directly via skill wrappers, with parameters already determined by preceding tasks or the Decomposer.

*   **`src/prompts/`:**
    *   New powerful prompt for `centralOrchestratorLLM.ts` (the Decomposer).
    *   Existing prompts for eventCreator, etc., will be simplified to focus on their new, narrower roles.

*   **`src/types/orchestrator.ts`:** Updated with `Task` and modified `OrchestratorDecision` as shown above.

*   **NEW: `src/lib/skills/` (Directory):**
    *   This directory would house the implementations for various skills.
    *   Example files: `findEventsSkill.ts`, `filterEventsSkill.ts`, `userInteractionSkills.ts`, `preferenceSkills.ts`.
    *   Each skill module would export a function adhering to the `Skill` interface.

*   **NEW: `src/lib/preferences.ts`:** As described in section 2.5.

*   **`structure.txt`:** Will need updating to reflect new files/directories.

## 4. Workflow Examples for Complex Queries

### Query 1: "Reschedule all my afternoon classes this month to mornings, but don't touch the ones on Mondays and leave time for lunch."

**Decomposition by `centralOrchestratorLLM` -> `taskList`:**

1.  `{ id: 'task1', taskType: 'FetchPreference', params: { prefKey: 'lunch_schedule' } }`
2.  `{ id: 'task2', taskType: 'FindEvents', params: { criteria: { type: 'class', timeOfDay: 'afternoon', period: 'this_month', userTimezone: 'America/Vancouver' } }, dependsOn: [] }`
3.  `{ id: 'task3', taskType: 'FilterEvents', params: { eventsRef: 'task2.result', excludeCriteria: { dayOfWeek: 'Monday' } }, dependsOn: ['task2'] }`
4.  `{ id: 'task4', taskType: 'GenerateProposedUpdates', params: { eventsRef: 'task3.result', moveTo: 'morning', constraints: [{ type: 'avoid_time_range', timeRangeRef: 'task1.result' }] }, dependsOn: ['task1', 'task3'] }`
    *   This task might involve sub-steps for each event: find free morning slot, respect lunch.
5.  `{ id: 'task5', taskType: 'RequestUserConfirmation', params: { originalEventsRef: 'task3.result', proposedChangesRef: 'task4.result.proposals', message: "I can move X afternoon classes to the morning, avoiding Mondays and your lunch. Shall I proceed?" }, dependsOn: ['task4'] }`
6.  `{ id: 'task6', taskType: 'ExecuteBatchUpdates', params: { updatesRef: 'task4.result.proposals' }, condition: 'task5.result.confirmed == true', dependsOn: ['task5'] }`
7.  `{ id: 'task7', taskType: 'FormatFinalResponse', params: { executionResultRef: 'task6.result', confirmationRef: 'task5.result' }, dependsOn: ['task6'] }`

**Execution by `chatController.ts` (Workflow Engine):**

*   **Task 1:** Calls `PreferenceSkill` -> `workflowContext.lunch_schedule = { start: '12:00', end: '13:00' }`.
*   **Task 2:** Calls `FindEventsSkill` (uses `apiListEvents`) -> `workflowContext.afternoon_classes_this_month = [eventA, eventB, eventC, ...]`.
*   **Task 3:** Calls `FilterEventsSkill` -> `workflowContext.classes_to_move = [eventA, eventC] (eventB was on Monday)`.
*   **Task 4:** Calls `GenerateProposedUpdatesSkill`. This skill iterates through `classes_to_move`. For each class:
    *   It might call another skill `FindAvailableSlotSkill` (with `targetTimeOfDay: 'morning'`, `avoidRanges: [workflowContext.lunch_schedule]`).
    *   Collects all proposed `[{eventId, newStart, newEnd}, ...]`. Stores in `workflowContext.proposed_updates`.
*   **Task 5:** Calls `UserInteractionSkill`. Assistant sends message to user. Workflow pauses.
*   **(User responds "Yes")**
*   **Task 6:** `condition` is met. Calls `ExecuteBatchUpdatesSkill`. This skill iterates `workflowContext.proposed_updates` and calls `apiPatchEvent` for each. Collects successes/failures. Stores in `workflowContext.update_results`.
*   **Task 7:** Calls `FormatResponseSkill`. Generates "Okay, I've rescheduled X classes for you."

---

### Query 2: "Clear my calendar next Friday for travel and notify anyone I had meetings with."

**Decomposition -> `taskList`:**

1.  `{ id: 'task1', taskType: 'FindEvents', params: { criteria: { date: 'next_friday', userTimezone: 'America/Vancouver' } } }`
2.  `{ id: 'task2', taskType: 'ExtractAttendees', params: { eventsRef: 'task1.result' }, dependsOn: ['task1'] }`
3.  `{ id: 'task3', taskType: 'DeleteEventsBatch', params: { eventsRef: 'task1.result' }, dependsOn: ['task1'] }`
4.  `{ id: 'task4', taskType: 'GenerateEventPayload', params: { summary: 'Travel', date: 'next_friday', allDay: true, calendarId: 'primary' } }`
5.  `{ id: 'task5', taskType: 'ExecuteCalendarCreate', params: { payloadRef: 'task4.result' }, dependsOn: ['task4'] }`
6.  `{ id: 'task6', taskType: 'NotifyUsers', params: { usersRef: 'task2.result.attendees', messageTemplate: "Your meeting on {eventDate} for '{eventSummary}' has been cancelled as I will be traveling.", eventDetailsRef: 'task1.result' }, dependsOn: ['task2', 'task3'] }` (Notification might be simplified to just a text response for now)
7.  `{ id: 'task7', taskType: 'FormatFinalResponse', params: { deleteResultRef: 'task3.result', createResultRef: 'task5.result', notificationResultRef: 'task6.result' }, dependsOn: ['task3', 'task5', 'task6'] }`

**Execution Highlights:**

*   `ExtractAttendeesSkill` would iterate through events from `task1` and compile a unique list of attendees.
*   `NotifyUsersSkill` (initially) might just formulate a text for the assistant to "say" to the user, like "Okay, I've cleared your Friday and would have notified X, Y, Z." A true notification system is a later step.

---

### Query 3: "Can you move my Friday meetings to a time when everyone is available next week, but make sure I don't miss my gym?"

**Decomposition -> `taskList`:**

1.  `{ id: 'task_get_gym', taskType: 'FetchPreference', params: { prefKey: 'gym_schedule' } }`
2.  `{ id: 'task_find_friday_meetings', taskType: 'FindEvents', params: { criteria: { dayOfWeek: 'Friday', type: 'meeting', userTimezone: 'America/Vancouver' } } }`
3.  `{ id: 'task_get_attendees', taskType: 'ExtractAttendees', params: { eventsRef: 'task_find_friday_meetings.result', includeOrganizer: true }, dependsOn: ['task_find_friday_meetings'] }`
4.  `{ id: 'task_find_slots', taskType: 'FindGroupAvailability', params: { attendeesRef: 'task_get_attendees.result.allUniqueAttendees', durationAverageRef: 'task_find_friday_meetings.result.averageDuration', timeframe: 'next_week', constraints: [{ type: 'avoid_time_range', timeRangeRef: 'task_get_gym.result'}], userTimezone: 'America/Vancouver' }, dependsOn: ['task_get_gym', 'task_find_friday_meetings', 'task_get_attendees'] }`
5.  `{ id: 'task_propose_slots', taskType: 'PresentChoicesToUser', params: { choicesRef: 'task_find_slots.result.availableSlots', message: "I found these times next week for your Friday meetings when everyone is free and you won't miss gym. Which one works for each meeting?", originalEventsRef: 'task_find_friday_meetings.result' }, dependsOn: ['task_find_slots'] }`
6.  `{ id: 'task_update_events', taskType: 'ExecuteBatchUpdates', params: { updatesFromUserChoiceRef: 'task_propose_slots.result.userSelections' }, condition: 'task_propose_slots.result.userMadeChoice == true', dependsOn: ['task_propose_slots']}`
7.  `{ id: 'task_final_response', taskType: 'FormatFinalResponse', params: { ... }, dependsOn: ['task_update_events']}`

**Execution Highlights:**

*   `FindGroupAvailabilitySkill` is a complex one. It would need to check free/busy for all attendees (this ideally needs a dedicated Google Calendar API for free/busy, or list all their events and find gaps).
*   The interaction in `task_propose_slots` is crucial. The system might need to present options for each original Friday meeting if durations differ.

---

## 5. Phased Implementation Strategy

This is a significant undertaking. A phased approach is recommended:

**Phase 1: Core Decomposer & Workflow Engine (Proof of Concept)**
1.  **Evolve `centralOrchestratorLLM`:**
    *   Update prompt and `OrchestratorDecision` type to support outputting a simple `taskList` for one or two specific complex query patterns (e.g., "Find X then tell me about it").
    *   Keep current single `actionType` for simple queries.
2.  **Basic Workflow in `chatController.ts`:**
    *   Implement logic to check if `taskList` is present.
    *   If so, iterate and execute tasks sequentially (initially, no complex dependency).
    *   Create a `dispatchTaskToSkill` mechanism (simple switch statement).
3.  **Define 2-3 Core "Skills":**
    *   `Skill: FindEvents` (wraps `apiListEvents`).
    *   `Skill: AnalyzeEvents` (wraps `eventAnalyzer.ts`).
    *   `Skill: SimpleRespond` (just formats a string).
4.  **Test End-to-End:** For the chosen simple complex query pattern.

**Phase 2: Expanding Skills & Decomposition Logic**
1.  **Add More Skills:**
    *   Skills for basic CRUD: `CreateEventPayload`, `ExecuteCreate`, `DeleteEventById`, `UpdateEventFields`.
    *   Refactor existing `eventCreatorLLM`, etc., to become these focused skills.
2.  **Enhance Decomposer:**
    *   Teach it to decompose more query types involving CRUD sequences (e.g., "delete X then create Y").
    *   Introduce `dependsOn` task logic in the Decomposer's output and `chatController`'s execution.
3.  **Basic Context Management:** Ensure results from one skill can be passed as params to the next.

**Phase 3: User Preferences & Richer Context**
1.  **Implement `UserPreference` Model & API (`preferences.ts`).**
2.  **Integrate Preference Skills:** Add `FetchPreferenceSkill`.
3.  **Enhance Decomposer & Skills:** To utilize preferences (e.g., Decomposer adds a task to fetch "gym_schedule" if query mentions gym).
4.  **Improve `clarificationContext`:** For multi-turn workflows, ensure context is preserved and resumed correctly.

**Phase 4: Advanced Features (Iterative)**
1.  **Complex Constraint Handling:** Start with hardcoded constraints in skills, then explore a more dynamic constraint engine.
2.  **Undo Functionality:** Requires robust audit logging for all calendar modifications.
3.  **Group Availability & Advanced Scheduling Logic:** Skills like `FindGroupAvailability`.
4.  **True Notifications:** (Beyond simple text responses).
5.  **Continuous Refinement of Decomposer Prompts:** This will be an ongoing effort, adding more examples and edge cases.

## 6. Benefits and Challenges

**Benefits:**
*   **Handles True Complexity:** Addresses the core limitations of the current system.
*   **Modularity & Reusability:** Skills can be combined in countless ways.
*   **Maintainability:** Easier to update/debug individual skills or the Decomposer.
*   **Scalability:** New capabilities can be added as new skills.
*   **Clarity of Logic:** The "plan" (taskList) is explicit and can be inspected.
*   **Improved Accuracy:** Focused skills/LLMs are often better than monolithic ones.

**Challenges:**
*   **Decomposer Intelligence:** The `centralOrchestratorLLM` (Decomposer) becomes the most critical and complex LLM component. Its ability to correctly break down diverse natural language is paramount. This requires extensive prompt engineering and potentially fine-tuning.
*   **Workflow State Management:** Robustly managing the state of a multi-step workflow, especially across user interactions or potential errors, is non-trivial.
*   **Defining the Right "Skill" Granularity:** Skills should be atomic enough to be reusable but not so fine-grained that `taskLists` become excessively long and complex.
*   **Potential Latency:** Chaining multiple LLM calls or skills can increase overall response time. Optimization will be needed.
*   **Error Handling & Recovery within Workflows:** How does the system gracefully handle a failure in the middle of a 10-step workflow? Does it try to re-plan? Ask the user?
*   **Testing Complexity:** Testing all possible workflow combinations becomes much harder.

This architectural evolution is a significant step towards creating a truly intelligent and versatile calendar assistant. It embraces the complexity of human language and calendar management by adopting a more structured, adaptable, and powerful processing model. 