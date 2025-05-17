import { ZodError } from "zod";
import type { calendar_v3 } from "googleapis";
import { CalendarAction, CreateEventIntentParams } from "@/lib/planner";
import {
  CreateEventTool,
  ListEventsTool,
  UpdateEventTool,
  DeleteEventTool,
  listEventsParamsSchema,
  updateEventParamsSchema,
  deleteEventParamsSchema,
} from "@/lib/calendarTools";
import { listEvents as apiListEvents } from "@/lib/googleCalendar";
import { handleGeneralChat } from "@/lib/generalChatHandler";
import { handleEventAnalysis } from "@/lib/eventAnalyzer";
import { generateEventCreationJSONs, eventCreationRequestListSchema } from "@/lib/eventCreatorLLM";

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

export async function executePlan(params: ChatControllerParams): Promise<string> {
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

  let toolResult: string;

  if (plan.action !== 'create_event' && plan.params) {
    (plan.params as any).calendarId = explicitCalendarId || (plan.params as any).calendarId;
  } else if (plan.action !== 'create_event' && explicitCalendarId) {
    plan.params = { ...plan.params, calendarId: explicitCalendarId };
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
            console.error("[ChatController] ZodError creating event with data:", JSON.stringify(eventData, null, 2), error.format());
            errorMsg = `Error validating parameters for one of the events: ${error.flatten().fieldErrors.summary?.[0] || 'details in log'}`;
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
      if (parsedListParams.calendarId && parsedListParams.calendarId !== 'primary' || explicitCalendarId) {
        const listTool = new ListEventsTool(userId, googleAccessToken);
        toolResult = await listTool.call(parsedListParams);
      } 
      else if (selectedCalendarIds && selectedCalendarIds.length > 0) {
        const allFetchedEvents: { event: calendar_v3.Schema$Event, calendarId: string }[] = [];
        const optionsBase: Omit<calendar_v3.Params$Resource$Events$List, 'calendarId' | 'timeZone'> = {
          q: parsedListParams.query,
          timeMin: parsedListParams.timeMin,
          timeMax: parsedListParams.timeMax,
          singleEvents: true,
          orderBy: "startTime",
        };
        for (const calId of selectedCalendarIds) {
          console.log(`[ChatController] Fetching events for calId: ${calId}, timeMin: ${optionsBase.timeMin}, timeMax: ${optionsBase.timeMax}, userTimezone: ${userTimezone}`);
          const events = await apiListEvents(userId, googleAccessToken, calId, { ...optionsBase, timeZone: userTimezone });
          if (events) {
            console.log(`[ChatController] Fetched ${events.length} events from calId: ${calId}`);
            if (events.length > 0) {
              console.log(`[ChatController] First event summary from ${calId}: ${events[0].summary} at ${events[0].start?.dateTime || events[0].start?.date}`);
              events.forEach(event => allFetchedEvents.push({ event, calendarId: calId }));
            }
          } else {
            console.log(`[ChatController] apiListEvents returned null for calId: ${calId}`);
          }
        }
        console.log(`[ChatController] Total events fetched into allFetchedEvents: ${allFetchedEvents.length}`);
        if (parsedListParams.questionAboutEvents) {
          if (allFetchedEvents.length > 0) {
            const eventContextForLLM = allFetchedEvents.map(item => 
              `Calendar: ${item.calendarId}\nEvent: ${item.event.summary || 'N/A'}\nStart: ${item.event.start?.dateTime || item.event.start?.date || 'N/A'}\nEnd: ${item.event.end?.dateTime || item.event.end?.date || 'N/A'}`
            ).join("\n---\n");
            console.log(`[ChatController] Sending to EventAnalyzer. Question: "${parsedListParams.questionAboutEvents}"`);
            toolResult = await handleEventAnalysis(parsedListParams.questionAboutEvents, eventContextForLLM);
          } else {
            toolResult = `No events found for the period to answer your question: "${parsedListParams.questionAboutEvents}"`;
          }
        } else {
          if (allFetchedEvents.length > 0) {
              const eventsStringArray = selectedCalendarIds.map(calId => {
                  const eventsFromThisCal = allFetchedEvents.filter(item => item.calendarId === calId);
                  if (eventsFromThisCal.length === 0) return null;
                  return `From calendar '${calId}': ${eventsFromThisCal
                      .map(item => `ID: ${item.event.id}, Summary: ${item.event.summary}, Start: ${item.event.start?.dateTime || item.event.start?.date}`)
                      .join("; ")}`;
              }).filter(str => str !== null);
              toolResult = `Found ${allFetchedEvents.length} event(s) across ${selectedCalendarIds.length} calendar(s):\n${eventsStringArray.join("\n")}`;
          } else {
            toolResult = "No events found matching your criteria across the selected calendars.";
          }
        }
      } 
      else {
        const listTool = new ListEventsTool(userId, googleAccessToken);
        const paramsForTool = { ...parsedListParams, timeZone: parsedListParams.timeZone || userTimezone };
        if (parsedListParams.questionAboutEvents) {
           console.warn("[ChatController] Analytical question received for default/primary calendar, but direct analysis not yet implemented for this specific path. Falling back to simple list.");
           toolResult = await listTool.call(paramsForTool);
           toolResult += `\n\n(Note: Analysis for the question "${parsedListParams.questionAboutEvents}" on the primary calendar is not yet fully implemented if no specific calendars were selected for analysis.)`;
        } else {
          toolResult = await listTool.call(paramsForTool); 
        }
      }
      break;
    case "update_event":
      const updateParams = updateEventParamsSchema.parse(plan.params);
      const updateTool = new UpdateEventTool(userId, googleAccessToken);
      toolResult = await updateTool.call(updateParams);
      break;
    case "delete_event":
      const deleteParams = deleteEventParamsSchema.parse(plan.params);
      const deleteTool = new DeleteEventTool(userId, googleAccessToken);
      toolResult = await deleteTool.call(deleteParams);
      break;
    case "general_chat":
      toolResult = await handleGeneralChat(textInput);
      break;
    default:
      console.warn(`[ChatController] Unhandled plan action: ${plan.action}`);
      throw new Error(`Unknown action: ${plan.action}`);
  }
  return toolResult;
} 