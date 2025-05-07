import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { insertEvent } from '@/lib/googleCalendar';
import { NextResponse } from 'next/server';
import { calendar_v3 } from 'googleapis';

export async function POST() {
  const session = await getServerSession(authOptions);

  if (!session || !session.user || !session.user.id || !session.accessToken) {
    return NextResponse.json({ error: 'Unauthorized or session invalid' }, { status: 401 });
  }

  const userId = session.user.id;
  const accessToken = session.accessToken;

  // Define a simple event to be created
  const event: calendar_v3.Schema$Event = {
    summary: 'Hello World Event from API',
    description: 'This is a test event created via the API by the Calendar Agent.',
    start: {
        dateTime: new Date().toISOString(),
        timeZone: 'UTC', 
    },
    end: {
        dateTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // Ends in 1 hour
        timeZone: 'UTC',
    },
  };

  try {
    // Pass userId and accessToken to insertEvent
    const createdEvent = await insertEvent(userId, accessToken, event);

    if (createdEvent) {
      return NextResponse.json({ message: 'Hello World event created successfully!', event: createdEvent });
    } else {
      return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
    }
  } catch (error) {
    console.error('API route error creating event:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
} 