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

interface WeekEvent {
  id: string;
  title: string;
  time: string;
  duration: number; // in minutes
  type: 'meeting' | 'focus' | 'personal' | 'ai-managed' | 'general';
  day: number; // 0-6 (Mon-Sun)
  startHour: number;
  color: string;
  calioEdited?: boolean;
  description?: string;
  location?: string;
  calendarId?: string;
}

interface WeekInsight {
  id: string;
  type: 'optimization' | 'pattern' | 'suggestion';
  icon: string;
  title: string;
  description: string;
  action?: string;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 24 }, (_, i) => i); // 0 AM to 11 PM

const CALENDAR_COLORS = [
  '#007AFF', '#34C759', '#FF3B30', '#FF9500', '#AF52DE',
  '#FF2D92', '#5AC8FA', '#FFCC00', '#FF6B35', '#32D74B',
];

const getCalendarColor = (calendarId: string | undefined, eventColor: string) => {
  if (!calendarId) return eventColor;
  let hash = 0;
  for (let i = 0; i < calendarId.length; i++) {
    hash = ((hash << 5) - hash) + calendarId.charCodeAt(i);
    hash |= 0;
  }
  return CALENDAR_COLORS[Math.abs(hash) % CALENDAR_COLORS.length];
};

const parseEventTime = (event: ApiEvent): { startHour: number; duration: number; timeString: string; day: number } => {
  const startTime = event.start.dateTime ? new Date(event.start.dateTime) : new Date(event.start.date || Date.now());
  const endTime = event.end.dateTime ? new Date(event.end.dateTime) : new Date(event.end.date || Date.now());
  
  let eventDay = startTime.getDay();
  eventDay = eventDay === 0 ? 6 : eventDay - 1;

  if (event.start.date) {
    return { startHour: 0, duration: 24 * 60, timeString: 'All Day', day: eventDay };
  }

  const startHour = startTime.getHours() + startTime.getMinutes() / 60;
  const duration = (endTime.getTime() - startTime.getTime()) / (1000 * 60);
  const timeString = startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return { startHour, duration, timeString, day: eventDay };
};

export default function WeekScreen() {
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(30));
  const currentDay = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
  const { getToken, isSignedIn } = useAuth();
  const scrollViewRef = useRef<ScrollView>(null);
  const calendarScrollRef = useRef<ScrollView>(null);
  const isLoadingRef = useRef(false);

  // State for current-time indicator position (in px)
  const [currentTimeTop, setCurrentTimeTop] = useState(0);
  useEffect(() => {
    const update = () => {
      const now = new Date();
      const hours = now.getHours() + now.getMinutes() / 60;
      setCurrentTimeTop(hours * 45);
    };
    update();
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, []);

  const {
    getWeekEvents,
    setWeekEvents,
    setLoading,
    isCacheValid,
    isLoading: isCacheLoading,
  } = useCalendarCache();

  const [weekEvents, setWeekEventsLocal] = useState<WeekEvent[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  const calendarClient = useMemo(() => {
    if (!isSignedIn) return null;
    const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://your-api-domain.com';
    return createCalendarClient(getToken, API_BASE_URL);
  }, [isSignedIn]);

  const [weekInsights] = useState<WeekInsight[]>([
    { id: '1', type: 'optimization', icon: '🎯', title: 'Focus time optimized', description: 'Calio moved 3 focus blocks to your peak productivity hours (10-12 AM)', action: 'View changes' },
    { id: '2', type: 'pattern',      icon: '📊', title: 'Meeting pattern detected',       description: 'You have 40% more meetings on Wednesdays. Consider blocking focus time.', action: 'Auto-block' },
    { id: '3', type: 'suggestion',   icon: '💡', title: 'Weekend prep suggestion',        description: 'Friday looks heavy. Move non-urgent items to next week?', action: 'Reschedule' },
  ]);

  const convertApiEventsToUI = useCallback((apiEvents: ApiEvent[]): WeekEvent[] =>
    apiEvents.map(event => {
      const { startHour, duration, timeString, day } = parseEventTime(event);
      return {
        id: event.id,
        title: event.summary,
        time: timeString,
        duration,
        type: event.type || 'general',
        day,
        startHour,
        color: getCalendarColor(event.calendarId, event.color || '#45B7D1'),
        calioEdited: event.calioEdited,
        description: event.description,
        location: event.location,
        calendarId: event.calendarId,
      };
    }),
  [ ]);

  useEffect(() => {
    if (!isInitialized) {
      const cached = getWeekEvents();
      if (cached.length) {
        setWeekEventsLocal(convertApiEventsToUI(cached));
      }
      setIsInitialized(true);
    }
  }, [isInitialized, getWeekEvents, convertApiEventsToUI]);

  const fetchEvents = useCallback(async () => {
    if (!calendarClient || isLoadingRef.current) return;
    isLoadingRef.current = true;
    setLoading('week', true);
    try {
      const res = await calendarClient.getWeekEvents();
      if (isApiError(res)) {
        Alert.alert('Error fetching week events', res.error);
        setWeekEventsLocal([]);
      } else {
        setWeekEvents(res.events);
        setWeekEventsLocal(convertApiEventsToUI(res.events));
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to load week events.');
      setWeekEventsLocal([]);
    } finally {
      setLoading('week', false);
      isLoadingRef.current = false;
    }
  }, [calendarClient, setWeekEvents, setLoading, convertApiEventsToUI]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    if (calendarClient && isInitialized && !isCacheValid('week') && !isLoadingRef.current) {
      fetchEvents();
    }
  }, [calendarClient, isInitialized, isCacheValid, fetchEvents]);

  useFocusEffect(useCallback(() => {
    if (calendarClient && isInitialized && !isCacheValid('week') && !isLoadingRef.current) {
      fetchEvents();
    }
  }, [calendarClient, isInitialized, isCacheValid, fetchEvents]));

  useEffect(() => {
    if (scrollViewRef.current && isInitialized) {
      const dayWidth = 78;
      const offset = currentDay * dayWidth - width / 2 + dayWidth / 2;
      scrollViewRef.current.scrollTo({ x: Math.max(0, offset), animated: true });
    }
  }, [isInitialized, currentDay]);

  useEffect(() => {
    if (isInitialized && calendarScrollRef.current) {
      const now = new Date();
      const pos = Math.max(0, (now.getHours() - 2) * 45);
      setTimeout(() => calendarScrollRef.current?.scrollTo({ y: pos, animated: true }), 500);
    }
  }, [isInitialized]);

  const getEventsForDay = (day: number) => weekEvents.filter(e => e.day === day);

  const getEventPosition = (event: WeekEvent) => {
    const top = event.startHour * 45;
    const height = (event.duration / 60) * 45;
    return { top, height };
  };

  const getInsightColor = (t: string) => t === 'optimization' ? '#E8F5E8' : t === 'pattern' ? '#FFF3E0' : '#E3F2FD';
  const getInsightBorderColor = (t: string) => t === 'optimization' ? '#4CAF50' : t === 'pattern' ? '#FF9800' : '#2196F3';

  const getCurrentWeekDates = () => {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (today.getDay() === 0 ? 6 : today.getDay() - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
      start: monday.toLocaleDateString('en-US',{month:'short',day:'numeric'}),
      end:   sunday.toLocaleDateString('en-US',{month:'short',day:'numeric'}),
    };
  };

  const formatHour = (h: number) => h === 0 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h-12} PM`;

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>This Week</Text>
          <Text style={styles.headerSubtitle}>
            {getCurrentWeekDates().start} - {getCurrentWeekDates().end}
          </Text>
        </View>
        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          <View style={styles.section}>
            <Animated.View style={[styles.summaryContainer, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
              <Text style={styles.summaryText}>
                I optimized your focus blocks to align with your peak productivity hours between 10-12 AM this week.{'\n'}
                Friday looks packed with both sprint planning and team social, so I kept your afternoon clear for demo prep.{'\n'}
                Your gym schedule is perfectly consistent - that Tuesday and regular pattern is working well for you.
              </Text>
            </Animated.View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Week Overview</Text>
            <Animated.View style={[styles.calendarContainer, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
              <View style={styles.calendarHeader}>
                <View style={styles.timeHeaderSpacer} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.daysHeaderScrollView} ref={scrollViewRef}>
                  <View style={styles.daysHeaderContainer}>
                    {DAYS.map((day, i) => {
                      const isToday = i === currentDay;
                      const monday = new Date();
                      monday.setDate(new Date().getDate() - (new Date().getDay() === 0 ? 6 : new Date().getDay() - 1));
                      const date = new Date(monday);
                      date.setDate(monday.getDate() + i);
                      return (
                        <View key={i} style={[styles.dayHeader, isToday && styles.todayHeader]}>
                          <Text style={[styles.dayHeaderText, isToday && styles.todayHeaderText]}>{day}</Text>
                          <Text style={[styles.dayHeaderDate, isToday && styles.todayHeaderDate]}>{date.getDate()}</Text>
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>

              <ScrollView ref={calendarScrollRef} showsVerticalScrollIndicator style={styles.calendarBodyScrollView}>
                <View style={styles.calendarBody}>
                  <View style={styles.timeColumn}>
                    {HOURS.map(h => (
                      <View key={h} style={styles.timeSlot}>
                        <Text style={styles.timeLabel}>{formatHour(h)}</Text>
                      </View>
                    ))}
                  </View>

                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.eventsScrollView}>
                    <View style={styles.eventsContainer}>
                      {DAYS.map((_, dayIndex) => {
                        const isToday = dayIndex === currentDay;
                        return (
                          <View key={dayIndex} style={[styles.dayColumn, isToday && styles.todayColumn]}>
                            {HOURS.map(h => (
                              <View key={h} style={[styles.hourSlot, isToday && styles.todayHourSlot]} />
                            ))}

                            {isToday && (
                              <View style={[styles.currentTimeIndicator, { top: currentTimeTop }]} />
                            )}

                            {isCacheLoading('week') && isToday ? (
                              <View style={styles.loadingContainerSmall}><Text style={styles.loadingText}>Loading...</Text></View>
                            ) : getEventsForDay(dayIndex).length === 0 && isToday ? (
                              <View style={styles.emptyEventsContainerSmall}><Text style={styles.emptyEventsTextSmall}>No events</Text></View>
                            ) : (
                              getEventsForDay(dayIndex).map(event => {
                                const pos = getEventPosition(event);
                                return (
                                  <Animated.View key={event.id} style={[styles.eventBlock, { top: pos.top, height: Math.max(pos.height,22), backgroundColor: event.color, opacity: fadeAnim }]}>
                                    <Text style={styles.eventTitle} numberOfLines={2}>{event.title}</Text>
                                    <Text style={styles.eventTime}>{event.time}</Text>
                                    {event.calioEdited && (
                                      <View style={styles.calioEditedBadge}><Text style={styles.calioEditedText}>⚡</Text></View>
                                    )}
                                  </Animated.View>
                                );
                              })
                            )}
                          </View>
                        );
                      })}
                    </View>
                  </ScrollView>
                </View>
              </ScrollView>
            </Animated.View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>AI Insights</Text>
            {weekInsights.map((insight, idx) => (
              <Animated.View key={insight.id} style={[styles.insightCard, {
                backgroundColor: getInsightColor(insight.type),
                borderColor: getInsightBorderColor(insight.type),
                opacity: fadeAnim,
                transform: [{ translateX: slideAnim.interpolate({ inputRange:[0,30], outputRange:[0,30+idx*10] }) }]
              }]}>
                <View style={styles.insightHeader}>
                  <View style={styles.insightIcon}><Text style={styles.insightIconText}>{insight.icon}</Text></View>
                  <View style={styles.insightContent}>
                    <Text style={styles.insightTitle}>{insight.title}</Text>
                    <Text style={styles.insightDescription}>{insight.description}</Text>
                  </View>
                </View>
                {insight.action && (
                  <TouchableOpacity style={styles.insightAction}><Text style={styles.insightActionText}>{insight.action}</Text></TouchableOpacity>
                )}
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
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#666666',
    marginTop: 4,
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
  summaryContainer: {
    paddingLeft: 16,
    marginBottom: 8,
  },
  summaryText: {
    fontSize: 16,
    color: '#555555',
    lineHeight: 24,
    fontWeight: '400',
  },
  calendarContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
    height: 450,
  },
  calendarHeader: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  timeHeaderSpacer: {
    width: 45,
  },
  daysHeaderScrollView: {
    flex: 1,
  },
  daysHeaderContainer: {
    flexDirection: 'row',
  },
  dayHeader: {
    width: 78,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 1,
    borderRadius: 6,
  },
  todayHeader: {
    backgroundColor: '#007AFF',
  },
  dayHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#666666',
    marginBottom: 2,
  },
  todayHeaderText: {
    color: '#FFFFFF',
  },
  dayHeaderDate: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  todayHeaderDate: {
    color: '#FFFFFF',
  },
  calendarBodyScrollView: {
    flex: 1,
  },
  calendarBody: {
    flexDirection: 'row',
  },
  timeColumn: {
    width: 45,
    paddingRight: 6,
  },
  timeSlot: {
    height: 45,
    justifyContent: 'center',
  },
  timeLabel: {
    fontSize: 9,
    color: '#999999',
    fontWeight: '500',
    textAlign: 'right',
  },
  eventsScrollView: {
    flex: 1,
  },
  eventsContainer: {
    flexDirection: 'row',
    height: 24 * 45, // 24 hours * 45px per hour
  },
  dayColumn: {
    width: 78,
    position: 'relative',
    marginRight: 1,
  },
  todayColumn: {
    backgroundColor: '#F8FBFF',
    borderRadius: 6,
  },
  hourSlot: {
    height: 45,
    borderBottomWidth: 0.5,
    borderBottomColor: '#F0F0F0',
  },
  todayHourSlot: {
    borderBottomColor: '#E8F4FF',
  },
  eventBlock: {
    position: 'absolute',
    left: 2,
    right: 2,
    borderRadius: 4,
    padding: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  eventTitle: {
    fontSize: 9,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 1,
    lineHeight: 11,
  },
  eventTime: {
    fontSize: 7,
    color: '#FFFFFF',
    opacity: 0.9,
    fontWeight: '500',
  },
  calioEditedBadge: {
    position: 'absolute',
    top: 1,
    right: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 6,
    width: 10,
    height: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calioEditedText: {
    fontSize: 5,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  loadingContainerSmall: {
    position: 'absolute',
    top: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 10,
    color: '#999999',
  },
  emptyEventsContainerSmall: {
    position: 'absolute',
    top: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  emptyEventsTextSmall: {
    fontSize: 10,
    color: '#999999',
  },
  insightCard: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  insightHeader: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  insightIcon: {
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
  insightIconText: {
    fontSize: 18,
  },
  insightContent: {
    flex: 1,
  },
  currentTimeIndicator: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'red',
    zIndex: 10,
  },
  insightTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  insightDescription: {
    fontSize: 14,
    color: '#666666',
    lineHeight: 20,
  },
  insightAction: {
    alignSelf: 'flex-start',
    backgroundColor: '#007AFF',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  insightActionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});