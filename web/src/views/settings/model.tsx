'use client';
import { useState } from 'react';
import { ProviderList, pressOf, providerName, useProviderConnect } from '@/components/model-connect.tsx';
import { costLine, spentLine, usePlan, providerOf } from '@/lib/prices.ts';
import { type ManageState, api } from '@/lib/api/endpoints.ts';
import { useAction } from '@/components/action.ts';
import { Button, ChoiceGroup, DeleteButton, Dialog, Failure, Select, SettingRow, SettingsGroup, Sheet, useToast } from '@/system';
import { useModels } from '@/lib/api/reads.ts';

const REASONING = [
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
] as const satisfies readonly (readonly [ManageState['model']['reasoning'], string])[];

/** Change the provider: choose, sign in, try a model, switch. Until the switch, the one in use goes on classifying. */
function ChangeProvider({ state, reload, onClose }: { state: ManageState; reload: () => void; onClose: () => void }) {
  const { choices, chosen } = state.model;
  const inUse = providerOf(chosen);
  const [picked, setPicked] = useState<(typeof choices)[number] | null>(null);
  const subtitle = `${providerName(
    choices.find((c) => c.provider === inUse),
    inUse ?? '',
  )} stays in use until you switch.`;
  if (!picked)
    return (
      <Dialog open onClose={onClose} title="Change provider" subtitle={subtitle}>
        <ProviderList choices={choices} inUse={inUse} onChoose={setPicked} />
      </Dialog>
    );
  return <Switch key={picked.provider} choice={picked} state={state} reload={reload} subtitle={subtitle} onBack={() => setPicked(null)} onClose={onClose} />;
}

function Switch({
  choice,
  state,
  reload,
  subtitle,
  onBack,
  onClose,
}: {
  choice: ManageState['model']['choices'][number];
  state: ManageState;
  reload: () => void;
  subtitle: string;
  onBack: () => void;
  onClose: () => void;
}) {
  const step = useProviderConnect(choice, state.model, reload);
  const { ready, next } = step;
  const { busy, error, run } = useAction();
  const toast = useToast();
  const old = providerOf(state.model.chosen);
  const name = providerName(choice, choice.provider);
  const doSwitch = () =>
    run(async () => {
      if (!ready) return;
      // The new model first, so something always classifies; the old sign-in goes once nothing uses it.
      await api.setModel(ready);
      if (old && old !== choice.provider) await api.signOutModel(old);
      toast(`Now classifying with ${name}`);
      reload();
      onClose();
    });
  return (
    <Dialog
      open
      onClose={onClose}
      title={step.title}
      subtitle={subtitle}
      footer={
        <>
          {next ? (
            <Button variant="ink" {...pressOf(next)}>
              {next.label}
            </Button>
          ) : (
            <Button variant="ink" busy={busy} disabled={!ready} onClick={doSwitch}>
              Switch to {name}
            </Button>
          )}
          <Button variant="quiet" onClick={onBack}>
            Back
          </Button>
          <Failure>{error}</Failure>
        </>
      }
    >
      {step.body}
    </Dialog>
  );
}

/** The reader's own way to a model and which one classifies their mail: each person signs in for themselves. */
export function Model({ state, reload, onConnect }: { state: ManageState; reload: () => void; onConnect: () => void }) {
  const { busy, error, run, settle } = useAction();
  const { chosen, choices, signedIn } = state.model;
  const [changing, setChanging] = useState(false);
  const models = useModels(signedIn);
  const plan = usePlan();
  const provider = providerOf(chosen);
  const choice = choices.find((c) => c.provider === provider);
  // Connecting a model is SetUp's Connect step, under this panel: the button closes the panel onto it.
  if (chosen === null || provider === null || !signedIn.includes(provider))
    return (
      <SettingsGroup title="Model" note="Classifies what no rule covers.">
        <Sheet>
          <SettingRow title="No model connected" note="Nothing new is classified or suggested. Rules still label what they cover.">
            <Button onClick={onConnect}>Connect a model</Button>
          </SettingRow>
        </Sheet>
      </SettingsGroup>
    );
  const offered = [...new Set([chosen, ...(models.data?.models ?? []).filter((m) => m.startsWith(`${provider}/`))])];
  const others = signedIn.filter((p) => p !== provider);
  const { spent } = state;
  return (
    <SettingsGroup
      title="Model"
      note={spent.costUsd > 0 ? `Classifies what no rule covers. ${spentLine(spent.costUsd, spent.judged, plan)}` : 'Classifies what no rule covers.'}
    >
      <Sheet>
        <SettingRow title={providerName(choice, provider)} note={choice?.how === 'key' ? 'Key saved.' : 'Signed in.'}>
          <Button onClick={() => setChanging(true)}>Change provider</Button>
        </SettingRow>
        <SettingRow title="Model" note={costLine(choice, models.data?.costs ?? {}, chosen)}>
          <Select
            label="Model"
            value={chosen}
            options={offered.map((m) => [m, m.slice(provider.length + 1)] as const)}
            disabled={busy}
            onChange={(model) => run(() => api.setModel(model), reload)}
          />
        </SettingRow>
        <SettingRow title="Reasoning" note="How long it thinks before it answers. Higher is slower, and each message takes more tokens.">
          <ChoiceGroup
            label="Reasoning"
            value={state.model.reasoning}
            options={REASONING}
            disabled={busy}
            onChange={(reasoning) => reasoning && run(() => api.setReasoning(reasoning), reload)}
          />
        </SettingRow>
        {others.map((p) => (
          <SettingRow
            key={p}
            title={providerName(
              choices.find((c) => c.provider === p),
              p,
            )}
            note="Signed in, but not in use."
          >
            <DeleteButton
              question={`Remove ${providerName(
                choices.find((c) => c.provider === p),
                p,
              )}?`}
              {...(choices.find((c) => c.provider === p)?.how === 'key' ? { says: 'The key you saved goes with it.' } : {})}
              onDelete={async () => {
                await settle(() => api.signOutModel(p));
                reload();
              }}
            >
              Remove
            </DeleteButton>
          </SettingRow>
        ))}
      </Sheet>
      <Failure>{error}</Failure>
      {changing ? <ChangeProvider state={state} reload={reload} onClose={() => setChanging(false)} /> : null}
    </SettingsGroup>
  );
}
