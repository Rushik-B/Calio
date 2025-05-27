import React, { useEffect, useRef } from 'react';
import {
    Animated,
    Dimensions,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const { width } = Dimensions.get('window');

interface ActionConfirmationProps {
  visible: boolean;
  message: string;
  icon?: string;
  onUndo?: () => void;
  onDismiss: () => void;
  autoHideDuration?: number;
}

export default function ActionConfirmation({
  visible,
  message,
  icon = '✅',
  onUndo,
  onDismiss,
  autoHideDuration = 4000,
}: ActionConfirmationProps) {
  const translateY = useRef(new Animated.Value(100)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Show animation
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto-hide after duration
      const timer = setTimeout(() => {
        hideConfirmation();
      }, autoHideDuration);

      return () => clearTimeout(timer);
    } else {
      hideConfirmation();
    }
  }, [visible]);

  const hideConfirmation = () => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 100,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss();
    });
  };

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ translateY }],
          opacity,
        },
      ]}
    >
      <View style={styles.content}>
        <View style={styles.messageContainer}>
          <Text style={styles.icon}>{icon}</Text>
          <Text style={styles.message}>{message}</Text>
        </View>
        
        <View style={styles.actions}>
          {onUndo && (
            <TouchableOpacity style={styles.undoButton} onPress={onUndo}>
              <Text style={styles.undoText}>Undo</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.dismissButton} onPress={hideConfirmation}>
            <Text style={styles.dismissText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 120, // Above floating action button
    left: 20,
    right: 20,
    zIndex: 1001,
  },
  content: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  messageContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  icon: {
    fontSize: 16,
    marginRight: 8,
  },
  message: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
  },
  undoButton: {
    backgroundColor: '#007AFF',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginRight: 8,
  },
  undoText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  dismissButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
  },
}); 