import { ArrowUpRightIcon, ChevronRightIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type ManageState, api, useAction, useLoaded } from '@/lib/api.ts';
import { Button, Copyable, Failure, Field, Form, Input, Select, Sub, Table, Td, TextLink, Th, Tr } from '@/system';

type Choice = ManageState['model']['choices'][number];

/** How each way to a model is paid for, in a line. */
const HOW: Record<string, string> = {
  'openai-codex': 'With a ChatGPT Plus or Pro plan. No bill per message.',
  chatgpt: 'With a ChatGPT Plus or Pro plan. No bill per message.',
  openai: 'Billed per message by OpenAI.',
  anthropic: 'Billed per message by Anthropic.',
  openrouter: 'One key for several labs’ models, billed by OpenRouter.',
  'vercel-ai-gateway': 'One key for several labs’ models, billed through Vercel.',
};

/** A provider's name, without the "API key" its choice label carries. */
export const providerName = (choice: Choice | undefined, provider: string) => choice?.label.replace(/ API key$/, '') ?? provider;

/** The ways to a model, each row pressable. The one in use is shown, and cannot be chosen again. */
export function ProviderList({ choices, inUse, onChoose }: { choices: readonly Choice[]; inUse: string | null; onChoose: (choice: Choice) => void }) {
  return (
    <Table>
      <thead className="sr-only">
        <Tr>
          <Th>Provider</Th>
        </Tr>
      </thead>
      <tbody>
        {choices.map((choice) =>
          choice.provider === inUse ? (
            <Tr key={choice.provider}>
              <Td>
                <span className="name">{providerName(choice, choice.provider)}</span>
                <Sub>In use</Sub>
              </Td>
            </Tr>
          ) : (
            <Tr key={choice.provider} onOpen={() => onChoose(choice)}>
              <Td>
                <span className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="name">{providerName(choice, choice.provider)}</span>
                    <Sub className="whitespace-normal">{HOW[choice.provider] ?? ''}</Sub>
                  </span>
                  <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </span>
              </Td>
            </Tr>
          ),
        )}
      </tbody>
    </Table>
  );
}

/**
 * Signing in to one provider and choosing its model. Nothing about what sorts mail changes here:
 * `ready` is the model to switch to.
 */
export function useProviderConnect(choice: Choice, model: ManageState['model'], reload: () => void) {
  const signedIn = model.signedIn.includes(choice.provider);
  const listed = useLoaded(`models ${model.signedIn.join(' ')}`, (signal) => api.models(signal), 300_000);
  const mine = (listed.data?.models ?? []).filter((m) => m.startsWith(`${choice.provider}/`));
  const recommended = listed.data?.recommended[choice.provider] ?? mine[0] ?? '';
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = picked ?? recommended;
  const [key, setKey] = useState('');
  const [address, setAddress] = useState('');
  const sign = useAction();
  const pending = model.pending;
  const started = pending && 'url' in pending ? pending : null;
  const code = started?.code === undefined ? null : { ...started, code: started.code };
  const chatgpt = choice.how !== 'key';
  // ChatGPT has only the one way in, so choosing it starts it: there is nothing else to press first.
  const asked = useRef(false);
  useEffect(() => {
    if (!chatgpt || signedIn || started || asked.current) return;
    asked.current = true;
    sign.run(() => api.signInChatGPT(), reload);
  });
  // The code, and then the sign-in finishing at OpenAI, are only learnt of by asking.
  const waiting = chatgpt && !signedIn;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(reload, 3000);
    return () => clearInterval(timer);
  }, [waiting, reload]);

  const fields = (
    <Form onSubmit={() => {}}>
      {choice.how === 'redirect' ? (
        <Field
          label="Account"
          hint={
            signedIn ? undefined : started && !sign.error ? (
              'After signing in, ChatGPT sends you to a page that will not load. Copy its address from the address bar and paste it here.'
            ) : (
              <Failure>{sign.error ?? (pending && 'error' in pending ? pending.error : null)}</Failure>
            )
          }
        >
          {signedIn ? (
            <span>Signed in</span>
          ) : started ? (
            <>
              <Button href={started.url} target="_blank" rel="noreferrer">
                Open ChatGPT
                <ArrowUpRightIcon aria-hidden />
              </Button>
              <Input
                autoComplete="off"
                aria-label="Address of the page ChatGPT sent you to"
                placeholder="http://127.0.0.1:1455/auth/callback?code=…"
                className="min-w-48 flex-1 font-mono"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
              <Button
                busy={sign.busy}
                disabled={address.trim() === ''}
                onClick={() =>
                  sign.run(
                    () => api.finishChatGPT(address),
                    () => (setAddress(''), reload()),
                  )
                }
              >
                Finish
              </Button>
            </>
          ) : sign.busy || !(sign.error || (pending && 'error' in pending)) ? (
            <span className="text-muted-foreground">Starting…</span>
          ) : (
            <Button onClick={() => (setAddress(''), sign.run(() => api.signInChatGPT(), reload))}>Start again</Button>
          )}
        </Field>
      ) : choice.how === 'device-code' ? (
        <Field
          label="Account"
          hint={
            signedIn ? undefined : code ? (
              <>
                Enter it at{' '}
                <TextLink href={code.url} away>
                  {new URL(code.url).host}
                </TextLink>
                , signed in to ChatGPT. This page carries on by itself once you have.
              </>
            ) : (
              <Failure>{sign.error ?? (pending && 'error' in pending ? pending.error : null)}</Failure>
            )
          }
        >
          {signedIn ? (
            <span>Signed in</span>
          ) : code ? (
            <>
              <Copyable value={code.code} label="the code" />
              <Button href={code.url} target="_blank" rel="noreferrer" onClick={() => void navigator.clipboard?.writeText(code.code).catch(() => {})}>
                Copy and open
                <ArrowUpRightIcon aria-hidden />
              </Button>
            </>
          ) : sign.busy || !(sign.error || (pending && 'error' in pending)) ? (
            <span className="text-muted-foreground">Getting a code…</span>
          ) : (
            <Button onClick={() => sign.run(() => api.signInChatGPT(), reload)}>Get a new code</Button>
          )}
        </Field>
      ) : (
        <Field label="API key" hint={signedIn ? 'Encrypted with your own data.' : <Failure>{sign.error}</Failure>}>
          {signedIn ? (
            <span>Saved</span>
          ) : (
            <>
              <Input
                type="password"
                autoComplete="off"
                autoFocus
                aria-label="API key"
                placeholder="Paste the key"
                className="min-w-48 flex-1 font-mono"
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
              <Button
                busy={sign.busy}
                disabled={key.trim() === ''}
                onClick={() =>
                  sign.run(
                    () => api.saveModelKey(choice.provider, key),
                    () => (setKey(''), reload()),
                  )
                }
              >
                Save
              </Button>
            </>
          )}
        </Field>
      )}
      {signedIn ? (
        <Field label="Model" hint="A small one is usually enough.">
          <Select
            label="Model"
            value={chosen}
            options={
              mine.length === 0
                ? [['', listed.loading ? 'Listing models…' : 'No models'] as const]
                : mine.map((m) => [m, m.slice(choice.provider.length + 1)] as const)
            }
            onChange={setPicked}
          />
        </Field>
      ) : null}
    </Form>
  );
  return { fields, ready: signedIn && chosen !== '' ? chosen : null };
}
