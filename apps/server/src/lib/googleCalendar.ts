import { google, calendar_v3 } from 'googleapis';
import { Auth } from 'googleapis';
import { logAuditEvent } from '../lib/auditLog';
import { Prisma } from '../generated/prisma';

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
 * Lists events from the user's primary calendar.
 * @param userId The ID of the user performing the action.
 * @param accessToken The user's Google OAuth 2.0 access token.
 * @param options Optional parameters for listing events (e.g., timeMin, timeMax, q).
 * @returns A list of events or null if an error occurred.
 */
export async function listEvents(userId: string, accessToken: string, options?: calendar_v3.Params$Resource$Events$List) {
    const action = 'calendar.listEvents';
    try {
        const calendar = getCalendarClient(accessToken);
        const response = await calendar.events.list({
            calendarId: 'primary',
            ...options,
        });
        const events = response.data.items;
        await logAuditEvent({
            userId,
            action,
            status: 'SUCCESS',
            payload: { options: options ? JSON.stringify(options) : undefined, resultCount: events?.length } as Prisma.InputJsonObject,
        });
        return events;
    } catch (error: any) {
        console.error('Error listing events:', error);
        await logAuditEvent({
            userId,
            action,
            status: 'FAILURE',
            payload: { options: options ? JSON.stringify(options) : undefined } as Prisma.InputJsonObject,
            error: error.message || String(error),
        });
        return null;
    }
}

/**
 * Inserts an event into the user's primary calendar.
 * @param userId The ID of the user performing the action.
 * @param accessToken The user's Google OAuth 2.0 access token.
 * @param event The event object to insert.
 * @returns The created event object or null if an error occurred.
 */
export async function insertEvent(userId: string, accessToken: string, event: calendar_v3.Schema$Event) {
    const action = 'calendar.insertEvent';
    try {
        const calendar = getCalendarClient(accessToken);
        const response = await calendar.events.insert({
            calendarId: 'primary', // Use the user's primary calendar
            requestBody: event,
        });

        const createdEvent = response.data;
        console.log('Event created: %s', createdEvent.htmlLink);
        await logAuditEvent({
            userId,
            action,
            status: 'SUCCESS',
            payload: { event: JSON.stringify(event), createdEventId: createdEvent.id } as Prisma.InputJsonObject,
        });
        return createdEvent; // Return the created event data
    } catch (error: any) {
        console.error('Error inserting event:', error);
        await logAuditEvent({
            userId,
            action,
            status: 'FAILURE',
            payload: { event: JSON.stringify(event) } as Prisma.InputJsonObject,
            error: error.message || String(error),
        });
        return null;
    }
}

/**
 * Updates an existing event in the user's primary calendar.
 * @param userId The ID of the user performing the action.
 * @param accessToken The user's Google OAuth 2.0 access token.
 * @param eventId The ID of the event to update.
 * @param eventPatch The partial event object with fields to update.
 * @returns The updated event object or null if an error occurred.
 */
export async function patchEvent(userId: string, accessToken: string, eventId: string, eventPatch: calendar_v3.Schema$Event) {
    const action = 'calendar.patchEvent';
    try {
        const calendar = getCalendarClient(accessToken);
        const response = await calendar.events.patch({
            calendarId: 'primary',
            eventId: eventId,
            requestBody: eventPatch,
        });
        const updatedEvent = response.data;
        console.log('Event updated: %s', updatedEvent.htmlLink);
        await logAuditEvent({
            userId,
            action,
            status: 'SUCCESS',
            payload: { eventId, eventPatch: JSON.stringify(eventPatch), updatedEventId: updatedEvent.id } as Prisma.InputJsonObject,
        });
        return updatedEvent;
    } catch (error: any) {
        console.error('Error patching event:', error);
        await logAuditEvent({
            userId,
            action,
            status: 'FAILURE',
            payload: { eventId, eventPatch: JSON.stringify(eventPatch) } as Prisma.InputJsonObject,
            error: error.message || String(error),
        });
        return null;
    }
}

/**
 * Deletes an event from the user's primary calendar.
 * @param userId The ID of the user performing the action.
 * @param accessToken The user's Google OAuth 2.0 access token.
 * @param eventId The ID of the event to delete.
 * @returns True if the event was deleted successfully, false otherwise.
 */
export async function deleteEvent(userId: string, accessToken: string, eventId: string) {
    const action = 'calendar.deleteEvent';
    try {
        const calendar = getCalendarClient(accessToken);
        await calendar.events.delete({
            calendarId: 'primary',
            eventId: eventId,
        });
        console.log('Event deleted: %s', eventId);
        await logAuditEvent({
            userId,
            action,
            status: 'SUCCESS',
            payload: { eventId } as Prisma.InputJsonObject,
        });
        return true;
    } catch (error: any) {
        console.error('Error deleting event:', error);
        await logAuditEvent({
            userId,
            action,
            status: 'FAILURE',
            payload: { eventId } as Prisma.InputJsonObject,
            error: error.message || String(error),
        });
        return false;
    }
} 