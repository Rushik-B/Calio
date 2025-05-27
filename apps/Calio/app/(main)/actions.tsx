import React, { useEffect, useState } from 'react';
import {
    Animated,
    Dimensions,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const { width, height } = Dimensions.get('window');

interface AgentAction {
  id: string;
  type: 'completed' | 'pending' | 'conflict' | 'suggestion' | 'notification';
  priority: 'high' | 'medium' | 'low';
  icon: string;
  title: string;
  description: string;
  timestamp: Date;
  status: 'new' | 'seen' | 'acted';
  actions: Array<{
    label: string;
    type: 'primary' | 'secondary' | 'danger';
    onPress: () => void;
  }>;
  metadata?: {
    affectedEvents?: string[];
    originalTime?: string;
    newTime?: string;
    reason?: string;
  };
}

export default function ActionsScreen() {
  const [fadeAnim] = useState(new Animated.Value(0));
  const [slideAnim] = useState(new Animated.Value(40));
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all');

  const [agentActions] = useState<AgentAction[]>([
    {
      id: '1',
      type: 'pending',
      priority: 'high',
      icon: '⚠️',
      title: 'Conflict detected: Standup vs Gym',
      description: 'Your standup meeting overlaps with gym time. Calio suggests moving the standup to 2:30 PM.',
      timestamp: new Date(Date.now() - 5 * 60 * 1000),
      status: 'new',
      actions: [
        { label: 'Apply Fix', type: 'primary', onPress: () => console.log('Apply fix') },
        { label: 'Ignore', type: 'secondary', onPress: () => console.log('Ignore') },
        { label: 'Custom Fix', type: 'secondary', onPress: () => console.log('Custom fix') },
      ],
      metadata: {
        affectedEvents: ['Standup', 'Gym'],
        originalTime: '2:00 PM',
        newTime: '2:30 PM',
        reason: 'Overlap with protected gym time',
      },
    },
    {
      id: '2',
      type: 'completed',
      priority: 'medium',
      icon: '✅',
      title: 'Meeting moved successfully',
      description: 'Moved "Design Review" from 3:00 PM to 4:00 PM and notified all attendees.',
      timestamp: new Date(Date.now() - 30 * 60 * 1000),
      status: 'seen',
      actions: [
        { label: 'Undo', type: 'danger', onPress: () => console.log('Undo move') },
        { label: 'Details', type: 'secondary', onPress: () => console.log('Show details') },
      ],
      metadata: {
        affectedEvents: ['Design Review'],
        originalTime: '3:00 PM',
        newTime: '4:00 PM',
        reason: 'Conflict with focus time',
      },
    },
    {
      id: '3',
      type: 'completed',
      priority: 'low',
      icon: '🛡️',
      title: 'Focus time protected',
      description: 'Blocked 2-hour deep work session from 10:00 AM - 12:00 PM. No meetings will be scheduled during this time.',
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
      status: 'seen',
      actions: [
        { label: 'Adjust', type: 'secondary', onPress: () => console.log('Adjust focus time') },
      ],
    },
    {
      id: '4',
      type: 'suggestion',
      priority: 'medium',
      icon: '💡',
      title: 'Optimize your Friday',
      description: 'You have 6 meetings on Friday. Calio can move 2 non-urgent meetings to next week for better focus.',
      timestamp: new Date(Date.now() - 45 * 60 * 1000),
      status: 'new',
      actions: [
        { label: 'Auto-optimize', type: 'primary', onPress: () => console.log('Auto optimize') },
        { label: 'Review', type: 'secondary', onPress: () => console.log('Review suggestions') },
        { label: 'Dismiss', type: 'secondary', onPress: () => console.log('Dismiss') },
      ],
    },
    {
      id: '5',
      type: 'notification',
      priority: 'low',
      icon: '📧',
      title: 'Email sent to team',
      description: 'Sent update about rescheduled standup to all team members with new meeting details.',
      timestamp: new Date(Date.now() - 35 * 60 * 1000),
      status: 'seen',
      actions: [
        { label: 'View Email', type: 'secondary', onPress: () => console.log('View email') },
      ],
    },
    {
      id: '6',
      type: 'completed',
      priority: 'medium',
      icon: '🏃‍♂️',
      title: 'Gym session rescheduled',
      description: 'Moved gym from 5:00 PM to 7:00 PM due to client call running over. Updated calendar.',
      timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000),
      status: 'seen',
      actions: [
        { label: 'Undo', type: 'danger', onPress: () => console.log('Undo gym move') },
        { label: 'OK', type: 'primary', onPress: () => console.log('Approve gym move') },
      ],
      metadata: {
        affectedEvents: ['Gym'],
        originalTime: '5:00 PM',
        newTime: '7:00 PM',
        reason: 'Client call extension',
      },
    },
  ]);

  const filteredActions = agentActions.filter(action => {
    if (filter === 'all') return true;
    if (filter === 'pending') return action.type === 'pending' || action.type === 'conflict' || action.type === 'suggestion';
    if (filter === 'completed') return action.type === 'completed' || action.type === 'notification';
    return true;
  });

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

  const getActionColor = (type: string) => {
    switch (type) {
      case 'completed': return '#E8F5E8';
      case 'pending': return '#FFF3E0';
      case 'conflict': return '#FFEBEE';
      case 'suggestion': return '#E3F2FD';
      case 'notification': return '#F3E5F5';
      default: return '#F8F9FA';
    }
  };

  const getActionBorderColor = (type: string) => {
    switch (type) {
      case 'completed': return '#4CAF50';
      case 'pending': return '#FF9800';
      case 'conflict': return '#F44336';
      case 'suggestion': return '#2196F3';
      case 'notification': return '#9C27B0';
      default: return '#E0E0E0';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return '#FF3B30';
      case 'medium': return '#FF9500';
      case 'low': return '#34C759';
      default: return '#8E8E93';
    }
  };

  const getFilterCount = (filterType: string) => {
    if (filterType === 'all') return agentActions.length;
    if (filterType === 'pending') return agentActions.filter(a => a.type === 'pending' || a.type === 'conflict' || a.type === 'suggestion').length;
    if (filterType === 'completed') return agentActions.filter(a => a.type === 'completed' || a.type === 'notification').length;
    return 0;
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
          <Text style={styles.headerTitle}>Agent Actions</Text>
          <Text style={styles.headerSubtitle}>What Calio has been doing for you</Text>
        </View>

        {/* Filter Tabs */}
        <View style={styles.filterContainer}>
          {[
            { key: 'all', label: 'All' },
            { key: 'pending', label: 'Pending' },
            { key: 'completed', label: 'Completed' },
          ].map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.filterTab,
                filter === tab.key && styles.filterTabActive,
              ]}
              onPress={() => setFilter(tab.key as any)}
            >
              <Text style={[
                styles.filterTabText,
                filter === tab.key && styles.filterTabTextActive,
              ]}>
                {tab.label}
              </Text>
              <View style={[
                styles.filterTabBadge,
                filter === tab.key && styles.filterTabBadgeActive,
              ]}>
                <Text style={[
                  styles.filterTabBadgeText,
                  filter === tab.key && styles.filterTabBadgeTextActive,
                ]}>
                  {getFilterCount(tab.key)}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          {/* Actions List */}
          <View style={styles.section}>
            {filteredActions.map((action, index) => (
              <Animated.View
                key={action.id}
                style={[
                  styles.actionCard,
                  {
                    backgroundColor: getActionColor(action.type),
                    borderColor: getActionBorderColor(action.type),
                    opacity: fadeAnim,
                    transform: [{
                      translateY: slideAnim.interpolate({
                        inputRange: [0, 40],
                        outputRange: [0, 40 + index * 10],
                      }),
                    }],
                  },
                ]}
              >
                {/* Status Indicator */}
                {action.status === 'new' && (
                  <View style={styles.newIndicator}>
                    <Text style={styles.newIndicatorText}>NEW</Text>
                  </View>
                )}

                {/* Priority Indicator */}
                <View style={[styles.priorityIndicator, { backgroundColor: getPriorityColor(action.priority) }]} />

                <View style={styles.cardHeader}>
                  <View style={styles.cardIcon}>
                    <Text style={styles.cardIconText}>{action.icon}</Text>
                  </View>
                  <View style={styles.cardContent}>
                    <Text style={styles.cardTitle}>{action.title}</Text>
                    <Text style={styles.cardDescription}>{action.description}</Text>
                    <Text style={styles.cardTimestamp}>
                      {action.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • 
                      {action.timestamp.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </Text>
                  </View>
                </View>

                {/* Metadata */}
                {action.metadata && (
                  <View style={styles.metadata}>
                    {action.metadata.originalTime && action.metadata.newTime && (
                      <View style={styles.metadataRow}>
                        <Text style={styles.metadataLabel}>Time change:</Text>
                        <Text style={styles.metadataValue}>
                          {action.metadata.originalTime} → {action.metadata.newTime}
                        </Text>
                      </View>
                    )}
                    {action.metadata.reason && (
                      <View style={styles.metadataRow}>
                        <Text style={styles.metadataLabel}>Reason:</Text>
                        <Text style={styles.metadataValue}>{action.metadata.reason}</Text>
                      </View>
                    )}
                    {action.metadata.affectedEvents && (
                      <View style={styles.metadataRow}>
                        <Text style={styles.metadataLabel}>Events:</Text>
                        <Text style={styles.metadataValue}>
                          {action.metadata.affectedEvents.join(', ')}
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Actions */}
                <View style={styles.cardActions}>
                  {action.actions.map((actionButton, actionIndex) => (
                    <TouchableOpacity
                      key={actionIndex}
                      style={[
                        styles.actionButton,
                        actionButton.type === 'primary' && styles.actionButtonPrimary,
                        actionButton.type === 'danger' && styles.actionButtonDanger,
                      ]}
                      onPress={actionButton.onPress}
                    >
                      <Text style={[
                        styles.actionButtonText,
                        actionButton.type === 'primary' && styles.actionButtonTextPrimary,
                        actionButton.type === 'danger' && styles.actionButtonTextDanger,
                      ]}>
                        {actionButton.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </Animated.View>
            ))}

            {filteredActions.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateEmoji}>🎉</Text>
                <Text style={styles.emptyStateTitle}>All caught up!</Text>
                <Text style={styles.emptyStateDescription}>
                  No {filter === 'all' ? '' : filter} actions at the moment.
                </Text>
              </View>
            )}
          </View>

          {/* Summary Stats */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Today's Summary</Text>
            <View style={styles.statsContainer}>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>12</Text>
                <Text style={styles.statLabel}>Actions Taken</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>3</Text>
                <Text style={styles.statLabel}>Conflicts Resolved</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>2h</Text>
                <Text style={styles.statLabel}>Time Saved</Text>
              </View>
            </View>
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
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  filterTab: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginRight: 8,
    borderWidth: 2,
    borderColor: '#E0E0E0',
  },
  filterTabActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  filterTabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666666',
    marginRight: 8,
  },
  filterTabTextActive: {
    color: '#FFFFFF',
  },
  filterTabBadge: {
    backgroundColor: '#F0F0F0',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
  },
  filterTabBadgeActive: {
    backgroundColor: '#FFFFFF',
  },
  filterTabBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#666666',
  },
  filterTabBadgeTextActive: {
    color: '#007AFF',
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
    marginBottom: 16,
  },
  actionCard: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    position: 'relative',
  },
  newIndicator: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: '#FF3B30',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  newIndicatorText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  priorityIndicator: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  cardIcon: {
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
  cardIconText: {
    fontSize: 18,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 14,
    color: '#666666',
    lineHeight: 20,
    marginBottom: 8,
  },
  cardTimestamp: {
    fontSize: 12,
    color: '#999999',
  },
  metadata: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  metadataRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  metadataLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666666',
    width: 80,
  },
  metadataValue: {
    fontSize: 12,
    color: '#1A1A1A',
    flex: 1,
  },
  cardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#F0F0F0',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  actionButtonPrimary: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  actionButtonDanger: {
    backgroundColor: '#FF3B30',
    borderColor: '#FF3B30',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666666',
  },
  actionButtonTextPrimary: {
    color: '#FFFFFF',
  },
  actionButtonTextDanger: {
    color: '#FFFFFF',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyStateEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 8,
  },
  emptyStateDescription: {
    fontSize: 16,
    color: '#666666',
    textAlign: 'center',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginHorizontal: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: '700',
    color: '#007AFF',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#666666',
    textAlign: 'center',
  },
}); 