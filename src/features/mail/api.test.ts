import { describe, expect, it } from 'vitest';
import { mockFetch } from '@/test/mock-fetch';
import { MAIL_BASE, mail, type SendMailInput } from './api';

const API = 'https://blocksapi.example.com';
const MAIL = `${API}/logic/v4/Mail`;

const input: SendMailInput = {
  to: ['ada@example.com'],
  cc: ['ops@example.com'],
  purpose: 'welcome',
  language: 'en-US',
  subjectDataContext: { name: 'Ada' },
  bodyDataContext: { link: 'https://app.example.com' },
  attachments: ['file-1'],
};

describe('MAIL_BASE', () => {
  it('is the Mail controller of the logic service', () => {
    expect(MAIL_BASE).toBe(MAIL);
  });
});

describe('mail.send', () => {
  it('posts the template request as given', async () => {
    const http = mockFetch({ body: { isSuccess: true } });
    await expect(mail.send(input)).resolves.toEqual({ isSuccess: true });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${MAIL}/Send` });
    expect(http.last().body).toEqual(input);
    expect(http.last().headers['x-blocks-key']).toBe('test-project-key');
  });

  it('sends a test mail to any address', async () => {
    const http = mockFetch();
    await mail.sendToAny({ ...input, isTestMail: true });
    expect(http.last()).toMatchObject({ method: 'POST', url: `${MAIL}/SendToAny` });
    expect(http.last().body).toEqual({ ...input, isTestMail: true });
  });
});

describe('mail.mailbox', () => {
  it('reads the first 20 mails by default', async () => {
    const http = mockFetch({ body: { data: [{ messageId: 'm1' }], totalCount: 1 } });
    await expect(mail.mailbox()).resolves.toEqual({ data: [{ messageId: 'm1' }], totalCount: 1 });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${MAIL}/GetMailBoxMails?PageNumber=1&PageSize=20`, body: undefined });
  });

  it('sends every filter, false included, and drops an empty search', async () => {
    const http = mockFetch();
    await mail.mailbox({ pageNumber: 2, pageSize: 10, searchText: 'invoice', isInbound: false, status: 'Failed' });
    expect(http.last().url).toBe(`${MAIL}/GetMailBoxMails?PageNumber=2&PageSize=10&SearchText=invoice&IsInbound=false&Status=Failed`);

    await mail.mailbox({ searchText: '' });
    expect(http.last().url).toBe(`${MAIL}/GetMailBoxMails?PageNumber=1&PageSize=20`);
  });

  it('reads one mail by message id', async () => {
    const http = mockFetch({ body: { messageId: '<m1@example.com>', subject: 'Hi' } });
    await expect(mail.mailboxMail('<m1@example.com>')).resolves.toEqual({ messageId: '<m1@example.com>', subject: 'Hi' });
    expect(http.last()).toMatchObject({ method: 'GET', url: `${MAIL}/GetMailBoxMail?MessageId=%3Cm1%40example.com%3E` });
  });
});

describe('mail configuration reads', () => {
  it.each([
    ['configs', () => mail.configs(), `${MAIL}/Gets`],
    ['logicTemplates', () => mail.logicTemplates(), `${API}/logic/v4/Template/Gets`],
    ['osTemplates', () => mail.osTemplates(), `${API}/os/v4/Mail/GetTemplates?PageNumber=1&PageSize=50`],
  ])('%s is a GET on its route', async (_name, call, url) => {
    const http = mockFetch({ body: [{ itemId: 'x' }] });
    await expect(call()).resolves.toEqual([{ itemId: 'x' }]);
    expect(http.last()).toMatchObject({ method: 'GET', url });
  });
});
