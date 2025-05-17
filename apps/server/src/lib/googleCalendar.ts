import { google, calendar_v3 } from 'googleapis';
import { logAuditEvent } from '../lib/auditLog';
import { Prisma } from '@prisma/client';

/**
 * Creates an authenticated Google Calendar API client.
 * @param accessToken The user's Google OAuth 2.0 access token.
 * @returns An authenticated Google Calendar API client instance.
 */
function getCalendarClient(accessToken: string): calendar_v3.Calendar {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    return google.calendar({ version: 'v3', auth: oauth2Client });
}

/**
 * Lists events from the user's specified calendar.
 * @param userId The ID of the user performing the action.
 * @param accessToken The user's Google OAuth 2.0 access token.
 * @param calendarId The ID of the calendar to list events from (defaults to 'primary').
 * @param options Optional parameters for listing events (e.g., timeMin, timeMax, q).
 * @returns A list of events or null if an error occurred.
 */
export async function listEvents(userId: string, accessToken: string, calendarId: string = 'primary', options?: calendar_v3.Params$Resource$Events$List) {
    const action = 'calendar.listEvents';
    try {
        const calendar = getCalendarClient(accessToken);
        const response = await calendar.events.list({
            calendarId: calendarId,
            ...options,
        });
        const events = response.data.items;
        await logAuditEvent({
            clerkUserId: userId,
            action,
            status: 'SUCCESS',
            payload: { calendarId, options: options ? JSON.stringify(options) : undefined, resultCount: events?.length } as Prisma.InputJsonObject,
        });
        return events;
    } catch (error: unknown) {
        console.error('Error listing events:', error);
        await logAuditEvent({
            clerkUserId: userId,
            action,
            status: 'FAILURE',
            payload: { calendarId, options: options ? JSON.stringify(options) : undefined } as Prisma.InputJsonObject,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

/**
 * Inserts an event into the user's specified calendar.
 * @param userId The ID of the user performing the action.
 * @param accessToken The user's Google OAuth 2.0 access token.
 * @param calendarId The ID of the calendar to insert the event into (defaults to 'primary').
 * @param event The event object to insert.
 * @returns The created event object or null if an error occurred.
 */
export async function insertEvent(userId: string, accessToken: string, calendarId: string = 'primary', event: calendar_v3.Schema$Event) {
    const action = 'calendar.insertEvent';
    try {
        const calendar = getCalendarClient(accessToken);
        const response = await calendar.events.insert({
            calendarId: calendarId,
            requestBody: event,
        });

        const createdEvent = response.data;
        console.log('Event created: %s', createdEvent.htmlLink);
        await logAuditEvent({
            clerkUserId: userId,
            action,
            status: 'SUCCESS',
            payload: { calendarId, event: JSON.stringify(event), createdEventId: createdEvent.id } as Prisma.InputJsonObject,
        });
        return createdEvent; // Return the created event data
    } catch (error: unknown) {
        console.error('Error inserting event:', error);
        await logAuditEvent({
            clerkUserId: userId,
            action,
            status: 'FAILURE',
            payload: { calendarId, event: JSON.stringify(event) } as Prisma.InputJsonObject,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

/**
 * Updates an existing event in the user's specified calendar.
 * @param userId The ID of the user performing the action.
 * @param accessToken The user's Google OAuth 2.0 access token.
 * @param calendarId The ID of the calendar where the event exists (defaults to 'primary').
 * @param eventId The ID of the event to update.
 * @param eventPatch The partial event object with fields to update.
 * @returns The updated event object or null if an error occurred.
 */
export async function patchEvent(userId: string, accessToken: string, calendarId: string = 'primary', eventId: string, eventPatch: calendar_v3.Schema$Event) {
    const action = 'calendar.patchEvent';
    try {
        const calendar = getCalendarClient(accessToken);
        const response = await calendar.events.patch({
            calendarId: calendarId,
            eventId: eventId,
            requestBody: eventPatch,
        });
        const updatedEvent = response.data;
        console.log('Event updated: %s', updatedEvent.htmlLink);
        await logAuditEvent({
            clerkUserId: userId,
            action,
            status: 'SUCCESS',
            payload: { calendarId, eventId, eventPatch: JSON.stringify(eventPatch), updatedEventId: updatedEvent.id } as Prisma.InputJsonObject,
        });
        return updatedEvent;
    } catch (error: unknown) {
        console.error('Error patching event:', error);
        await logAuditEvent({
            clerkUserId: userId,
            action,
            status: 'FAILURE',
            payload: { calendarId, eventId, eventPatch: JSON.stringify(eventPatch) } as Prisma.InputJsonObject,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

/**
 * Deletes an event from the user's specified calendar.
 * @param userId The ID of the user performing the action.
 * @param accessToken The user's Google OAuth 2.0 access token.
 * @param calendarId The ID of the calendar to delete the event from (defaults to 'primary').
 * @param eventId The ID of the event to delete.
 * @returns True if the event was deleted successfully, false otherwise.
 */
export async function deleteEvent(userId: string, accessToken: string, calendarId: string = 'primary', eventId: string) {
    const action = 'calendar.deleteEvent';
    try {
        const calendar = getCalendarClient(accessToken);
        await calendar.events.delete({
            calendarId: calendarId,
            eventId: eventId,
        });
        console.log('Event deleted: %s', eventId);
        await logAuditEvent({
            clerkUserId: userId,
            action,
            status: 'SUCCESS',
            payload: { calendarId, eventId } as Prisma.InputJsonObject,
        });
        return true;
    } catch (error: unknown) {
        console.error('Error deleting event:', error);
        await logAuditEvent({
            clerkUserId: userId,
            action,
            status: 'FAILURE',
            payload: { calendarId, eventId } as Prisma.InputJsonObject,
            error: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}

/**
 * Retrieves the list of calendars from the user's Google Calendar account.
 * @param userId The ID of the user performing the action.
 * @param accessToken The user's Google OAuth 2.0 access token.
 * @returns A list of calendar objects or null if an error occurred.
 */
export async function getUserCalendarList(userId: string, accessToken: string): Promise<calendar_v3.Schema$CalendarListEntry[] | null> {
    const action = 'calendar.listCalendarList'; // Action name for audit log
    try {
        const calendar = getCalendarClient(accessToken);
        const response = await calendar.calendarList.list({});
        const calendarList = response.data.items;

        await logAuditEvent({
            clerkUserId: userId,
            action,
            status: 'SUCCESS',
            payload: { resultCount: calendarList?.length } as Prisma.InputJsonObject,
        });
        // We are interested in id, summary, primary, accessRole
        return calendarList ? calendarList.map(cal => ({ 
            id: cal.id,
            summary: cal.summary,
            primary: cal.primary,
            accessRole: cal.accessRole 
        })) as calendar_v3.Schema$CalendarListEntry[] : []; // Ensure returning an array
    } catch (error: unknown) {
        console.error('Error fetching calendar list:', error);
        await logAuditEvent({
            clerkUserId: userId,
            action,
            status: 'FAILURE',
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
} 