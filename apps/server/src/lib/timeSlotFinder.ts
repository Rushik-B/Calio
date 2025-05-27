import type { calendar_v3 } from "googleapis";

export interface TimeSlot {
  start: Date;
  end: Date;
  startISO: string;
  endISO: string;
  displayTime: string;
}

export interface AvailableTimeSlots {
  date: string;
  slots: TimeSlot[];
}

/**
 * Parses event date/time from Google Calendar API format
 */
function parseEventDateTime(dateTime: any): Date | null {
  if (!dateTime) return null;
  
  if (dateTime.dateTime) {
    return new Date(dateTime.dateTime);
  } else if (dateTime.date) {
    // For all-day events, treat as starting at midnight
    return new Date(dateTime.date + 'T00:00:00');
  }
  
  return null;
}

/**
 * Checks if two time periods overlap using precise mathematical rules
 */
function hasTimeOverlap(
  start1: Date, 
  end1: Date, 
  start2: Date, 
  end2: Date
): boolean {
  // Two events conflict if: start1 < end2 AND start2 < end1
  // Events that start exactly when another ends are NOT conflicts
  return start1 < end2 && start2 < end1;
}

/**
 * Finds available time slots for a given date and duration
 */
export function findAvailableTimeSlots(
  targetDate: Date,
  durationMinutes: number,
  existingEvents: calendar_v3.Schema$Event[],
  userTimezone: string,
  options: {
    startHour?: number;    // Default: 8 (8 AM)
    endHour?: number;      // Default: 22 (10 PM)
    slotInterval?: number; // Default: 30 (30 minutes)
    maxSlots?: number;     // Default: 10
  } = {}
): TimeSlot[] {
  const {
    startHour = 8,
    endHour = 22,
    slotInterval = 30,
    maxSlots = 10
  } = options;

  const slots: TimeSlot[] = [];
  const duration = durationMinutes * 60 * 1000; // Convert to milliseconds
  const interval = slotInterval * 60 * 1000; // Convert to milliseconds
  
  // Set up day boundaries
  const dayStart = new Date(targetDate);
  dayStart.setHours(startHour, 0, 0, 0);
  const dayEnd = new Date(targetDate);
  dayEnd.setHours(endHour, 0, 0, 0);
  
  // Generate potential time slots
  for (let time = dayStart.getTime(); time <= dayEnd.getTime() - duration; time += interval) {
    const slotStart = new Date(time);
    const slotEnd = new Date(time + duration);
    
    // Check if this slot conflicts with any existing events
    const hasConflict = existingEvents.some(event => {
      const existingStart = parseEventDateTime(event.start);
      const existingEnd = parseEventDateTime(event.end);
      
      if (!existingStart || !existingEnd) return false;
      
      return hasTimeOverlap(slotStart, slotEnd, existingStart, existingEnd);
    });
    
    if (!hasConflict) {
      const startISO = slotStart.toISOString();
      const endISO = slotEnd.toISOString();
      const displayTime = slotStart.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true,
        timeZone: userTimezone 
      });
      
      slots.push({
        start: slotStart,
        end: slotEnd,
        startISO,
        endISO,
        displayTime
      });
      
      if (slots.length >= maxSlots) break;
    }
  }
  
  return slots;
}

/**
 * Finds available time slots across multiple days
 */
export function findAvailableTimeSlotsMultiDay(
  startDate: Date,
  numberOfDays: number,
  durationMinutes: number,
  existingEvents: calendar_v3.Schema$Event[],
  userTimezone: string,
  options: {
    startHour?: number;
    endHour?: number;
    slotInterval?: number;
    maxSlotsPerDay?: number;
    skipWeekends?: boolean;
  } = {}
): AvailableTimeSlots[] {
  const {
    maxSlotsPerDay = 5,
    skipWeekends = false
  } = options;

  const availableSlots: AvailableTimeSlots[] = [];
  
  for (let i = 0; i < numberOfDays; i++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + i);
    
    // Skip weekends if requested
    if (skipWeekends && (currentDate.getDay() === 0 || currentDate.getDay() === 6)) {
      continue;
    }
    
    const slots = findAvailableTimeSlots(
      currentDate,
      durationMinutes,
      existingEvents,
      userTimezone,
      { ...options, maxSlots: maxSlotsPerDay }
    );
    
    if (slots.length > 0) {
      availableSlots.push({
        date: currentDate.toISOString().split('T')[0], // YYYY-MM-DD format
        slots
      });
    }
  }
  
  return availableSlots;
}

/**
 * Generates smart suggestions for rescheduling a conflicting event
 */
export function generateSmartSuggestions(
  proposedEvent: any,
  conflictingEvents: calendar_v3.Schema$Event[],
  allExistingEvents: calendar_v3.Schema$Event[],
  userTimezone: string
): string[] {
  const suggestions: string[] = [];
  
  const proposedStart = parseEventDateTime(proposedEvent.start);
  const proposedEnd = parseEventDateTime(proposedEvent.end);
  
  if (!proposedStart || !proposedEnd) {
    return ["Please try a different time"];
  }
  
  const duration = proposedEnd.getTime() - proposedStart.getTime();
  const durationMinutes = Math.round(duration / (60 * 1000));
  const proposedDate = new Date(proposedStart);
  
  // Get the day name for the proposed date
  const proposedDayName = proposedDate.toLocaleDateString('en-US', { 
    weekday: 'long',
    timeZone: userTimezone 
  });
  
  // Find available slots for the same day
  const sameDaySlots = findAvailableTimeSlots(
    proposedDate,
    durationMinutes,
    allExistingEvents,
    userTimezone,
    { maxSlots: 3 }
  );
  
  // Add same-day suggestions with actual day name
  sameDaySlots.forEach(slot => {
    suggestions.push(`Try ${slot.displayTime} on ${proposedDayName}`);
  });
  
  // Find slots for the next day
  const nextDay = new Date(proposedDate);
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDayName = nextDay.toLocaleDateString('en-US', { 
    weekday: 'long',
    timeZone: userTimezone 
  });
  
  const nextDaySlots = findAvailableTimeSlots(
    nextDay,
    durationMinutes,
    allExistingEvents,
    userTimezone,
    { maxSlots: 2 }
  );
  
  if (nextDaySlots.length > 0) {
    const originalTime = proposedStart.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true,
      timeZone: userTimezone 
    });
    suggestions.push(`Schedule ${nextDayName} at ${originalTime}`);
    
    if (nextDaySlots[0].displayTime !== originalTime) {
      suggestions.push(`Try ${nextDayName} at ${nextDaySlots[0].displayTime}`);
    }
  }
  
  // Add fallback if no good suggestions found
  if (suggestions.length === 0) {
    suggestions.push("Try scheduling for a different day");
    suggestions.push("Consider shortening the meeting duration");
  }
  
  return suggestions.slice(0, 4); // Limit to 4 suggestions
}

/**
 * Formats available time slots for LLM consumption
 */
export function formatAvailableTimeSlotsForLLM(
  availableSlots: AvailableTimeSlots[],
  maxDays: number = 3
): string {
  if (availableSlots.length === 0) {
    return "No available time slots found in the specified range.";
  }
  
  const formattedSlots = availableSlots
    .slice(0, maxDays)
    .map(daySlots => {
      const dateStr = new Date(daySlots.date).toLocaleDateString('en-US', { 
        weekday: 'long', 
        month: 'short', 
        day: 'numeric' 
      });
      
      const timeRanges = daySlots.slots.map(slot => slot.displayTime).join(', ');
      
      return `${dateStr}: ${timeRanges}`;
    })
    .join('\n');
  
  return `Available time slots:\n${formattedSlots}`;
}

/**
 * Main function to get comprehensive availability information for conflict resolution
 */
export function getAvailabilityForConflictResolution(
  proposedEvent: any,
  allExistingEvents: calendar_v3.Schema$Event[],
  userTimezone: string
): {
  availableSlots: AvailableTimeSlots[];
  smartSuggestions: string[];
  formattedForLLM: string;
} {
  const proposedStart = parseEventDateTime(proposedEvent.start);
  const proposedEnd = parseEventDateTime(proposedEvent.end);
  
  if (!proposedStart || !proposedEnd) {
    return {
      availableSlots: [],
      smartSuggestions: ["Please specify a valid time"],
      formattedForLLM: "Unable to determine availability - invalid time format."
    };
  }
  
  const duration = proposedEnd.getTime() - proposedStart.getTime();
  const durationMinutes = Math.round(duration / (60 * 1000));
  const proposedDate = new Date(proposedStart);
  
  // Get available slots for the next 7 days
  const availableSlots = findAvailableTimeSlotsMultiDay(
    proposedDate,
    7,
    durationMinutes,
    allExistingEvents,
    userTimezone,
    { skipWeekends: false, maxSlotsPerDay: 5 }
  );
  
  // Generate smart suggestions
  const smartSuggestions = generateSmartSuggestions(
    proposedEvent,
    [], // We'll pass specific conflicting events when calling this
    allExistingEvents,
    userTimezone
  );
  
  // Format for LLM
  const formattedForLLM = formatAvailableTimeSlotsForLLM(availableSlots);
  
  return {
    availableSlots,
    smartSuggestions,
    formattedForLLM
  };
} 