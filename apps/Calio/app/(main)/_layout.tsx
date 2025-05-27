import { useAuth } from '@clerk/clerk-expo';
import { Redirect, Tabs } from 'expo-router';
import React, { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import ActionConfirmation from '../components/ActionConfirmation';
import { CalendarCacheProvider } from '../components/CalendarCache';
import FloatingActionButton from '../components/FloatingActionButton';
import QuickActionBar from '../components/QuickActionBar';

interface ParsedIntent {
  intent: string;
  parameters: Record<string, any>;
  confidence: number;
  clarifications?: string[];
  actions?: Array<{
    id: string;
    description: string;
    type: 'primary' | 'secondary';
  }>;
}

interface ActionResult {
  message: string;
  icon: string;
  canUndo: boolean;
}

export default function MainLayout() {
  const { isSignedIn } = useAuth();
  const [showQuickAction, setShowQuickAction] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmationData, setConfirmationData] = useState<ActionResult | null>(null);
  const [lastAction, setLastAction] = useState<ParsedIntent | null>(null);

  if (!isSignedIn) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  const getActionMessage = (intent: ParsedIntent): ActionResult => {
    switch (intent.intent) {
      case 'move_event':
        const event = intent.parameters.event || 'event';
        const newTime = intent.parameters.newTime || intent.parameters.time || 'new time';
        return {
          message: `Moved ${event} to ${newTime}`,
          icon: '🔄',
          canUndo: true,
        };
      
      case 'add_meeting':
        const meeting = intent.parameters.meeting || 'meeting';
        const person = intent.parameters.person ? ` with ${intent.parameters.person}` : '';
        const day = intent.parameters.day || 'today';
        return {
          message: `Scheduled ${meeting}${person} for ${day}`,
          icon: '➕',
          canUndo: true,
        };
      
      case 'clear_day':
        const clearDay = intent.parameters.day || 'day';
        const period = intent.parameters.period === 'afternoon' ? ' afternoon' : '';
        return {
          message: `Cleared ${clearDay}${period}`,
          icon: '🧹',
          canUndo: true,
        };
      
      case 'protect_time':
        const protectPeriod = intent.parameters.period || 'time';
        const duration = intent.parameters.duration || '';
        return {
          message: `Protected ${protectPeriod} ${duration}`.trim(),
          icon: '🛡️',
          canUndo: true,
        };
      
      case 'change_habit':
        const habit = intent.parameters.habit || 'habit';
        const frequency = intent.parameters.frequency || 'new frequency';
        return {
          message: `Changed ${habit} to ${frequency}`,
          icon: '🔁',
          canUndo: true,
        };
      
      case 'undo_action':
        return {
          message: 'Action undone successfully',
          icon: '↩️',
          canUndo: false,
        };
      
      default:
        return {
          message: 'Action completed successfully',
          icon: '✅',
          canUndo: false,
        };
    }
  };

  const handleQuickAction = (intent: ParsedIntent) => {
    console.log('Quick Action Intent:', intent);
    
    // Store the action for potential undo
    setLastAction(intent);
    
    // Get the appropriate confirmation message
    const result = getActionMessage(intent);
    setConfirmationData(result);
    setShowConfirmation(true);
    
    // Here you would typically:
    // 1. Send the intent to your backend
    // 2. Execute the action
    // 3. Update the UI accordingly
    
    // Simulate backend call
    setTimeout(() => {
      console.log('Action executed:', intent);
      // In a real app, you would update your calendar data here
    }, 100);
  };

  const handleUndo = () => {
    if (lastAction) {
      console.log('Undoing action:', lastAction);
      
      // Here you would send an undo request to your backend
      // and update the UI accordingly
      
      setShowConfirmation(false);
      setConfirmationData({
        message: 'Action undone successfully',
        icon: '↩️',
        canUndo: false,
      });
      setShowConfirmation(true);
      setLastAction(null);
    }
  };

  return (
    <CalendarCacheProvider>
      <View style={{ flex: 1 }}>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarStyle: {
              backgroundColor: '#ffffff',
              borderTopWidth: 1,
              borderTopColor: '#f0f0f0',
              paddingBottom: Platform.OS === 'ios' ? 20 : 10,
              paddingTop: 10,
              height: Platform.OS === 'ios' ? 85 : 65,
            },
            tabBarActiveTintColor: '#007AFF',
            tabBarInactiveTintColor: '#8E8E93',
            tabBarLabelStyle: {
              fontSize: 11,
              fontWeight: '600',
            },
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: 'Today',
              tabBarIcon: ({ color, size }) => (
                <TabIcon name="today" color={color} size={size} />
              ),
            }}
          />
          <Tabs.Screen
            name="week"
            options={{
              title: 'Week',
              tabBarIcon: ({ color, size }) => (
                <TabIcon name="week" color={color} size={size} />
              ),
            }}
          />
          <Tabs.Screen
            name="actions"
            options={{
              title: 'Actions',
              tabBarIcon: ({ color, size }) => (
                <TabIcon name="actions" color={color} size={size} />
              ),
            }}
          />
          <Tabs.Screen
            name="settings"
            options={{
              title: 'Settings',
              tabBarIcon: ({ color, size }) => (
                <TabIcon name="settings" color={color} size={size} />
              ),
            }}
          />
        </Tabs>

        {/* Floating Action Button */}
        <FloatingActionButton
          onPress={() => setShowQuickAction(true)}
          visible={!showQuickAction && !showConfirmation}
        />

        {/* Quick Action Bar */}
        <QuickActionBar
          visible={showQuickAction}
          onClose={() => setShowQuickAction(false)}
          onAction={handleQuickAction}
        />

        {/* Action Confirmation */}
        <ActionConfirmation
          visible={showConfirmation}
          message={confirmationData?.message || ''}
          icon={confirmationData?.icon}
          onUndo={confirmationData?.canUndo ? handleUndo : undefined}
          onDismiss={() => {
            setShowConfirmation(false);
            setConfirmationData(null);
          }}
        />
      </View>
    </CalendarCacheProvider>
  );
}

// Simple icon component using emojis for now
function TabIcon({ name, color, size }: { name: string; color: string; size: number }) {
  const icons = {
    today: '🏠',
    week: '📅',
    actions: '⚡',
    settings: '⚙️',
  };

  return (
    <Text style={{ fontSize: size, opacity: color === '#007AFF' ? 1 : 0.6 }}>
      {icons[name as keyof typeof icons]}
    </Text>
  );
} 