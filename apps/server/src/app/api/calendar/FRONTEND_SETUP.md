# 🚀 React Native/Expo Calendar API Setup Guide

## Quick Start

Your calendar API is ready for React Native/Expo! Here's everything your mobile app developer needs to get started.

## 📁 File Structure Created

```
src/app/api/calendar/
├── README.md              # Complete API documentation
├── FRONTEND_SETUP.md      # This file - React Native setup guide
├── types.ts               # TypeScript types (copy to RN project)
├── client.ts              # React Native SDK (copy to RN project)
├── utils/
│   └── auth.ts           # Shared auth utilities
├── calendars/
│   └── route.ts          # GET /api/calendar/calendars
├── events/
│   ├── route.ts          # CRUD operations for events
│   └── [eventId]/
│       └── route.ts      # GET specific event
```

## 🔧 React Native/Expo Integration (4 Steps)

### Step 1: Install Dependencies
```bash
# Core dependencies for Expo
npx expo install @clerk/clerk-expo

# For secure token storage
npx expo install expo-secure-store

# For network requests (if not already installed)
npm install axios  # or use fetch (built-in)
```

### Step 2: Copy Files to React Native Project
Copy these files to your React Native project:
- `types.ts` - TypeScript types
- `client.ts` - API client SDK (React Native compatible)

### Step 3: Configure Clerk in Your App

```typescript
// App.tsx or your root component
import { ClerkProvider } from '@clerk/clerk-expo';
import { tokenCache } from './utils/cache';

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

export default function App() {
  return (
    <ClerkProvider 
      tokenCache={tokenCache} 
      publishableKey={publishableKey}
    >
      {/* Your app components */}
    </ClerkProvider>
  );
}
```

Create `utils/cache.ts`:
```typescript
import * as SecureStore from 'expo-secure-store';
import { TokenCache } from '@clerk/clerk-expo/dist/cache';

const createTokenCache = (): TokenCache => {
  return {
    async getToken(key: string) {
      try {
        return SecureStore.getItemAsync(key);
      } catch (err) {
        return null;
      }
    },
    async saveToken(key: string, value: string) {
      try {
        return SecureStore.setItemAsync(key, value);
      } catch (err) {
        return;
      }
    },
  };
};

export const tokenCache = createTokenCache();
```

### Step 4: Use the API Client in React Native

```typescript
import { useAuth } from '@clerk/clerk-expo';
import { createCalendarClient } from './path/to/client';

function MyCalendarScreen() {
  const { getToken } = useAuth();
  const calendarClient = createCalendarClient(getToken, 'https://your-api-domain.com');

  // Get calendars
  const calendars = await calendarClient.getCalendars();
  
  // Get today's events
  const todayEvents = await calendarClient.getTodayEvents();
  
  // Create an event
  const newEvent = await calendarClient.createEvent({
    summary: "Meeting",
    start: { dateTime: "2025-05-27T10:00:00Z" },
    end: { dateTime: "2025-05-27T11:00:00Z" }
  });
}
```

## 🎯 Available API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/calendar/calendars` | List user's calendars |
| `GET` | `/api/calendar/events` | List events (with filters) |
| `GET` | `/api/calendar/events/[id]` | Get specific event |
| `POST` | `/api/calendar/events` | Create new event |
| `PATCH` | `/api/calendar/events` | Update existing event |
| `DELETE` | `/api/calendar/events` | Delete event |

## 🔐 Authentication for React Native

All endpoints require Clerk Bearer token:
```typescript
import { useAuth } from '@clerk/clerk-expo';

function useApiCall() {
  const { getToken } = useAuth();
  
  const makeAuthenticatedRequest = async (endpoint: string, options = {}) => {
    const token = await getToken();
    
    return fetch(`https://your-api-domain.com${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
  };
  
  return { makeAuthenticatedRequest };
}
```

## 📋 Common Use Cases for Mobile

### Display Calendar Events
```typescript
// Get this week's events
const events = await calendarClient.getWeekEvents('primary');

// Search for specific events
const meetings = await calendarClient.searchEvents('meeting');
```

### Create Events
```typescript
// Quick 1-hour meeting
await calendarClient.createQuickEvent(
  "Team Standup", 
  new Date("2025-05-27T09:00:00"), 
  60  // duration in minutes
);

// All-day event
await calendarClient.createAllDayEvent(
  "Conference", 
  new Date("2025-05-30")
);
```

### Update Events
```typescript
// Move event to different time
await calendarClient.moveEvent(
  "event-id-123",
  new Date("2025-05-27T14:00:00"),  // new start time
  new Date("2025-05-27T15:00:00")   // new end time
);
```

## 🛠️ Error Handling for React Native

```typescript
import { isApiError } from './types';

const response = await calendarClient.getEvents();

if (isApiError(response)) {
  // Show error to user (Toast, Alert, etc.)
  Alert.alert('Error', response.error);
} else {
  // Use the data
  console.log('Events:', response.events);
}
```

## 📱 React Native Component Example

```tsx
import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, Alert, ActivityIndicator } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import { createCalendarClient, isApiError } from './calendar-api';

export function CalendarScreen() {
  const { getToken } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadEvents() {
      try {
        const client = createCalendarClient(getToken, 'https://your-api-domain.com');
        const response = await client.getWeekEvents();
        
        if (isApiError(response)) {
          Alert.alert('Error', 'Failed to load events: ' + response.error);
        } else {
          setEvents(response.events);
        }
      } catch (error) {
        Alert.alert('Error', 'Network error occurred');
      } finally {
        setLoading(false);
      }
    }
    
    loadEvents();
  }, [getToken]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
        <Text>Loading calendar...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 16 }}>
        My Calendar
      </Text>
      
      <FlatList
        data={events}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ 
            padding: 12, 
            marginBottom: 8, 
            backgroundColor: '#f5f5f5', 
            borderRadius: 8 
          }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold' }}>
              {item.summary}
            </Text>
            {item.description && (
              <Text style={{ marginTop: 4, color: '#666' }}>
                {item.description}
              </Text>
            )}
            <Text style={{ marginTop: 4, color: '#888' }}>
              {new Date(item.start?.dateTime || item.start?.date).toLocaleString()}
            </Text>
            {item.location && (
              <Text style={{ marginTop: 4, color: '#888' }}>
                📍 {item.location}
              </Text>
            )}
          </View>
        )}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', marginTop: 32, color: '#666' }}>
            No events found
          </Text>
        }
      />
    </View>
  );
}
```

## 🚨 Important Notes for React Native/Expo

1. **Base URL Required**: Unlike web apps, you need to provide the full API URL:
   ```typescript
   const client = createCalendarClient(getToken, 'https://your-api-domain.com');
   ```

2. **Authentication**: Use `@clerk/clerk-expo` instead of `@clerk/nextjs`

3. **Secure Storage**: Use `expo-secure-store` for token caching

4. **Network Requests**: The client uses `fetch` which is available in React Native

5. **Error Handling**: Use `Alert.alert()` or Toast notifications for user feedback

6. **Time Zones**: React Native handles time zones differently - test thoroughly

7. **Permissions**: No special permissions needed for API calls, but consider calendar permissions for native features

## 📖 Environment Variables

Add to your `.env` file:
```bash
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
EXPO_PUBLIC_API_BASE_URL=https://your-api-domain.com
```

Use in your app:
```typescript
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;
const client = createCalendarClient(getToken, API_BASE_URL);
```

## 🔄 State Management Integration

### With Redux Toolkit:
```typescript
// calendarSlice.ts
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

export const fetchEvents = createAsyncThunk(
  'calendar/fetchEvents',
  async (_, { getState }) => {
    const { getToken } = useAuth();
    const client = createCalendarClient(getToken, API_BASE_URL);
    const response = await client.getWeekEvents();
    
    if (isApiError(response)) {
      throw new Error(response.error);
    }
    
    return response.events;
  }
);
```

### With Zustand:
```typescript
// calendarStore.ts
import { create } from 'zustand';

interface CalendarStore {
  events: Event[];
  loading: boolean;
  fetchEvents: (getToken: () => Promise<string>) => Promise<void>;
}

export const useCalendarStore = create<CalendarStore>((set) => ({
  events: [],
  loading: false,
  fetchEvents: async (getToken) => {
    set({ loading: true });
    try {
      const client = createCalendarClient(getToken, API_BASE_URL);
      const response = await client.getWeekEvents();
      
      if (!isApiError(response)) {
        set({ events: response.events });
      }
    } finally {
      set({ loading: false });
    }
  },
}));
```

## 📖 Full Documentation

See `README.md` for complete API documentation with all parameters, response formats, and advanced examples.

## 🆘 Need Help?

- Check the `README.md` for detailed documentation
- All endpoints return consistent error messages
- TypeScript types provide IntelliSense support
- Test endpoints with tools like Postman or Expo's network debugging

Your React Native calendar API integration is ready! 🎉📱 