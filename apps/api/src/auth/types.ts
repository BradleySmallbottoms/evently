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
  /**
   * When true, registration responses include the email verification token.
   * Used locally and on AWS until SES delivers the link (set INCLUDE_VERIFICATION_TOKEN).
   */
  includeVerificationToken: boolean;
  now: () => Date;
};
