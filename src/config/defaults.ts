import { BlockDefaults } from '../types';

export function blockDefaultsFrom(profile: unknown, region: unknown): BlockDefaults {
  const defaults: BlockDefaults = {};
  const cleanProfile = nonEmptyString(profile);
  const cleanRegion = nonEmptyString(region);
  if (cleanProfile !== undefined) {
    defaults.profile = cleanProfile;
  }
  if (cleanRegion !== undefined) {
    defaults.region = cleanRegion;
  }
  return defaults;
}

export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
