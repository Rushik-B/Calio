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
  internalDbUserId: string;
  clerkUserId: string;
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

export interface CreateEventExecutionResult {
  userMessage: string;
  createdEventsDetails: CreatedEventDetails[]; 
}

export type ExecutePlanResult = string | ClarificationNeededForDeletion | CreateEventExecutionResult | ClarificationNeededForTimeRange;

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
      const eventJSONsToCreate = await generateEventCreationJSONs({
        userInput: createIntentParams.userInput,
        userTimezone: userTimezone,
        userCalendarsFormatted: userCalendarsFormatted,
        currentTimeISO: currentTimeISO,
        anchorEventsContext: createIntentParams.anchorEventsContext
      });

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
      const updateParams = updateEventParamsSchema.parse(plan.params);
      updateParams.calendarId = explicitCalendarId || updateParams.calendarId;
      const updateTool = new UpdateEventTool(clerkUserId, googleAccessToken);
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
        currentTimeISO: currentTimeISO
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