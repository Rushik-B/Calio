# THESE PROMPTS DONT WORK RIGHT NOW AND SHOULD WORK IN LATER VERSIONS

1. Overlap with Existing Event: - “Set up a project kickoff for Friday 2pm–4pm. If I already have something then, move it to the next free slot on Friday after 4pm.”

2. Partial Information, Recurrence: - “Schedule a team sync for every alternate Tuesday at noon, but skip it during the last week of any month.

3. Conflicting Constraints (Priority Test): - “Book a study group on Monday at 3pm, but if that conflicts with my gym, schedule it as late as possible that day before 7pm.

Proposed solution - 


These are excellent and challenging queries that test the limits of a conversational calendar agent! They represent the kind of complex, multi-step reasoning users often expect.

Here's a breakdown of each query from `TO-DO-PROMPTS.md` and how we can approach making them work, distinguishing between what might be feasible with some immediate-to-mid-term enhancements versus what would require more significant architectural additions:

**1. Overlap with Existing Event:**
   > "Set up a project kickoff for Friday 2pm–4pm. If I already have something then, move it to the next free slot on Friday after 4pm.”

*   **Current System's Path:**
    1.  `Planner` would likely identify this as a "create\_event" intent for "project kickoff Friday 2pm-4pm".
    2.  `EventCreatorLLM` would generate the JSON for this event.
    3.  `ChatController` would receive this and normally call `CreateEventTool`.
*   **Challenges & Missing Pieces:**
    *   **Conflict Detection:** The system doesn't automatically check for conflicts *before* creating an event.
    *   **Conditional Logic ("If...then..."):** The core of this query is conditional.
    *   **Finding "Next Free Slot":** This requires a separate capability to search for availability based on duration and a starting point.
*   **Making it Work (Iterative Approach):**
    *   **Short-Term (Interactive):**
        1.  **`ChatController` Enhancement:** When handling a `create_event` action, before calling `CreateEventTool`, the `chatController` could first use the `ListEventsTool` to check the proposed time slot (Friday 2pm-4pm) on the target calendar.
        2.  **If Conflict:** Instead of autonomously rescheduling, the `chatController` would respond to the user: "It looks like you already have [Event X] scheduled for Friday 2pm-4pm. Would you like me to try and find a free 2-hour slot for 'project kickoff' after 4pm on Friday?"
        3.  **If User Confirms:** This becomes a new request. The `chatController` could then either:
            *   (Simpler) Ask the user to rephrase: "Okay, please ask me to 'find a 2-hour slot for project kickoff on Friday after 4pm'." This re-uses existing pathways.
            *   (More Advanced) The `chatController` could try to invoke the `Planner` again with a modified prompt like: "User wants to schedule 'project kickoff' for 2 hours on Friday after 4pm, as 2-4pm is busy. Find the earliest available slot."
    *   **Mid-Term (More Autonomous):**
        *   Introduce a "Find Free Slot" capability, possibly as a new tool or a more sophisticated function within the `chatController` that uses `ListEventsTool` iteratively or analyzes free/busy information from Google Calendar (if accessible via API and within scope).
        *   The `Planner` might be trained to output a multi-step plan or include "contingency" instructions.

**2. Partial Information, Recurrence:**
   > "Schedule a team sync for every alternate Tuesday at noon, but skip it during the last week of any month."

*   **Current System's Path:**
    *   `Planner` -> `EventCreatorLLM` for event details.
    *   `EventCreatorLLM` needs to generate recurrence rules. The `googleCalendarEventCreateObjectSchema` (and thus `createEventParamsSchema` in `calendarTools.ts`) has a `recurrence: z.array(z.string()).optional()` field for RRULE, EXRULE, etc.
*   **Challenges & Missing Pieces:**
    *   **Complex Recurrence Rule Generation:**
        *   "Every alternate Tuesday at noon": This is a standard RRULE (e.g., `FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;BYHOUR=12;BYMINUTE=0`). The `EventCreatorLLM` could potentially generate this if its prompt (`eventCreatorPrompt.md`) is sufficiently detailed with examples of recurrence.
        *   "Skip it during the last week of any month": This is significantly harder to express in a standard RRULE/EXRULE string. It might require complex `BYSETPOS` logic or multiple rules, which is challenging for an LLM to generate reliably and correctly without very specific examples or a dedicated recurrence parsing/generation library.
*   **Making it Work (Iterative Approach):**
    *   **Short-Term:**
        1.  **Enhance `eventCreatorPrompt.md`:** Add examples of how to translate common recurrence phrases (like "every other week," "monthly on the first Friday") into RRULE strings.
        2.  **Handle Complex Exclusions Gracefully:** For the "skip last week" part, the system might:
            *   State its limitation: "I can schedule the team sync for every alternate Tuesday at noon. However, I can't automatically skip it during the last week of the month. You might need to adjust those instances manually."
            *   Or, create the simpler recurring event and ignore the complex exclusion.
    *   **Mid-Term:**
        *   Investigate libraries or services that specialize in parsing natural language into iCalendar recurrence rules (RRULE, EXRULE, EXDATE). This could become a new tool.
        *   The `chatController` could potentially, after creating a base recurring event, fetch instances for the next few months and programmatically identify/offer to delete those falling in the "last week." This is complex controller logic.

**3. Conflicting Constraints (Priority Test):**
   > "Book a study group on Monday at 3pm, but if that conflicts with my gym, schedule it as late as possible that day before 7pm."

*   **Current System's Path:** Similar to query 1.
*   **Challenges & Missing Pieces:**
    *   **Conflict Detection (Specific Event Type):** Not just any conflict, but "if it conflicts with *my gym*." This requires identifying the type/summary of the conflicting event.
    *   **Finding "Latest Possible Slot":** An optimization problem within a time window.
*   **Making it Work (Iterative Approach):**
    *   **Short-Term (Interactive):**
        1.  **`ChatController` Enhancement (similar to Query 1):**
            *   Check for any conflict at Monday 3pm using `ListEventsTool`.
            *   **If Conflict:** The `chatController` would then present the conflict: "Monday 3pm is blocked by '[Conflicting Event Summary]'. Would you like me to find the latest possible slot for 'study group' today before 7pm?"
            *   Identifying if the conflicting event is "gym" would require the `chatController` to analyze the summary from `ListEventsTool` (simple keyword match for "gym" or a more advanced LLM call for classification if summaries are varied). This sub-step adds complexity.
        2.  **If User Confirms:** Similar to query 1, the user might need to rephrase, or the controller could try to re-invoke the planner with the new constraints.
    *   **Mid-Term (More Autonomous):**
        *   A "Find Free Slot" tool that can optimize for "latest" or "earliest" within a window.
        *   An "Event Classifier" capability (could be a small LLM call or regex) that the `chatController` uses on the results of `ListEventsTool` to determine the nature of conflicting events.

**Summary and Path Forward:**

*   **Fully autonomous handling of these queries is advanced and would require significant new components** (e.g., a dedicated "Smart Scheduler" module/tool, more sophisticated planner outputs, explicit state management for multi-turn conditional logic within the controller).
*   **We can make progress *now* by:**
    1.  **Enhancing `ChatController` for Interactive Conflict Resolution:** For queries 1 and 3, the most practical first step is for the `chatController` to:
        *   Proactively use `ListEventsTool` to check for conflicts before creating an event.
        *   If a conflict exists, clearly communicate this to the user and ask them how they'd like to proceed, offering the alternative mentioned in their query as an option (e.g., "Should I look for a slot after 4pm?").
    2.  **Improving `EventCreatorLLM` for Standard Recurrence:** For query 2, update `eventCreatorPrompt.md` with more examples to help it generate standard RRULEs. Acknowledge limitations for very complex exclusion rules.
    3.  **Logging & Iteration:** Implement these interactive steps, log how users respond and what kinds of complex requests come in. This data will inform the design of more autonomous solutions.

These queries highlight the jump from simple command execution to more nuanced, context-aware assistance. An iterative approach, starting with robust conflict detection and user-guided resolution, is the best way to build towards more sophisticated capabilities.


