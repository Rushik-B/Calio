import React from 'react';
import {
    StyleProp,
    Text,
    TextInput,
    TextStyle,
    TouchableOpacity,
    View,
    ViewStyle
} from 'react-native';

interface ChatInputProps {
  inputText: string;
  setInputText: (text: string) => void;
  handleSendMessage: () => void;
  isLoading: boolean;
  inputAreaStyle: StyleProp<ViewStyle>;
  textInputStyle: StyleProp<TextStyle>; // Corrected: TextInput style is TextStyle
  sendButtonStyle: StyleProp<ViewStyle>;
  sendButtonDisabledStyle: StyleProp<ViewStyle>;
  sendButtonTextStyle: StyleProp<TextStyle>;
}

const ChatInput: React.FC<ChatInputProps> = ({
  inputText,
  setInputText,
  handleSendMessage,
  isLoading,
  inputAreaStyle,
  textInputStyle,
  sendButtonStyle,
  sendButtonDisabledStyle,
  sendButtonTextStyle,
}) => {
  return (
    <View style={inputAreaStyle}>
      <TextInput
        style={textInputStyle}
        value={inputText}
        onChangeText={setInputText}
        placeholder="Ask about your calendar..."
        placeholderTextColor="#999"
        onSubmitEditing={handleSendMessage}
        editable={!isLoading}
      />
      <TouchableOpacity
        style={[sendButtonStyle, isLoading && sendButtonDisabledStyle]}
        onPress={handleSendMessage}
        disabled={isLoading}
      >
        <Text style={sendButtonTextStyle}>Send</Text>
      </TouchableOpacity>
    </View>
  );
};

export default ChatInput; 