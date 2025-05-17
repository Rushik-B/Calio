import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/clerk-sdk-node";
import { generatePlan, CalendarAction } from "@/lib/planner";
import { getUserCalendarList } from "@/lib/googleCalendar"; 
import { ZodError } from "zod";
import { executePlan } from "@/lib/chatController"; // Import the new controller function

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

  let userId: string;
  try {
    const claims = await clerkClient.verifyToken(token);
    if (!claims.sub) {
      throw new Error("User ID (sub) not found in token claims");
    }
    userId = claims.sub;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Unauthorized: Invalid token. " + message }, { status: 401 });
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
    return NextResponse.json({ error: `Failed to fetch Google OAuth token: ${message}` }, { status: 500 });
  }

  if (!googleAccessToken) {
    return NextResponse.json({ error: "Google OAuth token could not be retrieved." }, { status: 500 });
  }

  // 3. Get the user's text input, explicit calendarId, and selectedCalendarIds
  let textInput: string;
  let explicitCalendarId: string | undefined;
  let selectedCalendarIds: string[] | undefined;
  let userTimezone: string = "UTC";

  try {
    const body = await req.json();
    if (!body.text || typeof body.text !== "string") {
      return NextResponse.json({ error: "Request body must contain a 'text' field as a string." }, { status: 400 });
    }
    textInput = body.text;
    if (body.calendarId && typeof body.calendarId === 'string') {
      explicitCalendarId = body.calendarId;
    }
    if (body.selectedCalendarIds && Array.isArray(body.selectedCalendarIds)) {
      if (body.selectedCalendarIds.every((id: any) => typeof id === 'string')) {
        selectedCalendarIds = body.selectedCalendarIds;
      } else {
        console.warn("Invalid selectedCalendarIds: not all elements are strings. Ignoring.");
      }
    }
    if (body.userTimezone && typeof body.userTimezone === 'string') { 
      userTimezone = body.userTimezone;
    } else if (!body.userTimezone) { 
      console.warn("[ChatRoute] userTimezone not provided in request body. Defaulting to UTC. Frontend should send this.");
    }
    console.log("[ChatRoute] Received textInput:", textInput);
    console.log("[ChatRoute] Received selectedCalendarIds:", selectedCalendarIds);
    console.log("[ChatRoute] Received explicitCalendarId:", explicitCalendarId);
    console.log("[ChatRoute] Received userTimezone:", userTimezone);
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON in request body." }, { status: 400 });
  }

  // 4. Generate a plan using the planner
  const currentTimeISO = new Date().toISOString();
  let plan: CalendarAction | null;
  let userCalendarsFormatted: string = "No calendars found or user has not granted permission.";

  try {
    const calendars = await getUserCalendarList(userId, googleAccessToken);
    if (calendars && calendars.length > 0) {
      userCalendarsFormatted = calendars
        .map(cal => `(Name: "${cal.summary || cal.id}", ID: "${cal.id}", Primary: ${cal.primary || false}, Role: "${cal.accessRole}")`)
        .join(", ");
      console.log("[ChatRoute] User calendars for planner & event creator:", userCalendarsFormatted);
    } else {
      console.log("[ChatRoute] No calendars returned by getUserCalendarList or list is empty.");
    }
  } catch (error) {
    console.warn("[ChatRoute] Could not fetch user calendar list:", error);
    // userCalendarsFormatted keeps its default value
  }

  try {
    plan = await generatePlan(textInput, currentTimeISO, userTimezone, userCalendarsFormatted);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown planner error";
    console.error("Error in planner:", error);
    // Check if it's a ZodError from planner's output parsing (if any)
    if (error instanceof ZodError) {
        console.error("Planner output validation error:", error.format());
        return NextResponse.json({ error: "Planner output validation failed.", details: error.format() }, { status: 500 });
    }
    return NextResponse.json({ error: `Planner failed: ${message}` }, { status: 500 });
  }

  if (!plan) {
    return NextResponse.json({ error: "Could not generate a plan from the input." }, { status: 400 });
  }

  // 5. Execute the plan using the ChatController
  try {
    const toolResult = await executePlan({
      plan,
      userId,
      googleAccessToken,
      explicitCalendarId,
      selectedCalendarIds,
      userTimezone,
      textInput,
      userCalendarsFormatted,
      currentTimeISO
    });
    return NextResponse.json({ message: toolResult });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      console.error("Parameter validation error for tool (from controller):", error.format());
      // The controller itself might throw ZodErrors if its internal schema parsing fails
      // (though individual tools handle their own Zod parsing, executePlan might have its own)
      // Also, the plan.params are parsed by schemas within the controller.
      console.error("Parameters that failed Zod validation (likely plan.params):", JSON.stringify(plan?.params, null, 2));
      return NextResponse.json({ error: "Parameter validation failed for the calendar action.", details: error.format() }, { status: 400 });
    }
    // Handle errors thrown by executePlan (e.g., "Unknown action" or tool execution errors)
    const message = error instanceof Error ? error.message : "Unknown tool execution error";
    console.error(`Error executing plan via controller for action '${plan.action}':`, error);
    // If the error message already indicates a specific status (e.g. from a tool), consider using that.
    // For now, default to 500 for execution errors.
    return NextResponse.json({ error: `Error performing planned action: ${message}` }, { status: 500 });
  }
}
