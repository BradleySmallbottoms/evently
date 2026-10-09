import type {
  CreateUserAreaRequest,
  QuietHoursPrefs,
  ReplaceUserInterestsRequest,
  ReplaceUserInterestsResponse,
  UpdateQuietHoursRequest,
  UpdateUserAreaRequest,
  UserArea,
  UserPreferencesResponse,
} from '@local-events/contracts';

export type PreferenceErrorCode =
  | 'unauthorized'
  | 'not_found'
  | 'invalid_area'
  | 'area_limit'
  | 'unknown_category'
  | 'unknown_region';

export class PreferenceError extends Error {
  constructor(readonly code: PreferenceErrorCode) {
    super(code);
    this.name = 'PreferenceError';
  }
}

export type PreferenceServices = {
  getPreferences: (sessionToken: string | undefined) => Promise<UserPreferencesResponse>;
  replaceInterests: (
    sessionToken: string | undefined,
    input: ReplaceUserInterestsRequest,
  ) => Promise<ReplaceUserInterestsResponse>;
  updateQuietHours: (
    sessionToken: string | undefined,
    input: UpdateQuietHoursRequest,
  ) => Promise<QuietHoursPrefs>;
  listAreas: (sessionToken: string | undefined) => Promise<{ items: UserArea[] }>;
  createArea: (
    sessionToken: string | undefined,
    input: CreateUserAreaRequest,
  ) => Promise<UserArea>;
  updateArea: (
    sessionToken: string | undefined,
    areaId: string,
    input: UpdateUserAreaRequest,
  ) => Promise<UserArea>;
  deleteArea: (sessionToken: string | undefined, areaId: string) => Promise<void>;
};

export type PreferenceEnv = {
  now: () => Date;
};
