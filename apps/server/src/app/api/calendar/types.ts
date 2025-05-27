// Google Calendar API Types for Frontend

export interface Calendar {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
}

export interface EventDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface Attendee {
  email: string;
  displayName?: string;
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
}

export interface Reminder {
  method: 'email' | 'popup';
  minutes: number;
}

export interface EventReminders {
  useDefault?: boolean;
  overrides?: Reminder[];
}

export interface Event {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: EventDateTime;
  end: EventDateTime;
  attendees?: Attendee[];
  reminders?: EventReminders;
  recurrence?: string[];
  htmlLink?: string;
  created?: string;
  updated?: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  visibility?: 'default' | 'public' | 'private' | 'confidential';
  creator?: {
    email?: string;
    displayName?: string;
  };
  organizer?: {
    email?: string;
    displayName?: string;
  };
}

// Request/Response Types

export interface ListEventsRequest {
  calendarId?: string;
  timeMin?: string;
  timeMax?: string;
  q?: string;
  maxResults?: number;
  singleEvents?: boolean;
  orderBy?: 'startTime' | 'updated';
  timeZone?: string;
}

export interface ListEventsResponse {
  events: Event[];
}

export interface GetEventRequest {
  eventId: string;
  calendarId?: string;
}

export interface GetEventResponse {
  event: Event;
}

export interface CreateEventRequest {
  calendarId?: string;
  summary: string;
  description?: string;
  location?: string;
  start: EventDateTime;
  end: EventDateTime;
  attendees?: Attendee[];
  reminders?: EventReminders;
  recurrence?: string[];
  visibility?: 'default' | 'public' | 'private' | 'confidential';
}

export interface CreateEventResponse {
  event: Event;
}

export interface UpdateEventRequest {
  calendarId?: string;
  eventId: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: EventDateTime;
  end?: EventDateTime;
  attendees?: Attendee[];
  reminders?: EventReminders;
  recurrence?: string[];
  visibility?: 'default' | 'public' | 'private' | 'confidential';
}

export interface UpdateEventResponse {
  event: Event;
}

export interface DeleteEventRequest {
  calendarId?: string;
  eventId: string;
}

export interface DeleteEventResponse {
  success: boolean;
  message: string;
}

export interface ListCalendarsResponse {
  calendars: Calendar[];
}

// Error Response Type
export interface ApiErrorResponse {
  error: string;
  details?: any;
}

// Utility Types for Frontend
export type CalendarApiResponse<T> = T | ApiErrorResponse;

export interface CalendarApiOptions {
  baseUrl?: string;
  getToken: () => Promise<string>;
}

// Helper type guards
export function isApiError(response: any): response is ApiErrorResponse {
  return response && typeof response.error === 'string';
}

export function isSuccessResponse<T>(response: CalendarApiResponse<T>): response is T {
  return !isApiError(response);
} 