import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/clerk-sdk-node";
import { generatePlan, CalendarAction } from "../../../lib/planner";
import { getUserCalendarList } from "../../../lib/googleCalendar"; 
import { ZodError } from "zod";
import { executePlan } from "../../../lib/chatController"; // Import the new controller function
import prisma from "../../../lib/prisma"; // Import your Prisma client
import { v4 as uuidv4 } from 'uuid'; // For generating conversation_id
import { Prisma } from "@prisma/client"; // Import Prisma namespace
// Import for Central Orchestrator
import { getNextAction } from "../../../lib/centralOrchestratorLLM";
import { OrchestratorDecision } from "../../../types/orchestrator";

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
  let explicitCalendarId: string | undefined;
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
    if (requestBody.calendarId && typeof requestBody.calendarId === 'string') {
      explicitCalendarId = requestBody.calendarId;
    }
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

  // Fetch recent conversation history (not used directly in this step, but for future orchestrator)
  const orderedHistory = await prisma.conversationTurn.findMany({
    where: { conversationId: conversationId },
    orderBy: { turnNumber: 'asc' }, // Chronological for orchestrator
    take: 20 // Take more for better context, LLM can truncate if needed
  });

  const lastUserTurnInHistory = orderedHistory.filter(turn => turn.actor === 'USER').pop();
  const userTurnNumber = (lastUserTurnInHistory?.turnNumber || 0) + 1; 

  // Log user's message
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
  let plan: CalendarAction | null;
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
      plan = await generatePlan(plannerInput, currentTimeISO, userTimezone, userCalendarsFormatted);
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
      const executionResult = await executePlan({
        plan, userId, googleAccessToken, explicitCalendarId, selectedCalendarIds, userTimezone,
        textInput: orchestratorDecision.params?.userInput || textInput, 
        userCalendarsFormatted, currentTimeISO
      });

      finalAssistantResponseMessage = executionResult;
      assistantMessageForDb = executionResult;
      assistantToolResult = { text: executionResult } as Prisma.InputJsonValue;
      
      await prisma.conversationTurn.create({
        data: {
          conversationId: conversationId, userId: internalUserId, turnNumber: assistantTurnNumber,
          actor: 'ASSISTANT', messageText: assistantMessageForDb, toolCalled: assistantToolCalled, 
          toolParams: assistantToolParams, toolResult: assistantToolResult, 
          requiresFollowUp: assistantRequiresFollowUp, clarificationContext: assistantClarificationContext,
        }
      });
      return NextResponse.json({ message: executionResult, conversationId: conversationId });

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
