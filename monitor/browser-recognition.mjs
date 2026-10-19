import { createHmac } from 'node:crypto';

// This cookie is only a notification hint. Never persist session or MFA cookies.
export function monitorBrowserCookie(origin, email, key) {
  if (!key || !email) throw new Error('Monitor browser recognition configuration missing');
  if (new URL(origin).protocol !== 'https:') throw new Error('Monitor requires HTTPS');
  return {
    name: '__Host-aplt_security_browser',
    value: createHmac('sha256', key)
      .update(JSON.stringify(['autopilot-status-browser-v1', origin, email]))
      .digest('hex'),
    url: new URL('/', origin).href,
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
  };
}
