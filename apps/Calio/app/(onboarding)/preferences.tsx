import { router } from 'expo-router';
import React, { useState } from 'react';
import {
    Dimensions,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

const { width, height } = Dimensions.get('window');

type AutomationLevel = 'hands-off' | 'balanced' | 'take-charge' | 'custom';

interface PreferenceOption {
  id: AutomationLevel;
  title: string;
  description: string;
  emoji: string;
  color: string;
}

export default function PreferencesScreen() {
  const [selectedPreference, setSelectedPreference] = useState<AutomationLevel | null>(null);
  const [customDescription, setCustomDescription] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  const handleNext = () => {
    if (selectedPreference) {
      router.push('/(onboarding)/constraints');
    }
  };

  const preferences: PreferenceOption[] = [
    {
      id: 'hands-off',
      title: 'Hands-off',
      description: 'I want Calio to ask me before making any changes. Full control stays with me.',
      emoji: '🤝',
      color: '#34C759',
    },
    {
      id: 'balanced',
      title: 'Balanced',
      description: 'Calio can make minor adjustments automatically, but asks for approval on important changes.',
      emoji: '⚖️',
      color: '#FF9500',
    },
    {
      id: 'take-charge',
      title: 'Take charge',
      description: 'Calio can automatically reschedule, resolve conflicts, and notify others on my behalf.',
      emoji: '🚀',
      color: '#007AFF',
    },
    {
      id: 'custom',
      title: 'Custom',
      description: 'Let me specify exactly how I want Calio to manage my schedule.',
      emoji: '⚙️',
      color: '#AF52DE',
    },
  ];

  const handlePreferenceSelect = (preferenceId: AutomationLevel) => {
    setSelectedPreference(preferenceId);
    if (preferenceId === 'custom') {
      setShowCustomInput(true);
    } else {
      setShowCustomInput(false);
      setCustomDescription('');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>How should Calio manage your schedule?</Text>
          <Text style={styles.subtitle}>
            Tell Calio how proactive you want it to be with your calendar.
          </Text>
        </View>

        {/* Preference Options */}
        <ScrollView style={styles.optionsContainer} showsVerticalScrollIndicator={false}>
          {preferences.map((preference) => (
            <TouchableOpacity
              key={preference.id}
              style={[
                styles.optionCard,
                selectedPreference === preference.id && styles.optionCardSelected,
                { borderColor: selectedPreference === preference.id ? preference.color : 'transparent' }
              ]}
              onPress={() => handlePreferenceSelect(preference.id)}
            >
              <View style={styles.optionHeader}>
                <View style={styles.radioContainer}>
                  <View style={[
                    styles.radioButton,
                    selectedPreference === preference.id && styles.radioButtonSelected,
                    { backgroundColor: selectedPreference === preference.id ? preference.color : 'transparent' }
                  ]}>
                    {selectedPreference === preference.id && (
                      <View style={styles.radioInner} />
                    )}
                  </View>
                  <Text style={styles.optionEmoji}>{preference.emoji}</Text>
                </View>
                <Text style={[
                  styles.optionTitle,
                  selectedPreference === preference.id && { color: preference.color }
                ]}>
                  {preference.title}
                </Text>
              </View>
              <Text style={styles.optionDescription}>
                {preference.description}
              </Text>
            </TouchableOpacity>
          ))}

          {/* Custom Input */}
          {showCustomInput && selectedPreference === 'custom' && (
            <View style={styles.customInputContainer}>
              <Text style={styles.customInputLabel}>
                Describe how you'd like Calio to handle your schedule:
              </Text>
              <TextInput
                style={styles.customTextInput}
                placeholder="e.g., Only reschedule meetings during work hours, always ask before canceling anything, automatically block focus time..."
                placeholderTextColor="#999"
                value={customDescription}
                onChangeText={setCustomDescription}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
              <Text style={styles.customInputHint}>
                💡 Be as specific as you'd like - this helps Calio understand your preferences better!
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Visual Illustration */}
        <View style={styles.illustrationContainer}>
          <View style={styles.illustration}>
            <View style={styles.calendarIcon}>
              <Text style={styles.calendarEmoji}>📅</Text>
            </View>
            <View style={styles.arrowContainer}>
              <Text style={styles.arrow}>→</Text>
            </View>
            <View style={styles.agentIcon}>
              <Text style={styles.agentEmoji}>🤖</Text>
            </View>
          </View>
          <Text style={styles.illustrationText}>
            {selectedPreference === 'hands-off' 
              ? 'Calio will suggest changes and ask for your approval'
              : selectedPreference === 'balanced'
              ? 'Calio will handle small changes but ask about important ones'
              : selectedPreference === 'take-charge'
              ? 'Calio will automatically optimize your schedule'
              : selectedPreference === 'custom'
              ? 'Calio will follow your custom instructions'
              : 'Choose your preferred automation level'
            }
          </Text>
        </View>

        {/* Progress Indicator */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: '28%' }]} />
          </View>
          <Text style={styles.progressText}>2 of 7</Text>
        </View>

        {/* CTA */}
        <TouchableOpacity 
          style={[
            styles.nextButton,
            (!selectedPreference || (selectedPreference === 'custom' && !customDescription.trim())) && styles.nextButtonDisabled
          ]}
          onPress={handleNext}
          disabled={!selectedPreference || (selectedPreference === 'custom' && !customDescription.trim())}
        >
          <Text style={[
            styles.nextButtonText,
            (!selectedPreference || (selectedPreference === 'custom' && !customDescription.trim())) && styles.nextButtonTextDisabled
          ]}>
            Next
          </Text>
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
    borderRadius: 20,
    padding: 24,
    marginBottom: 16,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  optionCardSelected: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  radioContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
  },
  radioButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  radioButtonSelected: {
    borderColor: 'transparent',
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ffffff',
  },
  optionEmoji: {
    fontSize: 24,
  },
  optionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  optionDescription: {
    fontSize: 16,
    lineHeight: 22,
    color: '#666666',
  },
  customInputContainer: {
    backgroundColor: '#f8f9fa',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#AF52DE',
  },
  customInputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#AF52DE',
    marginBottom: 12,
  },
  customTextInput: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#333333',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    minHeight: 100,
    marginBottom: 12,
  },
  customInputHint: {
    fontSize: 14,
    color: '#666666',
    fontStyle: 'italic',
    lineHeight: 20,
  },
  illustrationContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  illustration: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  calendarIcon: {
    width: 60,
    height: 60,
    backgroundColor: '#f0f0f0',
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarEmoji: {
    fontSize: 28,
  },
  arrowContainer: {
    marginHorizontal: 20,
  },
  arrow: {
    fontSize: 24,
    color: '#007AFF',
  },
  agentIcon: {
    width: 60,
    height: 60,
    backgroundColor: '#e8f4ff',
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentEmoji: {
    fontSize: 28,
  },
  illustrationText: {
    fontSize: 14,
    color: '#666666',
    textAlign: 'center',
    paddingHorizontal: 16,
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
  nextButtonDisabled: {
    backgroundColor: '#e0e0e0',
    shadowOpacity: 0,
    elevation: 0,
  },
  nextButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
  nextButtonTextDisabled: {
    color: '#999999',
  },
}); 