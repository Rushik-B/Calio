import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/clerk-sdk-node";
import { getUserCalendarList } from "@/lib/googleCalendar";

// Helper function to authenticate and get user info
async function authenticateUser(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    throw new Error("Authorization header is missing");
  }
  
  const token = authHeader.replace("Bearer ", "");
  if (!token) {
    throw new Error("Malformed token in Authorization header");
  }

  const claims = await clerkClient.verifyToken(token);
  if (!claims.sub) {
    throw new Error("User ID (sub) not found in token claims");
  }

  const userId = claims.sub;

  // Get Google OAuth Access Token
  const response = await clerkClient.users.getUserOauthAccessToken(userId, "google");
  const oauthAccessTokens = response.data;
  
  if (!oauthAccessTokens || oauthAccessTokens.length === 0 || !oauthAccessTokens[0].token) {
    throw new Error("Google OAuth token not found. Please ensure your Google account is connected and calendar permissions are granted.");
  }

  return {
    userId,
    googleAccessToken: oauthAccessTokens[0].token,
  };
}

// GET /api/calendar/calendars - List user's calendars
export async function GET(req: NextRequest) {
  try {
    const { userId, googleAccessToken } = await authenticateUser(req);
    
    const calendarList = await getUserCalendarList(userId, googleAccessToken);
    
    if (calendarList === null) {
      return NextResponse.json({ error: "Failed to fetch calendar list" }, { status: 500 });
    }

    return NextResponse.json({ calendars: calendarList });
  } catch (error: unknown) {
    console.error("Error in GET /api/calendar/calendars:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    
    if (message.includes("Authorization") || message.includes("token")) {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    if (message.includes("Google OAuth")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    
    return NextResponse.json({ error: `Failed to fetch calendar list: ${message}` }, { status: 500 });
  }
} 