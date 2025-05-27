import { SignedIn, SignedOut, useAuth } from '@clerk/clerk-expo';
import React, { useEffect, useState } from 'react';
import {
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    View, // View is still needed for the root SignedIn container if any
} from 'react-native';

import CalendarSelector from '@/app/components/chat/CalendarSelector'; // Added import
import ChatHeader from '@/app/components/chat/ChatHeader';
import ChatInput from '@/app/components/chat/ChatInput';
import { Message } from '@/app/components/chat/MessageItem'; // Import Message interface
import MessageList from '@/app/components/chat/MessageList';
import SignedOutMessage from '@/app/components/chat/SignedOutMessage';

export default function Page() {
  const { getToken } = useAuth();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      text: 'Hello! How can I help you today with your calendar?',
      sender: 'bot',
      timestamp: new Date(),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]); // Added state for selected calendar IDs
  const [userTimezone, setUserTimezone] = useState<string>(''); // Added state for user timezone
  const [conversationId, setConversationId] = useState<string | null>(null); // Added state for conversationId

  useEffect(() => {
    // Get user timezone once the component mounts
    const currentUserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setUserTimezone(currentUserTimezone);
  }, []);

  const handleSendMessage = async () => {
    const trimmedInput = inputText.trim();
    if (!trimmedInput) return;

    setIsLoading(true);
    const userMessage: Message = {
      id: Date.now().toString(),
      text: trimmedInput,
      sender: 'user',
      timestamp: new Date(),
    };
    setMessages((prevMessages) => [...prevMessages, userMessage]);
    setInputText('');

    let botResponseText = 'An unexpected error occurred.';
    let newConversationId: string | null = conversationId; // Keep current conversationId by default

    try {
      const token = await getToken();
      if (!token) {
        botResponseText =
          'Authentication token not found. Please sign in again.';
        throw new Error('Clerk token not found');
      }

      console.log('[CONVO_DEBUG] Sending conversationId to backend:', conversationId); // DEBUG LOG

      const res = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ 
          text: trimmedInput, 
          selectedCalendarIds, 
          userTimezone, 
          conversationId // Include conversationId in the request
        }), 
      });

      const data = await res.json();
      console.log('[CONVO_DEBUG] Received data from backend:', JSON.stringify(data, null, 2)); // DEBUG LOG
      console.log('[CONVO_DEBUG] Received conversationId from backend:', data.conversationId); // DEBUG LOG
      
      newConversationId = data.conversationId || newConversationId; // Update conversationId from response

      if (res.ok) {
        if (typeof data.message === 'string') {
          botResponseText = data.message || 'Received an empty response.';
        } else if (typeof data.message === 'object' && data.message !== null && data.message.text) {
          // Handle message object for forward compatibility
          botResponseText = data.message.text || 'Received an empty response structure.';
          // TODO: Handle data.message.requiresFollowUp and data.message.clarificationContext in the future
        } else {
          botResponseText = 'Received an unexpected response format.';
        }

        if (data.details) {
          console.log("API Details:", data.details);
        }
      } else {
        botResponseText =
          data.error || `Error ${res.status}: Failed to get response from server.`;
        if (data.details) {
          console.error("API Error Details:", data.details);
        }
      }
    } catch (error) {
      console.error('Error sending message to API:', error);
      // Try to get conversationId even from error responses if the backend sends it
      if (error instanceof Response && error.bodyUsed === false) {
        try {
            const errorData = await error.json();
            newConversationId = errorData.conversationId || newConversationId;
        } catch (e) {
            console.error('[CONVO_DEBUG] Failed to parse error response body', e); // DEBUG LOG
        }
      } else if (error instanceof Error && error.message.includes('Network request failed')) {
        // Potentially network error, keep old botResponseText
         botResponseText =
          'Failed to connect to the server. Please check your connection.';
      } else if (error instanceof Error && error.message !== 'Clerk token not found') {
        botResponseText =
          'Failed to connect to the server. Please check your connection.';
      }
    }
    
    console.log('[CONVO_DEBUG] Setting conversationId to state:', newConversationId); // DEBUG LOG
    setConversationId(newConversationId); // Persist the conversationId from the response

    const botMessage: Message = {
      id: (Date.now() + 1).toString(),
      text: botResponseText,
      sender: 'bot',
      timestamp: new Date(),
    };
    setMessages((prevMessages) => [...prevMessages, botMessage]);
    setIsLoading(false);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
    >
      <SignedIn>
        <View style={{flex: 1}}> {/* Added a flex:1 View to ensure SignedIn content takes space if needed */}
            <ChatHeader headerStyle={styles.header} userInfoStyle={styles.userInfo} />
            <CalendarSelector // Added CalendarSelector component
              selectedCalendarIds={selectedCalendarIds}
              onSelectionChange={setSelectedCalendarIds}
            />
            <MessageList
            messages={messages}
            isLoading={isLoading}
            chatAreaStyle={styles.chatArea}
            typingIndicatorContainerStyle={styles.typingIndicatorContainer}
            typingIndicatorTextStyle={styles.typingIndicatorText}
            messageBubbleStyle={styles.messageBubble}
            userMessageStyle={styles.userMessage}
            botMessageStyle={styles.botMessage}
            messageTextStyle={styles.messageText}
            botMessageTextStyle={styles.botMessageText}
            messageTimestampStyle={styles.messageTimestamp}
            botMessageTimestampStyle={styles.botMessageTimestamp}
            />
            <ChatInput
            inputText={inputText}
            setInputText={setInputText}
            handleSendMessage={handleSendMessage}
            isLoading={isLoading}
            inputAreaStyle={styles.inputArea}
            textInputStyle={styles.textInput}
            sendButtonStyle={styles.sendButton}
            sendButtonDisabledStyle={styles.sendButtonDisabled}
            sendButtonTextStyle={styles.sendButtonText}
            />
        </View>
      </SignedIn>
      <SignedOut>
        <SignedOutMessage 
          containerStyle={styles.signedOutContainer} 
          linkStyle={styles.signInLink} 
        />
      </SignedOut>
    </KeyboardAvoidingView>
  );
}

// Styles remain here for now, passed as props to child components
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4f6f8',
  },
  // ChatHeader styles
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  userInfo: {
    fontSize: 15,
    color: '#333',
    fontWeight: '500',
  },
  // MessageList styles
  chatArea: {
    flex: 1,
    paddingHorizontal: 10,
    paddingTop: 10,
  },
  typingIndicatorContainer: {
    alignSelf: 'flex-start',
    marginVertical: 5,
    marginLeft: 10,
  },
  typingIndicatorText: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
  },
  // MessageItem styles
  messageBubble: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 18,
    marginBottom: 12,
    maxWidth: '80%',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  userMessage: {
    backgroundColor: '#007AFF',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  botMessage: {
    backgroundColor: '#E5E5EA',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 16,
    color: '#ffffff',
  },
  botMessageText: {
    color: '#000000',
  },
  messageTimestamp: {
    fontSize: 10,
    color: '#e0e0e0',
    alignSelf: 'flex-end',
    marginTop: 3,
  },
  botMessageTimestamp: {
    color: '#666666',
  },
  // ChatInput styles
  inputArea: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  textInput: {
    flex: 1,
    height: 42,
    borderColor: '#d0d0d0',
    borderWidth: 1,
    borderRadius: 21,
    paddingHorizontal: 16,
    marginRight: 10,
    backgroundColor: '#ffffff',
    fontSize: 16,
    // Note: color, fontWeight, etc. for the text itself are part of TextStyle
  },
  sendButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#a9cbf7',
  },
  sendButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 16,
  },
  // SignedOutMessage styles
  signedOutContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f4f6f8',
  },
  signInLink: {
    fontSize: 18,
    color: '#007AFF',
    fontWeight: '500',
  },
});