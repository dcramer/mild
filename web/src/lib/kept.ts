/**
 * Every read a screen has shown but the frame's, as this device last kept it, by its query's key (`readName`): a screen
 * is drawn from here at once, before Mild is asked again. Filled from the device once the page is idle, and as Mild
 * answers (`web/src/lib/device.ts`). `id` is its record on the device, which says nothing of what it holds.
 */
export const keptReads = new Map<string, { id: string; value: unknown }>();

export const readName = (queryKey: readonly unknown[]) => JSON.stringify(queryKey);
