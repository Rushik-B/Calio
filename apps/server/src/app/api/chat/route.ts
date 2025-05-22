import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/clerk-sdk-node";
import { generatePlan, CalendarAction } from "../../../lib/planner";
import { getUserCalendarList, deleteEvent as apiDeleteEvent, listEvents as apiListEvents } from "../../../lib/googleCalendar"; 
import { ZodError } from "zod";
import { executePlan } from "../../../lib/chatController"; // Import the new controller function
import prisma from "../../../lib/prisma"; // Import your Prisma client
import { v4 as uuidv4 } from 'uuid'; // For generating conversation_id
import { Prisma } from "@prisma/client"; // Import Prisma namespace
// Import for Central Orchestrator
import { getNextAction } from "../../../lib/centralOrchestratorLLM";

import { OrchestratorDecision } from "../../../types/orchestrator";
import { CreateEventExecutionResult } from "../../../lib/chatController"; // Import new types

export async function POST(req: NextRequest) {
  // 1. Get and verify Clerk session token
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "Authorization header is missing" }, { status: 401 });
  }
  const token = authHeader.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json({ error: "Malformed token in Authorization header" }, { status: 401 });
  }

  let userId: string; // This will be clerkUserId
  let internalUserId: string; // This will be the User model's id

  try {
    const claims = await clerkClient.verifyToken(token);
    if (!claims.sub) {
      throw new Error("User ID (sub) not found in token claims");
    }
    userId = claims.sub;

    // Find the internal user ID
    const internalUser = await prisma.user.findUnique({
      where: { clerkUserId: userId },
      select: { id: true }
    });

    if (!internalUser) {
      console.error(`[ChatRoute] User with clerkUserId ${userId} not found in internal DB. Ensure user is synced.`);
      return NextResponse.json({ error: "User not found in internal database. Please ensure your account is synced." }, { status: 500 });
    }
    internalUserId = internalUser.id;

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Unauthorized: Invalid token or user lookup failed. " + message }, { status: 401 });
  }

  // 2. Get Google OAuth Access Token from Clerk
  let googleAccessToken: string | undefined;
  try {
    const response = await clerkClient.users.getUserOauthAccessToken(userId, "google");
    const oauthAccessTokens = response.data; 
    
    if (oauthAccessTokens && oauthAccessTokens.length > 0 && oauthAccessTokens[0].token) {
      googleAccessToken = oauthAccessTokens[0].token;
    } else {
      console.warn(`Google OAuth token not found for user: ${userId}. Ensure the user has connected their Google account and granted calendar permissions via Clerk.`);
      return NextResponse.json(
        { error: "Google OAuth token not found. Please ensure your Google account is connected and calendar permissions are granted." },
        { status: 403 } 
      );
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error fetching Google OAuth token.";
    console.error("Error fetching Google OAuth token from Clerk:", error);
    if (error && typeof error === 'object' && 'errors' in error && Array.isArray((error as any).errors)) {
      console.error("Clerk specific errors:", JSON.stringify((error as any).errors, null, 2));
    }
    // Make sure to return conversationId in error responses if available
    // let parsedBodyForErrorConvId: any = {}; try { parsedBodyForErrorConvId = await req.json(); } catch (e) { /* ignore */ }
    return NextResponse.json({ error: `Failed to fetch Google OAuth token: ${message}` /*, conversationId: parsedBodyForErrorConvId.conversationId */ }, { status: 500 });
  }

  if (!googleAccessToken) {
    // let parsedBodyForErrorConvId: any = {}; try { parsedBodyForErrorConvId = await req.json(); } catch (e) { /* ignore */ }
    return NextResponse.json({ error: "Google OAuth token could not be retrieved."/*, conversationId: parsedBodyForErrorConvId.conversationId */ }, { status: 500 });
  }

  // 3. Get the user's text input, explicit calendarId, selectedCalendarIds, and conversationId
  let textInput: string;
  let selectedCalendarIds: string[] | undefined;
  let userTimezone: string = "UTC";
  let conversationId: string;
  let requestBody: any;

  try {
    requestBody = await req.json();
    if (!requestBody.text || typeof requestBody.text !== "string") {
      return NextResponse.json({ error: "Request body must contain a 'text' field as a string.", conversationId: requestBody.conversationId }, { status: 400 });
    }
    textInput = requestBody.text;
    if (requestBody.selectedCalendarIds && Array.isArray(requestBody.selectedCalendarIds)) {
      if (requestBody.selectedCalendarIds.every((id: any) => typeof id === 'string')) {
        selectedCalendarIds = requestBody.selectedCalendarIds;
      } else {
        console.warn("Invalid selectedCalendarIds: not all elements are strings. Ignoring.");
      }
    }
    if (requestBody.userTimezone && typeof requestBody.userTimezone === 'string') { 
      userTimezone = requestBody.userTimezone;
    } else if (!requestBody.userTimezone) { 
      console.warn("[ChatRoute] userTimezone not provided in request body. Defaulting to UTC. Frontend should send this.");
    }
    
    if (requestBody.conversationId && typeof requestBody.conversationId === 'string'){
        conversationId = requestBody.conversationId;
    } else {
        conversationId = uuidv4();
    }

    console.log(`[ChatRoute] ConvID: ${conversationId}, User: ${userId}, Input: "${textInput}", TZ: ${userTimezone}`);
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON in request body." }, { status: 400 });
  }

  // Fetch recent conversation history
  const orderedHistory = await prisma.conversationTurn.findMany({
    where: { conversationId: conversationId },
    orderBy: { turnNumber: 'asc' }, 
    take: 20 
  });

  // Determine userTurnNumber before first use
  const lastUserTurnInHistory = orderedHistory.filter(turn => turn.actor === 'USER').pop();
  const userTurnNumber = (lastUserTurnInHistory?.turnNumber || 0) + 1; 

  // Extract clarificationContext from the last assistant turn if it exists
  const lastAssistantTurnWithContext = orderedHistory
    .filter(turn => turn.actor === 'ASSISTANT' && turn.clarificationContext)
    .pop();

  // Log user's message (moved here to ensure it's logged before orchestrator sees it in history for resolution)
  try {
    await prisma.conversationTurn.create({
      data: {
        conversationId: conversationId,
        userId: internalUserId,
        turnNumber: userTurnNumber,
        actor: 'USER',
        messageText: textInput,
      }
    });
  } catch (dbError) {
    console.error("[ChatRoute] Failed to log user turn to DB:", dbError);
    // Decide if this is critical enough to halt the request
  }

  // 4. Generate a plan using the planner
  const currentTimeISO = new Date().toISOString();
  let userCalendarsFormatted: string = "No calendars found or user has not granted permission.";

  try {
    const calendars = await getUserCalendarList(userId, googleAccessToken);
    if (calendars && calendars.length > 0) {
      userCalendarsFormatted = calendars
        .map(cal => `(Name: \"${cal.summary || cal.id}\", ID: \"${cal.id}\", Primary: ${cal.primary || false}, Role: \"${cal.accessRole}\")`)
        .join(", ");
      console.log("[ChatRoute] User calendars for planner & event creator:", userCalendarsFormatted);
    } else {
      console.log("[ChatRoute] No calendars returned by getUserCalendarList or list is empty.");
    }
  } catch (error) {
    console.warn("[ChatRoute] Could not fetch user calendar list:", error);
  }

  // Determine the turn number for the assistant's response, relative to the user's current message.
  const assistantTurnNumber = userTurnNumber + 1;

  // **** Call Central Orchestrator ****
  let orchestratorDecision: OrchestratorDecision;
  try {
    orchestratorDecision = await getNextAction(
      orderedHistory, 
      textInput, 
      userTimezone, 
      userCalendarsFormatted
    );
    console.log("[ChatRoute] Orchestrator decision:", orchestratorDecision);
  } catch (orchestratorError) {
    console.error("[ChatRoute] Central Orchestrator failed:", orchestratorError);
    const errMessage = orchestratorError instanceof Error ? orchestratorError.message : "Unknown orchestrator error";
    await prisma.conversationTurn.create({
      data: {
        conversationId: conversationId, userId: internalUserId, turnNumber: assistantTurnNumber, 
        actor: 'ASSISTANT', messageText: `Sorry, I encountered an internal error trying to understand that. (${errMessage})`,
        toolCalled: 'orchestrator_fallback', requiresFollowUp: false,
      }
    });
    return NextResponse.json({ error: `Orchestrator failed: ${errMessage}`, conversationId: conversationId }, { status: 500 });
  }

  let finalAssistantResponseMessage: string;
  let assistantMessageForDb: string;
  let assistantToolCalled: string | undefined = orchestratorDecision.actionType;
  let assistantToolParams: Prisma.InputJsonValue | undefined = orchestratorDecision.params as Prisma.InputJsonValue;
  let assistantToolResult: Prisma.InputJsonValue | undefined;
  let assistantRequiresFollowUp: boolean = false;
  let assistantClarificationContext: Prisma.InputJsonValue | undefined;
  let assistantLlmPrompt: string | undefined = orchestratorDecision.reasoning;

  if (orchestratorDecision.actionType === 'respond_directly' || orchestratorDecision.actionType === 'ask_user_question') {
    finalAssistantResponseMessage = orchestratorDecision.responseText || "I'm not sure how to respond to that.";
    assistantMessageForDb = finalAssistantResponseMessage;
    assistantToolResult = { directResponse: finalAssistantResponseMessage, reasoning: orchestratorDecision.reasoning };
    if (orchestratorDecision.actionType === 'ask_user_question') {
        assistantRequiresFollowUp = true;
        assistantClarificationContext = orchestratorDecision.clarificationContextToSave as Prisma.InputJsonValue | undefined;
    }
    
    await prisma.conversationTurn.create({
      data: {
        conversationId: conversationId, userId: internalUserId, turnNumber: assistantTurnNumber, 
        actor: 'ASSISTANT', messageText: assistantMessageForDb, toolCalled: assistantToolCalled,
        toolParams: assistantToolParams, toolResult: assistantToolResult, requiresFollowUp: assistantRequiresFollowUp,
        clarificationContext: assistantClarificationContext, llmPrompt: assistantLlmPrompt, 
      }
    });
    return NextResponse.json({ message: finalAssistantResponseMessage, conversationId: conversationId });

  } else if (orchestratorDecision.actionType === 'call_planner') {
    let plan: CalendarAction | null;
    try {
      const plannerInput = orchestratorDecision.params?.userInput || textInput;
      console.log(`[ChatRoute] Orchestrator directs to 'call_planner'. Input for planner: "${plannerInput}"`);
      plan = await generatePlan(
        plannerInput, 
        currentTimeISO, 
        userTimezone, 
        userCalendarsFormatted,
        orchestratorDecision.params
      );
      assistantToolCalled = `planner->${plan?.action || 'unknown_plan_action'}`;
      assistantToolParams = plan?.params as Prisma.InputJsonValue | undefined;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown planner error";
        console.error("[ChatRoute] Error in planner:", error);
        finalAssistantResponseMessage = `Planner failed: ${message}`;
        assistantMessageForDb = finalAssistantResponseMessage;
        assistantToolResult = { error: finalAssistantResponseMessage, details: (error instanceof ZodError) ? error.format() : undefined } as Prisma.InputJsonValue;
        await prisma.conversationTurn.create({
            data: {
                conversationId: conversationId, userId: internalUserId, turnNumber: assistantTurnNumber,
                actor: 'ASSISTANT', messageText: assistantMessageForDb, toolCalled: 'planner_error',
                toolParams: orchestratorDecision.params as Prisma.InputJsonValue | undefined, 
                toolResult: assistantToolResult, requiresFollowUp: false,
            }
        });
        return NextResponse.json({ error: finalAssistantResponseMessage, details: (error instanceof ZodError) ? error.format() : undefined, conversationId: conversationId }, { status: 500 });
    }

    if (!plan) {
        finalAssistantResponseMessage = "Could not generate a plan from the input after planner call.";
        assistantMessageForDb = finalAssistantResponseMessage;
        assistantToolResult = { error: finalAssistantResponseMessage };
        await prisma.conversationTurn.create({
            data: {
                conversationId: conversationId, userId: internalUserId, turnNumber: assistantTurnNumber,
                actor: 'ASSISTANT', messageText: assistantMessageForDb, toolCalled: 'planner_no_plan',
                toolParams: orchestratorDecision.params as Prisma.InputJsonValue | undefined, 
                toolResult: assistantToolResult, requiresFollowUp: false,
            }
        });
        return NextResponse.json({ error: finalAssistantResponseMessage, conversationId: conversationId }, { status: 400 });
    }

    try {
      console.log(`[ChatRoute] Planner generated plan: ${plan.action}, params:`, plan.params);
      const executePlanResult = await executePlan({
        plan,
        internalDbUserId: internalUserId,
        clerkUserId: userId,
        googleAccessToken,
        explicitCalendarId: requestBody.explicitCalendarId,
        selectedCalendarIds: requestBody.selectedCalendarIds,
        userTimezone: requestBody.userTimezone,
        textInput: textInput,
        userCalendarsFormatted: userCalendarsFormatted,
        currentTimeISO: new Date().toISOString(),
      });

      let finalResponseToUser: string;
      let structuredToolResultForLog: any = null; // For storing structured data from create_event

      if (typeof executePlanResult === 'string') {
        finalResponseToUser = executePlanResult;
        assistantToolResult = executePlanResult; // Log string result
      } else if ('type' in executePlanResult && executePlanResult.type === 'clarification_needed_for_deletion') {
        // This is a ClarificationNeededForDeletion object
        // The orchestrator needs to be invoked again, but in a special "clarification" mode.
        assistantRequiresFollowUp = true;
        assistantClarificationContext = executePlanResult as any as Prisma.JsonObject; // Save the candidates
        
        const clarificationInput = `SYSTEM_CLARIFICATION_REQUEST: Type: delete_candidates_for_confirmation. Details: ${JSON.stringify(executePlanResult)}`;
        const clarificationDecision = await getNextAction(
          orderedHistory, 
          clarificationInput, 
          requestBody.userTimezone,
          userCalendarsFormatted, 
          true 
        );

        finalResponseToUser = clarificationDecision.responseText || "I need a bit more clarity. Could you help me understand?";
        assistantMessageForDb = finalResponseToUser;
        if (clarificationDecision.clarificationContextToSave) {
          assistantClarificationContext = clarificationDecision.clarificationContextToSave as any as Prisma.JsonObject;
        } // Orchestrator should manage this context for the next turn
        assistantLlmPrompt = `System prompt for clarification + ${JSON.stringify(executePlanResult)}`; 
        assistantToolResult = clarificationDecision as any as Prisma.InputJsonValue; 

      } else if ('type' in executePlanResult && executePlanResult.type === 'clarification_needed_for_time_range') {
        // This is ClarificationNeededForTimeRange object
        assistantRequiresFollowUp = true;
        assistantClarificationContext = executePlanResult as any as Prisma.JsonObject; // Save original query and attempted time range

        const clarificationInput = `SYSTEM_CLARIFICATION_REQUEST: Type: delete_clarify_time_range. Details: ${JSON.stringify(executePlanResult)}. Task: Ask user to confirm or provide a new time range for their deletion request.`;
        const clarificationDecision = await getNextAction(
          orderedHistory,
          clarificationInput,
          requestBody.userTimezone,
          userCalendarsFormatted,
          true // Indicate this is a clarification request generation
        );

        finalResponseToUser = clarificationDecision.responseText || "I couldn't find any events in that time frame. Would you like to try a different date or time range?";
        assistantMessageForDb = finalResponseToUser;
        if (clarificationDecision.clarificationContextToSave) {
          assistantClarificationContext = clarificationDecision.clarificationContextToSave as any as Prisma.JsonObject;
        } // Orchestrator should manage this context for the next turn
        assistantLlmPrompt = `System prompt for time range clarification + ${JSON.stringify(executePlanResult)}`;
        assistantToolResult = clarificationDecision as any as Prisma.InputJsonValue;

      } else {
        // This is CreateEventExecutionResult
        const createResult = executePlanResult as CreateEventExecutionResult; 
        finalResponseToUser = createResult.userMessage;
        // For create_event, log the array of created event details as the toolResult
        structuredToolResultForLog = createResult.createdEventsDetails;
        assistantToolResult = structuredToolResultForLog as Prisma.InputJsonValue; 
      }
      
      assistantMessageForDb = finalResponseToUser;

      await prisma.conversationTurn.create({
        data: {
          conversationId: conversationId, userId: internalUserId, turnNumber: assistantTurnNumber,
          actor: 'ASSISTANT', messageText: assistantMessageForDb, toolCalled: assistantToolCalled,
          toolParams: assistantToolParams, toolResult: assistantToolResult, requiresFollowUp: assistantRequiresFollowUp,
          clarificationContext: assistantClarificationContext, llmPrompt: assistantLlmPrompt
        }
      });
      return NextResponse.json({ message: finalResponseToUser, conversationId: conversationId });

    } catch (error: unknown) {
        let errorForDbLogging: string | Prisma.InputJsonValue = "Unknown tool execution error";
        assistantMessageForDb = "Error performing planned action."; 

        if (error instanceof ZodError) {
            console.error("[ChatRoute] Parameter validation error for tool (from controller):", error.format());
            errorForDbLogging = { error: "Parameter validation failed for the calendar action.", details: error.format() } as Prisma.InputJsonValue;
            assistantMessageForDb = `Error: Parameter validation failed. Details: ${JSON.stringify(error.format())}`;
        } else {
            const message = error instanceof Error ? error.message : "Unknown tool execution error";
            errorForDbLogging = message; 
            assistantMessageForDb = `Error: Error performing planned action: ${message}`;
            console.error(`[ChatRoute] Error executing plan via controller for action '${plan.action}':`, error);
        }
        assistantToolResult = { error: errorForDbLogging } as Prisma.InputJsonValue;
        finalAssistantResponseMessage = assistantMessageForDb; 

        await prisma.conversationTurn.create({
            data: {
                conversationId: conversationId, userId: internalUserId, turnNumber: assistantTurnNumber,
                actor: 'ASSISTANT', messageText: assistantMessageForDb,
                toolCalled: assistantToolCalled ? `${assistantToolCalled}_error` : 'execute_plan_error',
                toolParams: assistantToolParams, 
                toolResult: assistantToolResult, requiresFollowUp: false,
            }
        });
        const responseErrorBody: {error: string, details?: any, conversationId: string} = { error: finalAssistantResponseMessage, conversationId: conversationId };
        if (error instanceof ZodError) responseErrorBody.details = error.format();
        return NextResponse.json(responseErrorBody, { status: (error instanceof ZodError) ? 400 : 500 });
    }
  } else if (orchestratorDecision.actionType === 'fetch_context_and_call_planner') {
    console.log("[ChatRoute] Orchestrator directs to 'fetch_context_and_call_planner'. Params:", orchestratorDecision.params);
    
    // Step 1: Fetch context events from calendar
    let fetchedAnchorEvents: Array<{summary: string, start: string, end: string, calendarId: string}> = [];
    
    try {
      const { contextQuery, contextTimeMin, contextTimeMax, contextCalendarIds } = orchestratorDecision.params || {};
      
      if (!contextQuery) {
        throw new Error("contextQuery is required for fetch_context_and_call_planner");
      }
      
      console.log(`[ChatRoute] Fetching context events with query: "${contextQuery}", timeMin: ${contextTimeMin}, timeMax: ${contextTimeMax}`);
      
      // Determine which calendars to search
      const calendarsToSearch = contextCalendarIds && contextCalendarIds.length > 0 
        ? contextCalendarIds 
        : selectedCalendarIds && selectedCalendarIds.length > 0
        ? selectedCalendarIds
        : ['primary']; // Default to primary calendar
      
      // Search for events in the specified calendars
      for (const calId of calendarsToSearch) {
        try {
          const listOptions: any = {
            q: contextQuery, // Search by query
            timeMin: contextTimeMin,
            timeMax: contextTimeMax,
            singleEvents: true,
            orderBy: "startTime",
            timeZone: userTimezone
          };
          
          console.log(`[ChatRoute] Searching calendar '${calId}' for context events with options:`, listOptions);
          const eventsFromCal = await apiListEvents(userId, googleAccessToken, calId, listOptions);
          
          if (eventsFromCal && eventsFromCal.length > 0) {
            eventsFromCal.forEach((event: any) => {
              if (event.id && event.summary) {
                fetchedAnchorEvents.push({
                  summary: event.summary,
                  start: event.start?.dateTime || event.start?.date || '',
                  end: event.end?.dateTime || event.end?.date || '',
                  calendarId: calId
                });
              }
            });
          }
        } catch (calendarError) {
          console.warn(`[ChatRoute] Failed to search calendar '${calId}':`, calendarError);
          // Continue with next calendar
        }
      }
      
      // If no events found with the specific query, try a broader search for implicit temporal references
      if (fetchedAnchorEvents.length === 0 && contextQuery) {
        console.log(`[ChatRoute] No events found with query '${contextQuery}', trying broader search...`);
        
        // Try searching without the query to get all events in the time range
        for (const calId of calendarsToSearch) {
          try {
            const broadListOptions: any = {
              timeMin: contextTimeMin,
              timeMax: contextTimeMax,
              singleEvents: true,
              orderBy: "startTime",
              timeZone: userTimezone
            };
            
            console.log(`[ChatRoute] Broad search in calendar '${calId}' with options:`, broadListOptions);
            const allEventsFromCal = await apiListEvents(userId, googleAccessToken, calId, broadListOptions);
            
            if (allEventsFromCal && allEventsFromCal.length > 0) {
              allEventsFromCal.forEach((event: any) => {
                if (event.id && event.summary) {
                  fetchedAnchorEvents.push({
                    summary: event.summary,
                    start: event.start?.dateTime || event.start?.date || '',
                    end: event.end?.dateTime || event.end?.date || '',
                    calendarId: calId
                  });
                }
              });
            }
          } catch (broadSearchError) {
            console.warn(`[ChatRoute] Failed to do broad search on calendar '${calId}':`, broadSearchError);
            // Continue with next calendar
          }
        }
      }
      
      console.log(`[ChatRoute] Found ${fetchedAnchorEvents.length} context events:`, fetchedAnchorEvents);
      
    } catch (contextError) {
      console.error("[ChatRoute] Error fetching context events:", contextError);
      finalAssistantResponseMessage = `I had trouble finding the referenced event in your calendar. Could you please be more specific about which event you're referring to?`;
      assistantMessageForDb = finalAssistantResponseMessage;
      assistantToolResult = { error: "Context fetch failed", details: contextError instanceof Error ? contextError.message : String(contextError) } as Prisma.InputJsonValue;
      await prisma.conversationTurn.create({
        data: {
          conversationId: conversationId, userId: internalUserId, turnNumber: assistantTurnNumber,
          actor: 'ASSISTANT', messageText: assistantMessageForDb, toolCalled: 'fetch_context_error',
          toolParams: orchestratorDecision.params as Prisma.InputJsonValue | undefined,
          toolResult: assistantToolResult, requiresFollowUp: false,
        }
      });
      return NextResponse.json({ message: finalAssistantResponseMessage, conversationId: conversationId });
    }
    
    // Step 2: Call planner with the fetched context
    let plan: CalendarAction | null;
    try {
      const plannerInput = orchestratorDecision.params?.userInput || textInput;
      console.log(`[ChatRoute] Calling planner with context. Input: "${plannerInput}", Anchor events: ${fetchedAnchorEvents.length}`);
      
      // Merge any existing anchor context with the newly fetched context
      const combinedAnchorContext = [
        ...(orchestratorDecision.params?.anchorEventsContext || []),
        ...fetchedAnchorEvents
      ];
      
      plan = await generatePlan(
        plannerInput, 
        currentTimeISO, 
        userTimezone, 
        userCalendarsFormatted,
        {
          ...orchestratorDecision.params,
          anchorEventsContext: combinedAnchorContext.length > 0 ? combinedAnchorContext : undefined
        }
      );
      assistantToolCalled = `fetch_context_then_planner->${plan?.action || 'unknown_plan_action'}`;
      assistantToolParams = {
        ...orchestratorDecision.params,
        fetchedAnchorEvents: fetchedAnchorEvents,
        planParams: plan?.params
      } as Prisma.InputJsonValue;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown planner error";
      console.error("[ChatRoute] Error in planner after context fetch:", error);
      finalAssistantResponseMessage = `Planner failed after fetching context: ${message}`;
      assistantMessageForDb = finalAssistantResponseMessage;
      assistantToolResult = { error: finalAssistantResponseMessage, fetchedAnchorEvents: fetchedAnchorEvents, details: (error instanceof ZodError) ? error.format() : undefined } as Prisma.InputJsonValue;
      await prisma.conversationTurn.create({
        data: {
          conversationId: conversationId, userId: internalUserId, turnNumber: assistantTurnNumber,
          actor: 'ASSISTANT', messageText: assistantMessageForDb, toolCalled: 'planner_error_after_context',
          toolParams: assistantToolParams, 
          toolResult: assistantToolResult, requiresFollowUp: false,
        }
      });
      return NextResponse.json({ error: finalAssistantResponseMessage, details: (error instanceof ZodError) ? error.format() : undefined, conversationId: conversationId }, { status: 500 });
    }

    if (!plan) {
      finalAssistantResponseMessage = "Could not generate a plan from the input after fetching context.";
      assistantMessageForDb = finalAssistantResponseMessage;
      assistantToolResult = { error: finalAssistantResponseMessage, fetchedAnchorEvents: fetchedAnchorEvents };
      await prisma.conversationTurn.create({
        data: {
          conversationId: conversationId, userId: internalUserId, turnNumber: assistantTurnNumber,
          actor: 'ASSISTANT', messageText: assistantMessageForDb, toolCalled: 'planner_no_plan_after_context',
          toolParams: assistantToolParams, 
          toolResult: assistantToolResult, requiresFollowUp: false,
        }
      });
      return NextResponse.json({ error: finalAssistantResponseMessage, conversationId: conversationId }, { status: 400 });
    }

    // Continue with the same plan execution logic as 'call_planner'...

    try {
      console.log(`[ChatRoute] Executing plan with fetched context: ${plan.action}, params:`, plan.params);
      const executePlanResult = await executePlan({
        plan,
        internalDbUserId: internalUserId,
        clerkUserId: userId,
        googleAccessToken,
        explicitCalendarId: requestBody.explicitCalendarId,
        selectedCalendarIds: requestBody.selectedCalendarIds,
        userTimezone: requestBody.userTimezone,
        textInput: textInput,
        userCalendarsFormatted: userCalendarsFormatted,
        currentTimeISO: new Date().toISOString(),
      });

      let finalResponseToUser: string;
      let structuredToolResultForLog: any = null; // For storing structured data from create_event

      if (typeof executePlanResult === 'string') {
        finalResponseToUser = executePlanResult;
        assistantToolResult = {
          planResult: executePlanResult,
          fetchedAnchorEvents: fetchedAnchorEvents
        } as Prisma.InputJsonValue;
      } else if ('type' in executePlanResult && executePlanResult.type === 'clarification_needed_for_deletion') {
        // This is a ClarificationNeededForDeletion object
        assistantRequiresFollowUp = true;
        assistantClarificationContext = executePlanResult as any as Prisma.JsonObject;
        
        const clarificationInput = `SYSTEM_CLARIFICATION_REQUEST: Type: delete_candidates_for_confirmation. Details: ${JSON.stringify(executePlanResult)}`;
        const clarificationDecision = await getNextAction(
          orderedHistory, 
          clarificationInput, 
          requestBody.userTimezone,
          userCalendarsFormatted, 
          true 
        );

        finalResponseToUser = clarificationDecision.responseText || "I need a bit more clarity. Could you help me understand?";
        assistantMessageForDb = finalResponseToUser;
        if (clarificationDecision.clarificationContextToSave) {
          assistantClarificationContext = clarificationDecision.clarificationContextToSave as any as Prisma.JsonObject;
        }
        assistantLlmPrompt = `System prompt for clarification + ${JSON.stringify(executePlanResult)}`; 
        assistantToolResult = {
          clarificationDecision: clarificationDecision,
          fetchedAnchorEvents: fetchedAnchorEvents
        } as unknown as Prisma.InputJsonValue;

      } else if ('type' in executePlanResult && executePlanResult.type === 'clarification_needed_for_time_range') {
        // This is ClarificationNeededForTimeRange object
        assistantRequiresFollowUp = true;
        assistantClarificationContext = executePlanResult as any as Prisma.JsonObject;

        const clarificationInput = `SYSTEM_CLARIFICATION_REQUEST: Type: delete_clarify_time_range. Details: ${JSON.stringify(executePlanResult)}. Task: Ask user to confirm or provide a new time range for their deletion request.`;
        const clarificationDecision = await getNextAction(
          orderedHistory,
          clarificationInput,
          requestBody.userTimezone,
          userCalendarsFormatted,
          true
        );

        finalResponseToUser = clarificationDecision.responseText || "I couldn't find any events in that time frame. Would you like to try a different date or time range?";
        assistantMessageForDb = finalResponseToUser;
        if (clarificationDecision.clarificationContextToSave) {
          assistantClarificationContext = clarificationDecision.clarificationContextToSave as any as Prisma.JsonObject;
        }
        assistantLlmPrompt = `System prompt for time range clarification + ${JSON.stringify(executePlanResult)}`;
        assistantToolResult = {
          clarificationDecision: clarificationDecision,
          fetchedAnchorEvents: fetchedAnchorEvents
        } as unknown as Prisma.InputJsonValue;

      } else {
        // This is CreateEventExecutionResult
        const createResult = executePlanResult as CreateEventExecutionResult; 
        finalResponseToUser = createResult.userMessage;
        // For create_event, log the array of created event details as the toolResult
        structuredToolResultForLog = createResult.createdEventsDetails;
        assistantToolResult = {
          createdEventsDetails: structuredToolResultForLog,
          fetchedAnchorEvents: fetchedAnchorEvents
        } as Prisma.InputJsonValue; 
      }
      
      assistantMessageForDb = finalResponseToUser;

      await prisma.conversationTurn.create({
        data: {
          conversationId: conversationId, userId: internalUserId, turnNumber: assistantTurnNumber,
          actor: 'ASSISTANT', messageText: assistantMessageForDb, toolCalled: assistantToolCalled,
          toolParams: assistantToolParams, toolResult: assistantToolResult, requiresFollowUp: assistantRequiresFollowUp,
          clarificationContext: assistantClarificationContext, llmPrompt: assistantLlmPrompt
        }
      });
      return NextResponse.json({ message: finalResponseToUser, conversationId: conversationId });

    } catch (error: unknown) {
        let errorForDbLogging: string | Prisma.InputJsonValue = "Unknown tool execution error";
        assistantMessageForDb = "Error performing planned action after fetching context."; 

        if (error instanceof ZodError) {
            console.error("[ChatRoute] Parameter validation error for tool (from controller) after context fetch:", error.format());
            errorForDbLogging = { error: "Parameter validation failed for the calendar action.", details: error.format() } as Prisma.InputJsonValue;
            assistantMessageForDb = `Error: Parameter validation failed. Details: ${JSON.stringify(error.format())}`;
        } else {
            const message = error instanceof Error ? error.message : "Unknown tool execution error";
            errorForDbLogging = message; 
            assistantMessageForDb = `Error: Error performing planned action after fetching context: ${message}`;
            console.error(`[ChatRoute] Error executing plan via controller for action '${plan.action}' after context fetch:`, error);
        }
        assistantToolResult = { 
          error: errorForDbLogging,
          fetchedAnchorEvents: fetchedAnchorEvents
        } as Prisma.InputJsonValue;
        finalAssistantResponseMessage = assistantMessageForDb; 

        await prisma.conversationTurn.create({
            data: {
                conversationId: conversationId, userId: internalUserId, turnNumber: assistantTurnNumber,
                actor: 'ASSISTANT', messageText: assistantMessageForDb,
                toolCalled: assistantToolCalled ? `${assistantToolCalled}_error` : 'execute_plan_error_after_context',
                toolParams: assistantToolParams, 
                toolResult: assistantToolResult, requiresFollowUp: false,
            }
        });
        const responseErrorBody: {error: string, details?: any, conversationId: string} = { error: finalAssistantResponseMessage, conversationId: conversationId };
        if (error instanceof ZodError) responseErrorBody.details = error.format();
        return NextResponse.json(responseErrorBody, { status: (error instanceof ZodError) ? 400 : 500 });
    }
  } else if (orchestratorDecision.actionType === 'perform_google_calendar_action') {
    console.log("[ChatRoute] Orchestrator directs to 'perform_google_calendar_action'. Params:", orchestratorDecision.params);
    let actionSuccess = true;
    let actionMessages: string[] = [];

    if (orchestratorDecision.params?.GCToolName === 'delete_event_direct') {
      const eventsToDelete = orchestratorDecision.params.GCToolArgs as Array<{eventId: string, calendarId: string, summary?: string}>;
      if (eventsToDelete && eventsToDelete.length > 0) {
        for (const event of eventsToDelete) {
          try {
            const deleted = await apiDeleteEvent(userId, googleAccessToken, event.calendarId, event.eventId);
            if (deleted) {
              actionMessages.push(`Successfully deleted event: ${event.summary || event.eventId}`);
            } else {
              actionMessages.push(`Failed to delete event: ${event.summary || event.eventId}. It might not exist or an error occurred.`);
              actionSuccess = false;
            }
          } catch (gcError: any) {
            actionMessages.push(`Error deleting event ${event.summary || event.eventId}: ${gcError.message}`);
            actionSuccess = false;
          }
        }
      } else {
        actionMessages.push("No specific events were identified for deletion based on your choice.");
      }
    } else {
      actionMessages.push(`Unknown GCToolName: ${orchestratorDecision.params?.GCToolName}`);
      actionSuccess = false;
    }

    finalAssistantResponseMessage = orchestratorDecision.responseText || actionMessages.join('\n') || "Action processed.";
    assistantMessageForDb = finalAssistantResponseMessage;
    assistantToolCalled = `direct_gc_action->${orchestratorDecision.params?.GCToolName}`;
    assistantToolParams = orchestratorDecision.params?.GCToolArgs as Prisma.InputJsonValue;
    assistantToolResult = { summary: actionMessages.join('\n'), success: actionSuccess } as Prisma.InputJsonValue;
    assistantRequiresFollowUp = false;
    assistantClarificationContext = undefined; // Use undefined instead of null
    assistantLlmPrompt = orchestratorDecision.reasoning;

    await prisma.conversationTurn.create({
      data: {
        conversationId: conversationId, userId: internalUserId, turnNumber: assistantTurnNumber,
        actor: 'ASSISTANT', messageText: assistantMessageForDb, toolCalled: assistantToolCalled,
        toolParams: assistantToolParams, toolResult: assistantToolResult, requiresFollowUp: assistantRequiresFollowUp,
        clarificationContext: assistantClarificationContext, llmPrompt: assistantLlmPrompt
      }
    });
    return NextResponse.json({ message: finalAssistantResponseMessage, conversationId: conversationId });

  } else {
    console.error("[ChatRoute] Unknown orchestrator action type:", orchestratorDecision.actionType);
    finalAssistantResponseMessage = "Sorry, I encountered an unexpected internal state.";
    await prisma.conversationTurn.create({
      data: {
        conversationId: conversationId, userId: internalUserId, turnNumber: assistantTurnNumber,
        actor: 'ASSISTANT', messageText: finalAssistantResponseMessage,
        toolCalled: 'unknown_orchestrator_action', requiresFollowUp: false,
      }
    });
    return NextResponse.json({ error: finalAssistantResponseMessage, conversationId: conversationId }, { status: 500 });
  }
}
