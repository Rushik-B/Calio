import { useAuth } from '@clerk/clerk-expo';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { createCalendarClient } from '../api/calendar/client';
import { Event as ApiEvent, isApiError } from '../api/calendar/types';
import { useCalendarCache } from '../components/CalendarCache';

const { width, height } = Dimensions.get('window');

interface ActionCard {
  id: string;
  type: 'completed' | 'conflict' | 'suggestion' | 'recap';
  icon: string;
  title: string;
  description: string;
  timestamp: Date;
  actions: Array<{
    label: string;
    type: 'primary' | 'secondary' | 'danger';
    onPress: () => void;
  }>;
}

interface DayEvent {
  id: string;
  title: string;
  time: string;
  duration: number; // in minutes
  type: 'meeting' | 'focus' | 'personal' | 'ai-managed' | 'general';
  startHour: number;
  color: string;
  calioEdited?: boolean;
  description?: string;
  location?: string;
}

// Show all 24 hours
const HOURS = Array.from({ length: 24 }, (_, i) => i); // 0 AM to 11 PM

// Calendar colors - different colors for different calendars
const CALENDAR_COLORS = [
  '#007AFF', // Blue
  '#34C759', // Green
  '#FF3B30', // Red
  '#FF9500', // Orange
  '#AF52DE', // Purple
  '#FF2D92', // Pink
  '#5AC8FA', // Light Blue
  '#FFCC00', // Yellow
  '#FF6B35', // Orange Red
  '#32D74B', // Light Green
];

// Helper function to get calendar color
const getCalendarColor = (calendarId: string | undefined, eventColor: string) => {
  if (!calendarId) return eventColor;
  
  // Create a simple hash from calendarId to get consistent color
  let hash = 0;
  for (let i = 0; i < calendarId.length; i++) {
    const char = calendarId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  const index = Math.abs(hash) % CALENDAR_COLORS.length;
  return CALENDAR_COLORS[index];
};

// Helper function to parse event time and calculate start hour and duration
const parseEventTime = (event: ApiEvent): { startHour: number; duration: number; timeString: string } => {
  const startTime = event.start.dateTime ? new Date(event.start.dateTime) : new Date(event.start.date || Date.now());
  const endTime = event.end.dateTime ? new Date(event.end.dateTime) : new Date(event.end.date || Date.now());

  if (event.start.date) { // All-day event
    return {
      startHour: 0, // Display at the top of the day
      duration: 24 * 60, // Full day
      timeString: 'All Day'
    };
  }

  const startHour = startTime.getHours() + startTime.getMinutes() / 60;
  const duration = (endTime.getTime() - startTime.getTime()) / (1000 * 60); // Duration in minutes
  
  const timeString = startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return { startHour, duration, timeString };
};

export default function TodayScreen() {
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(50));
  const { getToken, isSignedIn } = useAuth();
  const calendarScrollRef = useRef<ScrollView>(null);
  const isLoadingRef = useRef(false);
  
  // Use calendar cache
  const {
    getTodayEvents,
    setTodayEvents,
    setLoading,
    isCacheValid,
    isLoading: isCacheLoading,
  } = useCalendarCache();

  // Local state for UI events
  const [todayEvents, setTodayEventsLocal] = useState<DayEvent[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  // Stable calendar client - only recreate when auth state changes
  const calendarClient = useMemo(() => {
    if (!isSignedIn) return null;
    const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://your-api-domain.com';
    return createCalendarClient(getToken, API_BASE_URL);
  }, [isSignedIn]);

  const [actionCards] = useState<ActionCard[]>([
    {
      id: '1',
      type: 'conflict',
      icon: '⚠️',
      title: 'Potential conflict detected',
      description: 'Sam rescheduled to Friday; conflicts with focus time.',
      timestamp: new Date(Date.now() - 15 * 60 * 1000),
      actions: [
        { label: 'Fix', type: 'primary', onPress: () => console.log('Fix conflict') },
        { label: 'Ignore', type: 'secondary', onPress: () => console.log('Ignore conflict') },
      ],
    },
    {
      id: '2',
      type: 'completed',
      icon: '✅',
      title: 'Moved 2pm standup to 3pm',
      description: 'Notified team about the change. Reason: Conflict with focus time.',
      timestamp: new Date(Date.now() - 30 * 60 * 1000),
      actions: [
        { label: 'Undo', type: 'secondary', onPress: () => console.log('Undo move') },
        { label: 'Details', type: 'primary', onPress: () => console.log('Show details') },
      ],
    },
    {
      id: '3',
      type: 'completed',
      icon: '🛡️',
      title: 'Protected focus time 10-12pm',
      description: 'Blocked 2-hour deep work session. No meetings scheduled.',
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
      actions: [
        { label: 'Adjust', type: 'secondary', onPress: () => console.log('Adjust focus time') },
      ],
    },
    {
      id: '4',
      type: 'completed',
      icon: '💪',
      title: 'Gym moved to 7pm',
      description: 'Detected conflict at 5pm. Automatically rescheduled.',
      timestamp: new Date(Date.now() - 45 * 60 * 1000),
      actions: [
        { label: 'Undo', type: 'secondary', onPress: () => console.log('Undo gym move') },
        { label: 'OK', type: 'primary', onPress: () => console.log('Approve gym move') },
      ],
    },
  ]);

  const daySummary = "Hey Rushik! Today's looking pretty solid - I've carved out those deep work blocks you love in the morning when you're most focused. Moved your code review to 3pm since I noticed you prefer technical discussions after lunch. Your gym session is locked in at 7pm, giving you time to decompress after that project planning session. I'm keeping an eye on that potential conflict with Sam's meeting, but we've got options if needed. You've got good momentum building this week!";

  // Convert API events to UI events
  const convertApiEventsToUI = useCallback((apiEvents: ApiEvent[]): DayEvent[] => {
    return apiEvents.map(event => {
      const { startHour, duration, timeString } = parseEventTime(event);
      return {
        id: event.id,
        title: event.summary,
        time: timeString,
        duration: duration,
        type: event.type || 'general',
        startHour: startHour,
        color: getCalendarColor(event.calendarId, event.color || '#45B7D1'),
        calioEdited: event.calioEdited,
        description: event.description,
        location: event.location,
      };
    });
  }, []);

  // Initialize with cached data on mount
  useEffect(() => {
    if (!isInitialized) {
      const cachedEvents = getTodayEvents();
      if (cachedEvents.length > 0) {
        console.log('📱 Loading cached today events:', cachedEvents.length);
        const uiEvents = convertApiEventsToUI(cachedEvents);
        setTodayEventsLocal(uiEvents);
      }
      setIsInitialized(true);
    }
  }, [isInitialized, getTodayEvents, convertApiEventsToUI]);

  // Stable fetch function to prevent recreating on every render
  const fetchEvents = useCallback(async () => {
    if (!calendarClient || isLoadingRef.current) return;
    
    isLoadingRef.current = true;
    setLoading('today', true);
    
    try {
      console.log('🔄 Fetching today events from all selected calendars...');
      const response = await calendarClient.getTodayEvents();
      
      if (isApiError(response)) {
        console.error('❌ API Error:', response.error);
        Alert.alert('Error fetching events', response.error);
        setTodayEvents([]);
        setTodayEventsLocal([]);
      } else {
        console.log('✅ Events fetched successfully:', response.events.length, 'events from all selected calendars');
        
        // Update cache with API events
        setTodayEvents(response.events);
        
        // Convert to UI events for display
        const uiEvents = convertApiEventsToUI(response.events);
        setTodayEventsLocal(uiEvents);
      }
    } catch (error: any) {
      console.error('❌ Network Error:', error);
      Alert.alert('Error', error.message || 'Failed to load events.');
      setTodayEvents([]);
      setTodayEventsLocal([]);
    } finally {
      setLoading('today', false);
      isLoadingRef.current = false;
    }
  }, [calendarClient, setTodayEvents, setLoading, convertApiEventsToUI]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Fetch events only when calendar client is available and cache is invalid
  useEffect(() => {
    if (calendarClient && isInitialized && !isCacheValid('today') && !isLoadingRef.current) {
      console.log('📱 Cache invalid or first load, fetching events...');
      fetchEvents();
    }
  }, [calendarClient, isInitialized, isCacheValid, fetchEvents]);

  // Refresh events when screen comes into focus (e.g., returning from settings)
  useFocusEffect(
    useCallback(() => {
      if (calendarClient && isInitialized && !isCacheValid('today') && !isLoadingRef.current) {
        console.log('📱 Screen focused, cache invalid, refreshing events...');
        fetchEvents();
      }
    }, [calendarClient, isInitialized, isCacheValid, fetchEvents])
  );

  // Auto-scroll to current time when events are loaded
  useEffect(() => {
    if (!isCacheLoading('today') && calendarScrollRef.current) {
      const now = new Date();
      const currentHour = now.getHours();
      // Scroll to current hour, with some offset to show context
      const scrollPosition = Math.max(0, (currentHour - 2) * 60); // 60px per hour, show 2 hours before current
      setTimeout(() => {
        calendarScrollRef.current?.scrollTo({ y: scrollPosition, animated: true });
      }, 500);
    }
  }, [isCacheLoading]);

  const getCardColor = (type: string) => {
    switch (type) {
      case 'completed': return '#E8F5E8';
      case 'conflict': return '#FFF3E0';
      case 'suggestion': return '#E3F2FD';
      case 'recap': return '#F3E5F5';
      default: return '#F8F9FA';
    }
  };

  const getCardBorderColor = (type: string) => {
    switch (type) {
      case 'completed': return '#4CAF50';
      case 'conflict': return '#FF9800';
      case 'suggestion': return '#2196F3';
      case 'recap': return '#9C27B0';
      default: return '#E0E0E0';
    }
  };

  const getEventPosition = (event: DayEvent) => {
    const hourHeight = 60;
    const top = event.startHour * hourHeight;
    const height = Math.max((event.duration / 60) * hourHeight, 30);
    return { top, height };
  };

  const getCurrentTimePosition = () => {
    const now = new Date();
    const currentHour = now.getHours() + now.getMinutes() / 60;
    return currentHour * 60; // 60px per hour
  };

  const formatHour = (hour: number) => {
    if (hour === 0) return '12 AM';
    if (hour === 12) return '12 PM';
    if (hour < 12) return `${hour} AM`;
    return `${hour - 12} PM`;
  };

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View 
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.greeting}>
            <Text style={styles.greetingEmoji}>☀️</Text>
            <Text style={styles.greetingText}>Good morning, Rushik!</Text>
          </View>
        </View>

        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          {/* Day Summary */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Your Day Summary</Text>
            <Animated.View
              style={[
                styles.summaryCard,
                {
                  opacity: fadeAnim,
                  transform: [{ translateY: slideAnim }],
                },
              ]}
            >
              <View style={styles.summaryIcon}>
                <Text style={styles.summaryIconText}>🤖</Text>
              </View>
              <Text style={styles.summaryText}>{daySummary}</Text>
            </Animated.View>
          </View>

          {/* Today's Calendar */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Today's Schedule</Text>
            <Animated.View
              style={[
                styles.calendarContainer,
                {
                  opacity: fadeAnim,
                  transform: [{ translateY: slideAnim }],
                },
              ]}
            >
              <View style={styles.calendarHeader}>
                <Text style={styles.calendarDate}>
                  {new Date().toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </Text>
              </View>
              
              <View style={styles.calendarGrid}>
                {/* Time Labels */}
                <View style={styles.timeColumn}>
                  {HOURS.map(hour => (
                    <View key={hour} style={styles.timeSlot}>
                      <Text style={styles.timeLabel}>
                        {formatHour(hour)}
                      </Text>
                    </View>
                  ))}
                </View>

                {/* Events Column - Now Scrollable */}
                <ScrollView 
                  ref={calendarScrollRef}
                  style={styles.eventsScrollView}
                  showsVerticalScrollIndicator={true}
                  nestedScrollEnabled={true}
                >
                  <View style={styles.eventsColumn}>
                    {/* Hour Grid Background */}
                    {HOURS.map(hour => (
                      <View key={hour} style={styles.hourSlot} />
                    ))}
                    
                    {/* Current Time Indicator */}
                    <View style={[styles.currentTimeLine, { top: getCurrentTimePosition() }]}>
                      <View style={styles.currentTimeDot} />
                      <View style={styles.currentTimeLineBar} />
                    </View>
                    
                    {/* Events */}
                    {isCacheLoading('today') ? (
                      <View style={styles.loadingContainer}>
                        <Text>Loading events from all calendars...</Text>
                      </View>
                    ) : todayEvents.length === 0 ? (
                      <View style={styles.emptyEventsContainer}>
                        <Text style={styles.emptyEventsText}>No events for today. Enjoy your free day! 🎉</Text>
                      </View>
                    ) : (
                      todayEvents.map(event => {
                        const position = getEventPosition(event);
                        return (
                          <Animated.View
                            key={event.id}
                            style={[
                              styles.eventBlock,
                              {
                                top: position.top,
                                height: position.height,
                                backgroundColor: event.color,
                                opacity: fadeAnim,
                              },
                            ]}
                          >
                            <View style={styles.eventContent}>
                              <Text style={styles.eventTitle} numberOfLines={2}>
                                {event.title}
                              </Text>
                              <Text style={styles.eventTime}>{event.time}</Text>
                              {event.calioEdited && (
                                <View style={styles.calioEditedBadge}>
                                  <Text style={styles.calioEditedText}>⚡ Calio</Text>
                                </View>
                              )}
                            </View>
                          </Animated.View>
                        );
                      })
                    )}
                  </View>
                </ScrollView>
              </View>
            </Animated.View>
          </View>

          {/* What Calio Did Today */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>What Calio did for you today</Text>
            {actionCards.map((card, index) => (
              <Animated.View
                key={card.id}
                style={[
                  styles.actionCard,
                  {
                    backgroundColor: getCardColor(card.type),
                    borderColor: getCardBorderColor(card.type),
                    opacity: fadeAnim,
                    transform: [{
                      translateY: slideAnim.interpolate({
                        inputRange: [0, 50],
                        outputRange: [0, 50 + index * 10],
                      }),
                    }],
                  },
                ]}
              >
                <View style={styles.cardHeader}>
                  <View style={styles.cardIcon}>
                    <Text style={styles.cardIconText}>{card.icon}</Text>
                  </View>
                  <View style={styles.cardContent}>
                    <Text style={styles.cardTitle}>{card.title}</Text>
                    <Text style={styles.cardDescription}>{card.description}</Text>
                    <Text style={styles.cardTimestamp}>
                      {card.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                </View>
                <View style={styles.cardActions}>
                  {card.actions.map((action, actionIndex) => (
                    <TouchableOpacity
                      key={actionIndex}
                      style={[
                        styles.actionButton,
                        action.type === 'primary' && styles.actionButtonPrimary,
                        action.type === 'danger' && styles.actionButtonDanger,
                      ]}
                      onPress={action.onPress}
                    >
                      <Text style={[
                        styles.actionButtonText,
                        action.type === 'primary' && styles.actionButtonTextPrimary,
                        action.type === 'danger' && styles.actionButtonTextDanger,
                      ]}>
                        {action.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </Animated.View>
            ))}
          </View>
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  greeting: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  greetingEmoji: {
    fontSize: 24,
    marginRight: 12,
  },
  greetingText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: 24,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 16,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 2,
    borderColor: '#E8F4FF',
  },
  summaryIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E8F4FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    alignSelf: 'flex-start',
  },
  summaryIconText: {
    fontSize: 18,
  },
  summaryText: {
    fontSize: 16,
    color: '#1A1A1A',
    lineHeight: 24,
    fontWeight: '400',
  },
  calendarContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 0, // Remove padding to handle internally
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
    height: 420, // Slightly increased height
    overflow: 'hidden', // Prevent any bleeding
  },
  calendarHeader: {
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F2F5',
    backgroundColor: '#FAFBFC',
  },
  calendarDate: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  calendarGrid: {
    flexDirection: 'row',
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  timeColumn: {
    width: 70, // Increased width for better spacing
    backgroundColor: '#FAFBFC',
    borderRightWidth: 1,
    borderRightColor: '#F0F2F5',
    paddingRight: 12,
    paddingLeft: 8,
  },
  timeSlot: {
    height: 60,
    justifyContent: 'flex-start',
    paddingTop: 4,
  },
  timeLabel: {
    fontSize: 12,
    color: '#8A8A8E',
    fontWeight: '600',
    textAlign: 'right',
    letterSpacing: 0.2,
  },
  eventsScrollView: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  eventsColumn: {
    position: 'relative',
    paddingHorizontal: 16, // Add horizontal padding
    paddingVertical: 4, // Add small vertical padding
    height: 24 * 60, // 24 hours * 60px per hour
    backgroundColor: '#FFFFFF',
  },
  hourSlot: {
    height: 60,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F7FA',
    marginRight: 8, // Prevent line from touching edge
  },
  currentTimeLine: {
    position: 'absolute',
    left: 0,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 10,
  },
  currentTimeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FF3B30',
    marginRight: 6,
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 2,
    elevation: 3,
  },
  currentTimeLineBar: {
    flex: 1,
    height: 2,
    backgroundColor: '#FF3B30',
    borderRadius: 1,
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 1,
    elevation: 2,
  },
  eventBlock: {
    position: 'absolute',
    left: 0,
    right: 12, // More margin from edge
    borderRadius: 12, // More rounded corners
    padding: 12, // Increased padding
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
    borderWidth: 1, // Add border outline
    borderColor: 'rgba(255,255,255,0.6)', // Subtle white border
    // Add a subtle inner shadow effect
    backgroundColor: '#FFFFFF', // Will be overridden by event color
  },
  eventContent: {
    flex: 1,
  },
  eventTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
    lineHeight: 16,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  eventTime: {
    fontSize: 11,
    color: '#FFFFFF',
    opacity: 0.95,
    marginBottom: 6,
    fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.2)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
  calioEditedBadge: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  calioEditedText: {
    fontSize: 9,
    color: '#FFFFFF',
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    height: 300,
    backgroundColor: '#FFFFFF',
  },
  emptyEventsContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    height: 300,
    padding: 24,
    backgroundColor: '#FFFFFF',
  },
  emptyEventsText: {
    fontSize: 16,
    color: '#8A8A8E',
    textAlign: 'center',
    lineHeight: 24,
    fontWeight: '500',
  },
  actionCard: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  cardIconText: {
    fontSize: 18,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 14,
    color: '#666666',
    lineHeight: 20,
    marginBottom: 8,
  },
  cardTimestamp: {
    fontSize: 12,
    color: '#999999',
  },
  cardActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#F0F0F0',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  actionButtonPrimary: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  actionButtonDanger: {
    backgroundColor: '#FF3B30',
    borderColor: '#FF3B30',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666666',
  },
  actionButtonTextPrimary: {
    color: '#FFFFFF',
  },
  actionButtonTextDanger: {
    color: '#FFFFFF',
  },
});