import { router } from 'expo-router';
import React from 'react';
import {
    Dimensions,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useOnboarding } from '../components/OnboardingContext';

const { width, height } = Dimensions.get('window');

export default function SummaryScreen() {
  const { completeOnboarding } = useOnboarding();

  const handleStartUsingCalio = async () => {
    // Mark onboarding as complete and navigate to main
    await completeOnboarding();
    router.replace('/(main)');
  };

  const features = [
    {
      icon: '🤖',
      title: 'Proactively schedule and reschedule',
      description: 'Based on your preferences and priorities',
    },
    {
      icon: '⚡',
      title: 'Resolve conflicts automatically',
      description: 'Notify relevant people when changes happen',
    },
    {
      icon: '🛡️',
      title: 'Protect your time',
      description: 'For what matters most to you',
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.emoji}>🎉</Text>
          <Text style={styles.title}>Ready to meet your agent?</Text>
          <Text style={styles.subtitle}>
            Here's what Calio will do for you:
          </Text>
        </View>

        {/* Features List */}
        <ScrollView style={styles.featuresContainer} showsVerticalScrollIndicator={false}>
          {features.map((feature, index) => (
            <View key={index} style={styles.featureCard}>
              <View style={styles.featureIcon}>
                <Text style={styles.featureEmoji}>{feature.icon}</Text>
              </View>
              <View style={styles.featureContent}>
                <Text style={styles.featureTitle}>{feature.title}</Text>
                <Text style={styles.featureDescription}>{feature.description}</Text>
              </View>
            </View>
          ))}
        </ScrollView>

        {/* Control Message */}
        <View style={styles.controlMessage}>
          <Text style={styles.controlText}>
            You're always in control and can adjust preferences anytime.
          </Text>
        </View>

        {/* Visual Celebration */}
        <View style={styles.celebrationContainer}>
          <View style={styles.celebration}>
            <Text style={styles.celebrationEmoji}>✨</Text>
            <Text style={styles.celebrationEmoji}>🎊</Text>
            <Text style={styles.celebrationEmoji}>✨</Text>
          </View>
          <Text style={styles.celebrationText}>
            Welcome to the future of scheduling!
          </Text>
        </View>

        {/* Progress Indicator */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: '100%' }]} />
          </View>
          <Text style={styles.progressText}>7 of 7 - Complete!</Text>
        </View>

        {/* CTA */}
        <TouchableOpacity style={styles.startButton} onPress={handleStartUsingCalio}>
          <Text style={styles.startButtonText}>Start Using Calio</Text>
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
    alignItems: 'center',
    paddingTop: height * 0.06,
    paddingBottom: 32,
  },
  emoji: {
    fontSize: 64,
    marginBottom: 24,
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
  featuresContainer: {
    flex: 1,
    marginBottom: 20,
  },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#e8f4ff',
  },
  featureIcon: {
    width: 56,
    height: 56,
    backgroundColor: '#e8f4ff',
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  featureEmoji: {
    fontSize: 24,
  },
  featureContent: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
    marginBottom: 4,
  },
  featureDescription: {
    fontSize: 14,
    color: '#666666',
    lineHeight: 20,
  },
  controlMessage: {
    backgroundColor: '#fff3cd',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#ffeaa7',
  },
  controlText: {
    fontSize: 14,
    color: '#856404',
    textAlign: 'center',
    fontWeight: '500',
  },
  celebrationContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  celebration: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  celebrationEmoji: {
    fontSize: 32,
    marginHorizontal: 8,
  },
  celebrationText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '600',
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
    backgroundColor: '#34C759',
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    color: '#34C759',
    fontWeight: '600',
  },
  startButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 18,
    paddingHorizontal: 32,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 40,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 12,
  },
  startButtonText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
  },
}); 