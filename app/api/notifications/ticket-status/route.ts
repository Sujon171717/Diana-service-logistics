import { NextResponse } from 'next/server';

type TicketStatus = 'Approved' | 'Rejected' | 'Completed';

type NotificationRequest = {
  ticketId?: string;
  riderId?: string;
  expoPushToken?: string;
  status?: TicketStatus;
  invoiceId?: string;
};

const messages: Record<TicketStatus, { title: string; body: string; type: string }> = {
  Approved: {
    title: 'Service request accepted',
    body: 'Your service request has been accepted.',
    type: 'ticket-approved',
  },
  Rejected: {
    title: 'Service request rejected',
    body: 'Your service request has been rejected.',
    type: 'ticket-rejected',
  },
  Completed: {
    title: 'Service request completed',
    body: 'Your service request has been completed. Tap to see Invoice',
    type: 'ticket-completed',
  },
};

const isExpoPushToken = (value: unknown): value is string =>
  typeof value === 'string' && /^ExponentPushToken\[[^\]]+\]$/.test(value);

export async function POST(request: Request) {
  let payload: NotificationRequest;
  try {
    payload = await request.json() as NotificationRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { ticketId, riderId, expoPushToken, status, invoiceId } = payload;
  if (!ticketId || !riderId || !isExpoPushToken(expoPushToken) || !status || !messages[status]) {
    return NextResponse.json({ error: 'ticketId, riderId, status, and a valid Expo push token are required.' }, { status: 400 });
  }

  const message = messages[status];
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };
  if (process.env.EXPO_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  }

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        to: expoPushToken,
        title: message.title,
        body: message.body,
        sound: 'default',
        priority: 'high',
        channelId: 'service-updates',
        data: {
          type: message.type,
          ticketId,
          riderId,
          invoiceId: invoiceId || '',
        },
      }),
      cache: 'no-store',
    });

    const result = await response.json() as {
      data?: { status?: string; id?: string; message?: string; details?: { error?: string } };
      errors?: unknown;
    };

    if (!response.ok || result.data?.status === 'error') {
      return NextResponse.json({ error: 'Expo rejected the notification.', details: result }, { status: 502 });
    }

    return NextResponse.json({ ok: true, ticket: result.data });
  } catch (error) {
    console.error('Unable to send ticket notification:', error);
    return NextResponse.json({ error: 'Unable to reach Expo push service.' }, { status: 502 });
  }
}
