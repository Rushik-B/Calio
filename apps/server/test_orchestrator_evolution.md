# Orchestrator Evolution Test Cases

This document provides comprehensive test cases to validate the evolved centralOrchestratorLLM implementation with workflow decomposition capabilities.

## Test Setup

Send these queries from the frontend and examine the server logs for:
1. Complexity analysis indicators
2. Workflow decomposition details
3. Task generation accuracy
4. Decision reasoning

## Test Cases

### 1. Multiple Steps with Connectors
**Query**: "Delete my 10am meeting tomorrow and then schedule a new one at 2pm with the same attendees"

**Expected Log Output**:
```
[CentralOrchestratorLLM] Processing mode: Standard Analysis
[CentralOrchestratorLLM] Analyzing query complexity for: Delete my 10am meeting tomorrow and then schedule a new one at 2pm with the same attendees
[CentralOrchestratorLLM] Complexity analysis - Score: 2, Indicators: [Multiple steps detected]
[CentralOrchestratorLLM] High complexity detected, likely to generate workflow
[CentralOrchestratorLLM] Decision type: Workflow
[CentralOrchestratorLLM] Workflow details: {
  name: "DeleteAndRescheduleWithAttendees",
  taskCount: 4,
  taskTypes: ["FindEvents", "ExtractAttendees", "ExecuteCalendarDelete", "ExecuteCalendarCreate"]
}
```

### 2. Conditional Logic
**Query**: "Schedule a team meeting for Friday at 2pm, but if that conflicts with anything, move it to 3pm instead"

**Expected Log Output**:
```
[CentralOrchestratorLLM] Complexity analysis - Score: 2, Indicators: [Conditional logic detected]
[CentralOrchestratorLLM] High complexity detected, likely to generate workflow
[CentralOrchestratorLLM] Decision type: Workflow
[CentralOrchestratorLLM] Workflow details: {
  name: "ConditionalMeetingScheduling",
  taskCount: 3,
  taskTypes: ["FindEvents", "BranchOnCondition", "ExecuteCalendarCreate"]
}
```

### 3. Batch Operations
**Query**: "Delete all my meetings with John from this week"

**Expected Log Output**:
```
[CentralOrchestratorLLM] Complexity analysis - Score: 1, Indicators: [Batch operations detected]
[CentralOrchestratorLLM] Low complexity detected, likely simple action
[CentralOrchestratorLLM] Decision type: call_planner
```

### 4. Cross-Calendar Operations
**Query**: "Sync my work and personal calendars for next week"

**Expected Log Output**:
```
[CentralOrchestratorLLM] Complexity analysis - Score: 1, Indicators: [Cross-calendar operations detected]
[CentralOrchestratorLLM] Low complexity detected, likely simple action
```

### 5. User Preferences
**Query**: "Schedule my writing time for next week, avoiding my usual gym hours"

**Expected Log Output**:
```
[CentralOrchestratorLLM] Complexity analysis - Score: 2, Indicators: [User preferences detected, Time relations detected]
[CentralOrchestratorLLM] High complexity detected, likely to generate workflow
[CentralOrchestratorLLM] Decision type: Workflow
[CentralOrchestratorLLM] Workflow details: {
  name: "ScheduleWritingAvoidingGym",
  taskCount: 3,
  taskTypes: ["FetchPreference", "FindEvents", "ExecuteCalendarCreate"]
}
```

### 6. Time Relations
**Query**: "Move my afternoon meetings to the morning after my workout"

**Expected Log Output**:
```
[CentralOrchestratorLLM] Complexity analysis - Score: 2, Indicators: [Time relations detected, Batch operations detected]
[CentralOrchestratorLLM] High complexity detected, likely to generate workflow
```

### 7. Ultimate Complex Query
**Query**: "Clear my calendar next Friday for travel and notify anyone I had meetings with, but if any meeting is marked urgent, ask me first"

**Expected Log Output**:
```
[CentralOrchestratorLLM] Complexity analysis - Score: 4, Indicators: [Multiple steps detected, Conditional logic detected, Batch operations detected, User preferences detected]
[CentralOrchestratorLLM] High complexity detected, likely to generate workflow
[CentralOrchestratorLLM] Decision type: Workflow
[CentralOrchestratorLLM] Workflow details: {
  name: "ClearFridayWithConditionalNotification",
  taskCount: 6,
  taskTypes: ["FindEvents", "FilterEvents", "BranchOnCondition", "RequestUserConfirmation", "ExecuteCalendarDeleteBatch", "ExtractAttendees"]
}
```

### 8. Simple Query (Should NOT Trigger Workflow)
**Query**: "What's my schedule for tomorrow?"

**Expected Log Output**:
```
[CentralOrchestratorLLM] Complexity analysis - Score: 0, Indicators: []
[CentralOrchestratorLLM] Low complexity detected, likely simple action
[CentralOrchestratorLLM] Decision type: call_planner
```

## Validation Checklist

### ✅ Core Functionality
- [ ] Complexity analysis correctly scores each indicator type
- [ ] Score threshold (≥2) properly triggers workflow mode
- [ ] Simple actions maintain backward compatibility
- [ ] Workflow definitions include all required fields (name, tasks)
- [ ] Task dependencies (dependsOn) are properly set
- [ ] OutputVariable naming is consistent

### ✅ Logging Quality
- [ ] Processing mode is clearly indicated
- [ ] Complexity indicators are accurately detected
- [ ] Workflow details are comprehensively logged
- [ ] Error handling logs are informative

### ✅ Type Safety
- [ ] No TypeScript compilation errors
- [ ] Zod schema validation passes
- [ ] Proper handling of optional vs required fields

### ✅ Prompt Engineering
- [ ] LLM generates appropriate task types
- [ ] Task parameters include all necessary data
- [ ] Workflow names are descriptive
- [ ] Human summaries are clear and helpful

## Next Steps After Testing

1. **If complexity detection works correctly**: Proceed to Phase 2 - implement workflow engine in chatController.ts
2. **If workflows are generated properly**: Begin implementing individual Skills
3. **If type safety is maintained**: Start working on user interaction tasks
4. **If logging is comprehensive**: Use logs to refine complexity detection algorithms

## Troubleshooting Common Issues

### Issue: All queries trigger workflows
**Solution**: Adjust complexity scoring thresholds or refine regex patterns

### Issue: Simple queries don't work
**Solution**: Verify backward compatibility in route.ts action dispatching

### Issue: Type errors
**Solution**: Check Zod schema alignment with TypeScript interfaces

### Issue: Poor workflow quality
**Solution**: Enhance orchestratorDecompositionPrompt.md with more examples 