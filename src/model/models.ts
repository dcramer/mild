import type { Api, Model, Models } from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import type { Config } from '../config.ts';
import { fileCredentialStore } from './credentials.ts';

/** pi-ai's providers, with credentials kept in the data directory. Environment API keys still work when nothing is stored. */
export function openModels(config: Config): Models {
  return builtinModels({ credentials: fileCredentialStore(config.modelAuthPath) });
}

/** Look up a `provider/model-id` spec. Throws a message the user can act on. */
export function resolveModel(models: Models, spec: string): Model<Api> {
  const slash = spec.indexOf('/');
  if (slash <= 0 || slash === spec.length - 1) throw new Error(`SIFT_MODEL must look like provider/model-id, not "${spec}".`);
  const model = models.getModel(spec.slice(0, slash), spec.slice(slash + 1));
  if (!model) throw new Error(`Unknown model "${spec}". Run \`sift models\` to list the models you can use.`);
  return model;
}
