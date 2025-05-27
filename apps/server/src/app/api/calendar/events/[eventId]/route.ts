import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/clerk-sdk-node";
import { google, calendar_v3 } from 'googleapis';
import { logAuditEvent } from "@/lib/auditLog";
import { Prisma } from '@prisma/client';

// Helper function to create authenticated Google Calendar client
function getCalendarClient(accessToken: string): calendar_v3.Calendar {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

// Helper function to get a specific event
async function getEvent(clerkUserIdForAudit: string, accessToken: string, calendarId: string, eventId: string) {
  const action = 'calendar.getEvent';
  try {
    const calendar = getCalendarClient(accessToken);
    const response = await calendar.events.get({
      calendarId: calendarId,
      eventId: eventId,
    });
    
    const event = response.data;
    await logAuditEvent({
      clerkUserId: clerkUserIdForAudit,
      action,
      status: 'SUCCESS',
      payload: { calendarId, eventId } as Prisma.InputJsonObject,
    });
    return event;
  } catch (error: unknown) {
    console.error('Error getting event:', error);
    await logAuditEvent({
      clerkUserId: clerkUserIdForAudit,
      action,
      status: 'FAILURE',
      payload: { calendarId, eventId } as Prisma.InputJsonObject,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

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

// GET /api/calendar/events/[eventId] - Get specific event
export async function GET(
  req: NextRequest,
  { params }: { params: { eventId: string } }
) {
  try {
    const { userId, googleAccessToken } = await authenticateUser(req);
    
    const { eventId } = params;
    const url = new URL(req.url);
    const calendarId = url.searchParams.get('calendarId') || 'primary';
    
    if (!eventId) {
      return NextResponse.json({ error: "Event ID is required" }, { status: 400 });
    }
    
    const event = await getEvent(userId, googleAccessToken, calendarId, eventId);
    
    if (!event) {
      return NextResponse.json({ error: "Event not found or failed to fetch" }, { status: 404 });
    }

    return NextResponse.json({ event });
  } catch (error: unknown) {
    console.error("Error in GET /api/calendar/events/[eventId]:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    
    if (message.includes("Authorization") || message.includes("token")) {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    if (message.includes("Google OAuth")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    
    return NextResponse.json({ error: `Failed to fetch event: ${message}` }, { status: 500 });
  }
} 