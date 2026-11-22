'use client';
import { PaperclipIcon, XIcon } from 'lucide-react';
import { useRef } from 'react';
import { size } from '@/lib/format';
import { Button } from './button.tsx';
import { Failure } from './note.tsx';
import { Tooltip } from './tooltip.tsx';

/** A file on a draft. `sent`: how much of it has reached Mild, while it is uploading; `failed`: why it did not. */
export interface DraftFile {
  key: string;
  name: string;
  size: number;
  sent?: number;
  failed?: string;
}

/** A draft's press that attaches files: a quiet paperclip beside Send, which opens the device's file picker. */
export function AttachButton({ onFiles }: { onFiles: (files: File[]) => void }) {
  const picker = useRef<HTMLInputElement>(null);
  return (
    <>
      <Tooltip says="Attach files">
        <Button variant="quiet" size="icon" aria-label="Attach files" onClick={() => picker.current?.click()}>
          <PaperclipIcon aria-hidden />
        </Button>
      </Tooltip>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        aria-hidden
        tabIndex={-1}
        onChange={(event) => {
          onFiles([...(event.target.files ?? [])]);
          event.target.value = '';
        }}
      />
    </>
  );
}

/**
 * A draft's files, under its text: each its name, its size or how much has uploaded, and a press that takes it off. One
 * that failed says why, and is taken off to send.
 */
export function DraftFiles({ files, onRemove }: { files: readonly DraftFile[]; onRemove: (key: string) => void }) {
  if (files.length === 0) return null;
  return (
    <ul aria-label="Attachments" className="flex flex-wrap gap-1.5 px-(--gutter) pb-2">
      {files.map((file) => (
        <li key={file.key} className="flex max-w-full flex-col">
          <span className="flex h-7 max-w-full items-center gap-1.5 rounded-(--corner) bg-(--fill) pr-0.5 pl-2 text-sm pointer-coarse:h-9">
            <PaperclipIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 truncate">{file.name}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {file.sent !== undefined && !file.failed
                ? `${Math.round((file.sent / Math.max(file.size, 1)) * 100)}%`
                : file.size < 1000
                  ? `${file.size} bytes`
                  : size(file.size)}
            </span>
            <button
              type="button"
              aria-label={`Remove ${file.name}`}
              className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-(--corner) text-muted-foreground hover:bg-(--fill-strong) hover:text-foreground pointer-coarse:size-8"
              onClick={() => onRemove(file.key)}
            >
              <XIcon className="size-3" aria-hidden />
            </button>
          </span>
          <Failure className="text-sm">{file.failed}</Failure>
        </li>
      ))}
    </ul>
  );
}
