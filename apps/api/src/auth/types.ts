import type {
  CreateIdentityRequest,
  CreateIdentityResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  LoginPublisherRequest,
  LoginPublisherResponse,
  PublisherMeResponse,
  RegisterPublisherRequest,
  RegisterPublisherResponse,
  VerifyPublisherEmailRequest,
  VerifyPublisherEmailResponse,
} from '@local-events/contracts';

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_unverified'
  | 'email_taken'
  | 'slug_taken'
  | 'invalid_token'
  | 'token_expired'
  | 'unauthorized';

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.name = 'AuthError';
  }
}

export type AuthServices = {
  createIdentity: (input: CreateIdentityRequest) => Promise<CreateIdentityResponse>;
  createSession: (input: CreateSessionRequest) => Promise<CreateSessionResponse>;
  registerPublisher: (input: RegisterPublisherRequest) => Promise<RegisterPublisherResponse>;
  verifyPublisherEmail: (
    input: VerifyPublisherEmailRequest,
  ) => Promise<VerifyPublisherEmailResponse>;
  loginPublisher: (input: LoginPublisherRequest) => Promise<{
    body: LoginPublisherResponse;
    sessionToken: string;
    expiresAt: Date;
  }>;
  logoutPublisher: (sessionToken: string | undefined) => Promise<void>;
  getPublisherMe: (sessionToken: string | undefined) => Promise<PublisherMeResponse>;
};

export type AuthEnv = {
  /** When false, registration responses include the verification token (local/dev). */
  isProduction: boolean;
  now: () => Date;
};
