'use client';
import { useState } from 'react';
import { saveFile, useFiles } from '@/lib/attachments.ts';
import type { MessageDetail } from '@/lib/api/endpoints.ts';
import { reveal } from '@/lib/reveal.ts';
import { MessageFiles, useToast } from '@/system';

/** The message's files, each fetched from Gmail as it is pressed. */
export function Files({ detail }: { detail: MessageDetail }) {
  const files = useFiles(detail);
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const toast = useToast();
  const save = (part: string) => {
    const file = files.find((f) => f.part === part)!;
    const name = reveal(file.name);
    setSaving((now) => new Set(now).add(part));
    saveFile(detail, part, name)
      .then(
        () => {},
        (error: unknown) => toast(`Could not download ${name}`, { tone: 'failure', description: error instanceof Error ? error.message : String(error) }),
      )
      .finally(() =>
        setSaving((now) => {
          const left = new Set(now);
          left.delete(part);
          return left;
        }),
      );
  };
  return <MessageFiles files={files.map((f) => ({ key: f.part, name: reveal(f.name), size: f.size, saving: saving.has(f.part) }))} onSave={save} />;
}
