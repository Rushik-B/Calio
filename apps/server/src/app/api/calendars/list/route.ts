import { NextRequest, NextResponse } from "next/server";
import { clerkClient, OauthAccessToken } from "@clerk/clerk-sdk-node";
import { getUserCalendarList } from "@/lib/googleCalendar";

export async function GET(req: NextRequest) {
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

  // 3. Fetch the calendar list
  try {
    const calendarList = await getUserCalendarList(userId, googleAccessToken);
    if (calendarList) {
      return NextResponse.json(calendarList);
    } else {
      return NextResponse.json({ error: "Failed to retrieve calendar list." }, { status: 500 });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error fetching calendar list.";
    console.error("Error in GET /api/calendars/list route:", error);
    return NextResponse.json({ error: `Failed to fetch calendar list: ${message}` }, { status: 500 });
  }
} 