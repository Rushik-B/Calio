import { ZodError } from "zod";
import type { calendar_v3 } from "googleapis";
import { CalendarAction, CreateEventIntentParams, DeleteEventIntentParams } from "@/lib/planner";
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

interface EventWithCalendarId extends calendar_v3.Schema$Event {
  calendarId: string;
}

interface ChatControllerParams {
  plan: CalendarAction;
  userId: string;
  googleAccessToken: string;
  explicitCalendarId?: string;
  selectedCalendarIds?: string[];
  userTimezone: string;
  textInput: string;
  userCalendarsFormatted: string;
  currentTimeISO: string;
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

export type ExecutePlanResult = string | ClarificationNeededForDeletion;

export async function executePlan(params: ChatControllerParams): Promise<ExecutePlanResult> {
  const { 
    plan, 
    userId, 
    googleAccessToken, 
    explicitCalendarId, 
    selectedCalendarIds, 
    userTimezone, 
    textInput, 
    userCalendarsFormatted, 
    currentTimeISO 
  } = params;

  let toolResult: ExecutePlanResult;

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

      console.log("[ChatController] Calling EventCreatorLLM with userInput:", createIntentParams.userInput);
      const eventJSONsToCreate = await generateEventCreationJSONs({
        userInput: createIntentParams.userInput,
        userTimezone: userTimezone,
        userCalendarsFormatted: userCalendarsFormatted,
        currentTimeISO: currentTimeISO
      });

      if (!eventJSONsToCreate || eventJSONsToCreate.length === 0) {
        toolResult = "I couldn't determine any specific events to create from your request. Could you please rephrase or provide more details?";
        break;
      }

      const creationResults: string[] = [];
      const createTool = new CreateEventTool(userId, googleAccessToken);

      for (const eventData of eventJSONsToCreate) {
        try {
          const finalEventDataForTool = {
            ...eventData,
            calendarId: eventData.calendarId || createIntentParams.calendarId || 'primary'
          };
          const singleCreationResult = await createTool.call(finalEventDataForTool);
          creationResults.push(singleCreationResult);
        } catch (error) {
          let errorMsg = "Failed to create one of the events.";
          if (error instanceof ZodError) {
            console.error("[ChatController] ZodError during createTool call or pre-validation for event:", JSON.stringify(eventData, null, 2), error.format());
            errorMsg = `Error validating parameters for event '${eventData.summary || "(unknown summary)"}': ${error.flatten().fieldErrors.summary?.[0] || 'details in log'}`;
          } else if (error instanceof Error) {
            console.error("[ChatController] Error creating event with data:", JSON.stringify(eventData, null, 2), error);
            errorMsg = `Error creating event '${eventData.summary || "(unknown summary)"}': ${error.message}`;
          }
          creationResults.push(errorMsg);
        }
      }
      toolResult = creationResults.join("\n\n");
      break;
    case "list_events":
      const parsedListParams = listEventsParamsSchema.parse(plan.params || {});
      let calendarToListFrom = explicitCalendarId || parsedListParams.calendarId;

      if (selectedCalendarIds && selectedCalendarIds.length > 0 && !explicitCalendarId) {
        const allFetchedEvents: EventWithCalendarId[] = [];
        const optionsBase: Omit<calendar_v3.Params$Resource$Events$List, 'calendarId' | 'timeZone'> = {
          q: parsedListParams.query,
          timeMin: parsedListParams.timeMin,
          timeMax: parsedListParams.timeMax,
          singleEvents: true,
          orderBy: "startTime",
        };
        for (const calId of selectedCalendarIds) {
          const eventsFromCal = await apiListEvents(userId, googleAccessToken, calId, { ...optionsBase, timeZone: userTimezone });
          if (eventsFromCal) {
            eventsFromCal.forEach(event => allFetchedEvents.push({ ...event, calendarId: calId }));
          }
        }
        console.log(`[ChatController] Total events fetched for list_events (multi-calendar): ${allFetchedEvents.length}`);
        if (parsedListParams.questionAboutEvents) {
          if (allFetchedEvents.length > 0) {
            const eventContextForLLM = allFetchedEvents.map(item => 
              `Calendar: ${item.calendarId}\nEvent: ${item.summary || 'N/A'}\nStart: ${item.start?.dateTime || item.start?.date || 'N/A'}\nEnd: ${item.end?.dateTime || item.end?.date || 'N/A'}`
            ).join("\n---\n");
            toolResult = await handleEventAnalysis(parsedListParams.questionAboutEvents, eventContextForLLM);
          } else {
            toolResult = `No events found across selected calendars for the period to answer your question: "${parsedListParams.questionAboutEvents}"`;
          }
        } else {
          if (allFetchedEvents.length > 0) {
              const eventsStringArray = selectedCalendarIds.map(calId => {
                  const eventsFromThisCal = allFetchedEvents.filter(item => item.calendarId === calId);
                  if (eventsFromThisCal.length === 0) return null;
                  return `From calendar '${calId}': ${eventsFromThisCal
                      .map(item => `ID: ${item.id}, Summary: ${item.summary}, Start: ${item.start?.dateTime || item.start?.date}`)
                      .join("; ")}`;
              }).filter(str => str !== null);
              toolResult = `Found ${allFetchedEvents.length} event(s) across ${selectedCalendarIds.length} calendar(s):\n${eventsStringArray.join("\n")}`;
          } else {
            toolResult = "No events found matching your criteria across the selected calendars.";
          }
        }
      } else {
        const listTool = new ListEventsTool(userId, googleAccessToken);
        const paramsForTool = { ...parsedListParams, calendarId: calendarToListFrom, timeZone: parsedListParams.timeZone || userTimezone };
        if (parsedListParams.questionAboutEvents) {
           console.log(`[ChatController] Analytical question for single calendar '${calendarToListFrom}'. Using ListEventsTool.`);
           toolResult = await listTool.call(paramsForTool);
        } else {
          toolResult = await listTool.call(paramsForTool); 
        }
      }
      break;
    case "update_event":
      const updateParams = updateEventParamsSchema.parse(plan.params);
      updateParams.calendarId = explicitCalendarId || updateParams.calendarId;
      const updateTool = new UpdateEventTool(userId, googleAccessToken);
      toolResult = await updateTool.call(updateParams);
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
        const eventsFromCal = await apiListEvents(userId, googleAccessToken, calId, { ...listOptions, timeZone: userTimezone });
        if (eventsFromCal) {
          eventsFromCal.forEach(event => eventsToConsiderForDeletion.push({ ...event, calendarId: calId }));
        }
      }

      if (eventsToConsiderForDeletion.length === 0) {
        toolResult = "No events found in the specified calendar(s) and time range to consider for deletion.";
        break;
      }

      console.log(`[ChatController] Calling EventDeleterLLM with ${eventsToConsiderForDeletion.length} events.`);
      console.log("[ChatController] Events being sent to EventDeleterLLM for evaluation:", JSON.stringify(eventsToConsiderForDeletion, null, 2));

      const eventJSONsToDelete: DeletionCandidateFromLLM[] = await generateEventDeletionJSONs({
        userInput: deleteIntentParams.userInput,
        userTimezone: userTimezone,
        eventList: eventsToConsiderForDeletion,
        targetCalendarIds: targetCalendarIdsForDelete,
        currentTimeISO: currentTimeISO
      });

      const userFriendlyCandidates = eventsToConsiderForDeletion.map(e => ({
        eventId: e.id || 'unknown-id',
        calendarId: e.calendarId,
        summary: e.summary,
        startTime: e.start?.dateTime || e.start?.date || 'N/A'
      }));

      // Scenario 1: Orchestrator thought it was singular, but EventDeleterLLM (surprisingly) found multiple *specific* matches.
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

      // Scenario 2: EventDeleterLLM returned empty (was unsure), BUT there *were* events in the time range it could have picked from.
      // This is the case from the user's log.
      if ((!eventJSONsToDelete || eventJSONsToDelete.length === 0) && eventsToConsiderForDeletion.length > 0) {
        console.log(`[ChatController] Ambiguity: EventDeleterLLM unsure, but ${eventsToConsiderForDeletion.length} potential candidates existed.`);
        // For this scenario, we present ALL events that were initially considered, as the EventDeleterLLM didn't narrow them down.
        return {
          type: 'clarification_needed_for_deletion',
          originalQuery: deleteIntentParams.userInput,
          candidates: userFriendlyCandidates
        };
      }
      
      // Original logic for when EventDeleterLLM confidently returns 0 events and there truly were none to begin with, or it successfully identifies events.
      if (!eventJSONsToDelete || eventJSONsToDelete.length === 0) {
        // This block now primarily handles cases where eventsToConsiderForDeletion was also empty, 
        // or if EventDeleterLLM justifiably found nothing specific to delete from a non-empty list (e.g. user query didn't match anything)
        // but this should be less common if the above clarification catches most ambiguities.
        const userInputLower = deleteIntentParams.userInput.toLowerCase();
        const hasNumbers = /\d+/.test(userInputLower);
        const hasQuotes = /["'""]/.test(userInputLower);
        const keywordsLikeEventTest = /\b(event|test|meeting|appointment|task)\b/i.test(userInputLower);

        if ((hasNumbers && keywordsLikeEventTest) || hasQuotes) {
          toolResult = `I looked for events matching your description ("${deleteIntentParams.userInput}") in the timeframe, but I couldn't pinpoint the exact one(s) you want to delete. Could you please provide a more specific name, part of the description, or the event ID?`;
        } else {
          toolResult = "I couldn't identify any specific events to delete based on your request and the events found. Please try rephrasing or provide more details :)";
        }
        break;
      }

      const deletionResults: string[] = [];
      for (const eventToDelete of eventJSONsToDelete) {
        if (!eventToDelete.eventId || !eventToDelete.calendarId) {
            console.warn("[ChatController] EventDeleterLLM provided an item without eventId or calendarId:", eventToDelete);
            deletionResults.push(`Skipped deleting an event due to missing ID or calendar ID (Summary: ${eventToDelete.summary || 'N/A'}).`);
            continue;
        }
        try {
          if (!targetCalendarIdsForDelete.includes(eventToDelete.calendarId)) {
            console.warn(`[ChatController] EventDeleterLLM tried to delete from a non-target calendar ${eventToDelete.calendarId}. Skipping.`);
            deletionResults.push(`Skipped deleting event '${eventToDelete.summary || eventToDelete.eventId}' as it was from an unexpected calendar.`);
            continue;
          }
          const success = await apiDeleteEvent(userId, googleAccessToken, eventToDelete.calendarId, eventToDelete.eventId);
          const reasoningText = eventToDelete.reasoningForDeletion ? ` Reason: ${eventToDelete.reasoningForDeletion}` : "";
          if (success) {
            deletionResults.push(`Successfully deleted event: ${eventToDelete.summary || eventToDelete.eventId} (ID: ${eventToDelete.eventId}) from calendar ${eventToDelete.calendarId}.${reasoningText}`);
          } else {
            deletionResults.push(`Failed to delete event: ${eventToDelete.summary || eventToDelete.eventId} (ID: ${eventToDelete.eventId}) from calendar ${eventToDelete.calendarId}. It might not exist or an error occurred.${reasoningText}`);
          }
        } catch (error) {
          let errorMsg = `Error deleting event ${eventToDelete.summary || eventToDelete.eventId} (ID: ${eventToDelete.eventId}).`;
          if (error instanceof Error) {
            errorMsg += `: ${error.message}`;
          }
          console.error("[ChatController] Error calling apiDeleteEvent:", error);
          deletionResults.push(errorMsg);
        }
      }
      toolResult = deletionResults.join("\n");
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