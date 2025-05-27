import SignOutButton from '@/app/components/SignOutButton'; // Assuming SignOutButton is in components root
import { useUser } from '@clerk/clerk-expo';
import React from 'react';
import { StyleProp, Text, TextStyle, View, ViewStyle } from 'react-native';

interface ChatHeaderProps {
  headerStyle: StyleProp<ViewStyle>;
  userInfoStyle: StyleProp<TextStyle>;
}

const ChatHeader: React.FC<ChatHeaderProps> = ({ headerStyle, userInfoStyle }) => {
  const { user } = useUser();

  return (
    <View style={headerStyle}>
      <Text style={userInfoStyle}>
        Signed in as: {user?.emailAddresses[0].emailAddress}
      </Text>
      <SignOutButton />
    </View>
  );
};

export default ChatHeader; 