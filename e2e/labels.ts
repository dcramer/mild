import { expect, type Page } from '@playwright/test';

export const addLabelsDialog = (page: Page) => page.getByRole('dialog', { name: 'Add labels' });

export const addALabelDialog = (page: Page) => page.getByRole('dialog', { name: 'Add a label' });

/** From the open Add labels, Write one yourself, with a name and nothing else. */
export async function writeLabel(page: Page, name: string) {
  await addLabelsDialog(page).getByRole('button', { name: 'Write one yourself' }).click();
  const manual = addALabelDialog(page);
  await manual.getByRole('textbox', { name: 'Name' }).fill(name);
  await manual.getByRole('button', { name: 'Add label', exact: true }).click();
  await expect(manual).toHaveCount(0);
}

/** The first step of setting up a mailbox: its heading, and the box its words go in. */
export const WANT = 'What do you want from Mild?';

/** Setting up, asks for labels for `words`, and waits for the step that offers them. */
export async function suggestLabels(page: Page, words: string) {
  await page.getByRole('textbox', { name: WANT }).fill(words);
  await page.getByRole('button', { name: 'Suggest labels' }).click();
  await expect(page.getByRole('heading', { name: 'Your labels', level: 1 })).toBeVisible();
}

/** In the open Add labels, asks the model for labels for `words`. */
export async function askForLabels(page: Page, words: string) {
  const dialog = addLabelsDialog(page);
  await dialog.getByRole('textbox', { name: 'What mail, and what should happen to it?' }).fill(words);
  await dialog.getByRole('button', { name: 'Suggest labels' }).click();
  return dialog;
}
