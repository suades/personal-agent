import { google } from 'googleapis';
import { getConnectorConfig } from '../connectors';

async function getCalendarClient(userId: string) {
  const config = await getConnectorConfig(userId, 'calendar');
  if (!config?.access_token) throw new Error('Calendar not connected');
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({
    access_token: config.access_token as string,
    refresh_token: config.refresh_token as string,
  });
  return google.calendar({ version: 'v3', auth: oauth2 });
}

export async function createEvent(userId: string, { summary, start, end, attendees }: {
  summary: string; start: string; end: string; attendees?: string[];
}) {
  const cal = await getCalendarClient(userId);
  const res = await cal.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary,
      start: { dateTime: start },
      end:   { dateTime: end },
      attendees: attendees?.map(email => ({ email })),
    },
  });
  return { id: res.data.id, link: res.data.htmlLink };
}

export async function listUpcoming(userId: string, max = 10) {
  const cal = await getCalendarClient(userId);
  const res = await cal.events.list({
    calendarId: 'primary',
    timeMin: new Date().toISOString(),
    maxResults: max, singleEvents: true, orderBy: 'startTime',
  });
  return res.data.items ?? [];
}
