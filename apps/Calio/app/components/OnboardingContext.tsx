import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';

interface OnboardingData {
  priorities: string[];
  automationLevel: 'hands-off' | 'take-charge' | null;
  constraints: string[];
  connectedCalendars: string[];
  notifications: string[];
  isCompleted: boolean;
}

interface OnboardingContextType {
  onboardingData: OnboardingData;
  updateOnboardingData: (data: Partial<OnboardingData>) => void;
  completeOnboarding: () => Promise<void>;
  isOnboardingCompleted: () => Promise<boolean>;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

const ONBOARDING_STORAGE_KEY = '@calio_onboarding_completed';

export const OnboardingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [onboardingData, setOnboardingData] = useState<OnboardingData>({
    priorities: [],
    automationLevel: null,
    constraints: [],
    connectedCalendars: [],
    notifications: [],
    isCompleted: false,
  });

  const updateOnboardingData = (data: Partial<OnboardingData>) => {
    setOnboardingData(prev => ({ ...prev, ...data }));
  };

  const completeOnboarding = async () => {
    try {
      await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
      setOnboardingData(prev => ({ ...prev, isCompleted: true }));
    } catch (error) {
      console.error('Error saving onboarding completion:', error);
    }
  };

  const isOnboardingCompleted = async (): Promise<boolean> => {
    try {
      const completed = await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);
      return completed === 'true';
    } catch (error) {
      console.error('Error checking onboarding completion:', error);
      return false;
    }
  };

  useEffect(() => {
    // Check onboarding status on mount
    isOnboardingCompleted().then(completed => {
      setOnboardingData(prev => ({ ...prev, isCompleted: completed }));
    });
  }, []);

  return (
    <OnboardingContext.Provider
      value={{
        onboardingData,
        updateOnboardingData,
        completeOnboarding,
        isOnboardingCompleted,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
};

export const useOnboarding = () => {
  const context = useContext(OnboardingContext);
  if (context === undefined) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return context;
}; 