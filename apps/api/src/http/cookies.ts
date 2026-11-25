export const SESSION_COOKIE = 'll_session';
export const CSRF_COOKIE = 'll_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export interface CookieFlags {
  readonly path: string;
  readonly sameSite: 'lax';
  readonly secure: boolean;
  readonly httpOnly: boolean;
}

export const sessionCookieFlags = (secure: boolean): CookieFlags => ({
  path: '/',
  sameSite: 'lax',
  secure,
  httpOnly: true,
});
/** The CSRF cookie must be readable by the SPA so it can echo it in the header (double submit). */
export const csrfCookieFlags = (secure: boolean): CookieFlags => ({
  path: '/',
  sameSite: 'lax',
  secure,
  httpOnly: false,
});
