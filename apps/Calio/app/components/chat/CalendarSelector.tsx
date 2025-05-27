import { useAuth } from '@clerk/clerk-expo';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// Define the Calendar interface based on the API documentation
export interface Calendar {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole: string;
}

interface CalendarSelectorProps {
  selectedCalendarIds: string[];
  onSelectionChange: (selectedIds: string[]) => void;
  // Optional: Style props if needed for deeper customization
  // triggerButtonStyle?: StyleProp<ViewStyle>;
  // triggerButtonTextStyle?: StyleProp<TextStyle>;
  // modalHeaderStyle?: StyleProp<ViewStyle>;
  // modalHeaderTextStyle?: StyleProp<TextStyle>;
}

const CalendarSelector: React.FC<CalendarSelectorProps> = ({ selectedCalendarIds, onSelectionChange }) => {
  const { getToken } = useAuth();
  const [modalVisible, setModalVisible] = useState(false);
  const [availableCalendars, setAvailableCalendars] = useState<Calendar[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCalendars = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError("Authentication token not found. Please sign in again.");
        setIsLoading(false);
        return;
      }

      const response = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/api/calendars/list`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Error ${response.status}: Failed to fetch calendars`);
      }

      const data: Calendar[] = await response.json();
      setAvailableCalendars(data);
      // Automatically select the primary calendar by default if one exists and no selection is passed
      if (data.length > 0 && selectedCalendarIds.length === 0) {
        const primaryCalendar = data.find(cal => cal.primary);
        if (primaryCalendar) {
          onSelectionChange([primaryCalendar.id]);
        }
      }

    } catch (e: any) {
      console.error("Failed to fetch calendars:", e);
      setError(e.message || "An unexpected error occurred while fetching calendars.");
      Alert.alert("Error", e.message || "Could not load calendars. Please try again later.");
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch calendars when the component mounts or when the modal is about to open
  // For simplicity, fetching when modal is opened to ensure fresh data.
  // Could also fetch on mount if preferred.
  useEffect(() => {
    if (modalVisible) {
      fetchCalendars();
    }
  }, [modalVisible]);

  const toggleCalendarSelection = (id: string) => {
    const currentIndex = selectedCalendarIds.indexOf(id);
    const newSelectedCalendarIds = [...selectedCalendarIds];

    if (currentIndex === -1) {
      newSelectedCalendarIds.push(id);
    } else {
      newSelectedCalendarIds.splice(currentIndex, 1);
    }
    onSelectionChange(newSelectedCalendarIds);
  };

  const renderCalendarItem = ({ item }: { item: Calendar }) => (
    <TouchableOpacity
      style={[
        styles.calendarItem,
        selectedCalendarIds.includes(item.id) && styles.selectedCalendarItem,
      ]}
      onPress={() => toggleCalendarSelection(item.id)}
    >
      <Text style={[
        styles.calendarText,
        selectedCalendarIds.includes(item.id) && styles.selectedCalendarText
      ]}>
        {item.summary}{item.primary ? ' (Primary)' : ''}
      </Text>
      <Text style={styles.calendarAccessRole}>{item.accessRole}</Text>
    </TouchableOpacity>
  );

  const getSelectionSummary = () => {
    if (selectedCalendarIds.length === 0) return "No calendars selected";
    if (selectedCalendarIds.length === 1) {
        const cal = availableCalendars.find(c => c.id === selectedCalendarIds[0]);
        return cal ? cal.summary : "1 calendar selected";
    }
    return `${selectedCalendarIds.length} calendars selected`;
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => setModalVisible(true)} style={styles.triggerButton}>
        <Text style={styles.triggerButtonText}>Select Calendars ({getSelectionSummary()})</Text>
      </TouchableOpacity>

      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalHeader}>Available Calendars</Text>
            {isLoading ? (
              <ActivityIndicator size="large" color="#007AFF" />
            ) : error ? (
              <Text style={styles.errorText}>{error}</Text>
            ) : (
              <FlatList
                data={availableCalendars}
                renderItem={renderCalendarItem}
                keyExtractor={(item) => item.id}
                ListEmptyComponent={<Text>No calendars found.</Text>}
              />
            )}
            <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 10,
    alignItems: 'center', // Center the button
  },
  triggerButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  triggerButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    width: '90%',
    maxHeight: '80%',
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalHeader: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
  },
  calendarItem: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectedCalendarItem: {
    backgroundColor: '#e0eaff',
  },
  calendarText: {
    fontSize: 16,
    color: '#333',
  },
  selectedCalendarText: {
    fontWeight: 'bold',
    color: '#007AFF'
  },
  calendarAccessRole: {
    fontSize: 12,
    color: '#777',
  },
  errorText: {
    color: 'red',
    textAlign: 'center',
    marginVertical: 10,
  },
  closeButton: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    paddingVertical: 12,
    marginTop: 20,
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default CalendarSelector; 