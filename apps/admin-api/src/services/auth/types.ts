import type {
  AdminLoginChallengeResponse,
  AdminLoginRequest,
  AdminSessionResponse,
  AdminTotpConfirmRequest,
} from '@local-events/contracts';

export type AdminAuthErrorCode =
  | 'unauthorized'
  | 'invalid_credentials'
  | 'invalid_totp'
  | 'challenge_expired';

export class AdminAuthError extends Error {
  constructor(readonly code: AdminAuthErrorCode) {
    super(code);
    this.name = 'AdminAuthError';
  }
}

export type AdminAuthServices = {
  login: (input: AdminLoginRequest) => Promise<AdminLoginChallengeResponse>;
  confirmTotp: (input: AdminTotpConfirmRequest) => Promise<AdminSessionResponse & { sessionToken: string }>;
  me: (sessionToken: string | undefined) => Promise<AdminSessionResponse>;
  logout: (sessionToken: string | undefined) => Promise<void>;
  requireSession: (sessionToken: string | undefined) => Promise<{ adminId: string; email: string; role: string }>;
  /** Create bootstrap admin if none exist. Returns whether one was created. */
  ensureBootstrapAdmin?: (input: {
    email: string;
    password: string;
  }) => Promise<{ created: boolean }>;
};
