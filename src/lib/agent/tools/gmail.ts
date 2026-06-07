import { google } from 'googleapis';
import { getConnectorConfig } from '../connectors';

async function getGmailClient(userId: string) {
  const config = await getConnectorConfig(userId, 'gmail');
  if (!config?.access_token) throw new Error('Gmail not connected');
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({
    access_token: config.access_token as string,
    refresh_token: config.refresh_token as string,
  });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

export async function sendEmail(userId: string, { to, subject, body }: { to: string; subject: string; body: string }) {
  const gmail = await getGmailClient(userId);
  const raw = Buffer.from(
    `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
  ).toString('base64url');
  const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return { id: res.data.id ?? null };
}

export async function listRecentEmails(userId: string, max = 10) {
  const gmail = await getGmailClient(userId);
  const list = await gmail.users.messages.list({ userId: 'me', maxResults: max });
  const messages = list.data.messages ?? [];
  const detailed = await Promise.all(
    messages.map(m => gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'metadata' }))
  );
  return detailed.map(d => ({
    id: d.data.id,
    snippet: d.data.snippet,
    headers: Object.fromEntries((d.data.payload?.headers ?? []).map(h => [h.name, h.value])),
  }));
}
