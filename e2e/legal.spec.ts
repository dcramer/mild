import { expect, test } from './sift.ts';

test('the security page is linked at the foot of the signed-out page, and links to the privacy policy', async ({ page }) => {
  // The seeded dashboard has no Google sign-in, so its session reply is made into a signed-out visitor's.
  await page.route('**/api/session?*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), required: true, email: null, canSignIn: true } });
  });
  await page.goto('/');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Security' }).click();
  await expect(page.getByRole('heading', { name: 'Security', level: 1 })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/security');
  await expect(page.getByRole('heading', { name: 'What it does not protect against' })).toBeVisible();

  await page.getByRole('link', { name: 'privacy policy' }).click();
  await expect(page.getByRole('heading', { name: 'Privacy policy', level: 1 })).toBeVisible();
});
