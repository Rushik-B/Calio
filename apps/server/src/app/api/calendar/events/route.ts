import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/clerk-sdk-node";
import { listEvents, insertEvent, patchEvent, deleteEvent } from "@/lib/googleCalendar";
import { z } from "zod";

// Validation schemas
const listEventsSchema = z.object({
  calendarId: z.string().optional().default('primary'),
  timeMin: z.string().optional(),
  timeMax: z.string().optional(),
  q: z.string().optional(), // Search query
  maxResults: z.number().min(1).max(2500).optional(),
  singleEvents: z.boolean().optional().default(true),
  orderBy: z.enum(['startTime', 'updated']).optional(),
  timeZone: z.string().optional(),
});

const createEventSchema = z.object({
  calendarId: z.string().optional().default('primary'),
  summary: z.string().min(1, "Event title is required"),
  description: z.string().optional(),
  location: z.string().optional(),
  start: z.object({
    dateTime: z.string().optional(),
    date: z.string().optional(),
    timeZone: z.string().optional(),
  }),
  end: z.object({
    dateTime: z.string().optional(),
    date: z.string().optional(),
    timeZone: z.string().optional(),
  }),
  attendees: z.array(z.object({
    email: z.string().email(),
    displayName: z.string().optional(),
  })).optional(),
  reminders: z.object({
    useDefault: z.boolean().optional(),
    overrides: z.array(z.object({
      method: z.enum(['email', 'popup']),
      minutes: z.number().min(0),
    })).optional(),
  }).optional(),
  recurrence: z.array(z.string()).optional(),
});

const updateEventSchema = z.object({
  calendarId: z.string().optional().default('primary'),
  eventId: z.string().min(1, "Event ID is required"),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: z.object({
    dateTime: z.string().optional(),
    date: z.string().optional(),
    timeZone: z.string().optional(),
  }).optional(),
  end: z.object({
    dateTime: z.string().optional(),
    date: z.string().optional(),
    timeZone: z.string().optional(),
  }).optional(),
  attendees: z.array(z.object({
    email: z.string().email(),
    displayName: z.string().optional(),
  })).optional(),
  reminders: z.object({
    useDefault: z.boolean().optional(),
    overrides: z.array(z.object({
      method: z.enum(['email', 'popup']),
      minutes: z.number().min(0),
    })).optional(),
  }).optional(),
});

const deleteEventSchema = z.object({
  calendarId: z.string().optional().default('primary'),
  eventId: z.string().min(1, "Event ID is required"),
});

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

// GET /api/calendar/events - List events
export async function GET(req: NextRequest) {
  try {
    const { userId, googleAccessToken } = await authenticateUser(req);
    
    // Parse query parameters
    const url = new URL(req.url);
    const queryParams = Object.fromEntries(url.searchParams.entries());
    
    // Convert string numbers to actual numbers for validation
    if (queryParams.maxResults) {
      (queryParams as any).maxResults = parseInt(queryParams.maxResults);
    }
    if (queryParams.singleEvents) {
      (queryParams as any).singleEvents = queryParams.singleEvents === 'true';
    }
    
    const validatedParams = listEventsSchema.parse(queryParams);
    
    const events = await listEvents(userId, googleAccessToken, validatedParams.calendarId, {
      timeMin: validatedParams.timeMin,
      timeMax: validatedParams.timeMax,
      q: validatedParams.q,
      maxResults: validatedParams.maxResults,
      singleEvents: validatedParams.singleEvents,
      orderBy: validatedParams.orderBy,
      timeZone: validatedParams.timeZone,
    });

    if (events === null) {
      return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
    }

    return NextResponse.json({ events });
  } catch (error: unknown) {
    console.error("Error in GET /api/calendar/events:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    
    if (message.includes("Authorization") || message.includes("token")) {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    if (message.includes("Google OAuth")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    
    return NextResponse.json({ error: `Failed to fetch events: ${message}` }, { status: 500 });
  }
}

// POST /api/calendar/events - Create event
export async function POST(req: NextRequest) {
  try {
    const { userId, googleAccessToken } = await authenticateUser(req);
    
    const body = await req.json();
    const validatedData = createEventSchema.parse(body);
    
    const { calendarId, ...eventData } = validatedData;
    
    const createdEvent = await insertEvent(userId, googleAccessToken, calendarId, eventData);
    
    if (!createdEvent) {
      return NextResponse.json({ error: "Failed to create event" }, { status: 500 });
    }

    return NextResponse.json({ event: createdEvent }, { status: 201 });
  } catch (error: unknown) {
    console.error("Error in POST /api/calendar/events:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    
    if (message.includes("Authorization") || message.includes("token")) {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    if (message.includes("Google OAuth")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Validation error", details: error.format() }, { status: 400 });
    }
    
    return NextResponse.json({ error: `Failed to create event: ${message}` }, { status: 500 });
  }
}

// PATCH /api/calendar/events - Update event
export async function PATCH(req: NextRequest) {
  try {
    const { userId, googleAccessToken } = await authenticateUser(req);
    
    const body = await req.json();
    const validatedData = updateEventSchema.parse(body);
    
    const { calendarId, eventId, ...eventPatch } = validatedData;
    
    const updatedEvent = await patchEvent(userId, googleAccessToken, calendarId, eventId, eventPatch);
    
    if (!updatedEvent) {
      return NextResponse.json({ error: "Failed to update event" }, { status: 500 });
    }

    return NextResponse.json({ event: updatedEvent });
  } catch (error: unknown) {
    console.error("Error in PATCH /api/calendar/events:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    
    if (message.includes("Authorization") || message.includes("token")) {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    if (message.includes("Google OAuth")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Validation error", details: error.format() }, { status: 400 });
    }
    
    return NextResponse.json({ error: `Failed to update event: ${message}` }, { status: 500 });
  }
}

// DELETE /api/calendar/events - Delete event
export async function DELETE(req: NextRequest) {
  try {
    const { userId, googleAccessToken } = await authenticateUser(req);
    
    const body = await req.json();
    const validatedData = deleteEventSchema.parse(body);
    
    const success = await deleteEvent(userId, googleAccessToken, validatedData.calendarId, validatedData.eventId);
    
    if (!success) {
      return NextResponse.json({ error: "Failed to delete event" }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "Event deleted successfully" });
  } catch (error: unknown) {
    console.error("Error in DELETE /api/calendar/events:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    
    if (message.includes("Authorization") || message.includes("token")) {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    if (message.includes("Google OAuth")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Validation error", details: error.format() }, { status: 400 });
    }
    
    return NextResponse.json({ error: `Failed to delete event: ${message}` }, { status: 500 });
  }
} 