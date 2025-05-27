import { router } from 'expo-router';
import React, { useState } from 'react';
import {
    Dimensions,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const { width, height } = Dimensions.get('window');

interface NotificationOption {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  icon: string;
}

export default function NotificationsScreen() {
  const [notificationOptions, setNotificationOptions] = useState<NotificationOption[]>([
    {
      id: 'push',
      title: 'Push notifications',
      description: 'Get instant updates on your device',
      enabled: true,
      icon: '📱',
    },
    {
      id: 'email',
      title: 'Email updates',
      description: 'Receive summaries and important changes',
      enabled: true,
      icon: '📧',
    },
    {
      id: 'slack',
      title: 'Slack/Teams integration',
      description: 'Connect with your workplace chat',
      enabled: false,
      icon: '💬',
    },
    {
      id: 'sms',
      title: 'SMS (optional)',
      description: 'Text messages for urgent updates',
      enabled: false,
      icon: '💬',
    },
  ]);

  const toggleNotification = (id: string) => {
    setNotificationOptions(prev =>
      prev.map(option =>
        option.id === id
          ? { ...option, enabled: !option.enabled }
          : option
      )
    );
  };

  const handleNext = () => {
    router.push('/(onboarding)/summary');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Stay in the loop</Text>
          <Text style={styles.subtitle}>
            How would you like to be notified about schedule changes, conflicts, or suggestions?
          </Text>
        </View>

        {/* Notification Options */}
        <ScrollView style={styles.optionsContainer} showsVerticalScrollIndicator={false}>
          {notificationOptions.map((option) => (
            <TouchableOpacity
              key={option.id}
              style={[
                styles.optionCard,
                option.enabled && styles.optionCardEnabled
              ]}
              onPress={() => toggleNotification(option.id)}
            >
              <View style={styles.optionContent}>
                <View style={styles.optionLeft}>
                  <Text style={styles.optionIcon}>{option.icon}</Text>
                  <View style={styles.optionInfo}>
                    <Text style={[
                      styles.optionTitle,
                      option.enabled && styles.optionTitleEnabled
                    ]}>
                      {option.title}
                    </Text>
                    <Text style={styles.optionDescription}>
                      {option.description}
                    </Text>
                  </View>
                </View>
                <View style={[
                  styles.checkbox,
                  option.enabled && styles.checkboxEnabled
                ]}>
                  {option.enabled && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Visual Illustration */}
        <View style={styles.illustrationContainer}>
          <View style={styles.notificationIllustration}>
            <View style={styles.phoneIcon}>
              <Text style={styles.phoneEmoji}>📱</Text>
              <View style={styles.notificationBadge}>
                <Text style={styles.badgeText}>3</Text>
              </View>
            </View>
            <View style={styles.notificationBubbles}>
              <View style={[styles.notificationBubble, styles.bubble1]} />
              <View style={[styles.notificationBubble, styles.bubble2]} />
              <View style={[styles.notificationBubble, styles.bubble3]} />
            </View>
          </View>
          <Text style={styles.illustrationText}>
            Stay informed about your schedule changes
          </Text>
        </View>

        {/* Progress Indicator */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: '71%' }]} />
          </View>
          <Text style={styles.progressText}>5 of 7</Text>
        </View>

        {/* CTA */}
        <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
          <Text style={styles.nextButtonText}>Next</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  header: {
    paddingTop: height * 0.06,
    paddingBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1a1a1a',
    textAlign: 'center',
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: '#666666',
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  optionsContainer: {
    flex: 1,
    marginBottom: 20,
  },
  optionCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  optionCardEnabled: {
    backgroundColor: '#e8f4ff',
    borderColor: '#007AFF',
  },
  optionContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  optionIcon: {
    fontSize: 24,
    marginRight: 16,
  },
  optionInfo: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 4,
  },
  optionTitleEnabled: {
    color: '#007AFF',
  },
  optionDescription: {
    fontSize: 14,
    color: '#666666',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  checkboxEnabled: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  checkmark: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  illustrationContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  notificationIllustration: {
    alignItems: 'center',
    marginBottom: 16,
  },
  phoneIcon: {
    position: 'relative',
    marginBottom: 20,
  },
  phoneEmoji: {
    fontSize: 48,
  },
  notificationBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: '#FF3B30',
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  notificationBubbles: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  notificationBubble: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginHorizontal: 4,
    backgroundColor: '#007AFF',
  },
  bubble1: {
    opacity: 1,
  },
  bubble2: {
    opacity: 0.6,
  },
  bubble3: {
    opacity: 0.3,
  },
  illustrationText: {
    fontSize: 14,
    color: '#666666',
    textAlign: 'center',
  },
  progressContainer: {
    alignItems: 'center',
    marginVertical: 24,
  },
  progressBar: {
    width: '100%',
    height: 4,
    backgroundColor: '#e0e0e0',
    borderRadius: 2,
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    color: '#666666',
  },
  nextButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 40,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  nextButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
}); 