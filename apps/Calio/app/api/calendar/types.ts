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
}

export interface Reminder {
  method: 'email' | 'popup';
  minutes: number;
}

export interface Event {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: EventDateTime;
  end: EventDateTime;
  attendees?: Attendee[];
  reminders?: {
    useDefault?: boolean;
    overrides?: Reminder[];
  };
  recurrence?: string[];
  htmlLink?: string;
  created?: string;
  updated?: string;
  calendarId?: string;
  // Calio specific fields (optional)
  type?: 'meeting' | 'focus' | 'personal' | 'ai-managed'; 
  color?: string;
  calioEdited?: boolean;
}

export interface CreateEventRequest {
  calendarId?: string;
  summary: string;
  description?: string;
  location?: string;
  start: EventDateTime;
  end: EventDateTime;
  attendees?: Attendee[];
  reminders?: {
    useDefault?: boolean;
    overrides?: Reminder[];
  };
  recurrence?: string[];
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
  reminders?: {
    useDefault?: boolean;
    overrides?: Reminder[];
  };
  recurrence?: string[];
}

export interface DeleteEventRequest {
  calendarId?: string;
  eventId: string;
}

export interface GetEventsParams {
  calendarId?: string;
  timeMin?: string;
  timeMax?: string;
  q?: string;
  maxResults?: number;
  singleEvents?: boolean;
  orderBy?: 'startTime' | 'updated';
  timeZone?: string;
}

export interface ApiError {
  error: string;
  details?: any;
}

export const isApiError = (response: any): response is ApiError => {
  return response && typeof response.error === 'string';
};

// Response types
export interface CalendarsResponse {
  calendars: Calendar[];
}

export interface EventsResponse {
  events: Event[];
}

export interface EventResponse {
  event: Event;
}

export interface SuccessResponse {
  success: boolean;
  message: string;
}

export type CalendarClient = {
  getCalendars: () => Promise<CalendarsResponse | ApiError>;
  getEvents: (params?: GetEventsParams) => Promise<EventsResponse | ApiError>;
  getEvent: (eventId: string, calendarId?: string) => Promise<EventResponse | ApiError>;
  createEvent: (eventData: CreateEventRequest) => Promise<EventResponse | ApiError>;
  updateEvent: (eventData: UpdateEventRequest) => Promise<EventResponse | ApiError>;
  deleteEvent: (eventData: DeleteEventRequest) => Promise<SuccessResponse | ApiError>;
  // Helper methods from docs
  getTodayEvents: (calendarId?: string) => Promise<EventsResponse | ApiError>;
  getWeekEvents: (calendarId?: string) => Promise<EventsResponse | ApiError>;
  searchEvents: (query: string, calendarId?: string) => Promise<EventsResponse | ApiError>;
  createQuickEvent: (
    summary: string,
    startTime: Date,
    durationMinutes: number,
    calendarId?: string
  ) => Promise<EventResponse | ApiError>;
  createAllDayEvent: (
    summary: string,
    date: Date,
    calendarId?: string
  ) => Promise<EventResponse | ApiError>;
  moveEvent: (
    eventId: string,
    newStartTime: Date,
    newEndTime: Date,
    calendarId?: string
  ) => Promise<EventResponse | ApiError>;
  getEventsFromMultipleCalendars: (calendarIds: string[], params?: Omit<GetEventsParams, 'calendarId'>) => Promise<EventsResponse | ApiError>;
}; 