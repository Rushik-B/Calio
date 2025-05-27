import React, { useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    Keyboard,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

const { width } = Dimensions.get('window');

interface QuickAction {
  id: string;
  label: string;
  icon: string;
  template: string;
  category: 'schedule' | 'modify' | 'protect' | 'undo' | 'habit';
}

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

interface QuickActionBarProps {
  onAction: (intent: ParsedIntent) => void;
  visible: boolean;
  onClose: () => void;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'move_event',
    label: 'Move Event',
    icon: '🔄',
    template: 'Move [event] to [time]',
    category: 'modify',
  },
  {
    id: 'add_meeting',
    label: 'Add Meeting',
    icon: '➕',
    template: 'Schedule [meeting] with [person] on [day/time]',
    category: 'schedule',
  },
  {
    id: 'clear_day',
    label: 'Clear Day',
    icon: '🧹',
    template: 'Clear my [day/time period]',
    category: 'modify',
  },
  {
    id: 'protect_time',
    label: 'Protect Time',
    icon: '🛡️',
    template: 'Protect [time period] for [activity]',
    category: 'protect',
  },
  {
    id: 'change_habit',
    label: 'Change Habit',
    icon: '🔁',
    template: 'Change [habit] to [frequency]',
    category: 'habit',
  },
  {
    id: 'undo_action',
    label: 'Undo Action',
    icon: '↩️',
    template: 'Undo [recent action]',
    category: 'undo',
  },
  {
    id: 'reschedule_all',
    label: 'Reschedule All',
    icon: '📅',
    template: 'Reschedule all [day] meetings to [new day]',
    category: 'modify',
  },
  {
    id: 'block_focus',
    label: 'Block Focus',
    icon: '🎯',
    template: 'Block [duration] focus time on [day]',
    category: 'protect',
  },
];

const EXAMPLE_COMMANDS = [
  "move standup to 4 pm",
  "schedule coffee with Sarah tomorrow",
  "clear Friday afternoon",
  "protect my mornings this week",
  "cancel tomorrow's gym",
  "reschedule all Monday meetings to Tuesday",
];

export default function QuickActionBar({ onAction, visible, onClose }: QuickActionBarProps) {
  const [inputText, setInputText] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [filteredActions, setFilteredActions] = useState(QUICK_ACTIONS);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showClarification, setShowClarification] = useState(false);
  const [clarificationData, setClarificationData] = useState<ParsedIntent | null>(null);
  
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
      
      // Auto-focus input when visible
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    } else {
      fadeAnim.setValue(0);
      slideAnim.setValue(50);
      setInputText('');
      setShowSuggestions(true);
      setShowClarification(false);
    }
  }, [visible]);

  useEffect(() => {
    // Filter actions based on input text
    if (inputText.length > 0) {
      const filtered = QUICK_ACTIONS.filter(action =>
        action.label.toLowerCase().includes(inputText.toLowerCase()) ||
        action.template.toLowerCase().includes(inputText.toLowerCase())
      );
      setFilteredActions(filtered);
      setShowSuggestions(filtered.length > 0);
    } else {
      setFilteredActions(QUICK_ACTIONS);
      setShowSuggestions(true);
    }
  }, [inputText]);

  const parseIntent = async (text: string): Promise<ParsedIntent> => {
    // Simulate intent parsing - in real app, this would call your backend
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const lowerText = text.toLowerCase();
    
    // Simple pattern matching for demo
    if (lowerText.includes('move') && lowerText.includes('standup')) {
      if (lowerText.includes('4 pm') || lowerText.includes('4pm')) {
        return {
          intent: 'move_event',
          parameters: { event: 'standup', newTime: '16:00', day: 'today' },
          confidence: 0.95,
        };
      } else {
        return {
          intent: 'move_event',
          parameters: { event: 'standup' },
          confidence: 0.7,
          clarifications: ['What time should I move the standup to?'],
          actions: [
            { id: 'move_2pm', description: 'Move to 2:00 PM', type: 'primary' },
            { id: 'move_3pm', description: 'Move to 3:00 PM', type: 'primary' },
            { id: 'move_4pm', description: 'Move to 4:00 PM', type: 'primary' },
            { id: 'move_tomorrow', description: 'Move to tomorrow', type: 'secondary' },
          ],
        };
      }
    }
    
    if (lowerText.includes('clear') && lowerText.includes('friday')) {
      return {
        intent: 'clear_day',
        parameters: { day: 'friday', period: lowerText.includes('afternoon') ? 'afternoon' : 'all_day' },
        confidence: 0.9,
      };
    }
    
    if (lowerText.includes('schedule') && lowerText.includes('coffee')) {
      const hasPerson = lowerText.includes('sarah');
      const hasTime = lowerText.includes('tomorrow') || lowerText.includes('2 pm');
      
      if (hasPerson && hasTime) {
        return {
          intent: 'add_meeting',
          parameters: { 
            meeting: 'coffee', 
            person: 'Sarah', 
            time: lowerText.includes('2 pm') ? '14:00' : 'tomorrow',
            day: lowerText.includes('tomorrow') ? 'tomorrow' : 'today'
          },
          confidence: 0.95,
        };
      } else {
        return {
          intent: 'add_meeting',
          parameters: { meeting: 'coffee' },
          confidence: 0.6,
          clarifications: ['Who should I schedule coffee with and when?'],
          actions: [
            { id: 'coffee_sarah_tomorrow', description: 'Coffee with Sarah tomorrow 2 PM', type: 'primary' },
            { id: 'coffee_team_friday', description: 'Team coffee Friday 3 PM', type: 'secondary' },
            { id: 'specify_details', description: 'Let me specify details', type: 'secondary' },
          ],
        };
      }
    }
    
    if (lowerText.includes('protect') && lowerText.includes('morning')) {
      return {
        intent: 'protect_time',
        parameters: { 
          period: 'mornings', 
          duration: lowerText.includes('week') ? 'this_week' : 'today',
          activity: 'focus time'
        },
        confidence: 0.9,
      };
    }
    
    // Default fallback for unrecognized input
    return {
      intent: 'unknown',
      parameters: { originalText: text },
      confidence: 0.1,
      clarifications: ['I didn\'t quite understand that. Did you mean one of these?'],
      actions: [
        { id: 'move_event', description: 'Move an event', type: 'primary' },
        { id: 'add_meeting', description: 'Schedule a meeting', type: 'primary' },
        { id: 'clear_time', description: 'Clear some time', type: 'primary' },
        { id: 'protect_time', description: 'Protect focus time', type: 'secondary' },
      ],
    };
  };

  const handleSubmit = async () => {
    if (!inputText.trim()) return;
    
    setIsProcessing(true);
    Keyboard.dismiss();
    
    try {
      const intent = await parseIntent(inputText);
      
      if (intent.confidence < 0.8 && intent.clarifications) {
        setClarificationData(intent);
        setShowClarification(true);
      } else {
        onAction(intent);
        onClose();
      }
    } catch (error) {
      console.error('Error parsing intent:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleChipPress = (action: QuickAction) => {
    setInputText(action.template);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleExamplePress = (example: string) => {
    setInputText(example);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleClarificationAction = (actionId: string) => {
    if (!clarificationData) return;
    
    // Update the intent with the selected clarification
    const updatedIntent: ParsedIntent = {
      ...clarificationData,
      confidence: 0.95,
      clarifications: undefined,
    };
    
    // Update parameters based on selected action
    if (actionId === 'move_4pm') {
      updatedIntent.parameters.newTime = '16:00';
    } else if (actionId === 'coffee_sarah_tomorrow') {
      updatedIntent.parameters = {
        meeting: 'coffee',
        person: 'Sarah',
        day: 'tomorrow',
        time: '14:00',
      };
    }
    // Add more action mappings as needed
    
    onAction(updatedIntent);
    setShowClarification(false);
    onClose();
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'schedule': return '#007AFF';
      case 'modify': return '#FF9500';
      case 'protect': return '#34C759';
      case 'undo': return '#FF3B30';
      case 'habit': return '#AF52DE';
      default: return '#8E8E93';
    }
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} onPress={onClose} />
        
        <Animated.View
          style={[
            styles.container,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>⚡ Instruct Calio</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Input Bar */}
          <View style={styles.inputContainer}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="Type what you want me to do..."
              placeholderTextColor="#999"
              value={inputText}
              onChangeText={setInputText}
              onSubmitEditing={handleSubmit}
              multiline={false}
              returnKeyType="send"
            />
            <TouchableOpacity
              style={[styles.sendButton, isProcessing && styles.sendButtonDisabled]}
              onPress={handleSubmit}
              disabled={isProcessing || !inputText.trim()}
            >
              <Text style={styles.sendButtonText}>
                {isProcessing ? '⏳' : '→'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Examples */}
          {inputText.length === 0 && (
            <View style={styles.examplesContainer}>
              <Text style={styles.examplesTitle}>Try saying:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {EXAMPLE_COMMANDS.map((example, index) => (
                  <TouchableOpacity
                    key={index}
                    style={styles.exampleChip}
                    onPress={() => handleExamplePress(example)}
                  >
                    <Text style={styles.exampleText}>"{example}"</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Quick Action Chips */}
          {showSuggestions && (
            <View style={styles.chipsContainer}>
              <Text style={styles.chipsTitle}>Quick Actions:</Text>
              <View style={styles.chipsGrid}>
                {filteredActions.slice(0, 6).map((action) => (
                  <TouchableOpacity
                    key={action.id}
                    style={[
                      styles.actionChip,
                      { borderColor: getCategoryColor(action.category) },
                    ]}
                    onPress={() => handleChipPress(action)}
                  >
                    <Text style={styles.actionChipIcon}>{action.icon}</Text>
                    <Text style={styles.actionChipText}>{action.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </Animated.View>

        {/* Clarification Modal */}
        {showClarification && clarificationData && (
          <Animated.View style={styles.clarificationModal}>
            <View style={styles.clarificationContent}>
              <Text style={styles.clarificationTitle}>
                {clarificationData.clarifications?.[0]}
              </Text>
              <View style={styles.clarificationActions}>
                {clarificationData.actions?.map((action) => (
                  <TouchableOpacity
                    key={action.id}
                    style={[
                      styles.clarificationButton,
                      action.type === 'primary' && styles.clarificationButtonPrimary,
                    ]}
                    onPress={() => handleClarificationAction(action.id)}
                  >
                    <Text
                      style={[
                        styles.clarificationButtonText,
                        action.type === 'primary' && styles.clarificationButtonTextPrimary,
                      ]}
                    >
                      {action.description}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={styles.clarificationCancel}
                onPress={() => setShowClarification(false)}
              >
                <Text style={styles.clarificationCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
  },
  container: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 34, // Safe area
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontSize: 16,
    color: '#666666',
    fontWeight: '600',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#1A1A1A',
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#C7C7CC',
  },
  sendButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  examplesContainer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  examplesTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666666',
    marginBottom: 8,
  },
  exampleChip: {
    backgroundColor: '#F0F9FF',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  exampleText: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: '500',
  },
  chipsContainer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  chipsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666666',
    marginBottom: 12,
  },
  chipsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    marginBottom: 8,
    minWidth: (width - 56) / 2, // Two columns with spacing
  },
  actionChipIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  actionChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A1A',
    flex: 1,
  },
  clarificationModal: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  clarificationContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
  },
  clarificationTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 16,
    textAlign: 'center',
  },
  clarificationActions: {
    gap: 8,
    marginBottom: 16,
  },
  clarificationButton: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  clarificationButtonPrimary: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  clarificationButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
    textAlign: 'center',
  },
  clarificationButtonTextPrimary: {
    color: '#FFFFFF',
  },
  clarificationCancel: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  clarificationCancelText: {
    fontSize: 16,
    color: '#666666',
    fontWeight: '500',
  },
}); 