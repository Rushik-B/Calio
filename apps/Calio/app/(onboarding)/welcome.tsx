import { router } from 'expo-router';
import React from 'react';
import {
    Dimensions,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const { width, height } = Dimensions.get('window');

export default function WelcomeScreen() {
  const handleGetStarted = () => {
    router.push('/(onboarding)/priorities');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Header Section */}
        <View style={styles.headerSection}>
          <Text style={styles.emoji}>👋</Text>
          <Text style={styles.title}>Welcome to Calio</Text>
          <Text style={styles.subtitle}>
            Meet your new personal scheduling agent.
          </Text>
          <Text style={styles.description}>
            Calio orchestrates your calendar, resolves conflicts, and protects your time—so you can focus on what matters.
          </Text>
        </View>

        {/* Illustration/Visual Section */}
        <View style={styles.visualSection}>
          <View style={styles.calendarIllustration}>
            <View style={styles.calendarHeader}>
              <View style={styles.calendarDot} />
              <View style={styles.calendarDot} />
              <View style={styles.calendarDot} />
            </View>
            <View style={styles.calendarBody}>
              <View style={[styles.calendarEvent, styles.eventBlue]} />
              <View style={[styles.calendarEvent, styles.eventGreen]} />
              <View style={[styles.calendarEvent, styles.eventPurple]} />
            </View>
          </View>
        </View>

        {/* CTA Section */}
        <View style={styles.ctaSection}>
          <TouchableOpacity style={styles.getStartedButton} onPress={handleGetStarted}>
            <Text style={styles.getStartedText}>Get Started</Text>
          </TouchableOpacity>
        </View>
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
    justifyContent: 'space-between',
  },
  headerSection: {
    alignItems: 'center',
    paddingTop: height * 0.08,
  },
  emoji: {
    fontSize: 64,
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#1a1a1a',
    textAlign: 'center',
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#007AFF',
    textAlign: 'center',
    marginBottom: 24,
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    color: '#666666',
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  visualSection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  calendarIllustration: {
    width: width * 0.6,
    height: width * 0.6,
    backgroundColor: '#f8f9fa',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
  },
  calendarDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#e0e0e0',
  },
  calendarBody: {
    flex: 1,
    justifyContent: 'space-around',
  },
  calendarEvent: {
    height: 24,
    borderRadius: 12,
    marginVertical: 4,
  },
  eventBlue: {
    backgroundColor: '#007AFF',
    width: '80%',
  },
  eventGreen: {
    backgroundColor: '#34C759',
    width: '60%',
  },
  eventPurple: {
    backgroundColor: '#AF52DE',
    width: '90%',
  },
  ctaSection: {
    paddingBottom: 40,
  },
  getStartedButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  getStartedText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
}); 