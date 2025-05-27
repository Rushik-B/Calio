import React from 'react';
import { StyleProp, Text, TextStyle, View, ViewStyle } from 'react-native';

export interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  timestamp: Date;
}

interface MessageItemProps {
  msg: Message;
  messageBubbleStyle: StyleProp<ViewStyle>;
  userMessageStyle: StyleProp<ViewStyle>;
  botMessageStyle: StyleProp<ViewStyle>;
  messageTextStyle: StyleProp<TextStyle>;
  botMessageTextStyle: StyleProp<TextStyle>;
  messageTimestampStyle: StyleProp<TextStyle>;
  botMessageTimestampStyle: StyleProp<TextStyle>;
}

const MessageItem: React.FC<MessageItemProps> = ({
  msg,
  messageBubbleStyle,
  userMessageStyle,
  botMessageStyle,
  messageTextStyle,
  botMessageTextStyle,
  messageTimestampStyle,
  botMessageTimestampStyle,
}) => {
  return (
    <View
      key={msg.id}
      style={[
        messageBubbleStyle,
        msg.sender === 'user' ? userMessageStyle : botMessageStyle,
      ]}
    >
      <Text style={[messageTextStyle, msg.sender === 'bot' && botMessageTextStyle]}>
        {msg.text}
      </Text>
      <Text
        style={[
          messageTimestampStyle,
          msg.sender === 'bot' && botMessageTimestampStyle,
        ]}
      >
        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </Text>
    </View>
  );
};

export default MessageItem; 