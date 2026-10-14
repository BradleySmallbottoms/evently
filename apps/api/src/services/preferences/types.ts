import type {
  CreateUserAreaRequest,
  QuietHoursPrefs,
  UpdateDiscoveryRadiusRequest,
  UpdateQuietHoursRequest,
  UpdateTravelDistanceRequest,
  UpdateUserAreaRequest,
  UpdateUserProfileRequest,
  UserArea,
  UserPreferencesResponse,
  UserProfile,
} from '@local-events/contracts';

export type PreferenceErrorCode =
  | 'unauthorized'
  | 'not_found'
  | 'invalid_area'
  | 'area_limit'
  | 'unknown_tag'
  | 'unknown_region'
  | 'invalid_display_name'
  | 'name_required';

export class PreferenceError extends Error {
  constructor(readonly code: PreferenceErrorCode) {
    super(code);
    this.name = 'PreferenceError';
  }
}

export type PreferenceServices = {
  getPreferences: (sessionToken: string | undefined) => Promise<UserPreferencesResponse>;
  updateQuietHours: (
    sessionToken: string | undefined,
    input: UpdateQuietHoursRequest,
  ) => Promise<QuietHoursPrefs>;
  updateTravelDistance: (
    sessionToken: string | undefined,
    input: UpdateTravelDistanceRequest,
  ) => Promise<UpdateTravelDistanceRequest>;
  updateDiscoveryRadius: (
    sessionToken: string | undefined,
    input: UpdateDiscoveryRadiusRequest,
  ) => Promise<UpdateDiscoveryRadiusRequest>;
  getProfile: (sessionToken: string | undefined) => Promise<UserProfile>;
  updateProfile: (
    sessionToken: string | undefined,
    input: UpdateUserProfileRequest,
  ) => Promise<UserProfile>;
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
