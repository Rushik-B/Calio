import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { generatePlan } from '../../../lib/planner';
import {
  CreateEventTool,
  ListEventsTool,
  UpdateEventTool,
  DeleteEventTool,
  createEventParamsSchema,
  listEventsParamsSchema,
  updateEventParamsSchema,
  deleteEventParamsSchema,
} from '../../../lib/calendarTools';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user || !session.user.id || !session.accessToken) {
      console.log("[API /api/process] No session or missing user/access token.");
      return NextResponse.json({ error: "Authentication required. Please log in." }, { status: 401 });
    }

    if (session.error) {
      console.error(`[API /api/process] Authentication error from session: ${session.error}`);
      if (session.error === "RefreshErrorInvalidGrant" || session.error === "RefreshAccessTokenError") {
        return NextResponse.json({ error: "Session expired or invalid. Please log in again." }, { status: 401 });
      }
      return NextResponse.json({ error: "An issue occurred with your session. Please try logging out and back in." }, { status: 401 });
    }

    const userId = session.user.id;
    const accessToken = session.accessToken;

    console.log(`[API /api/process] Authenticated user: ${userId}`);

    const body = await request.json();
    const userText = body.text;

    if (!userText || typeof userText !== 'string') {
      return NextResponse.json({ error: 'Invalid request: "text" is required and must be a string.' }, { status: 400 });
    }

    console.log('[API /api/process] Received text:', userText);

    const nowISO = new Date().toISOString();
    const plan = await generatePlan(userText, nowISO);

    if (!plan) {
      return NextResponse.json({ error: 'Failed to generate a plan from the LLM.' }, { status: 500 });
    }

    console.log('[API /api/process] Plan generated:', plan);

    let toolResultText = 'Action could not be executed or no specific tool output.';
    let assistantMsg = plan.reasoning || "I've processed your request.";
    const diff = {}; // Placeholder for diff

    try {
      if (plan.action === 'create_event' && plan.params) {
        const validatedParams = createEventParamsSchema.safeParse(plan.params);
        if (validatedParams.success) {
          const tool = new CreateEventTool(userId, accessToken);
          toolResultText = await tool.call(validatedParams.data);
          assistantMsg = toolResultText;
        } else {
          console.error("[API /api/process] CreateEventTool param validation error:", validatedParams.error.format());
          throw new Error('Parameter validation failed for CreateEventTool: ' + validatedParams.error.format());
        }
      } else if (plan.action === 'list_events' && plan.params) {
        const validatedParams = listEventsParamsSchema.safeParse(plan.params);
        if (validatedParams.success) {
          const tool = new ListEventsTool(userId, accessToken);
          toolResultText = await tool.call(validatedParams.data);
          assistantMsg = toolResultText;
        } else {
          console.error("[API /api/process] ListEventsTool param validation error:", validatedParams.error.format());
          throw new Error('Parameter validation failed for ListEventsTool: ' + validatedParams.error.format());
        }
      } else if (plan.action === 'update_event' && plan.params) {
        const validatedParams = updateEventParamsSchema.safeParse(plan.params);
        if (validatedParams.success) {
          const tool = new UpdateEventTool(userId, accessToken);
          toolResultText = await tool.call(validatedParams.data);
          assistantMsg = toolResultText;
        } else {
          console.error("[API /api/process] UpdateEventTool param validation error:", validatedParams.error.format());
          throw new Error('Parameter validation failed for UpdateEventTool: ' + validatedParams.error.format());
        }
      } else if (plan.action === 'delete_event' && plan.params) {
        const validatedParams = deleteEventParamsSchema.safeParse(plan.params);
        if (validatedParams.success) {
          const tool = new DeleteEventTool(userId, accessToken);
          toolResultText = await tool.call(validatedParams.data);
          assistantMsg = toolResultText;
        } else {
          console.error("[API /api/process] DeleteEventTool param validation error:", validatedParams.error.format());
          throw new Error('Parameter validation failed for DeleteEventTool: ' + validatedParams.error.format());
        }
      } else if (plan.action === 'unknown') {
        assistantMsg = "I'm not sure how to handle that request.";
        toolResultText = 'Action was "unknown".';
      } else if (!plan.params) {
        assistantMsg = plan.reasoning || "I understood the action, but no specific parameters were provided to execute.";
        toolResultText = 'No parameters provided for the action.';
      }
    } catch (toolError: any) {
      console.error('[API /api/process] Error executing tool:', toolError.message, toolError.stack);
      return NextResponse.json({ 
        error: 'An error occurred while trying to execute the planned action. Please check server logs for details.',
      }, { status: 500 });
    }
    
    console.log('[API /api/process] Tool Result Text:', toolResultText);

    return NextResponse.json({
      assistantMsg,
      diff,
      plan 
    });

  } catch (error: any) {
    console.error('[API /api/process] General error:', error.message, error.stack);
    let errorMessage = 'An unexpected error occurred. Please check server logs for details.';
    if (error instanceof SyntaxError) {
      errorMessage = 'Invalid request format: Could not parse JSON body.';
    }
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
} 