import { describe, expect, it } from 'vitest';
import { connectGmail, fakeGoogle } from './fixtures.ts';
import type { FakeGmail } from './google.ts';

const fake = fakeGoogle();

const labelCalls = (gmail: FakeGmail) => gmail.requests.map((r) => r.method).filter((m) => m.startsWith('users.labels.'));

describe('ensureLabel', () => {
  it('uses a label whose case was changed in Gmail instead of making it again', async () => {
    const { mailbox, gmail } = connectGmail(fake.google);
    const renamed = gmail.label('Mild/News');
    expect(await mailbox.ensureLabel('mild/news')).toBe(renamed);
    expect(labelCalls(gmail)).toEqual(['users.labels.list']);
  });

  it('uses a label made since it read the list', async () => {
    const { mailbox, gmail } = connectGmail(fake.google);
    expect(await mailbox.ensureLabel('mild/other')).toBe(gmail.labelId('mild/other'));
    const made = gmail.label('mild/newsletters');
    expect(await mailbox.ensureLabel('mild/newsletters')).toBe(made);
    expect(labelCalls(gmail)).toEqual(['users.labels.list', 'users.labels.create', 'users.labels.create', 'users.labels.list']);
  });
});
