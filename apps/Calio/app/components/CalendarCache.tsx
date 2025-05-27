import React, { createContext, useCallback, useContext, useReducer, useRef } from 'react';
import { Event as ApiEvent } from '../api/calendar/types';

interface CalendarCache {
  events: {
    today: ApiEvent[];
    week: ApiEvent[];
    lastFetchToday: number | null;
    lastFetchWeek: number | null;
  };
  calendars: {
    list: any[];
    lastFetch: number | null;
  };
  isLoading: {
    today: boolean;
    week: boolean;
    calendars: boolean;
  };
}

interface CalendarCacheAction {
  type: 'SET_TODAY_EVENTS' | 'SET_WEEK_EVENTS' | 'SET_CALENDARS' | 'SET_LOADING' | 'CLEAR_CACHE';
  payload?: any;
}

const initialState: CalendarCache = {
  events: {
    today: [],
    week: [],
    lastFetchToday: null,
    lastFetchWeek: null,
  },
  calendars: {
    list: [],
    lastFetch: null,
  },
  isLoading: {
    today: false,
    week: false,
    calendars: false,
  },
};

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache

function calendarCacheReducer(state: CalendarCache, action: CalendarCacheAction): CalendarCache {
  switch (action.type) {
    case 'SET_TODAY_EVENTS':
      return {
        ...state,
        events: {
          ...state.events,
          today: action.payload,
          lastFetchToday: Date.now(),
        },
        isLoading: {
          ...state.isLoading,
          today: false,
        },
      };
    case 'SET_WEEK_EVENTS':
      return {
        ...state,
        events: {
          ...state.events,
          week: action.payload,
          lastFetchWeek: Date.now(),
        },
        isLoading: {
          ...state.isLoading,
          week: false,
        },
      };
    case 'SET_CALENDARS':
      return {
        ...state,
        calendars: {
          list: action.payload,
          lastFetch: Date.now(),
        },
        isLoading: {
          ...state.isLoading,
          calendars: false,
        },
      };
    case 'SET_LOADING':
      return {
        ...state,
        isLoading: {
          ...state.isLoading,
          [action.payload.type]: action.payload.loading,
        },
      };
    case 'CLEAR_CACHE':
      return initialState;
    default:
      return state;
  }
}

interface CalendarCacheContextType {
  cache: CalendarCache;
  getTodayEvents: () => ApiEvent[];
  getWeekEvents: () => ApiEvent[];
  getCalendars: () => any[];
  setTodayEvents: (events: ApiEvent[]) => void;
  setWeekEvents: (events: ApiEvent[]) => void;
  setCalendars: (calendars: any[]) => void;
  setLoading: (type: 'today' | 'week' | 'calendars', loading: boolean) => void;
  isCacheValid: (type: 'today' | 'week' | 'calendars') => boolean;
  clearCache: () => void;
  isLoading: (type: 'today' | 'week' | 'calendars') => boolean;
}

const CalendarCacheContext = createContext<CalendarCacheContextType | undefined>(undefined);

export function CalendarCacheProvider({ children }: { children: React.ReactNode }) {
  const [cache, dispatch] = useReducer(calendarCacheReducer, initialState);
  const backgroundFetchRef = useRef<{ [key: string]: boolean }>({});

  const isCacheValid = useCallback((type: 'today' | 'week' | 'calendars'): boolean => {
    const now = Date.now();
    switch (type) {
      case 'today':
        return !!(cache.events.lastFetchToday && (now - cache.events.lastFetchToday) < CACHE_DURATION);
      case 'week':
        return !!(cache.events.lastFetchWeek && (now - cache.events.lastFetchWeek) < CACHE_DURATION);
      case 'calendars':
        return !!(cache.calendars.lastFetch && (now - cache.calendars.lastFetch) < CACHE_DURATION);
      default:
        return false;
    }
  }, [cache]);

  const getTodayEvents = useCallback(() => {
    return cache.events.today;
  }, [cache.events.today]);

  const getWeekEvents = useCallback(() => {
    return cache.events.week;
  }, [cache.events.week]);

  const getCalendars = useCallback(() => {
    return cache.calendars.list;
  }, [cache.calendars.list]);

  const setTodayEvents = useCallback((events: ApiEvent[]) => {
    dispatch({ type: 'SET_TODAY_EVENTS', payload: events });
  }, []);

  const setWeekEvents = useCallback((events: ApiEvent[]) => {
    dispatch({ type: 'SET_WEEK_EVENTS', payload: events });
  }, []);

  const setCalendars = useCallback((calendars: any[]) => {
    dispatch({ type: 'SET_CALENDARS', payload: calendars });
  }, []);

  const setLoading = useCallback((type: 'today' | 'week' | 'calendars', loading: boolean) => {
    dispatch({ type: 'SET_LOADING', payload: { type, loading } });
  }, []);

  const clearCache = useCallback(() => {
    dispatch({ type: 'CLEAR_CACHE' });
    backgroundFetchRef.current = {};
  }, []);

  const isLoading = useCallback((type: 'today' | 'week' | 'calendars') => {
    return cache.isLoading[type];
  }, [cache.isLoading]);

  const value: CalendarCacheContextType = {
    cache,
    getTodayEvents,
    getWeekEvents,
    getCalendars,
    setTodayEvents,
    setWeekEvents,
    setCalendars,
    setLoading,
    isCacheValid,
    clearCache,
    isLoading,
  };

  return (
    <CalendarCacheContext.Provider value={value}>
      {children}
    </CalendarCacheContext.Provider>
  );
}

export function useCalendarCache() {
  const context = useContext(CalendarCacheContext);
  if (context === undefined) {
    throw new Error('useCalendarCache must be used within a CalendarCacheProvider');
  }
  return context;
} 