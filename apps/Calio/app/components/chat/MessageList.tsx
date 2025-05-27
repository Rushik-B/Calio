import React, { useEffect, useRef } from 'react';
import { ScrollView, StyleProp, Text, TextStyle, View, ViewStyle } from 'react-native';
import MessageItem, { Message } from './MessageItem';

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  chatAreaStyle: StyleProp<ViewStyle>;
  typingIndicatorContainerStyle: StyleProp<ViewStyle>;
  typingIndicatorTextStyle: StyleProp<TextStyle>;
  // Props for MessageItem
  messageBubbleStyle: StyleProp<ViewStyle>;
  userMessageStyle: StyleProp<ViewStyle>;
  botMessageStyle: StyleProp<ViewStyle>;
  messageTextStyle: StyleProp<TextStyle>;
  botMessageTextStyle: StyleProp<TextStyle>;
  messageTimestampStyle: StyleProp<TextStyle>;
  botMessageTimestampStyle: StyleProp<TextStyle>;
}

const MessageList: React.FC<MessageListProps> = ({
  messages,
  isLoading,
  chatAreaStyle,
  typingIndicatorContainerStyle,
  typingIndicatorTextStyle,
  messageBubbleStyle,
  userMessageStyle,
  botMessageStyle,
  messageTextStyle,
  botMessageTextStyle,
  messageTimestampStyle,
  botMessageTimestampStyle,
}) => {
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (scrollViewRef.current) {
      scrollViewRef.current.scrollToEnd({ animated: true });
    }
  }, [messages, isLoading]);

  return (
    <ScrollView
      style={chatAreaStyle}
      contentContainerStyle={{ paddingBottom: 20 }}
      ref={scrollViewRef}
    >
      {messages.map((msg) => (
        <MessageItem
          key={msg.id}
          msg={msg}
          messageBubbleStyle={messageBubbleStyle}
          userMessageStyle={userMessageStyle}
          botMessageStyle={botMessageStyle}
          messageTextStyle={messageTextStyle}
          botMessageTextStyle={botMessageTextStyle}
          messageTimestampStyle={messageTimestampStyle}
          botMessageTimestampStyle={botMessageTimestampStyle}
        />
      ))}
      {isLoading && (
        <View style={typingIndicatorContainerStyle}>
          <Text style={typingIndicatorTextStyle}>Bot is typing...</Text>
        </View>
      )}
    </ScrollView>
  );
};

export default MessageList; 