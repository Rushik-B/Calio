import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    Animated,
    Dimensions,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const { width, height } = Dimensions.get('window');

interface ConnectedAccount {
  id: string;
  name: string;
  type: 'calendar' | 'communication' | 'productivity';
  icon: string;
  connected: boolean;
  status: 'active' | 'error' | 'syncing';
  lastSync?: Date;
}

interface NotificationChannel {
  id: string;
  name: string;
  description: string;
  icon: string;
  enabled: boolean;
}

interface AutomationRule {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  category: 'scheduling' | 'protection' | 'optimization';
}

export default function SettingsScreen() {
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(30));
  const [automationLevel, setAutomationLevel] = useState<'ask' | 'balanced' | 'autonomous'>('balanced');

  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([
    {
      id: '1',
      name: 'Google Calendar',
      type: 'calendar',
      icon: '📅',
      connected: true,
      status: 'active',
      lastSync: new Date(Date.now() - 5 * 60 * 1000),
    },
    {
      id: '2',
      name: 'Microsoft Outlook',
      type: 'calendar',
      icon: '📧',
      connected: false,
      status: 'active',
    },
    {
      id: '3',
      name: 'Slack',
      type: 'communication',
      icon: '💬',
      connected: true,
      status: 'active',
      lastSync: new Date(Date.now() - 2 * 60 * 1000),
    },
    {
      id: '4',
      name: 'Microsoft Teams',
      type: 'communication',
      icon: '👥',
      connected: false,
      status: 'active',
    },
    {
      id: '5',
      name: 'Notion',
      type: 'productivity',
      icon: '📝',
      connected: true,
      status: 'syncing',
      lastSync: new Date(Date.now() - 30 * 60 * 1000),
    },
  ]);

  const [notificationChannels, setNotificationChannels] = useState<NotificationChannel[]>([
    {
      id: '1',
      name: 'Push Notifications',
      description: 'Get instant updates on your device',
      icon: '📱',
      enabled: true,
    },
    {
      id: '2',
      name: 'Email Updates',
      description: 'Receive summaries and important changes',
      icon: '📧',
      enabled: true,
    },
    {
      id: '3',
      name: 'SMS Alerts',
      description: 'Text messages for urgent updates',
      icon: '💬',
      enabled: false,
    },
  ]);

  const [automationRules, setAutomationRules] = useState<AutomationRule[]>([
    {
      id: '1',
      title: 'Protect focus time',
      description: 'Block 2-hour focus sessions automatically',
      enabled: true,
      category: 'protection',
    },
    {
      id: '2',
      title: 'Auto-reschedule conflicts',
      description: 'Move meetings when conflicts are detected',
      enabled: true,
      category: 'scheduling',
    },
    {
      id: '3',
      title: 'Optimize meeting clusters',
      description: 'Group meetings together to create larger free blocks',
      enabled: false,
      category: 'optimization',
    },
    {
      id: '4',
      title: 'Decline low-priority meetings',
      description: 'Automatically decline optional meetings during focus time',
      enabled: false,
      category: 'protection',
    },
    {
      id: '5',
      title: 'Buffer time management',
      description: 'Add travel time and prep time automatically',
      enabled: true,
      category: 'scheduling',
    },
  ]);

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

  const toggleAccount = (accountId: string) => {
    setConnectedAccounts(prev =>
      prev.map(account =>
        account.id === accountId
          ? { ...account, connected: !account.connected }
          : account
      )
    );
  };

  const toggleNotification = (channelId: string) => {
    setNotificationChannels(prev =>
      prev.map(channel =>
        channel.id === channelId
          ? { ...channel, enabled: !channel.enabled }
          : channel
      )
    );
  };

  const toggleRule = (ruleId: string) => {
    setAutomationRules(prev =>
      prev.map(rule =>
        rule.id === ruleId
          ? { ...rule, enabled: !rule.enabled }
          : rule
      )
    );
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return '#34C759';
      case 'error': return '#FF3B30';
      case 'syncing': return '#FF9500';
      default: return '#8E8E93';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'active': return 'Connected';
      case 'error': return 'Error';
      case 'syncing': return 'Syncing...';
      default: return 'Disconnected';
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'scheduling': return '#007AFF';
      case 'protection': return '#34C759';
      case 'optimization': return '#FF9500';
      default: return '#8E8E93';
    }
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
          <Text style={styles.headerTitle}>Settings</Text>
          <Text style={styles.headerSubtitle}>Manage your Calio preferences</Text>
        </View>

        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          {/* Automation Level */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Automation Level</Text>
            <Text style={styles.sectionDescription}>
              How proactive should Calio be with your schedule?
            </Text>
            
            <View style={styles.automationOptions}>
              {[
                {
                  key: 'ask',
                  title: 'Ask Before Acting',
                  description: 'Calio suggests changes and waits for approval',
                  icon: '🤝',
                },
                {
                  key: 'balanced',
                  title: 'Balanced Approach',
                  description: 'Minor changes automatic, major changes need approval',
                  icon: '⚖️',
                },
                {
                  key: 'autonomous',
                  title: 'Full Autonomy',
                  description: 'Calio handles everything automatically (undo available)',
                  icon: '🚀',
                },
              ].map((option) => (
                <TouchableOpacity
                  key={option.key}
                  style={[
                    styles.automationOption,
                    automationLevel === option.key && styles.automationOptionSelected,
                  ]}
                  onPress={() => setAutomationLevel(option.key as any)}
                >
                  <View style={styles.automationOptionHeader}>
                    <Text style={styles.automationOptionIcon}>{option.icon}</Text>
                    <View style={styles.automationOptionContent}>
                      <Text style={[
                        styles.automationOptionTitle,
                        automationLevel === option.key && styles.automationOptionTitleSelected,
                      ]}>
                        {option.title}
                      </Text>
                      <Text style={styles.automationOptionDescription}>
                        {option.description}
                      </Text>
                    </View>
                    <View style={[
                      styles.radioButton,
                      automationLevel === option.key && styles.radioButtonSelected,
                    ]}>
                      {automationLevel === option.key && (
                        <View style={styles.radioButtonInner} />
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Connected Accounts */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Connected Accounts</Text>
            <Text style={styles.sectionDescription}>
              Manage your calendar and communication integrations
            </Text>
            
            <View style={styles.accountsContainer}>
              {connectedAccounts.map((account, index) => (
                <Animated.View
                  key={account.id}
                  style={[
                    styles.accountCard,
                    {
                      opacity: fadeAnim,
                      transform: [{
                        translateX: slideAnim.interpolate({
                          inputRange: [0, 30],
                          outputRange: [0, 30 + index * 5],
                        }),
                      }],
                    },
                  ]}
                >
                  <View style={styles.accountHeader}>
                    <View style={styles.accountIcon}>
                      <Text style={styles.accountIconText}>{account.icon}</Text>
                    </View>
                    <View style={styles.accountInfo}>
                      <Text style={styles.accountName}>{account.name}</Text>
                      <View style={styles.accountStatus}>
                        <View style={[
                          styles.statusDot,
                          { backgroundColor: getStatusColor(account.status) }
                        ]} />
                        <Text style={styles.statusText}>
                          {getStatusText(account.status)}
                        </Text>
                        {account.lastSync && (
                          <Text style={styles.lastSyncText}>
                            • Last sync {account.lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </Text>
                        )}
                      </View>
                    </View>
                    <Switch
                      value={account.connected}
                      onValueChange={() => toggleAccount(account.id)}
                      trackColor={{ false: '#E0E0E0', true: '#007AFF' }}
                      thumbColor={account.connected ? '#FFFFFF' : '#FFFFFF'}
                    />
                  </View>
                </Animated.View>
              ))}
            </View>
          </View>

          {/* Notification Channels */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notifications</Text>
            <Text style={styles.sectionDescription}>
              Choose how you want to be notified about changes
            </Text>
            
            <View style={styles.notificationsContainer}>
              {notificationChannels.map((channel, index) => (
                <Animated.View
                  key={channel.id}
                  style={[
                    styles.notificationCard,
                    {
                      opacity: fadeAnim,
                      transform: [{
                        translateX: slideAnim.interpolate({
                          inputRange: [0, 30],
                          outputRange: [0, -30 + index * 5],
                        }),
                      }],
                    },
                  ]}
                >
                  <View style={styles.notificationHeader}>
                    <View style={styles.notificationIcon}>
                      <Text style={styles.notificationIconText}>{channel.icon}</Text>
                    </View>
                    <View style={styles.notificationInfo}>
                      <Text style={styles.notificationName}>{channel.name}</Text>
                      <Text style={styles.notificationDescription}>
                        {channel.description}
                      </Text>
                    </View>
                    <Switch
                      value={channel.enabled}
                      onValueChange={() => toggleNotification(channel.id)}
                      trackColor={{ false: '#E0E0E0', true: '#007AFF' }}
                      thumbColor={channel.enabled ? '#FFFFFF' : '#FFFFFF'}
                    />
                  </View>
                </Animated.View>
              ))}
            </View>
          </View>

          {/* Automation Rules */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Automation Rules</Text>
            <Text style={styles.sectionDescription}>
              Fine-tune how Calio manages your schedule
            </Text>
            
            <View style={styles.rulesContainer}>
              {automationRules.map((rule, index) => (
                <Animated.View
                  key={rule.id}
                  style={[
                    styles.ruleCard,
                    {
                      opacity: fadeAnim,
                      transform: [{
                        translateY: slideAnim.interpolate({
                          inputRange: [0, 30],
                          outputRange: [0, 30 + index * 3],
                        }),
                      }],
                    },
                  ]}
                >
                  <View style={styles.ruleHeader}>
                    <View style={[
                      styles.ruleCategoryBadge,
                      { backgroundColor: getCategoryColor(rule.category) }
                    ]}>
                      <Text style={styles.ruleCategoryText}>
                        {rule.category.charAt(0).toUpperCase() + rule.category.slice(1)}
                      </Text>
                    </View>
                    <Switch
                      value={rule.enabled}
                      onValueChange={() => toggleRule(rule.id)}
                      trackColor={{ false: '#E0E0E0', true: '#007AFF' }}
                      thumbColor={rule.enabled ? '#FFFFFF' : '#FFFFFF'}
                    />
                  </View>
                  <Text style={styles.ruleTitle}>{rule.title}</Text>
                  <Text style={styles.ruleDescription}>{rule.description}</Text>
                </Animated.View>
              ))}
            </View>
          </View>

          {/* Account Actions */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Account</Text>
            
            <TouchableOpacity style={styles.actionButton} onPress={() => router.push('/(main)/calendar-settings')}>
              <Text style={styles.actionButtonText}>Calendar Sync Settings</Text>
              <Text style={styles.actionButtonIcon}>🔄</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.actionButton} onPress={() => router.push('/(home)')}>
              <Text style={styles.actionButtonText}>Chat with Calio</Text>
              <Text style={styles.actionButtonIcon}>💬</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.actionButton}>
              <Text style={styles.actionButtonText}>Export Data</Text>
              <Text style={styles.actionButtonIcon}>📤</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.actionButton}>
              <Text style={styles.actionButtonText}>Privacy Settings</Text>
              <Text style={styles.actionButtonIcon}>🔒</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.actionButton}>
              <Text style={styles.actionButtonText}>Help & Support</Text>
              <Text style={styles.actionButtonIcon}>❓</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={[styles.actionButton, styles.dangerButton]}>
              <Text style={[styles.actionButtonText, styles.dangerButtonText]}>Sign Out</Text>
              <Text style={styles.actionButtonIcon}>🚪</Text>
            </TouchableOpacity>
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
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 16,
    lineHeight: 20,
  },
  automationOptions: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  automationOption: {
    padding: 16,
    marginVertical: 2,
    borderRadius: 12,
    backgroundColor: '#F8F9FA',
  },
  automationOptionSelected: {
    backgroundColor: '#E8F4FF',
    borderWidth: 2,
    borderColor: '#007AFF',
  },
  automationOptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  automationOptionIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  automationOptionContent: {
    flex: 1,
  },
  automationOptionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  automationOptionTitleSelected: {
    color: '#007AFF',
  },
  automationOptionDescription: {
    fontSize: 14,
    color: '#666666',
    lineHeight: 18,
  },
  radioButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioButtonSelected: {
    borderColor: '#007AFF',
    backgroundColor: '#007AFF',
  },
  radioButtonInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  accountsContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  accountCard: {
    padding: 16,
    marginVertical: 2,
    borderRadius: 12,
    backgroundColor: '#F8F9FA',
  },
  accountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  accountIcon: {
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
  accountIconText: {
    fontSize: 18,
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  accountStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    color: '#666666',
    fontWeight: '500',
  },
  lastSyncText: {
    fontSize: 12,
    color: '#999999',
    marginLeft: 4,
  },
  notificationsContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  notificationCard: {
    padding: 16,
    marginVertical: 2,
    borderRadius: 12,
    backgroundColor: '#F8F9FA',
  },
  notificationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  notificationIcon: {
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
  notificationIconText: {
    fontSize: 18,
  },
  notificationInfo: {
    flex: 1,
  },
  notificationName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  notificationDescription: {
    fontSize: 14,
    color: '#666666',
    lineHeight: 18,
  },
  rulesContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  ruleCard: {
    padding: 16,
    marginVertical: 2,
    borderRadius: 12,
    backgroundColor: '#F8F9FA',
  },
  ruleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  ruleCategoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  ruleCategoryText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },
  ruleTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  ruleDescription: {
    fontSize: 14,
    color: '#666666',
    lineHeight: 18,
  },
  actionButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1A1A1A',
  },
  actionButtonIcon: {
    fontSize: 18,
  },
  dangerButton: {
    backgroundColor: '#FFEBEE',
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
  dangerButtonText: {
    color: '#FF3B30',
  },
}); 