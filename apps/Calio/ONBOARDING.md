# Calio Onboarding Flow

## Overview

The Calio app now features a comprehensive 7-screen onboarding flow that guides new users through setting up their scheduling preferences and connecting their calendars.

## Onboarding Screens

### 1. Welcome Screen (`welcome.tsx`)
- **Purpose**: Introduction to Calio and its value proposition
- **Features**: Beautiful welcome message with calendar illustration
- **CTA**: "Get Started" button

### 2. Priorities Screen (`priorities.tsx`)
- **Purpose**: Collect user's top priorities for time protection
- **Features**: 
  - Multi-select priority chips (Deep Work, Gym, Family, etc.)
  - Custom priority input option
  - Progress indicator (1/7)
- **Validation**: At least one priority must be selected

### 3. Preferences Screen (`preferences.tsx`)
- **Purpose**: Set automation level for Calio's proactiveness
- **Features**:
  - Radio button selection between "Hands-off" and "Take charge"
  - Visual illustration showing calendar-to-agent flow
  - Progress indicator (2/7)

### 4. Constraints Screen (`constraints.tsx`)
- **Purpose**: Define time blocks that should never be scheduled over
- **Features**:
  - Toggle switches for common constraints (evenings, weekends, lunch, mornings)
  - Option to add custom constraints
  - Visual timeline illustration
  - Progress indicator (3/7)

### 5. Calendar Connection Screen (`calendar-connection.tsx`)
- **Purpose**: Connect external calendar services
- **Features**:
  - Google Calendar connection
  - Microsoft Outlook connection
  - Apple Calendar (coming soon)
  - Skip option available
  - Progress indicator (4/7)

### 6. Notifications Screen (`notifications.tsx`)
- **Purpose**: Configure notification preferences
- **Features**:
  - Checkbox options for push notifications, email, Slack/Teams, SMS
  - Visual notification illustration
  - Progress indicator (5/7)

### 7. Summary Screen (`summary.tsx`)
- **Purpose**: Review setup and complete onboarding
- **Features**:
  - Summary of Calio's capabilities
  - Celebration animation
  - "Start Using Calio" final CTA
  - Progress indicator (7/7 - Complete!)

## Technical Implementation

### Context Management
- **OnboardingContext**: Manages onboarding state and data collection
- **AsyncStorage**: Persists onboarding completion status
- **Data Collection**: Stores user preferences for later use

### Navigation Flow
1. **Sign-in** → **Onboarding** (if not completed) → **Home**
2. **Onboarding completion** → Automatic redirect to Home
3. **Returning users** → Direct to Home (bypasses onboarding)

### Key Features
- **Beautiful UI**: Modern design with consistent styling
- **Progress Tracking**: Visual progress bar on each screen
- **Data Persistence**: User preferences saved throughout the flow
- **Responsive Design**: Works on various screen sizes
- **Accessibility**: Proper touch targets and visual feedback

### File Structure
```
app/(onboarding)/
├── _layout.tsx          # Onboarding layout wrapper
├── index.tsx            # Redirect to welcome screen
├── welcome.tsx          # Screen 1: Welcome
├── priorities.tsx       # Screen 2: Priority selection
├── preferences.tsx      # Screen 3: Automation preferences
├── constraints.tsx      # Screen 4: Time constraints
├── calendar-connection.tsx # Screen 5: Calendar connections
├── notifications.tsx    # Screen 6: Notification settings
└── summary.tsx          # Screen 7: Summary and completion
```

### Integration Points
- **Google Sign-in**: Maintained and integrated with onboarding flow
- **Clerk Authentication**: Preserved existing auth flow
- **Home Screen**: Accessible after onboarding completion
- **Chat Interface**: Existing chat functionality preserved

## Usage

After implementing this onboarding flow:

1. **New users** will see the onboarding after signing in with Google
2. **Existing users** will go directly to the home screen
3. **Onboarding data** can be accessed via the `useOnboarding()` hook
4. **Completion status** is automatically managed and persisted

The onboarding flow provides a smooth, engaging introduction to Calio while collecting essential user preferences for personalized scheduling assistance. 