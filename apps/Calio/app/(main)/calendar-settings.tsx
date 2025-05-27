import { useAuth } from '@clerk/clerk-expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    SafeAreaView,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { createCalendarClient } from '../api/calendar/client';
import { isApiError } from '../api/calendar/types';
import { useCalendarCache } from '../components/CalendarCache';

const CALENDAR_SETTINGS_KEY = 'calio_calendar_settings';

interface CalendarSyncSetting {
  id: string;
  summary: string;
  synced: boolean;
}

export default function CalendarSettingsScreen() {
  const { getToken, isSignedIn } = useAuth();
  const [calendars, setCalendars] = useState<CalendarSyncSetting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isLoadingRef = useRef(false);
  const { clearCache } = useCalendarCache();

  const calendarClient = useMemo(() => {
    if (!isSignedIn) return null;
    const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://your-api-domain.com';
    return createCalendarClient(getToken, API_BASE_URL);
  }, [isSignedIn]);

  // Load saved calendar settings
  const loadSavedSettings = useCallback(async (): Promise<Record<string, boolean>> => {
    try {
      const savedSettings = await AsyncStorage.getItem(CALENDAR_SETTINGS_KEY);
      return savedSettings ? JSON.parse(savedSettings) : {};
    } catch (error) {
      console.error('❌ Error loading calendar settings:', error);
      return {};
    }
  }, []);

  // Save calendar settings
  const saveSettings = useCallback(async (settings: CalendarSyncSetting[]) => {
    try {
      const settingsMap = settings.reduce((acc, cal) => {
        acc[cal.id] = cal.synced;
        return acc;
      }, {} as Record<string, boolean>);
      
      await AsyncStorage.setItem(CALENDAR_SETTINGS_KEY, JSON.stringify(settingsMap));
      console.log('✅ Calendar settings saved:', settingsMap);
      return true;
    } catch (error) {
      console.error('❌ Error saving calendar settings:', error);
      return false;
    }
  }, []);

  const fetchUserCalendars = useCallback(async () => {
    if (!calendarClient || isLoadingRef.current) return;
    
    isLoadingRef.current = true;
    setIsLoading(true);
    setError(null);
    
    try {
      console.log('🔄 Fetching user calendars...');
      const [response, savedSettings] = await Promise.all([
        calendarClient.getCalendars(),
        loadSavedSettings()
      ]);
      
      if (isApiError(response)) {
        console.error('❌ API Error:', response.error);
        setError(response.error);
        Alert.alert('Error fetching calendars', response.error);
        setCalendars([]);
      } else {
        console.log('✅ Calendars fetched successfully:', response.calendars.length, 'calendars');
        console.log('📋 Loaded saved settings:', savedSettings);
        
        const initialSettings: CalendarSyncSetting[] = response.calendars.map(cal => ({
          id: cal.id,
          summary: cal.summary,
          synced: savedSettings[cal.id] !== undefined ? savedSettings[cal.id] : cal.primary, // Use saved setting or default to primary
        }));
        setCalendars(initialSettings);
      }
    } catch (e: any) {
      console.error('❌ Network Error:', e);
      setError(e.message || 'Failed to load calendars.');
      Alert.alert('Error', e.message || 'Failed to load calendars.');
      setCalendars([]);
    } finally {
      setIsLoading(false);
      isLoadingRef.current = false;
    }
  }, [calendarClient, loadSavedSettings]);

  useEffect(() => {
    if (calendarClient && !isLoadingRef.current) {
      fetchUserCalendars();
    }
  }, [calendarClient]);

  const toggleCalendarSync = (calendarId: string) => {
    setCalendars(prevCalendars =>
      prevCalendars.map(cal =>
        cal.id === calendarId ? { ...cal, synced: !cal.synced } : cal
      )
    );
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      const success = await saveSettings(calendars);
      if (success) {
        // Clear cache to force fresh data fetch with new settings
        clearCache();
        Alert.alert(
          "Settings Saved", 
          "Your calendar sync preferences have been updated. The changes will take effect immediately.",
          [
            {
              text: "OK",
              onPress: () => router.back()
            }
          ]
        );
      } else {
        Alert.alert("Error", "Failed to save settings. Please try again.");
      }
    } catch (error) {
      Alert.alert("Error", "Failed to save settings. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const renderCalendarItem = ({ item }: { item: CalendarSyncSetting }) => (
    <View style={styles.calendarItem}>
      <View style={styles.calendarInfo}>
        <Text style={styles.calendarName}>{item.summary}</Text>
        <Text style={styles.calendarIdText}>
          {item.id === 'primary' ? 'Primary Calendar' : `ID: ${item.id}`}
        </Text>
      </View>
      <Switch
        value={item.synced}
        onValueChange={() => toggleCalendarSync(item.id)}
        trackColor={{ false: '#E0E0E0', true: '#007AFF' }}
        thumbColor={item.synced ? '#FFFFFF' : '#FFFFFF'}
      />
    </View>
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <Stack.Screen options={{ title: 'Calendar Sync Settings' }} />
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading Calendars...</Text>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.errorContainer}>
        <Stack.Screen options={{ title: 'Calendar Sync Settings' }} />
        <Text style={styles.errorText}>Error: {error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => {
          if (calendarClient && !isLoadingRef.current) {
            fetchUserCalendars();
          }
        }}>
          <Text style={styles.retryButtonText}>Try Again</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const syncedCount = calendars.filter(cal => cal.synced).length;

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ title: 'Calendar Sync Settings' }} />
      <View style={styles.headerContainer}>
        <Text style={styles.headerTitle}>Manage Calendar Sync</Text>
        <Text style={styles.headerSubtitle}>
          Select which calendars Calio should access and display events from.
        </Text>
        <Text style={styles.syncStatus}>
          {syncedCount} of {calendars.length} calendars synced
        </Text>
      </View>

      <FlatList
        data={calendars}
        renderItem={renderCalendarItem}
        keyExtractor={item => item.id}
        ListEmptyComponent={() => (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No calendars found.</Text>
          </View>
        )}
        contentContainerStyle={styles.listContentContainer}
      />

      <TouchableOpacity 
        style={[styles.saveButton, isSaving && styles.saveButtonDisabled]} 
        onPress={handleSaveSettings}
        disabled={isSaving}
      >
        <Text style={styles.saveButtonText}>
          {isSaving ? 'Saving...' : 'Save Settings'}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666666',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#F8F9FA',
  },
  errorText: {
    fontSize: 16,
    color: '#FF3B30',
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  headerContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    backgroundColor: '#FFFFFF',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#666666',
    lineHeight: 20,
    marginBottom: 8,
  },
  syncStatus: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '600',
  },
  listContentContainer: {
    paddingVertical: 16,
  },
  calendarItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  calendarInfo: {
    flex: 1,
    marginRight: 16,
  },
  calendarName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 2,
  },
  calendarIdText: {
    fontSize: 12,
    color: '#999999',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 50,
  },
  emptyText: {
    fontSize: 16,
    color: '#666666',
  },
  saveButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingVertical: 16,
    marginHorizontal: 20,
    marginVertical: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  saveButtonDisabled: {
    backgroundColor: '#C7C7CC',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
}); 