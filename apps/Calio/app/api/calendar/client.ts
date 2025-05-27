import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    ApiError,
    CalendarClient,
    CalendarsResponse,
    CreateEventRequest,
    DeleteEventRequest,
    EventResponse,
    EventsResponse,
    GetEventsParams,
    SuccessResponse,
    UpdateEventRequest,
} from './types';

const CALENDAR_SETTINGS_KEY = 'calio_calendar_settings';

// Helper function to load calendar settings
const loadCalendarSettings = async (): Promise<string[]> => {
  try {
    const savedSettings = await AsyncStorage.getItem(CALENDAR_SETTINGS_KEY);
    if (savedSettings) {
      const settings = JSON.parse(savedSettings);
      const selectedCalendars = Object.keys(settings).filter(calId => settings[calId]);
      return selectedCalendars.length > 0 ? selectedCalendars : ['primary'];
    }
    return ['primary']; // Default to primary calendar
  } catch (error) {
    console.error('❌ Error loading calendar settings:', error);
    return ['primary'];
  }
};

export const createCalendarClient = (
  getToken: () => Promise<string | null>,
  baseUrl: string
): CalendarClient => {
  const makeRequest = async <T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
    body?: any
  ): Promise<T | ApiError> => {
    const token = await getToken();
    if (!token) {
      return { error: 'Authentication token not available' };
    }

    try {
      const response = await fetch(`${baseUrl}${endpoint}`,
        {
          method,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        return { error: errorData.error || `API request failed: ${response.status}`, details: errorData.details };
      }
      if (response.status === 204) { // Handle No Content for DELETE
        return { success: true, message: 'Event deleted successfully' } as unknown as T;
      }
      return await response.json();
    } catch (error: any) {
      return { error: error.message || 'Network error' };
    }
  };

  const getCalendars = () => makeRequest<CalendarsResponse>('/api/calendar/calendars');

  const getEvents = (params?: GetEventsParams) => {
    const query = params ? new URLSearchParams(params as Record<string, string>).toString() : '';
    return makeRequest<EventsResponse>(`/api/calendar/events?${query}`);
  };

  const getEvent = (eventId: string, calendarId: string = 'primary') => {
    return makeRequest<EventResponse>(`/api/calendar/events/${eventId}?calendarId=${calendarId}`);
  };

  const createEvent = (eventData: CreateEventRequest) => {
    return makeRequest<EventResponse>('/api/calendar/events', 'POST', eventData);
  };

  const updateEvent = (eventData: UpdateEventRequest) => {
    return makeRequest<EventResponse>('/api/calendar/events', 'PATCH', eventData);
  };

  const deleteEvent = (eventData: DeleteEventRequest) => {
    return makeRequest<SuccessResponse>('/api/calendar/events', 'DELETE', eventData);
  };

  // Helper method to fetch events from multiple calendars
  const getEventsFromMultipleCalendars = async (calendarIds: string[], params?: Omit<GetEventsParams, 'calendarId'>): Promise<EventsResponse | ApiError> => {
    try {
      const promises = calendarIds.map(calendarId => 
        getEvents({ ...params, calendarId })
      );
      
      const responses = await Promise.all(promises);
      
      // Check if any response is an error
      const errorResponse = responses.find(response => 'error' in response);
      if (errorResponse) {
        return errorResponse as ApiError;
      }
      
      // Combine all events from all calendars and add calendarId to each event
      const allEvents = responses.flatMap((response, index) => 
        'events' in response ? response.events.map(event => ({
          ...event,
          calendarId: calendarIds[index] // Add the calendarId to each event
        })) : []
      );
      
      // Sort events by start time
      allEvents.sort((a, b) => {
        const aTime = new Date(a.start.dateTime || a.start.date || 0).getTime();
        const bTime = new Date(b.start.dateTime || b.start.date || 0).getTime();
        return aTime - bTime;
      });
      
      return { events: allEvents };
    } catch (error: any) {
      return { error: error.message || 'Failed to fetch events from multiple calendars' };
    }
  };

  // Helper methods from docs
  const getTodayEvents = async (calendarId?: string) => {
    const today = new Date();
    const timeMin = new Date(today.setHours(0, 0, 0, 0)).toISOString();
    const timeMax = new Date(today.setHours(23, 59, 59, 999)).toISOString();
    
    if (calendarId) {
      return getEvents({ calendarId, timeMin, timeMax, singleEvents: true, orderBy: 'startTime' });
    }
    
    // Fetch from all selected calendars
    const selectedCalendars = await loadCalendarSettings();
    return getEventsFromMultipleCalendars(selectedCalendars, { timeMin, timeMax, singleEvents: true, orderBy: 'startTime' });
  };

  const getWeekEvents = async (calendarId?: string) => {
    const today = new Date();
    const currentDay = today.getDay(); // 0 (Sun) - 6 (Sat)
    const firstDayOfWeek = new Date(today);
    firstDayOfWeek.setDate(today.getDate() - (currentDay === 0 ? 6 : currentDay - 1)); // Adjust for Monday start
    firstDayOfWeek.setHours(0, 0, 0, 0);

    const lastDayOfWeek = new Date(firstDayOfWeek);
    lastDayOfWeek.setDate(firstDayOfWeek.getDate() + 6);
    lastDayOfWeek.setHours(23, 59, 59, 999);

    if (calendarId) {
      return getEvents({
        calendarId,
        timeMin: firstDayOfWeek.toISOString(),
        timeMax: lastDayOfWeek.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });
    }
    
    // Fetch from all selected calendars
    const selectedCalendars = await loadCalendarSettings();
    return getEventsFromMultipleCalendars(selectedCalendars, {
      timeMin: firstDayOfWeek.toISOString(),
      timeMax: lastDayOfWeek.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });
  };

  const searchEvents = (query: string, calendarId: string = 'primary') => {
    return getEvents({ calendarId, q: query });
  };

  const createQuickEvent = (
    summary: string,
    startTime: Date,
    durationMinutes: number,
    calendarId: string = 'primary'
  ) => {
    const endTime = new Date(startTime.getTime() + durationMinutes * 60000);
    return createEvent({
      calendarId,
      summary,
      start: { dateTime: startTime.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      end: { dateTime: endTime.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    });
  };

  const createAllDayEvent = (
    summary: string,
    date: Date,
    calendarId: string = 'primary'
  ) => {
    const startDate = new Date(date.setHours(0,0,0,0));
    const endDate = new Date(date.setHours(0,0,0,0));
    endDate.setDate(date.getDate() + 1);

    return createEvent({
      calendarId,
      summary,
      start: { date: startDate.toISOString().split('T')[0] }, // YYYY-MM-DD
      end: { date: endDate.toISOString().split('T')[0] },     // YYYY-MM-DD
    });
  };

  const moveEvent = (
    eventId: string,
    newStartTime: Date,
    newEndTime: Date,
    calendarId: string = 'primary'
  ) => {
    return updateEvent({
      calendarId,
      eventId,
      start: { dateTime: newStartTime.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      end: { dateTime: newEndTime.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    });
  };

  return {
    getCalendars,
    getEvents,
    getEvent,
    createEvent,
    updateEvent,
    deleteEvent,
    getTodayEvents,
    getWeekEvents,
    searchEvents,
    createQuickEvent,
    createAllDayEvent,
    moveEvent,
    getEventsFromMultipleCalendars,
  };
}; 