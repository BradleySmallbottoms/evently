import type {
  CreateWebLoginCodeRequest,
  CreateWebLoginCodeResponse,
  CreateIdentityRequest,
  CreateIdentityResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  ExchangeWebLoginCodeRequest,
  ExchangeWebLoginCodeResponse,
  LoginPublisherRequest,
  LoginPublisherResponse,
  PublisherMeResponse,
  RegisterPublisherRequest,
  RegisterPublisherResponse,
  VerifyPublisherEmailRequest,
  VerifyPublisherEmailResponse,
  WebUserMeResponse,
} from '@local-events/contracts';

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_unverified'
  | 'email_taken'
  | 'slug_taken'
  | 'invalid_token'
  | 'token_expired'
  | 'unauthorized'
  | 'invalid_pairing_code';

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.name = 'AuthError';
  }
}

export type PublisherMemberAccess = {
  accountId: string;
  role: 'owner' | 'editor';
  publisherVerified: boolean;
};

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
  createWebLoginCode: (input: CreateWebLoginCodeRequest) => Promise<CreateWebLoginCodeResponse>;
  exchangeWebLoginCode: (
    input: ExchangeWebLoginCodeRequest,
  ) => Promise<{
    body: ExchangeWebLoginCodeResponse;
    sessionToken: string;
    expiresAt: Date;
  }>;
  getWebUserMe: (sessionToken: string | undefined) => Promise<WebUserMeResponse>;
  /** Resolves a publisher session and checks membership on the given publisher. */
  requirePublisherMember: (
    sessionToken: string | undefined,
    publisherId: string,
  ) => Promise<PublisherMemberAccess>;
};

export type AuthEnv = {
  /**
   * When true, registration responses include the email verification token.
   * Used locally and on AWS until SES delivers the link (set INCLUDE_VERIFICATION_TOKEN).
   */
  includeVerificationToken: boolean;
  now: () => Date;
};
