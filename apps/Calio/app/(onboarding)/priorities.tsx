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

interface Priority {
  id: string;
  label: string;
  emoji: string;
}

const defaultPriorities: Priority[] = [
  { id: 'deep-work', label: 'Deep Work / Study', emoji: '🧠' },
  { id: 'gym-health', label: 'Gym / Health', emoji: '💪' },
  { id: 'family-friends', label: 'Family & Friends', emoji: '👨‍👩‍👧‍👦' },
  { id: 'me-time', label: 'Me-Time', emoji: '🧘‍♀️' },
  { id: 'meetings', label: 'Meetings', emoji: '📅' },
  { id: 'side-projects', label: 'Side Projects', emoji: '🚀' },
  { id: 'reading', label: 'Reading', emoji: '📚' },
  { id: 'cooking', label: 'Cooking', emoji: '👨‍🍳' },
  { id: 'sleep', label: 'Sleep', emoji: '😴' },
  { id: 'commute', label: 'Commute', emoji: '🚗' },
  { id: 'hobbies', label: 'Hobbies', emoji: '🎨' },
  { id: 'travel', label: 'Travel', emoji: '✈️' },
  { id: 'learning', label: 'Learning', emoji: '🎓' },
  { id: 'networking', label: 'Networking', emoji: '🤝' },
  { id: 'volunteering', label: 'Volunteering', emoji: '🤲' },
  { id: 'meditation', label: 'Meditation', emoji: '🕯️' },
  { id: 'music', label: 'Music', emoji: '🎵' },
  { id: 'gaming', label: 'Gaming', emoji: '🎮' },
  { id: 'shopping', label: 'Shopping', emoji: '🛍️' },
  { id: 'cleaning', label: 'Cleaning', emoji: '🧹' },
  { id: 'pets', label: 'Pet Care', emoji: '🐕' },
  { id: 'gardening', label: 'Gardening', emoji: '🌱' },
  { id: 'sports', label: 'Sports', emoji: '⚽' },
  { id: 'entertainment', label: 'Entertainment', emoji: '🎬' },
];

export default function PrioritiesScreen() {
  const [selectedPriorities, setSelectedPriorities] = useState<string[]>([]);
  const [customPriorities, setCustomPriorities] = useState<Priority[]>([]);
  const [customPriority, setCustomPriority] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  const MAX_SELECTIONS = 10;

  const togglePriority = (priorityId: string) => {
    if (selectedPriorities.includes(priorityId)) {
      setSelectedPriorities(prev => prev.filter(id => id !== priorityId));
    } else if (selectedPriorities.length < MAX_SELECTIONS) {
      setSelectedPriorities(prev => [...prev, priorityId]);
    }
  };

  const addCustomPriority = () => {
    if (customPriority.trim() && selectedPriorities.length < MAX_SELECTIONS) {
      const customId = `custom-${Date.now()}`;
      const newCustomPriority: Priority = {
        id: customId,
        label: customPriority.trim(),
        emoji: '⭐'
      };
      setCustomPriorities(prev => [...prev, newCustomPriority]);
      setSelectedPriorities(prev => [...prev, customId]);
      setCustomPriority('');
      setShowCustomInput(false);
    }
  };

  const handleNext = () => {
    // Store selected priorities in context or async storage
    router.push('/(onboarding)/preferences');
  };

  const allPriorities = [...defaultPriorities, ...customPriorities];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>What matters most in your week?</Text>
          <Text style={styles.subtitle}>
            Choose up to {MAX_SELECTIONS} priorities so Calio can protect your time for what's important.
          </Text>
          <View style={styles.selectionCounter}>
            <Text style={styles.counterText}>
              {selectedPriorities.length}/{MAX_SELECTIONS} selected
            </Text>
          </View>
        </View>

        {/* Priority Selection */}
        <ScrollView style={styles.prioritiesContainer} showsVerticalScrollIndicator={false}>
          <View style={styles.prioritiesGrid}>
            {allPriorities.map((priority) => {
              const isSelected = selectedPriorities.includes(priority.id);
              const isDisabled = !isSelected && selectedPriorities.length >= MAX_SELECTIONS;
              
              return (
                <TouchableOpacity
                  key={priority.id}
                  style={[
                    styles.priorityChip,
                    isSelected && styles.priorityChipSelected,
                    isDisabled && styles.priorityChipDisabled
                  ]}
                  onPress={() => togglePriority(priority.id)}
                  disabled={isDisabled}
                >
                  <Text style={[
                    styles.priorityEmoji,
                    isDisabled && styles.priorityEmojiDisabled
                  ]}>
                    {priority.emoji}
                  </Text>
                  <Text style={[
                    styles.priorityLabel,
                    isSelected && styles.priorityLabelSelected,
                    isDisabled && styles.priorityLabelDisabled
                  ]}>
                    {priority.label}
                  </Text>
                  {isSelected && (
                    <View style={styles.selectedIndicator}>
                      <Text style={styles.checkmark}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}

            {/* Custom Priority Option */}
            {selectedPriorities.length < MAX_SELECTIONS && (
              <>
                {!showCustomInput ? (
                  <TouchableOpacity
                    style={styles.addCustomChip}
                    onPress={() => setShowCustomInput(true)}
                  >
                    <Text style={styles.addCustomEmoji}>➕</Text>
                    <Text style={styles.addCustomLabel}>Add Custom</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.customInputContainer}>
                    <TextInput
                      style={styles.customInput}
                      placeholder="Enter custom priority..."
                      placeholderTextColor="#999"
                      value={customPriority}
                      onChangeText={setCustomPriority}
                      onSubmitEditing={addCustomPriority}
                      autoFocus
                      maxLength={20}
                    />
                    <View style={styles.customInputButtons}>
                      <TouchableOpacity 
                        style={styles.cancelButton} 
                        onPress={() => {
                          setShowCustomInput(false);
                          setCustomPriority('');
                        }}
                      >
                        <Text style={styles.cancelButtonText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={[
                          styles.addButton,
                          !customPriority.trim() && styles.addButtonDisabled
                        ]} 
                        onPress={addCustomPriority}
                        disabled={!customPriority.trim()}
                      >
                        <Text style={styles.addButtonText}>Add</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </>
            )}
          </View>
        </ScrollView>

        {/* Progress Indicator */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: '14%' }]} />
          </View>
          <Text style={styles.progressText}>1 of 7</Text>
        </View>

        {/* CTA */}
        <TouchableOpacity 
          style={[
            styles.nextButton,
            selectedPriorities.length === 0 && styles.nextButtonDisabled
          ]}
          onPress={handleNext}
          disabled={selectedPriorities.length === 0}
        >
          <Text style={[
            styles.nextButtonText,
            selectedPriorities.length === 0 && styles.nextButtonTextDisabled
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
    paddingBottom: 24,
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
    marginBottom: 16,
  },
  selectionCounter: {
    alignItems: 'center',
  },
  counterText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
    backgroundColor: '#e8f4ff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  prioritiesContainer: {
    flex: 1,
  },
  prioritiesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  priorityChip: {
    width: (width - 64) / 3,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative',
    minHeight: 80,
    justifyContent: 'center',
  },
  priorityChipSelected: {
    backgroundColor: '#e8f4ff',
    borderColor: '#007AFF',
  },
  priorityChipDisabled: {
    backgroundColor: '#f0f0f0',
    opacity: 0.5,
  },
  priorityEmoji: {
    fontSize: 20,
    marginBottom: 6,
  },
  priorityEmojiDisabled: {
    opacity: 0.5,
  },
  priorityLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: '#333333',
    textAlign: 'center',
    lineHeight: 14,
  },
  priorityLabelSelected: {
    color: '#007AFF',
    fontWeight: '600',
  },
  priorityLabelDisabled: {
    color: '#999999',
  },
  selectedIndicator: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#007AFF',
    borderRadius: 8,
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  addCustomChip: {
    width: (width - 64) / 3,
    backgroundColor: '#f0f0f0',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e0e0e0',
    borderStyle: 'dashed',
    minHeight: 80,
    justifyContent: 'center',
  },
  addCustomEmoji: {
    fontSize: 20,
    marginBottom: 6,
  },
  addCustomLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: '#666666',
    textAlign: 'center',
  },
  customInputContainer: {
    width: (width - 48),
    backgroundColor: '#f8f9fa',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#007AFF',
  },
  customInput: {
    fontSize: 16,
    color: '#333333',
    marginBottom: 12,
    textAlign: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  customInputButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cancelButton: {
    backgroundColor: '#f0f0f0',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    flex: 1,
    marginRight: 8,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#666666',
    fontSize: 14,
    fontWeight: '600',
  },
  addButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    flex: 1,
    marginLeft: 8,
    alignItems: 'center',
  },
  addButtonDisabled: {
    backgroundColor: '#e0e0e0',
  },
  addButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
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