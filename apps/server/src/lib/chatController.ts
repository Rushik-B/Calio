import { ZodError } from "zod";
import type { calendar_v3 } from "googleapis";
import { CalendarAction, CreateEventIntentParams, DeleteEventIntentParams, UpdateEventIntentParams } from "@/lib/planner";
import {
  CreateEventTool,
  ListEventsTool,
  UpdateEventTool,
  listEventsParamsSchema,
  updateEventParamsSchema,
  deleteEventParamsSchema,
} from "@/lib/calendarTools";
import { listEvents as apiListEvents, deleteEvent as apiDeleteEvent } from "@/lib/googleCalendar";
import { handleGeneralChat } from "@/lib/generalChatHandler";
import { handleEventAnalysis } from "@/lib/eventAnalyzer";
import { generateEventCreationJSONs, eventCreationRequestListSchema } from "@/lib/eventCreatorLLM";
import { generateEventDeletionJSONs, eventDeletionRequestListSchema } from "@/lib/eventDeleterLLM";
import { generateEventUpdateJSONs, eventUpdateRequestListSchema } from "@/lib/eventUpdaterLLM";

interface EventWithCalendarId extends calendar_v3.Schema$Event {
  calendarId: string;
}

interface ChatControllerParams {
  plan: CalendarAction;
  internalDbUserId: string;
  clerkUserId: string;
  googleAccessToken: string;
  explicitCalendarId?: string;
  selectedCalendarIds?: string[];
  userTimezone: string;
  textInput: string;
  userCalendarsFormatted: string;
  currentTimeISO: string;
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

// Define a more specific type for the events we expect to process (from eventDeleterLLM)
interface DeletionCandidateFromLLM {
  eventId: string;
  calendarId: string;
  summary?: string;
  reasoningForDeletion?: string;
}

// Refined to match calendar_v3.Schema$Event more closely for used fields
interface EventToConsider extends Omit<calendar_v3.Schema$Event, 'id' | 'summary' | 'start'> {
  id?: string | null; // id can be null or undefined in calendar_v3.Schema$Event
  summary?: string | null;
  start?: calendar_v3.Schema$EventDateTime | null;
  calendarId: string; // This is added when eventsToConsiderForDeletion is populated
}

export interface CreatedEventDetails {
  id: string;
  summary: string | null;
  htmlLink: string | null;
  description: string | null;
  location: string | null;
  start: calendar_v3.Schema$EventDateTime | null;
  end: calendar_v3.Schema$EventDateTime | null;
  calendarId: string;
  // Any other fields you want to ensure are available from the event details
}

export interface ClarificationNeededForDeletion {
  type: 'clarification_needed_for_deletion';
  originalQuery: string;
  candidates: Array<{
    eventId: string;
    calendarId: string;
    summary?: string | null;
    startTime?: string | null; // Formatted start time for user display
  }>;
}

export interface ClarificationNeededForTimeRange {
  type: 'clarification_needed_for_time_range';
  originalQuery: string;
  attemptedTimeMin?: string; 
  attemptedTimeMax?: string; 
}

export interface ConflictDetectedForCreation {
  type: 'conflict_detected_for_creation';
  message: string;
  proposedEvents: any[];
  conflictingEvents: any[];
  suggestions: string[];
}

export interface CreateEventExecutionResult {
  userMessage: string;
  createdEventsDetails: CreatedEventDetails[]; 
}

export type ExecutePlanResult = string | ClarificationNeededForDeletion | CreateEventExecutionResult | ClarificationNeededForTimeRange | ConflictDetectedForCreation;

// Conflict detection result interface
interface ConflictCheckResult {
  hasConflicts: boolean;
  message: string;
  conflictingEvents: any[];
}

// Helper function to parse date/time strings
function parseEventDateTime(dateTime: any): Date | null {
  if (!dateTime) return null;
  
  if (dateTime.dateTime) {
    return new Date(dateTime.dateTime);
  } else if (dateTime.date) {
    // For all-day events, treat as starting at midnight
    return new Date(dateTime.date + 'T00:00:00');
  }
  
  return null;
}

// Code-based conflict detection function
async function checkEventConflicts(
  proposedEvents: any[],
  existingEvents: calendar_v3.Schema$Event[],
  userTimezone: string
): Promise<ConflictCheckResult> {
  const conflicts: any[] = [];
  
  for (const proposedEvent of proposedEvents) {
    const proposedStart = parseEventDateTime(proposedEvent.start);
    const proposedEnd = parseEventDateTime(proposedEvent.end);
    
    if (!proposedStart || !proposedEnd) continue;
    
    for (const existingEvent of existingEvents) {
      const existingStart = parseEventDateTime(existingEvent.start);
      const existingEnd = parseEventDateTime(existingEvent.end);
      
      if (!existingStart || !existingEnd) continue;
      
      // Mathematical overlap check: start1 < end2 && start2 < end1
      if (proposedStart < existingEnd && existingStart < proposedEnd) {
        conflicts.push({
          id: existingEvent.id,
          summary: existingEvent.summary || 'Untitled Event',
          start: existingEvent.start?.dateTime || existingEvent.start?.date,
          end: existingEvent.end?.dateTime || existingEvent.end?.date,
          calendarId: (existingEvent as any).calendarId || 'unknown'
        });
      }
    }
  }
  
  if (conflicts.length > 0) {
    const conflictSummaries = conflicts.map(c => c.summary).join(', ');
    return {
      hasConflicts: true,
      message: `Your ${proposedEvents[0]?.summary || 'event'} conflicts with: ${conflictSummaries}`,
      conflictingEvents: conflicts
    };
  }
  
  return {
    hasConflicts: false,
    message: '',
    conflictingEvents: []
  };
}

// Smart suggestion engine - finds available time slots
function generateTimeSlotSuggestions(
  proposedEvent: any,
  existingEvents: calendar_v3.Schema$Event[],
  userTimezone: string
): string[] {
  const suggestions: string[] = [];
  const proposedStart = parseEventDateTime(proposedEvent.start);
  const proposedEnd = parseEventDateTime(proposedEvent.end);
  
  if (!proposedStart || !proposedEnd) {
    return ["Please try a different time"];
  }
  
  const duration = proposedEnd.getTime() - proposedStart.getTime();
  const proposedDate = new Date(proposedStart);
  
  // Generate suggestions for the same day first
  const sameDaySlots = findAvailableSlots(proposedDate, duration, existingEvents);
  sameDaySlots.slice(0, 2).forEach(slot => {
    const timeStr = slot.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true,
      timeZone: userTimezone 
    });
    suggestions.push(`Try ${timeStr} on the same day`);
  });
  
  // Add next day suggestion
  const nextDay = new Date(proposedDate);
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDaySlots = findAvailableSlots(nextDay, duration, existingEvents);
  if (nextDaySlots.length > 0) {
    const timeStr = proposedStart.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true,
      timeZone: userTimezone 
    });
    suggestions.push(`Schedule tomorrow at ${timeStr}`);
  }
  
  // Add fallback option
  suggestions.push("Create anyway and resolve the conflict later");
  
  return suggestions.slice(0, 4); // Limit to 4 suggestions
}

// Helper function to find available time slots
function findAvailableSlots(
  targetDate: Date,
  duration: number,
  existingEvents: calendar_v3.Schema$Event[]
): Date[] {
  const slots: Date[] = [];
  const dayStart = new Date(targetDate);
  dayStart.setHours(8, 0, 0, 0); // Start at 8 AM
  const dayEnd = new Date(targetDate);
  dayEnd.setHours(22, 0, 0, 0); // End at 10 PM
  
  // Generate potential time slots (every hour)
  for (let time = dayStart.getTime(); time <= dayEnd.getTime() - duration; time += 60 * 60 * 1000) {
    const slotStart = new Date(time);
    const slotEnd = new Date(time + duration);
    
    // Check if this slot conflicts with any existing events
    const hasConflict = existingEvents.some(event => {
      const existingStart = parseEventDateTime(event.start);
      const existingEnd = parseEventDateTime(event.end);
      
      if (!existingStart || !existingEnd) return false;
      
      // Check for overlap
      return slotStart < existingEnd && existingStart < slotEnd;
    });
    
    if (!hasConflict) {
      slots.push(slotStart);
    }
  }
  
  return slots;
}

export async function executePlan(params: ChatControllerParams): Promise<ExecutePlanResult> {
  const { 
    plan, 
    internalDbUserId,
    clerkUserId,
    googleAccessToken, 
    explicitCalendarId, 
    selectedCalendarIds, 
    userTimezone, 
    textInput, 
    userCalendarsFormatted, 
    currentTimeISO 
  } = params;

  let toolResult: ExecutePlanResult = "";

  if (plan.action !== 'create_event' && plan.action !== 'delete_event' && explicitCalendarId && plan.params) {
    (plan.params as any).calendarId = explicitCalendarId || (plan.params as any).calendarId;
  } else if (plan.action !== 'create_event' && plan.action !== 'delete_event' && explicitCalendarId && !plan.params) {
    plan.params = {
        actionType: plan.action as any,
        calendarId: explicitCalendarId,
    };
  }

  switch (plan.action) {
    case "create_event":
      const createIntentParams = plan.params as CreateEventIntentParams;
      if (!createIntentParams || typeof createIntentParams.userInput !== 'string') {
        console.error("[ChatController] Invalid params for create_event action:", createIntentParams);
        throw new Error("Planner did not provide valid input for event creation.");
      }

      console.log("[ChatController] Calling EventCreatorLLM with userInput:", createIntentParams.userInput, "and anchorContext:", createIntentParams.anchorEventsContext);
      
      // Fetch existing events for conflict checking (from the next few days)
      const conflictCheckTimeMin = new Date().toISOString();
      const conflictCheckTimeMax = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // Next 7 days
      
      let existingEventsForConflictCheck: calendar_v3.Schema$Event[] = [];
      const calendarsToCheckForConflicts = selectedCalendarIds || [explicitCalendarId || 'primary'].filter(Boolean);
      
      try {
        for (const calId of calendarsToCheckForConflicts) {
          console.log(`[ChatController] Fetching events from calendar '${calId}' for conflict checking.`);
          const eventsFromCal = await apiListEvents(clerkUserId, googleAccessToken, calId, {
            timeMin: conflictCheckTimeMin,
            timeMax: conflictCheckTimeMax,
            singleEvents: true,
            orderBy: "startTime",
            timeZone: userTimezone
          });
          if (eventsFromCal) {
            // Add calendarId to each event for conflict checking
            const eventsWithCalendarId = eventsFromCal.map(event => ({
              ...event,
              calendarId: calId
            }));
            existingEventsForConflictCheck.push(...eventsWithCalendarId);
          }
        }
        console.log(`[ChatController] Found ${existingEventsForConflictCheck.length} existing events for conflict checking.`);
      } catch (error) {
        console.warn("[ChatController] Failed to fetch events for conflict checking:", error);
        // Continue without conflict checking
      }

      // Pass existing events to EventCreatorLLM so it can handle conditional logic properly
      const eventJSONsToCreate = await generateEventCreationJSONs({
        userInput: createIntentParams.userInput,
        userTimezone: userTimezone,
        userCalendarsFormatted: userCalendarsFormatted,
        currentTimeISO: currentTimeISO,
        anchorEventsContext: createIntentParams.anchorEventsContext,
        timezoneInfo: params.timezoneInfo,
        existingEventsForConflictCheck: existingEventsForConflictCheck, // Pass existing events for conditional logic evaluation
      });

      // CODE-BASED CONFLICT DETECTION
      if (eventJSONsToCreate && eventJSONsToCreate.length > 0) {
        const conflictResult = await checkEventConflicts(
          eventJSONsToCreate,
          existingEventsForConflictCheck,
          userTimezone
        );
        
        if (conflictResult.hasConflicts) {
          // Generate intelligent suggestions using our smart suggestion engine
          const suggestions = generateTimeSlotSuggestions(
            eventJSONsToCreate[0], // Primary event
            existingEventsForConflictCheck,
            userTimezone
          );
          
          return {
            type: 'conflict_detected_for_creation',
            message: conflictResult.message,
            proposedEvents: eventJSONsToCreate,
            conflictingEvents: conflictResult.conflictingEvents,
            suggestions: suggestions
          } as ConflictDetectedForCreation;
        }
      }

      if (!eventJSONsToCreate || eventJSONsToCreate.length === 0) {
        toolResult = "I couldn't determine any specific events to create from your request. Could you please rephrase or provide more details?";
        break;
      }

      const creationResultsMessages: string[] = [];
      const createdEventsDetailsList: CreatedEventDetails[] = [];
      const createTool = new CreateEventTool(clerkUserId, googleAccessToken);

      for (const eventData of eventJSONsToCreate) {
        try {
          const finalEventDataForTool = {
            ...eventData,
            calendarId: eventData.calendarId || createIntentParams.calendarId || 'primary'
          };
          const singleCreationResultString = await createTool.call(finalEventDataForTool);
          const parsedResult = JSON.parse(singleCreationResultString);

          if (parsedResult.details) {
            createdEventsDetailsList.push({
              id: parsedResult.details.id,
              summary: parsedResult.details.summary,
              htmlLink: parsedResult.details.htmlLink,
              description: finalEventDataForTool.description || null, // from input to tool
              location: finalEventDataForTool.location || null,     // from input to tool
              start: parsedResult.details.start,            // from GCal API response
              end: parsedResult.details.end,                // from GCal API response
              calendarId: parsedResult.details.calendarId     // from GCal API response (or default)
            });
            creationResultsMessages.push(parsedResult.message); 
          } else {
            creationResultsMessages.push(parsedResult.message || "Failed to create an event due to an unknown issue.");
          }

        } catch (error) {
          let errorMsg = "Failed to create one of the events.";
          if (error instanceof ZodError) {
            console.error("[ChatController] ZodError during createTool call or pre-validation for event:", JSON.stringify(eventData, null, 2), error.format());
            errorMsg = `Error validating parameters for event '${eventData.summary || "(unknown summary)"}': ${error.flatten().fieldErrors.summary?.[0] || 'details in log'}`;
          } else if (error instanceof Error) {
            console.error("[ChatController] Error creating event with data:", JSON.stringify(eventData, null, 2), error);
            errorMsg = `Error creating event '${eventData.summary || "(unknown summary)"}': ${error.message}`;
          }
          creationResultsMessages.push(errorMsg);
        }
      }
      // toolResult = creationResults.join("\n\n");
      return {
        userMessage: creationResultsMessages.join("\n\n"),
        createdEventsDetails: createdEventsDetailsList
      };
    case "list_events":
      const parsedListParams = listEventsParamsSchema.parse(plan.params || {});
      const effectiveCalendarId = explicitCalendarId || parsedListParams.calendarId || 'primary'; 
      const effectiveTimeZone = parsedListParams.timeZone || userTimezone;

      let fetchedEvents: EventWithCalendarId[] = []; 

      if (selectedCalendarIds && selectedCalendarIds.length > 0 && !explicitCalendarId) {
        // Multi-calendar: Fetch events from all selected calendars
        console.log(`[ChatController] Multi-calendar list_events for calendars: ${selectedCalendarIds.join(', ')} using timezone: ${effectiveTimeZone}`);
        const optionsBase: Omit<calendar_v3.Params$Resource$Events$List, 'calendarId' | 'timeZone'> = {
          q: parsedListParams.query,
          timeMin: parsedListParams.timeMin,
          timeMax: parsedListParams.timeMax,
          singleEvents: true,
          orderBy: "startTime",
        };
        for (const calId of selectedCalendarIds) {
          const eventsFromCal = await apiListEvents(clerkUserId, googleAccessToken, calId, { ...optionsBase, timeZone: effectiveTimeZone });
          if (eventsFromCal) {
            eventsFromCal.forEach(event => fetchedEvents.push({ ...event, calendarId: calId }));
          }
        }
          } else {
        // Single-calendar: Use ListEventsTool
        console.log(`[ChatController] Single-calendar list_events for calendar: ${effectiveCalendarId} using timezone: ${effectiveTimeZone}`);
        const listTool = new ListEventsTool(clerkUserId, googleAccessToken);
        const paramsForTool = { 
          ...parsedListParams, 
          calendarId: effectiveCalendarId, 
          timeZone: effectiveTimeZone 
        };
        
        const toolOutput = await listTool.call(paramsForTool);

        if (Array.isArray(toolOutput)) { // Events array returned (questionAboutEvents was present)
           fetchedEvents = toolOutput.map(event => ({ ...event, calendarId: effectiveCalendarId } as EventWithCalendarId));
        } else if (typeof toolOutput === 'string' && !parsedListParams.questionAboutEvents) {
          // Summary string returned (no questionAboutEvents)
          toolResult = toolOutput;
          break; // Skip further processing
        } else if (typeof toolOutput === 'string' && parsedListParams.questionAboutEvents) {
          if(toolOutput.startsWith("Failed to list events") || toolOutput.startsWith("No events found")) {
             toolResult = toolOutput; 
             break; 
          }
          console.warn("[ChatController] ListEventsTool returned an unexpected string when a question was asked. Output:", toolOutput);
          fetchedEvents = []; 
        }
      }

      // --- Consistent Analysis or Summary --- 
      if (parsedListParams.questionAboutEvents) {
        if (fetchedEvents.length > 0) {
          const eventContextForLLM = fetchedEvents.map(item => 
            `Calendar: ${item.calendarId}\nEvent: ${item.summary || 'N/A'}\nStart: ${item.start?.dateTime || item.start?.date || 'N/A'}\nEnd: ${item.end?.dateTime || item.end?.date || 'N/A'}${item.description ? `\nDescription: ${item.description}`: ''}`
          ).join("\n---\n");
          console.log(`[ChatController] Calling handleEventAnalysis for question: "${parsedListParams.questionAboutEvents}" with ${fetchedEvents.length} events using timezone ${effectiveTimeZone}.`);
          toolResult = await handleEventAnalysis(parsedListParams.questionAboutEvents, eventContextForLLM, effectiveTimeZone);
        } else {
          // toolResult might have been set by ListEventsTool returning "No events found..."
          // Only set a new message if toolResult is still its initial empty string or was not a specific "no events" message.
          if (toolResult === "" || !toolResult.includes("No events found")) {
            toolResult = `I'm Sorry :( , I couldn't find any events related to "${parsedListParams.questionAboutEvents}". Maybe try rephrasing your question?\n\nP.S. Have you selected the correct calendars?`;
          }
        }
      } else {
        if (toolResult === "") { // Only if not already set by single-calendar direct string output or error
            if (fetchedEvents.length > 0) {
                const calsRepresented = Array.from(new Set(fetchedEvents.map(e => e.calendarId))); // Correctly convert Set to Array
                const eventsStringArray = calsRepresented.map(calId => {
                    const eventsFromThisCal = fetchedEvents.filter(item => item.calendarId === calId);
                    if (eventsFromThisCal.length === 0) return null;
                    return `From calendar '${calId}': ${eventsFromThisCal
                        .map(item => `ID: ${item.id || 'N/A'}, Summary: ${item.summary || 'N/A'}, Start: ${item.start?.dateTime || item.start?.date || 'N/A'}`)
                        .join("; ")}`;
                }).filter(str => str !== null);
                toolResult = `Found ${fetchedEvents.length} event(s) across ${calsRepresented.length} calendar(s):\n${eventsStringArray.join("\n")}`;
        } else {
              toolResult = "No events found matching your criteria.";
            }
        }
      }
      break;
    case "update_event":
      const updateIntentParams = plan.params as UpdateEventIntentParams;
      if (!updateIntentParams || typeof updateIntentParams.userInput !== 'string') {
        console.error("[ChatController] Invalid params for update_event action:", updateIntentParams);
        throw new Error("Planner did not provide valid input for event updating.");
      }

      let targetCalendarIdsForUpdate: string[] = [];
      if (explicitCalendarId) {
        targetCalendarIdsForUpdate = [explicitCalendarId];
      } else if (selectedCalendarIds && selectedCalendarIds.length > 0) {
        targetCalendarIdsForUpdate = selectedCalendarIds;
      } else if (updateIntentParams.calendarId) {
        targetCalendarIdsForUpdate = [updateIntentParams.calendarId];
      } else {
        console.warn("[ChatController] No specific calendar ID for update, defaulting to 'primary'.");
        targetCalendarIdsForUpdate = ['primary'];
      }

      console.log(`[ChatController] Attempting to update events. User input: "${updateIntentParams.userInput}". Target calendars: ${targetCalendarIdsForUpdate.join(', ')}`);

      const eventsToConsiderForUpdate: EventWithCalendarId[] = [];
      const updateListOptions: Omit<calendar_v3.Params$Resource$Events$List, 'calendarId' | 'timeZone'> = {
        timeMin: updateIntentParams.timeMin, 
        timeMax: updateIntentParams.timeMax, 
        q: updateIntentParams.query,
        singleEvents: true,
        orderBy: "startTime",
      };

      // Use anchor events context if provided by orchestrator, otherwise fetch events
      if (updateIntentParams.anchorEventsContext && updateIntentParams.anchorEventsContext.length > 0) {
        // Convert anchor events context to EventWithCalendarId format, now with real event IDs
        updateIntentParams.anchorEventsContext.forEach(anchorEvent => {
          if (anchorEvent.id && anchorEvent.summary && anchorEvent.calendarId) {
            eventsToConsiderForUpdate.push({
              id: anchorEvent.id, // Now has the real event ID
              summary: anchorEvent.summary,
              start: anchorEvent.start, // Already in proper Google Calendar format
              end: anchorEvent.end, // Already in proper Google Calendar format
              calendarId: anchorEvent.calendarId,
            } as EventWithCalendarId);
          }
        });
        console.log(`[ChatController] Using ${eventsToConsiderForUpdate.length} anchor events for update consideration.`);
      } else {
        // Fetch events from calendars
        for (const calId of targetCalendarIdsForUpdate) {
          console.log(`[ChatController] Fetching events from calendar '${calId}' to consider for update.`);
          const eventsFromCal = await apiListEvents(clerkUserId, googleAccessToken, calId, { ...updateListOptions, timeZone: userTimezone });
          if (eventsFromCal) {
            eventsFromCal.forEach(event => eventsToConsiderForUpdate.push({ ...event, calendarId: calId }));
          }
        }
      }

      if (eventsToConsiderForUpdate.length === 0) {
        toolResult = `I couldn't find any events matching your description ("${updateIntentParams.userInput}") to update.`;
        break;
      }

      console.log(`[ChatController] Calling EventUpdaterLLM with ${eventsToConsiderForUpdate.length} events.`);

      const eventJSONsToUpdate = await generateEventUpdateJSONs({
        userInput: updateIntentParams.userInput,
        userTimezone: userTimezone,
        eventList: eventsToConsiderForUpdate,
        targetCalendarIds: targetCalendarIdsForUpdate,
        currentTimeISO: currentTimeISO,
        timezoneInfo: params.timezoneInfo,
      });

      if (!eventJSONsToUpdate || eventJSONsToUpdate.length === 0) {
        toolResult = `I looked for events matching your description ("${updateIntentParams.userInput}") but couldn't pinpoint specific ones to update.`;
        break;
      }

      const updateResults: string[] = [];
      const successfullyUpdatedSummaries: string[] = [];
      const failedToUpdateSummaries: string[] = [];
      let allUpdateSucceeded = true;
      let anyUpdateSucceeded = false;

      for (const eventToUpdate of eventJSONsToUpdate) {
        if (!eventToUpdate.eventId || !eventToUpdate.calendarId) {
            console.warn("[ChatController] EventUpdaterLLM provided an item without eventId or calendarId:", eventToUpdate);
            updateResults.push(`Skipped updating an event due to missing ID or calendar ID.`); 
            failedToUpdateSummaries.push(eventToUpdate.summary || 'an event with missing details');
            allUpdateSucceeded = false;
            continue;
        }

        try {
          if (!targetCalendarIdsForUpdate.includes(eventToUpdate.calendarId)) {
            console.warn(`[ChatController] EventUpdaterLLM tried to update from a non-target calendar ${eventToUpdate.calendarId}. Skipping.`);
            updateResults.push(`Skipped updating event as it was from an unexpected calendar.`); 
            failedToUpdateSummaries.push(eventToUpdate.summary || eventToUpdate.eventId);
            allUpdateSucceeded = false;
            continue;
          }

          // Create update parameters for the existing UpdateEventTool
          const updateToolParams: any = {
            eventId: eventToUpdate.eventId,
            calendarId: eventToUpdate.calendarId,
          };

          // Only include fields that are being updated
          if (eventToUpdate.summary) updateToolParams.summary = eventToUpdate.summary;
          if (eventToUpdate.description) updateToolParams.description = eventToUpdate.description;
          if (eventToUpdate.location) updateToolParams.location = eventToUpdate.location;
          if (eventToUpdate.start?.dateTime) updateToolParams.start = eventToUpdate.start.dateTime;
          if (eventToUpdate.end?.dateTime) updateToolParams.end = eventToUpdate.end.dateTime;
          if (eventToUpdate.attendees) updateToolParams.attendees = eventToUpdate.attendees;

          const updateTool = new UpdateEventTool(clerkUserId, googleAccessToken);
          const result = await updateTool.call(updateToolParams);
          
          if (result.includes('updated successfully')) {
            updateResults.push(result);
            successfullyUpdatedSummaries.push(eventToUpdate.summary || eventToUpdate.eventId);
            anyUpdateSucceeded = true;
          } else {
            updateResults.push(result);
            failedToUpdateSummaries.push(eventToUpdate.summary || eventToUpdate.eventId);
            allUpdateSucceeded = false;
          }
        } catch (error) {
          let errorMsg = `Error updating event ${eventToUpdate.summary || eventToUpdate.eventId} (ID: ${eventToUpdate.eventId}).`;
          if (error instanceof Error) {
            errorMsg += `: ${error.message}`;
          }
          console.error("[ChatController] Error calling UpdateEventTool:", error);
          updateResults.push(errorMsg);
          failedToUpdateSummaries.push(eventToUpdate.summary || eventToUpdate.eventId);
          allUpdateSucceeded = false;
        }
      }

      if (anyUpdateSucceeded && allUpdateSucceeded) {
        if (successfullyUpdatedSummaries.length === 1) {
          toolResult = `Great! I've updated '${successfullyUpdatedSummaries[0]}' for you.`;
        } else {
          toolResult = `Excellent! I've updated ${successfullyUpdatedSummaries.length} events: ${successfullyUpdatedSummaries.map(s => `'${s}'`).join(', ')}.`;
        }
      } else if (anyUpdateSucceeded && !allUpdateSucceeded) {
        let response = `I was able to update: ${successfullyUpdatedSummaries.map(s => `'${s}'`).join(', ')}.`;
        if (failedToUpdateSummaries.length > 0) {
          response += ` However, I couldn't update: ${failedToUpdateSummaries.map(s => `'${s}'`).join(', ')}.`;
        }
        toolResult = response;
      } else { 
        toolResult = "I'm sorry, I wasn't able to update the requested event(s) at this time. Please ensure the event details are correct or try again.";
      }
      break;
    case "delete_event":
      const deleteIntentParams = plan.params as DeleteEventIntentParams;
      if (!deleteIntentParams || typeof deleteIntentParams.userInput !== 'string') {
        console.error("[ChatController] Invalid params for delete_event action:", deleteIntentParams);
        throw new Error("Planner did not provide valid input for event deletion.");
      }

      let targetCalendarIdsForDelete: string[] = [];
      if (explicitCalendarId) {
        targetCalendarIdsForDelete = [explicitCalendarId];
      } else if (selectedCalendarIds && selectedCalendarIds.length > 0) {
        targetCalendarIdsForDelete = selectedCalendarIds;
      } else if (deleteIntentParams.calendarId) {
        targetCalendarIdsForDelete = [deleteIntentParams.calendarId];
      } else {
        console.warn("[ChatController] No specific calendar ID for deletion, defaulting to 'primary'. This might be risky.");
        targetCalendarIdsForDelete = ['primary'];
      }

      console.log(`[ChatController] Attempting to delete events. User input: "${deleteIntentParams.userInput}". Target calendars: ${targetCalendarIdsForDelete.join(', ')}`);

      const eventsToConsiderForDeletion: EventWithCalendarId[] = [];
      const listOptions: Omit<calendar_v3.Params$Resource$Events$List, 'calendarId' | 'timeZone'> = {
        timeMin: deleteIntentParams.timeMin, 
        timeMax: deleteIntentParams.timeMax, 
        singleEvents: true,
        orderBy: "startTime",
      };

      for (const calId of targetCalendarIdsForDelete) {
        console.log(`[ChatController] Fetching events from calendar '${calId}' to consider for deletion.`);
        const eventsFromCal = await apiListEvents(clerkUserId, googleAccessToken, calId, { ...listOptions, timeZone: userTimezone });
        if (eventsFromCal) {
          eventsFromCal.forEach(event => eventsToConsiderForDeletion.push({ ...event, calendarId: calId }));
        }
      }

      if (eventsToConsiderForDeletion.length === 0) {
        console.log(`[ChatController] No events found in the specified time range to consider for deletion. Query: "${deleteIntentParams.userInput}", TimeMin: ${deleteIntentParams.timeMin}, TimeMax: ${deleteIntentParams.timeMax}`);
        return {
          type: 'clarification_needed_for_time_range',
          originalQuery: deleteIntentParams.userInput,
          attemptedTimeMin: deleteIntentParams.timeMin,
          attemptedTimeMax: deleteIntentParams.timeMax
        };
      }

      console.log(`[ChatController] Calling EventDeleterLLM with ${eventsToConsiderForDeletion.length} events.`);
      console.log("[ChatController] Events being sent to EventDeleterLLM for evaluation:", JSON.stringify(eventsToConsiderForDeletion, null, 2));

      const eventJSONsToDelete: DeletionCandidateFromLLM[] = await generateEventDeletionJSONs({
        userInput: deleteIntentParams.userInput,
        userTimezone: userTimezone,
        eventList: eventsToConsiderForDeletion,
        targetCalendarIds: targetCalendarIdsForDelete,
        currentTimeISO: currentTimeISO,
        timezoneInfo: params.timezoneInfo,
      });

      const userFriendlyCandidates = eventsToConsiderForDeletion.map(e => ({
        eventId: e.id || 'unknown-id',
        calendarId: e.calendarId,
        summary: e.summary,
        startTime: e.start?.dateTime || e.start?.date || 'N/A'
      }));

      if (deleteIntentParams.originalRequestNature === "singular" && eventJSONsToDelete && eventJSONsToDelete.length > 1) {
        console.log(`[ChatController] Ambiguity: Singular request, but EventDeleterLLM identified ${eventJSONsToDelete.length} events.`);
        return {
          type: 'clarification_needed_for_deletion',
          originalQuery: deleteIntentParams.userInput,
          candidates: eventJSONsToDelete.map(e => ({
              eventId: e.eventId,
              calendarId: e.calendarId,
              summary: e.summary,
              startTime: eventsToConsiderForDeletion.find(etc => etc.id === e.eventId)?.start?.dateTime || eventsToConsiderForDeletion.find(etc => etc.id === e.eventId)?.start?.date || 'N/A'
          }))
        };
      }

      if ((!eventJSONsToDelete || eventJSONsToDelete.length === 0) && eventsToConsiderForDeletion.length > 0) {
        console.log(`[ChatController] Ambiguity: EventDeleterLLM unsure, but ${eventsToConsiderForDeletion.length} potential candidates existed.`);
        return {
          type: 'clarification_needed_for_deletion',
          originalQuery: deleteIntentParams.userInput,
          candidates: userFriendlyCandidates
        };
      }
      
      if (!eventJSONsToDelete || eventJSONsToDelete.length === 0) {
        toolResult = `I looked for events matching your description ("${deleteIntentParams.userInput}") but couldn't pinpoint specific ones to delete.`;
        break;
      }

      const deletionResults: string[] = [];
      const successfullyDeletedSummaries: string[] = [];
      const failedToDeleteSummaries: string[] = [];
      let allSucceeded = true;
      let anySucceeded = false;

      for (const eventToDelete of eventJSONsToDelete) {
        if (!eventToDelete.eventId || !eventToDelete.calendarId) {
            console.warn("[ChatController] EventDeleterLLM provided an item without eventId or calendarId:", eventToDelete);
            deletionResults.push(`Skipped deleting an event due to missing ID or calendar ID (Summary: ${eventToDelete.summary || 'N/A'}).`); 
            failedToDeleteSummaries.push(eventToDelete.summary || eventToDelete.eventId || 'an event with missing details');
            allSucceeded = false;
            continue;
        }
        try {
          if (!targetCalendarIdsForDelete.includes(eventToDelete.calendarId)) {
            console.warn(`[ChatController] EventDeleterLLM tried to delete from a non-target calendar ${eventToDelete.calendarId}. Skipping.`);
            deletionResults.push(`Skipped deleting event '${eventToDelete.summary || eventToDelete.eventId}' as it was from an unexpected calendar.`); 
            failedToDeleteSummaries.push(eventToDelete.summary || eventToDelete.eventId);
            allSucceeded = false;
            continue;
          }
          const success = await apiDeleteEvent(clerkUserId, googleAccessToken, eventToDelete.calendarId, eventToDelete.eventId);
          const reasoningText = eventToDelete.reasoningForDeletion ? ` Reason: ${eventToDelete.reasoningForDeletion}` : ""; 
          if (success) {
            deletionResults.push(`Successfully deleted event: ${eventToDelete.summary || eventToDelete.eventId} (ID: ${eventToDelete.eventId}) from calendar ${eventToDelete.calendarId}.${reasoningText}`);
            successfullyDeletedSummaries.push(eventToDelete.summary || eventToDelete.eventId);
            anySucceeded = true;
          } else {
            deletionResults.push(`Failed to delete event: ${eventToDelete.summary || eventToDelete.eventId} (ID: ${eventToDelete.eventId}) from calendar ${eventToDelete.calendarId}. It might not exist or an error occurred.${reasoningText}`);
            failedToDeleteSummaries.push(eventToDelete.summary || eventToDelete.eventId);
            allSucceeded = false;
          }
        } catch (error) {
          let errorMsg = `Error deleting event ${eventToDelete.summary || eventToDelete.eventId} (ID: ${eventToDelete.eventId}).`;
          if (error instanceof Error) {
            errorMsg += `: ${error.message}`;
          }
          console.error("[ChatController] Error calling apiDeleteEvent:", error);
          deletionResults.push(errorMsg);
          failedToDeleteSummaries.push(eventToDelete.summary || eventToDelete.eventId);
          allSucceeded = false;
        }
      }

      if (anySucceeded && allSucceeded) {
        if (successfullyDeletedSummaries.length === 1) {
          toolResult = `Okay, I've deleted '${successfullyDeletedSummaries[0]}' for you.`;
        } else {
          toolResult = `Alright, I've removed ${successfullyDeletedSummaries.length} events: ${successfullyDeletedSummaries.map(s => `'${s}'`).join(', ')}.`;
        }
      } else if (anySucceeded && !allSucceeded) {
        let response = `Okay, I was able to delete: ${successfullyDeletedSummaries.map(s => `'${s}'`).join(', ')}.`;
        if (failedToDeleteSummaries.length > 0) {
          response += ` However, I couldn't remove: ${failedToDeleteSummaries.map(s => `'${s}'`).join(', ')}.`;
        }
        toolResult = response;
      } else { 
        toolResult = "I'm sorry, I wasn't able to delete the requested event(s) at this time. Please ensure the event details are correct or try again.";
      }
      break;
    case "general_chat":
      toolResult = await handleGeneralChat(textInput);
      break;
    default:
      const unhandledAction = plan.action as string;
      console.warn(`[ChatController] Unhandled plan action: ${unhandledAction}`);
      throw new Error(`Unknown action: ${unhandledAction}`);
  }
  return toolResult;
} 