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

interface TimeConstraint {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
}

interface CustomConstraint {
  id: string;
  text: string;
  timestamp: Date;
}

interface TimeBlock {
  id: string;
  day: string;
  startHour: number;
  endHour: number;
  label: string;
  color: string;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export default function ConstraintsScreen() {
  const [constraints, setConstraints] = useState<TimeConstraint[]>([
    {
      id: 'evenings',
      label: 'No meetings after 8pm',
      description: 'Protect your evening time',
      enabled: false,
    },
    {
      id: 'weekends',
      label: 'No work on weekends',
      description: 'Keep weekends free from work',
      enabled: false,
    },
    {
      id: 'lunch',
      label: 'Lunch break 12-1pm',
      description: 'Block lunch time daily',
      enabled: false,
    },
    {
      id: 'mornings',
      label: 'No meetings before 9am',
      description: 'Protect your morning routine',
      enabled: false,
    },
  ]);

  const [customConstraints, setCustomConstraints] = useState<CustomConstraint[]>([]);
  const [customInput, setCustomInput] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([
    {
      id: 'sleep',
      day: 'all',
      startHour: 22,
      endHour: 7,
      label: 'Sleep',
      color: '#5856D6',
    },
    {
      id: 'lunch',
      day: 'weekdays',
      startHour: 12,
      endHour: 13,
      label: 'Lunch',
      color: '#FF9500',
    },
  ]);
  const [selectedTimeSlots, setSelectedTimeSlots] = useState<Set<string>>(new Set());
  const [isCreatingBlock, setIsCreatingBlock] = useState(false);
  const [newBlockLabel, setNewBlockLabel] = useState('');

  const toggleConstraint = (id: string) => {
    setConstraints(prev => 
      prev.map(constraint => 
        constraint.id === id 
          ? { ...constraint, enabled: !constraint.enabled }
          : constraint
      )
    );
  };

  const addCustomConstraint = () => {
    if (customInput.trim()) {
      const newConstraint: CustomConstraint = {
        id: `custom-${Date.now()}`,
        text: customInput.trim(),
        timestamp: new Date(),
      };
      setCustomConstraints(prev => [...prev, newConstraint]);
      setCustomInput('');
      setShowCustomInput(false);
    }
  };

  const removeCustomConstraint = (id: string) => {
    setCustomConstraints(prev => prev.filter(c => c.id !== id));
  };

  const toggleTimeSlot = (day: string, hour: number) => {
    const slotId = `${day}-${hour}`;
    setSelectedTimeSlots(prev => {
      const newSet = new Set(prev);
      if (newSet.has(slotId)) {
        newSet.delete(slotId);
      } else {
        newSet.add(slotId);
      }
      return newSet;
    });
  };

  const createTimeBlock = () => {
    if (selectedTimeSlots.size > 0 && newBlockLabel.trim()) {
      const slots = Array.from(selectedTimeSlots);
      const colors = ['#FF3B30', '#FF9500', '#FFCC02', '#34C759', '#007AFF', '#5856D6', '#AF52DE'];
      const randomColor = colors[Math.floor(Math.random() * colors.length)];
      
      const newBlock: TimeBlock = {
        id: `block-${Date.now()}`,
        day: 'custom',
        startHour: Math.min(...slots.map(s => parseInt(s.split('-')[1]))),
        endHour: Math.max(...slots.map(s => parseInt(s.split('-')[1]))) + 1,
        label: newBlockLabel.trim(),
        color: randomColor,
      };
      
      setTimeBlocks(prev => [...prev, newBlock]);
      setSelectedTimeSlots(new Set());
      setNewBlockLabel('');
      setIsCreatingBlock(false);
    }
  };

  const isTimeSlotBlocked = (day: string, hour: number) => {
    return timeBlocks.some(block => {
      if (block.day === 'all' || 
          (block.day === 'weekdays' && !['Sat', 'Sun'].includes(day)) ||
          block.day === 'custom') {
        return hour >= block.startHour && hour < block.endHour;
      }
      return false;
    });
  };

  const getTimeSlotColor = (day: string, hour: number) => {
    const block = timeBlocks.find(block => {
      if (block.day === 'all' || 
          (block.day === 'weekdays' && !['Sat', 'Sun'].includes(day)) ||
          block.day === 'custom') {
        return hour >= block.startHour && hour < block.endHour;
      }
      return false;
    });
    return block?.color || '#f0f0f0';
  };

  const handleNext = () => {
    router.push('/(onboarding)/calendar-connection');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>When are you always off-limits?</Text>
          <Text style={styles.subtitle}>
            Block times Calio should never schedule over.
          </Text>
        </View>

        {/* Quick Constraints */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Options</Text>
          {constraints.map((constraint) => (
            <TouchableOpacity
              key={constraint.id}
              style={[
                styles.constraintCard,
                constraint.enabled && styles.constraintCardEnabled
              ]}
              onPress={() => toggleConstraint(constraint.id)}
            >
              <View style={styles.constraintContent}>
                <View style={styles.constraintInfo}>
                  <Text style={[
                    styles.constraintLabel,
                    constraint.enabled && styles.constraintLabelEnabled
                  ]}>
                    {constraint.label}
                  </Text>
                  <Text style={styles.constraintDescription}>
                    {constraint.description}
                  </Text>
                </View>
                <View style={[
                  styles.toggle,
                  constraint.enabled && styles.toggleEnabled
                ]}>
                  <View style={[
                    styles.toggleKnob,
                    constraint.enabled && styles.toggleKnobEnabled
                  ]} />
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Custom Constraints */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tell me more</Text>
          <Text style={styles.sectionSubtitle}>
            Describe any other times you need protected in your own words
          </Text>
          
          {/* Custom Constraints List */}
          {customConstraints.map((constraint) => (
            <View key={constraint.id} style={styles.customConstraintCard}>
              <View style={styles.messageContainer}>
                <View style={styles.userMessage}>
                  <Text style={styles.userMessageText}>{constraint.text}</Text>
                  <Text style={styles.messageTime}>
                    {constraint.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
                <TouchableOpacity 
                  style={styles.removeButton}
                  onPress={() => removeCustomConstraint(constraint.id)}
                >
                  <Text style={styles.removeButtonText}>×</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.botResponse}>
                <Text style={styles.botResponseText}>
                  Got it! I'll make sure to protect that time for you. 👍
                </Text>
              </View>
            </View>
          ))}

          {/* Custom Input */}
          {!showCustomInput ? (
            <TouchableOpacity
              style={styles.addCustomButton}
              onPress={() => setShowCustomInput(true)}
            >
              <Text style={styles.addCustomIcon}>💬</Text>
              <Text style={styles.addCustomText}>Add custom constraint</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.customInputContainer}>
              <Text style={styles.inputLabel}>Tell me about your time constraints:</Text>
              <TextInput
                style={styles.customTextInput}
                placeholder="e.g., No calls during my kids' bedtime (7-8pm), Block Friday afternoons for deep work, Keep mornings free for exercise..."
                placeholderTextColor="#999"
                value={customInput}
                onChangeText={setCustomInput}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                autoFocus
              />
              <View style={styles.inputButtons}>
                <TouchableOpacity 
                  style={styles.cancelButton}
                  onPress={() => {
                    setShowCustomInput(false);
                    setCustomInput('');
                  }}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[
                    styles.sendButton,
                    !customInput.trim() && styles.sendButtonDisabled
                  ]}
                  onPress={addCustomConstraint}
                  disabled={!customInput.trim()}
                >
                  <Text style={styles.sendButtonText}>Send</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Time Blocking UI */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Visual Time Blocks</Text>
          <Text style={styles.sectionSubtitle}>
            Tap and drag to create custom time blocks
          </Text>
          
          {/* Time Grid */}
          <View style={styles.timeGrid}>
            {/* Header with days */}
            <View style={styles.timeGridHeader}>
              <View style={styles.timeLabel} />
              {DAYS.map(day => (
                <Text key={day} style={styles.dayLabel}>{day}</Text>
              ))}
            </View>
            
            {/* Time slots */}
            <ScrollView style={styles.timeGridBody} nestedScrollEnabled>
              {HOURS.map(hour => (
                <View key={hour} style={styles.timeRow}>
                  <Text style={styles.hourLabel}>
                    {hour === 0 ? '12am' : hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`}
                  </Text>
                  {DAYS.map(day => {
                    const slotId = `${day}-${hour}`;
                    const isSelected = selectedTimeSlots.has(slotId);
                    const isBlocked = isTimeSlotBlocked(day, hour);
                    const blockColor = getTimeSlotColor(day, hour);
                    
                    return (
                      <TouchableOpacity
                        key={slotId}
                        style={[
                          styles.timeSlot,
                          isSelected && styles.timeSlotSelected,
                          isBlocked && { backgroundColor: blockColor },
                        ]}
                        onPress={() => !isBlocked && toggleTimeSlot(day, hour)}
                        disabled={isBlocked}
                      />
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </View>

          {/* Create Block Controls */}
          {selectedTimeSlots.size > 0 && (
            <View style={styles.createBlockContainer}>
              {!isCreatingBlock ? (
                <TouchableOpacity
                  style={styles.createBlockButton}
                  onPress={() => setIsCreatingBlock(true)}
                >
                  <Text style={styles.createBlockButtonText}>
                    Create Block ({selectedTimeSlots.size} slots selected)
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.blockLabelContainer}>
                  <TextInput
                    style={styles.blockLabelInput}
                    placeholder="Block name (e.g., Focus Time, Family Time)"
                    placeholderTextColor="#999"
                    value={newBlockLabel}
                    onChangeText={setNewBlockLabel}
                    autoFocus
                  />
                  <View style={styles.blockLabelButtons}>
                    <TouchableOpacity
                      style={styles.cancelBlockButton}
                      onPress={() => {
                        setIsCreatingBlock(false);
                        setNewBlockLabel('');
                      }}
                    >
                      <Text style={styles.cancelBlockButtonText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.saveBlockButton,
                        !newBlockLabel.trim() && styles.saveBlockButtonDisabled
                      ]}
                      onPress={createTimeBlock}
                      disabled={!newBlockLabel.trim()}
                    >
                      <Text style={styles.saveBlockButtonText}>Create</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Legend */}
          <View style={styles.legend}>
            {timeBlocks.map(block => (
              <View key={block.id} style={styles.legendItem}>
                <View style={[styles.legendColor, { backgroundColor: block.color }]} />
                <Text style={styles.legendText}>{block.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Progress Indicator */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: '42%' }]} />
          </View>
          <Text style={styles.progressText}>3 of 7</Text>
        </View>

        {/* CTA */}
        <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
          <Text style={styles.nextButtonText}>Next</Text>
        </TouchableOpacity>
      </ScrollView>
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
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 16,
    lineHeight: 20,
  },
  constraintCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  constraintCardEnabled: {
    backgroundColor: '#e8f4ff',
    borderColor: '#007AFF',
  },
  constraintContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  constraintInfo: {
    flex: 1,
    marginRight: 16,
  },
  constraintLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 4,
  },
  constraintLabelEnabled: {
    color: '#007AFF',
  },
  constraintDescription: {
    fontSize: 14,
    color: '#666666',
  },
  toggle: {
    width: 50,
    height: 30,
    backgroundColor: '#e0e0e0',
    borderRadius: 15,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleEnabled: {
    backgroundColor: '#007AFF',
  },
  toggleKnob: {
    width: 26,
    height: 26,
    backgroundColor: '#ffffff',
    borderRadius: 13,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  toggleKnobEnabled: {
    alignSelf: 'flex-end',
  },
  customConstraintCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  messageContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  userMessage: {
    flex: 1,
    backgroundColor: '#007AFF',
    borderRadius: 16,
    padding: 12,
    marginRight: 8,
  },
  userMessageText: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 18,
  },
  messageTime: {
    color: '#e0e0e0',
    fontSize: 10,
    marginTop: 4,
  },
  removeButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  botResponse: {
    backgroundColor: '#e0e0e0',
    borderRadius: 16,
    padding: 12,
    alignSelf: 'flex-start',
    maxWidth: '80%',
  },
  botResponseText: {
    color: '#333333',
    fontSize: 14,
    lineHeight: 18,
  },
  addCustomButton: {
    backgroundColor: '#f0f0f0',
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#e0e0e0',
    borderStyle: 'dashed',
  },
  addCustomIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  addCustomText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#666666',
  },
  customInputContainer: {
    backgroundColor: '#f8f9fa',
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
    borderColor: '#007AFF',
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
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
    minHeight: 80,
    marginBottom: 12,
  },
  inputButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cancelButton: {
    backgroundColor: '#f0f0f0',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    flex: 1,
    marginRight: 8,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#666666',
    fontSize: 16,
    fontWeight: '600',
  },
  sendButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    flex: 1,
    marginLeft: 8,
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#e0e0e0',
  },
  sendButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  timeGrid: {
    backgroundColor: '#f8f9fa',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  timeGridHeader: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  timeLabel: {
    width: 50,
  },
  dayLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: '#666666',
  },
  timeGridBody: {
    maxHeight: 300,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  hourLabel: {
    width: 50,
    fontSize: 10,
    color: '#666666',
    textAlign: 'right',
    paddingRight: 8,
  },
  timeSlot: {
    flex: 1,
    height: 20,
    backgroundColor: '#ffffff',
    marginHorizontal: 1,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  timeSlotSelected: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  createBlockContainer: {
    marginBottom: 16,
  },
  createBlockButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  createBlockButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  blockLabelContainer: {
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: '#007AFF',
  },
  blockLabelInput: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#333333',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginBottom: 12,
  },
  blockLabelButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cancelBlockButton: {
    backgroundColor: '#f0f0f0',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    flex: 1,
    marginRight: 8,
    alignItems: 'center',
  },
  cancelBlockButtonText: {
    color: '#666666',
    fontSize: 14,
    fontWeight: '600',
  },
  saveBlockButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    flex: 1,
    marginLeft: 8,
    alignItems: 'center',
  },
  saveBlockButtonDisabled: {
    backgroundColor: '#e0e0e0',
  },
  saveBlockButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
    marginBottom: 8,
  },
  legendColor: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 6,
  },
  legendText: {
    fontSize: 12,
    color: '#666666',
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