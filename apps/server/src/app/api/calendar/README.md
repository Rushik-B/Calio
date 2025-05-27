# Calendar API Documentation

This directory provides comprehensive Google Calendar API endpoints for frontend applications. All endpoints require proper authentication using Clerk tokens.

**📱 For React Native/Expo apps**: See `FRONTEND_SETUP.md` for mobile-specific setup instructions.

## Authentication

All API endpoints require a Bearer token in the Authorization header:

**Web React:**
```javascript
const token = await getToken(); // Get from Clerk
const headers = {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json'
};
```

**React Native/Expo:**
```typescript
import { useAuth } from '@clerk/clerk-expo';

const { getToken } = useAuth();
const token = await getToken();
const headers = {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json'
};
```

## Base URL

**Web React:** `/api/calendar`

**React Native/Expo:** `https://your-api-domain.com/api/calendar`

---

## 📅 Calendar Management

### GET `/api/calendar/calendars`
Get list of user's calendars.

**Response:**
```json
{
  "calendars": [
    {
      "id": "primary",
      "summary": "Your Name",
      "primary": true,
      "accessRole": "owner"
    },
    {
      "id": "calendar-id-2",
      "summary": "Work Calendar",
      "primary": false,
      "accessRole": "owner"
    }
  ]
}
```

**Frontend Usage:**
```javascript
async function getCalendars() {
  const token = await getToken();
  const response = await fetch('/api/calendar/calendars', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  const data = await response.json();
  return data.calendars;
}
```

**React Native Usage:**
```typescript
import { useAuth } from '@clerk/clerk-expo';

async function getCalendars() {
  const { getToken } = useAuth();
  const token = await getToken();
  const response = await fetch('https://your-api-domain.com/api/calendar/calendars', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  const data = await response.json();
  return data.calendars;
}
```

---

## 📝 Event Management

### GET `/api/calendar/events`
List events from calendars.

**Query Parameters:**
- `calendarId` (optional): Calendar ID (default: 'primary')
- `timeMin` (optional): Start time (ISO 8601)
- `timeMax` (optional): End time (ISO 8601)
- `q` (optional): Search query
- `maxResults` (optional): Max events to return (1-2500)
- `singleEvents` (optional): Expand recurring events (default: true)
- `orderBy` (optional): 'startTime' or 'updated'
- `timeZone` (optional): Time zone for the request

**Response:**
```json
{
  "events": [
    {
      "id": "event-id-1",
      "summary": "Meeting with Team",
      "description": "Weekly team sync",
      "location": "Conference Room A",
      "start": {
        "dateTime": "2025-05-26T10:00:00-07:00",
        "timeZone": "America/Vancouver"
      },
      "end": {
        "dateTime": "2025-05-26T11:00:00-07:00",
        "timeZone": "America/Vancouver"
      },
      "attendees": [
        {
          "email": "colleague@example.com",
          "displayName": "Colleague Name"
        }
      ],
      "htmlLink": "https://calendar.google.com/...",
      "created": "2025-05-20T10:00:00Z",
      "updated": "2025-05-20T10:00:00Z"
    }
  ]
}
```

**Frontend Usage:**
```javascript
async function getEvents(options = {}) {
  const token = await getToken();
  const params = new URLSearchParams();
  
  // Add optional parameters
  if (options.calendarId) params.append('calendarId', options.calendarId);
  if (options.timeMin) params.append('timeMin', options.timeMin);
  if (options.timeMax) params.append('timeMax', options.timeMax);
  if (options.q) params.append('q', options.q);
  if (options.maxResults) params.append('maxResults', options.maxResults.toString());
  
  const response = await fetch(`/api/calendar/events?${params}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  const data = await response.json();
  return data.events;
}

// Example: Get events for today
const today = new Date();
const tomorrow = new Date(today);
tomorrow.setDate(tomorrow.getDate() + 1);

const todayEvents = await getEvents({
  timeMin: today.toISOString(),
  timeMax: tomorrow.toISOString(),
  calendarId: 'primary'
});
```

### GET `/api/calendar/events/[eventId]`
Get a specific event by ID.

**Query Parameters:**
- `calendarId` (optional): Calendar ID (default: 'primary')

**Response:**
```json
{
  "event": {
    "id": "event-id-1",
    "summary": "Meeting with Team",
    // ... full event object
  }
}
```

**Frontend Usage:**
```javascript
async function getEvent(eventId, calendarId = 'primary') {
  const token = await getToken();
  const response = await fetch(`/api/calendar/events/${eventId}?calendarId=${calendarId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  const data = await response.json();
  return data.event;
}
```

### POST `/api/calendar/events`
Create a new event.

**Request Body:**
```json
{
  "calendarId": "primary", // optional
  "summary": "New Meeting",
  "description": "Meeting description", // optional
  "location": "Conference Room B", // optional
  "start": {
    "dateTime": "2025-05-26T14:00:00-07:00",
    "timeZone": "America/Vancouver"
  },
  "end": {
    "dateTime": "2025-05-26T15:00:00-07:00",
    "timeZone": "America/Vancouver"
  },
  "attendees": [ // optional
    {
      "email": "attendee@example.com",
      "displayName": "Attendee Name"
    }
  ],
  "reminders": { // optional
    "useDefault": false,
    "overrides": [
      {
        "method": "email",
        "minutes": 1440 // 24 hours before
      },
      {
        "method": "popup",
        "minutes": 15
      }
    ]
  },
  "recurrence": [ // optional
    "RRULE:FREQ=WEEKLY;BYDAY=MO"
  ]
}
```

**Response:**
```json
{
  "event": {
    "id": "newly-created-event-id",
    "summary": "New Meeting",
    // ... full created event object
  }
}
```

**Frontend Usage:**
```javascript
async function createEvent(eventData) {
  const token = await getToken();
  const response = await fetch('/api/calendar/events', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(eventData)
  });
  const data = await response.json();
  return data.event;
}

// Example: Create a simple meeting
const newEvent = await createEvent({
  summary: "Team Standup",
  start: {
    dateTime: "2025-05-27T09:00:00-07:00",
    timeZone: "America/Vancouver"
  },
  end: {
    dateTime: "2025-05-27T09:30:00-07:00",
    timeZone: "America/Vancouver"
  },
  location: "Zoom",
  description: "Daily team standup meeting"
});
```

### PATCH `/api/calendar/events`
Update an existing event.

**Request Body:**
```json
{
  "calendarId": "primary", // optional
  "eventId": "event-id-to-update",
  "summary": "Updated Meeting Title", // optional
  "description": "Updated description", // optional
  "location": "New Location", // optional
  "start": { // optional
    "dateTime": "2025-05-26T15:00:00-07:00",
    "timeZone": "America/Vancouver"
  },
  "end": { // optional
    "dateTime": "2025-05-26T16:00:00-07:00",
    "timeZone": "America/Vancouver"
  }
  // ... other fields to update
}
```

**Response:**
```json
{
  "event": {
    "id": "event-id-to-update",
    // ... updated event object
  }
}
```

**Frontend Usage:**
```javascript
async function updateEvent(eventId, updates, calendarId = 'primary') {
  const token = await getToken();
  const response = await fetch('/api/calendar/events', {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      eventId,
      calendarId,
      ...updates
    })
  });
  const data = await response.json();
  return data.event;
}

// Example: Update event time
const updatedEvent = await updateEvent('event-id-123', {
  start: {
    dateTime: "2025-05-27T10:00:00-07:00",
    timeZone: "America/Vancouver"
  },
  end: {
    dateTime: "2025-05-27T11:00:00-07:00",
    timeZone: "America/Vancouver"
  }
});
```

### DELETE `/api/calendar/events`
Delete an event.

**Request Body:**
```json
{
  "calendarId": "primary", // optional
  "eventId": "event-id-to-delete"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Event deleted successfully"
}
```

**Frontend Usage:**
```javascript
async function deleteEvent(eventId, calendarId = 'primary') {
  const token = await getToken();
  const response = await fetch('/api/calendar/events', {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      eventId,
      calendarId
    })
  });
  const data = await response.json();
  return data.success;
}
```

---

## 🛠️ Complete Frontend Calendar Component Examples

### Web React Component

Here's a complete React component example using these APIs:

```javascript
import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';

function CalendarComponent() {
  const { getToken } = useAuth();
  const [calendars, setCalendars] = useState([]);
  const [events, setEvents] = useState([]);
  const [selectedCalendar, setSelectedCalendar] = useState('primary');
  const [loading, setLoading] = useState(false);

  // Fetch calendars on component mount
  useEffect(() => {
    fetchCalendars();
  }, []);

  // Fetch events when calendar selection changes
  useEffect(() => {
    if (selectedCalendar) {
      fetchEvents();
    }
  }, [selectedCalendar]);

  const fetchCalendars = async () => {
    try {
      const token = await getToken();
      const response = await fetch('/api/calendar/calendars', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setCalendars(data.calendars || []);
    } catch (error) {
      console.error('Error fetching calendars:', error);
    }
  };

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const today = new Date();
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);

      const params = new URLSearchParams({
        calendarId: selectedCalendar,
        timeMin: today.toISOString(),
        timeMax: nextWeek.toISOString(),
        maxResults: '50',
        singleEvents: 'true',
        orderBy: 'startTime'
      });

      const response = await fetch(`/api/calendar/events?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setEvents(data.events || []);
    } catch (error) {
      console.error('Error fetching events:', error);
    } finally {
      setLoading(false);
    }
  };

  const createEvent = async (eventData) => {
    try {
      const token = await getToken();
      const response = await fetch('/api/calendar/events', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...eventData,
          calendarId: selectedCalendar
        })
      });
      const data = await response.json();
      
      if (data.event) {
        // Refresh events list
        fetchEvents();
        return data.event;
      }
    } catch (error) {
      console.error('Error creating event:', error);
    }
  };

  const deleteEvent = async (eventId) => {
    try {
      const token = await getToken();
      const response = await fetch('/api/calendar/events', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          eventId,
          calendarId: selectedCalendar
        })
      });
      const data = await response.json();
      
      if (data.success) {
        // Refresh events list
        fetchEvents();
      }
    } catch (error) {
      console.error('Error deleting event:', error);
    }
  };

  return (
    <div className="calendar-component">
      <h2>My Calendar</h2>
      
      {/* Calendar Selector */}
      <div className="calendar-selector">
        <label>Select Calendar:</label>
        <select 
          value={selectedCalendar} 
          onChange={(e) => setSelectedCalendar(e.target.value)}
        >
          {calendars.map(cal => (
            <option key={cal.id} value={cal.id}>
              {cal.summary} {cal.primary ? '(Primary)' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Events List */}
      <div className="events-list">
        <h3>Upcoming Events</h3>
        {loading ? (
          <p>Loading events...</p>
        ) : (
          <ul>
            {events.map(event => (
              <li key={event.id} className="event-item">
                <div>
                  <strong>{event.summary}</strong>
                  <p>{event.description}</p>
                  <p>
                    {new Date(event.start?.dateTime || event.start?.date).toLocaleString()}
                  </p>
                  {event.location && <p>📍 {event.location}</p>}
                </div>
                <button onClick={() => deleteEvent(event.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Quick Event Creator */}
      <div className="quick-create">
        <h3>Quick Create Event</h3>
        <button onClick={() => {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          tomorrow.setHours(14, 0, 0, 0);
          
          const endTime = new Date(tomorrow);
          endTime.setHours(15, 0, 0, 0);
          
          createEvent({
            summary: "Quick Meeting",
            start: {
              dateTime: tomorrow.toISOString(),
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
            },
            end: {
              dateTime: endTime.toISOString(),
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
            }
          });
        }}>
          Create Test Event Tomorrow 2PM
        </button>
      </div>
    </div>
  );
}

export default CalendarComponent;
```

### React Native/Expo Component

Here's the same functionality for React Native:

```tsx
import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  FlatList, 
  TouchableOpacity, 
  Alert, 
  ActivityIndicator,
  StyleSheet 
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useAuth } from '@clerk/clerk-expo';

const API_BASE_URL = 'https://your-api-domain.com'; // Replace with your API domain

export function CalendarScreen() {
  const { getToken } = useAuth();
  const [calendars, setCalendars] = useState([]);
  const [events, setEvents] = useState([]);
  const [selectedCalendar, setSelectedCalendar] = useState('primary');
  const [loading, setLoading] = useState(false);

  // Fetch calendars on component mount
  useEffect(() => {
    fetchCalendars();
  }, []);

  // Fetch events when calendar selection changes
  useEffect(() => {
    if (selectedCalendar) {
      fetchEvents();
    }
  }, [selectedCalendar]);

  const fetchCalendars = async () => {
    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/api/calendar/calendars`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setCalendars(data.calendars || []);
    } catch (error) {
      Alert.alert('Error', 'Failed to fetch calendars');
    }
  };

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const today = new Date();
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);

      const params = new URLSearchParams({
        calendarId: selectedCalendar,
        timeMin: today.toISOString(),
        timeMax: nextWeek.toISOString(),
        maxResults: '50',
        singleEvents: 'true',
        orderBy: 'startTime'
      });

      const response = await fetch(`${API_BASE_URL}/api/calendar/events?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setEvents(data.events || []);
    } catch (error) {
      Alert.alert('Error', 'Failed to fetch events');
    } finally {
      setLoading(false);
    }
  };

  const createQuickEvent = async () => {
    try {
      const token = await getToken();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(14, 0, 0, 0);
      
      const endTime = new Date(tomorrow);
      endTime.setHours(15, 0, 0, 0);
      
      const response = await fetch(`${API_BASE_URL}/api/calendar/events`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          calendarId: selectedCalendar,
          summary: "Quick Meeting",
          start: {
            dateTime: tomorrow.toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
          },
          end: {
            dateTime: endTime.toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
          }
        })
      });
      const data = await response.json();
      
      if (data.event) {
        Alert.alert('Success', 'Event created successfully!');
        fetchEvents(); // Refresh events list
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to create event');
    }
  };

  const deleteEvent = async (eventId) => {
    Alert.alert(
      'Delete Event',
      'Are you sure you want to delete this event?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            try {
              const token = await getToken();
              const response = await fetch(`${API_BASE_URL}/api/calendar/events`, {
                method: 'DELETE',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  eventId,
                  calendarId: selectedCalendar
                })
              });
              const data = await response.json();
              
              if (data.success) {
                Alert.alert('Success', 'Event deleted successfully!');
                fetchEvents(); // Refresh events list
              }
            } catch (error) {
              Alert.alert('Error', 'Failed to delete event');
            }
          }
        }
      ]
    );
  };

  const renderEvent = ({ item }) => (
    <View style={styles.eventItem}>
      <View style={styles.eventContent}>
        <Text style={styles.eventTitle}>{item.summary}</Text>
        {item.description && (
          <Text style={styles.eventDescription}>{item.description}</Text>
        )}
        <Text style={styles.eventTime}>
          {new Date(item.start?.dateTime || item.start?.date).toLocaleString()}
        </Text>
        {item.location && (
          <Text style={styles.eventLocation}>📍 {item.location}</Text>
        )}
      </View>
      <TouchableOpacity 
        style={styles.deleteButton}
        onPress={() => deleteEvent(item.id)}
      >
        <Text style={styles.deleteButtonText}>Delete</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Calendar</Text>
      
      {/* Calendar Selector */}
      <View style={styles.pickerContainer}>
        <Text style={styles.pickerLabel}>Select Calendar:</Text>
        <Picker
          selectedValue={selectedCalendar}
          onValueChange={setSelectedCalendar}
          style={styles.picker}
        >
          {calendars.map(cal => (
            <Picker.Item 
              key={cal.id} 
              label={`${cal.summary}${cal.primary ? ' (Primary)' : ''}`} 
              value={cal.id} 
            />
          ))}
        </Picker>
      </View>

      {/* Quick Create Button */}
      <TouchableOpacity style={styles.createButton} onPress={createQuickEvent}>
        <Text style={styles.createButtonText}>Create Test Event Tomorrow 2PM</Text>
      </TouchableOpacity>

      {/* Events List */}
      <Text style={styles.sectionTitle}>Upcoming Events</Text>
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading events...</Text>
        </View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(item) => item.id}
          renderItem={renderEvent}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No events found</Text>
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  pickerContainer: {
    marginBottom: 16,
  },
  pickerLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  picker: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  createButton: {
    backgroundColor: '#007AFF',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  createButtonText: {
    color: '#fff',
    textAlign: 'center',
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 8,
    color: '#666',
  },
  eventItem: {
    flexDirection: 'row',
    padding: 12,
    marginBottom: 8,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    alignItems: 'center',
  },
  eventContent: {
    flex: 1,
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  eventDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  eventTime: {
    fontSize: 14,
    color: '#888',
    marginBottom: 2,
  },
  eventLocation: {
    fontSize: 14,
    color: '#888',
  },
  deleteButton: {
    backgroundColor: '#FF3B30',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 32,
    color: '#666',
    fontSize: 16,
  },
});

export default CalendarScreen;
```

---

## 🚨 Error Handling

All endpoints return consistent error responses:

```json
{
  "error": "Error message",
  "details": {} // Optional validation details for 400 errors
}
```

**Common HTTP Status Codes:**
- `200`: Success
- `201`: Created (for POST requests)
- `400`: Bad Request (validation errors)
- `401`: Unauthorized (invalid/missing token)
- `403`: Forbidden (missing Google OAuth permissions)
- `404`: Not Found (event doesn't exist)
- `500`: Internal Server Error

**Frontend Error Handling:**
```javascript
async function apiCall() {
  try {
    const response = await fetch('/api/calendar/events');
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'API request failed');
    }
    
    return await response.json();
  } catch (error) {
    console.error('API Error:', error.message);
    // Handle error in UI
  }
}
```

---

## 📋 TypeScript Types

For TypeScript projects, here are the key types:

```typescript
interface Calendar {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
}

interface EventDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

interface Attendee {
  email: string;
  displayName?: string;
}

interface Reminder {
  method: 'email' | 'popup';
  minutes: number;
}

interface Event {
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
}

interface CreateEventRequest {
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
```

---

## 🔧 Tips for Frontend Development

1. **Always handle authentication errors** - Redirect to login when you get 401 responses
2. **Cache calendar lists** - They don't change often, so cache them locally
3. **Use proper date handling** - Always work with ISO 8601 strings for API calls
4. **Implement loading states** - Calendar operations can take time
5. **Handle time zones properly** - Use the user's local timezone for display
6. **Batch operations when possible** - For multiple events, consider batching requests
7. **Implement optimistic updates** - Update UI immediately, then sync with server
8. **Add proper error boundaries** - Calendar operations can fail for various reasons

This API provides everything you need to build a full-featured calendar interface! 🚀 