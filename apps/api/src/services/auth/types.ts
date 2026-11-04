import type {
  AcceptPublisherInviteRequest,
  AcceptPublisherInviteResponse,
  ConfirmDeviceLinkRequest,
  ConfirmDeviceLinkResponse,
  CreateDeviceLinkCodeRequest,
  CreateDeviceLinkCodeResponse,
  CreatePublisherInviteRequest,
  CreatePublisherInviteResponse,
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
  PublisherOtpConfirmRequest,
  PublisherOtpLoginRequest,
  PublisherOtpLoginResponse,
  PublisherTotpChangeRequest,
  PublisherTotpLoginRequest,
  PublisherTotpSetupResponse,
  PublisherTotpStatusResponse,
  RegisterPushTokenRequest,
  RegisterPushTokenResponse,
  PublisherInviteListResponse,
  PublisherMemberListResponse,
  PublisherMeResponse,
  PublisherProfile,
  RegisterPublisherRequest,
  RegisterPublisherResponse,
  UpdatePublisherProfileRequest,
  VerifyPublisherEmailRequest,
  VerifyPublisherEmailResponse,
  WebUserMeResponse,
} from '@local-events/contracts';
import type { PublisherStatus } from '@local-events/domain';

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'invalid_totp'
  | 'challenge_expired'
  | 'invalid_otp'
  | 'otp_expired'
  | 'otp_rate_limited'
  | 'totp_not_enabled'
  | 'totp_already_enabled'
  | 'email_unverified'
  | 'email_taken'
  | 'slug_taken'
  | 'invalid_token'
  | 'token_expired'
  | 'unauthorized'
  | 'forbidden'
  | 'invalid_pairing_code'
  | 'device_link_same_user'
  | 'already_member'
  | 'invite_pending'
  | 'member_limit'
  | 'invite_email_mismatch'
  | 'user_banned';

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.name = 'AuthError';
  }
}

export type PublisherMemberAccess = {
  accountId: string;
  role: 'owner' | 'editor';
  publisherStatus: PublisherStatus;
};

export type UserSessionAccess = {
  userId: string;
};

export type AuthServices = {
  createIdentity: (input: CreateIdentityRequest) => Promise<CreateIdentityResponse>;
  createSession: (input: CreateSessionRequest) => Promise<CreateSessionResponse>;
  registerPublisher: (input: RegisterPublisherRequest) => Promise<RegisterPublisherResponse>;
  verifyPublisherEmail: (
    input: VerifyPublisherEmailRequest,
  ) => Promise<VerifyPublisherEmailResponse>;
  loginPublisher: (input: LoginPublisherRequest) => Promise<PublisherLoginResult>;
  requestPublisherOtp: (input: PublisherOtpLoginRequest) => Promise<PublisherOtpLoginResponse>;
  confirmPublisherOtp: (input: PublisherOtpConfirmRequest) => Promise<PublisherLoginResult>;
  confirmPublisherTotp: (input: PublisherTotpLoginRequest) => Promise<PublisherLoginResult>;
  setupPublisherTotp: (sessionToken: string | undefined) => Promise<PublisherTotpSetupResponse>;
  confirmPublisherTotpSetup: (
    sessionToken: string | undefined,
    input: PublisherTotpChangeRequest,
  ) => Promise<PublisherTotpStatusResponse>;
  disablePublisherTotp: (
    sessionToken: string | undefined,
    input: PublisherTotpChangeRequest,
  ) => Promise<PublisherTotpStatusResponse>;
  logoutPublisher: (sessionToken: string | undefined) => Promise<void>;
  getPublisherMe: (sessionToken: string | undefined) => Promise<PublisherMeResponse>;
  createWebLoginCode: (input: CreateWebLoginCodeRequest) => Promise<CreateWebLoginCodeResponse>;
  exchangeWebLoginCode: (input: ExchangeWebLoginCodeRequest) => Promise<{
    body: ExchangeWebLoginCodeResponse;
    sessionToken: string;
    expiresAt: Date;
  }>;
  getWebUserMe: (sessionToken: string | undefined) => Promise<WebUserMeResponse>;
  createDeviceLinkCode: (
    input: CreateDeviceLinkCodeRequest,
  ) => Promise<CreateDeviceLinkCodeResponse>;
  confirmDeviceLink: (input: ConfirmDeviceLinkRequest) => Promise<ConfirmDeviceLinkResponse>;
  /** Resolves a publisher session and checks membership on the given publisher. */
  requirePublisherMember: (
    sessionToken: string | undefined,
    publisherId: string,
  ) => Promise<PublisherMemberAccess>;
  /** Resolves an app-user session (Bearer or pairing cookie token). */
  requireUserSession: (sessionToken: string | undefined) => Promise<UserSessionAccess>;
  /** Stores an Expo push token on the device identified by deviceCredential. */
  registerPushToken: (
    sessionToken: string | undefined,
    input: RegisterPushTokenRequest,
  ) => Promise<RegisterPushTokenResponse>;
  getPublisherProfile: (
    sessionToken: string | undefined,
    publisherId: string,
  ) => Promise<PublisherProfile>;
  updatePublisherProfile: (
    sessionToken: string | undefined,
    publisherId: string,
    input: UpdatePublisherProfileRequest,
  ) => Promise<PublisherProfile>;
  listPublisherMembers: (
    sessionToken: string | undefined,
    publisherId: string,
  ) => Promise<PublisherMemberListResponse>;
  listPublisherInvites: (
    sessionToken: string | undefined,
    publisherId: string,
  ) => Promise<PublisherInviteListResponse>;
  createPublisherInvite: (
    sessionToken: string | undefined,
    publisherId: string,
    input: CreatePublisherInviteRequest,
  ) => Promise<CreatePublisherInviteResponse>;
  acceptPublisherInvite: (
    sessionToken: string | undefined,
    input: AcceptPublisherInviteRequest,
  ) => Promise<AcceptPublisherInviteResponse>;
};

/** Password or email-code login. The cookie is set only when status is authenticated. */
export type PublisherLoginResult =
  | {
      status: 'authenticated';
      body: Extract<LoginPublisherResponse, { status: 'authenticated' }>;
      sessionToken: string;
      expiresAt: Date;
    }
  | {
      status: 'totp_required';
      body: Extract<LoginPublisherResponse, { status: 'totp_required' }>;
    };

export type AuthEnv = {
  /**
   * When true, registration responses include the email verification token.
   * Used locally and on AWS until Resend delivers the link (set INCLUDE_VERIFICATION_TOKEN).
   */
  includeVerificationToken: boolean;
  /**
   * When true, a publisher email-code response includes the code.
   * Defaults to includeVerificationToken. Set PUBLISHER_INCLUDE_LOGIN_OTP.
   */
  includeLoginOtp?: boolean;
  /** Pepper for publisher login-code hashes. A missing value is random for this process. */
  otpPepper?: string;
  /** Sends the publisher sign-in code. Unset means the code is not emailed. */
  sendPublisherLoginCode?: (input: { to: string; code: string }) => Promise<void>;
  now: () => Date;
};
