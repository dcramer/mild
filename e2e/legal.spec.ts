import { boxOf, expect, path, PHONE, test } from './sift.ts';

test.describe('A Mild run as a service', () => {
  test.use({ cloud: true });

  test.describe('signed out', () => {
    test.use({ signedOut: true });

    test('the security page is linked at the foot of the sign-in page, drawn by the server, says where to report a problem privately, and links to the privacy policy', async ({
      page,
    }) => {
      const html = await (await page.request.get('/')).text();
      expect(html).toContain('Sign in with Google');
      expect(html).not.toContain('aria-label="Sections"');
      await page.goto('/');
      await page.getByRole('contentinfo').getByRole('link', { name: 'Security' }).click();
      await expect(page.getByRole('heading', { name: 'Security', level: 1 })).toBeVisible();
      await path(page).toBe('/security');
      await expect(page.getByRole('heading', { name: 'What it does not protect against' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'privately on GitHub' })).toHaveAttribute('href', 'https://github.com/dcramer/sift/security/advisories/new');

      await page.getByRole('link', { name: 'privacy policy' }).click();
      await expect(page.getByRole('heading', { name: 'Privacy policy', level: 1 })).toBeVisible();
      await expect(page.getByRole('link', { name: 'an issue on GitHub' })).toHaveAttribute('href', 'https://github.com/dcramer/sift/issues');
    });
  });

  test('signed in, the foot of a screen links to the terms, privacy and security', async ({ page }) => {
    await page.goto('/rules');
    await page.getByRole('contentinfo').getByRole('link', { name: 'Terms' }).click();
    await expect(page.getByRole('heading', { name: 'Terms of service', level: 1 })).toBeVisible();
    await page.goBack();
    await page.getByRole('contentinfo').getByRole('link', { name: 'Security' }).click();
    await expect(page.getByRole('heading', { name: 'Security', level: 1 })).toBeVisible();
  });

  test.describe('On a phone', () => {
    test.use({ viewport: PHONE });

    test('the menu has the terms, privacy and security under the sections', async ({ page }) => {
      await page.goto('/rules');
      await page.getByRole('button', { name: 'Menu' }).click();
      const menu = page.getByRole('dialog', { name: 'Menu' });
      const last = await boxOf(menu.getByRole('navigation', { name: 'Sections' }));
      const privacy = menu.getByRole('link', { name: 'Privacy' });
      expect((await boxOf(privacy)).y).toBeGreaterThan(last.y + last.height);
      await privacy.click();
      await expect(page.getByRole('heading', { name: 'Privacy policy', level: 1 })).toBeVisible();
    });
  });
});

test.describe("Someone's own copy", () => {
  test('has no terms, privacy or security: the foot is the code, and their addresses are the dashboard', async ({ page }) => {
    await page.goto('/rules');
    const foot = page.getByRole('contentinfo');
    await expect(foot.getByRole('link', { name: 'Open source' })).toBeVisible();
    for (const name of ['Terms', 'Privacy', 'Security']) await expect(foot.getByRole('link', { name })).toHaveCount(0);

    await page.goto('/terms');
    await expect(page.getByRole('heading', { name: 'For review', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Terms of service' })).toHaveCount(0);
  });

  test.describe('On a phone', () => {
    test.use({ viewport: PHONE });

    test('the menu has no fine print', async ({ page }) => {
      await page.goto('/rules');
      await page.getByRole('button', { name: 'Menu' }).click();
      const menu = page.getByRole('dialog', { name: 'Menu' });
      await expect(menu.getByRole('navigation', { name: 'Sections' })).toBeVisible();
      await expect(menu.getByRole('link', { name: 'Privacy' })).toHaveCount(0);
    });
  });
});
