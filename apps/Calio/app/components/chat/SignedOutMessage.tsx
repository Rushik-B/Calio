import { Link } from 'expo-router';
import React from 'react';
import { StyleProp, Text, TextStyle, View, ViewStyle } from 'react-native';

interface SignedOutMessageProps {
  containerStyle: StyleProp<ViewStyle>;
  linkStyle: StyleProp<TextStyle>;
}

const SignedOutMessage: React.FC<SignedOutMessageProps> = ({ containerStyle, linkStyle }) => {
  return (
    <View style={containerStyle}>
      <Link href="/(auth)/sign-in">
        <Text style={linkStyle}>Sign in to access the chat</Text>
      </Link>
    </View>
  );
};

export default SignedOutMessage; 