import { blocksFetch } from '@/lib/blocks-client';
import { BLOCKS } from '@/lib/env';

/**
 * Transactional email through the project's configured mail server.
 *
 * There is no subject/body on the request: `purpose` + `language` pick a template the
 * project saved in the console, and the two data contexts fill its placeholders. A purpose
 * nobody created a template for fails server-side — the API cannot list valid purposes
 * from here, so check the console's Email → Templates.
 */

export const MAIL_BASE = `${BLOCKS.apiUrl}/logic/v4/Mail`;

export interface SendMailInput {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string[];
  /** File ids (from Storage) to attach. */
  attachments?: string[];
  purpose?: string;
  language?: string;
  subjectDataContext?: Record<string, string>;
  bodyDataContext?: Record<string, string>;
  sendPhoneNumberAsEmail?: boolean;
}

export interface MailboxMail {
  itemId?: string;
  messageId?: string;
  subject?: string;
  from?: string;
  to?: string | string[];
  status?: string | number;
  isInBound?: boolean;
  date?: string;
  createdDate?: string;
  error?: string;
  [k: string]: unknown;
}

const qs = (p: Record<string, string | number | boolean | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== '') q.set(k, String(v));
  return q.toString();
};

export const mail = {
  send: (input: SendMailInput) =>
    blocksFetch<Record<string, unknown>>(`${MAIL_BASE}/Send`, { method: 'POST', body: input }),

  /** Same request plus `isTestMail` — the provider-routing hint for a test send. */
  sendToAny: (input: SendMailInput & { isTestMail?: boolean }) =>
    blocksFetch<Record<string, unknown>>(`${MAIL_BASE}/SendToAny`, { method: 'POST', body: input }),

  /** Sent (and, for inbound mailboxes, received) mail — the delivery log. */
  mailbox: (p: { pageNumber?: number; pageSize?: number; searchText?: string; isInbound?: boolean; status?: string } = {}) =>
    blocksFetch<{ data?: MailboxMail[]; totalCount?: number } | MailboxMail[]>(
      `${MAIL_BASE}/GetMailBoxMails?${qs({ PageNumber: p.pageNumber ?? 1, PageSize: p.pageSize ?? 20, SearchText: p.searchText, IsInbound: p.isInbound, Status: p.status })}`,
    ),
  mailboxMail: (messageId: string) => blocksFetch<MailboxMail>(`${MAIL_BASE}/GetMailBoxMail?${qs({ MessageId: messageId })}`),

  /** Mail server configurations — `[{ itemId, name, isDefault, isInbound, provider }]`. */
  configs: () => blocksFetch<unknown>(`${MAIL_BASE}/Gets`),

  /** Templates as Logic sees them (what a workflow's Send Email node can pick). */
  logicTemplates: () => blocksFetch<unknown>(`${BLOCKS.apiUrl}/logic/v4/Template/Gets`),
  /** Templates as the OS console manages them — any signed-in user may read these. */
  osTemplates: () => blocksFetch<unknown>(`${BLOCKS.apiUrl}/os/v4/Mail/GetTemplates?PageNumber=1&PageSize=50`),
};
