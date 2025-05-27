// Calendar API Client for Frontend (Web React & React Native/Expo Compatible)
// This file can be copied to your frontend project for easy API usage

import {
  ListEventsRequest,
  ListEventsResponse,
  GetEventResponse,
  CreateEventRequest,
  CreateEventResponse,
  UpdateEventRequest,
  UpdateEventResponse,
  DeleteEventResponse,
  ListCalendarsResponse,
  CalendarApiResponse,
  isApiError,
  CalendarApiOptions,
} from './types';

export class CalendarApiClient {
  private baseUrl: string;
  private getToken: () => Promise<string>;

  constructor(options: CalendarApiOptions) {
    // For React Native, baseUrl should be the full domain (e.g., 'https://your-api.com/api/calendar')
    // For web React, baseUrl can be relative (e.g., '/api/calendar')
    this.baseUrl = options.baseUrl || '/api/calendar';
    this.getToken = options.getToken;
  }

  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<CalendarApiResponse<T>> {
    try {
      const token = await this.getToken();
      
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          error: data.error || `HTTP ${response.status}: ${response.statusText}`,
          details: data.details,
        };
      }

      return data;
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Network error occurred',
      };
    }
  }

  // Calendar Management

  /**
   * Get list of user's calendars
   */
  async getCalendars(): Promise<CalendarApiResponse<ListCalendarsResponse>> {
    return this.makeRequest<ListCalendarsResponse>('/calendars');
  }

  // Event Management

  /**
   * List events from calendars
   */
  async getEvents(params: ListEventsRequest = {}): Promise<CalendarApiResponse<ListEventsResponse>> {
    const searchParams = new URLSearchParams();
    
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        searchParams.append(key, String(value));
      }
    });

    const queryString = searchParams.toString();
    const endpoint = queryString ? `/events?${queryString}` : '/events';
    
    return this.makeRequest<ListEventsResponse>(endpoint);
  }

  /**
   * Get a specific event by ID
   */
  async getEvent(eventId: string, calendarId = 'primary'): Promise<CalendarApiResponse<GetEventResponse>> {
    const params = new URLSearchParams({ calendarId });
    return this.makeRequest<GetEventResponse>(`/events/${eventId}?${params}`);
  }

  /**
   * Create a new event
   */
  async createEvent(eventData: CreateEventRequest): Promise<CalendarApiResponse<CreateEventResponse>> {
    return this.makeRequest<CreateEventResponse>('/events', {
      method: 'POST',
      body: JSON.stringify(eventData),
    });
  }

  /**
   * Update an existing event
   */
  async updateEvent(eventData: UpdateEventRequest): Promise<CalendarApiResponse<UpdateEventResponse>> {
    return this.makeRequest<UpdateEventResponse>('/events', {
      method: 'PATCH',
      body: JSON.stringify(eventData),
    });
  }

  /**
   * Delete an event
   */
  async deleteEvent(eventId: string, calendarId = 'primary'): Promise<CalendarApiResponse<DeleteEventResponse>> {
    return this.makeRequest<DeleteEventResponse>('/events', {
      method: 'DELETE',
      body: JSON.stringify({ eventId, calendarId }),
    });
  }

  // Convenience Methods

  /**
   * Get events for today
   */
  async getTodayEvents(calendarId = 'primary'): Promise<CalendarApiResponse<ListEventsResponse>> {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return this.getEvents({
      calendarId,
      timeMin: today.toISOString(),
      timeMax: tomorrow.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });
  }

  /**
   * Get events for this week
   */
  async getWeekEvents(calendarId = 'primary'): Promise<CalendarApiResponse<ListEventsResponse>> {
    const today = new Date();
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);

    return this.getEvents({
      calendarId,
      timeMin: today.toISOString(),
      timeMax: nextWeek.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });
  }

  /**
   * Search events by query
   */
  async searchEvents(query: string, calendarId = 'primary'): Promise<CalendarApiResponse<ListEventsResponse>> {
    return this.getEvents({
      calendarId,
      q: query,
      singleEvents: true,
      orderBy: 'startTime',
    });
  }

  /**
   * Create a quick event (just title and time)
   */
  async createQuickEvent(
    summary: string,
    startTime: Date,
    durationMinutes = 60,
    calendarId = 'primary'
  ): Promise<CalendarApiResponse<CreateEventResponse>> {
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + durationMinutes);

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    return this.createEvent({
      calendarId,
      summary,
      start: {
        dateTime: startTime.toISOString(),
        timeZone,
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone,
      },
    });
  }

  /**
   * Create an all-day event
   */
  async createAllDayEvent(
    summary: string,
    date: Date,
    calendarId = 'primary'
  ): Promise<CalendarApiResponse<CreateEventResponse>> {
    const dateString = date.toISOString().split('T')[0]; // YYYY-MM-DD format

    return this.createEvent({
      calendarId,
      summary,
      start: {
        date: dateString,
      },
      end: {
        date: dateString,
      },
    });
  }

  /**
   * Move an event to a different time
   */
  async moveEvent(
    eventId: string,
    newStartTime: Date,
    newEndTime?: Date,
    calendarId = 'primary'
  ): Promise<CalendarApiResponse<UpdateEventResponse>> {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    
    const updateData: UpdateEventRequest = {
      eventId,
      calendarId,
      start: {
        dateTime: newStartTime.toISOString(),
        timeZone,
      },
    };

    if (newEndTime) {
      updateData.end = {
        dateTime: newEndTime.toISOString(),
        timeZone,
      };
    }

    return this.updateEvent(updateData);
  }
}

// Utility functions for common operations

/**
 * Create a calendar client instance
 */
export function createCalendarClient(getToken: () => Promise<string>, baseUrl?: string): CalendarApiClient {
  return new CalendarApiClient({ getToken, baseUrl });
}

/**
 * Helper to handle API responses with error checking
 */
export async function handleApiResponse<T>(
  apiCall: Promise<CalendarApiResponse<T>>,
  onSuccess: (data: T) => void,
  onError?: (error: string, details?: any) => void
): Promise<void> {
  const response = await apiCall;
  
  if (isApiError(response)) {
    if (onError) {
      onError(response.error, response.details);
    } else {
      console.error('Calendar API Error:', response.error, response.details);
    }
  } else {
    onSuccess(response);
  }
}

// React Hook for Calendar API (Compatible with Web React & React Native)
export function useCalendarApi(getToken: () => Promise<string>, baseUrl?: string) {
  const client = createCalendarClient(getToken, baseUrl);
  
  return {
    client,
    
    // Convenience methods that return promises
    getCalendars: () => client.getCalendars(),
    getEvents: (params?: ListEventsRequest) => client.getEvents(params),
    getEvent: (eventId: string, calendarId?: string) => client.getEvent(eventId, calendarId),
    createEvent: (eventData: CreateEventRequest) => client.createEvent(eventData),
    updateEvent: (eventData: UpdateEventRequest) => client.updateEvent(eventData),
    deleteEvent: (eventId: string, calendarId?: string) => client.deleteEvent(eventId, calendarId),
    
    // Convenience methods
    getTodayEvents: (calendarId?: string) => client.getTodayEvents(calendarId),
    getWeekEvents: (calendarId?: string) => client.getWeekEvents(calendarId),
    searchEvents: (query: string, calendarId?: string) => client.searchEvents(query, calendarId),
    createQuickEvent: (summary: string, startTime: Date, durationMinutes?: number, calendarId?: string) =>
      client.createQuickEvent(summary, startTime, durationMinutes, calendarId),
    createAllDayEvent: (summary: string, date: Date, calendarId?: string) =>
      client.createAllDayEvent(summary, date, calendarId),
    moveEvent: (eventId: string, newStartTime: Date, newEndTime?: Date, calendarId?: string) =>
      client.moveEvent(eventId, newStartTime, newEndTime, calendarId),
  };
} 