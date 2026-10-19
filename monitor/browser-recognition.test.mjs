import assert from 'node:assert/strict';
import test from 'node:test';
import { monitorBrowserCookie } from './browser-recognition.mjs';

test('fresh runs recognise the same monitor without carrying an authenticated session', () => {
  const args = ['https://app.example.test', 'monitor@example.test', 'synthetic-test-key'];
  const cookie = monitorBrowserCookie(...args);
  assert.deepEqual(monitorBrowserCookie(...args), cookie);
  assert.equal(cookie.name, '__Host-aplt_security_browser');
  assert.match(cookie.value, /^[a-f0-9]{64}$/);
  assert.equal(cookie.url, 'https://app.example.test/');
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.secure, true);
  assert.equal(cookie.sameSite, 'Strict');
  for (const changed of [
    ['https://other.example.test', args[1], args[2]],
    [args[0], 'other@example.test', args[2]],
    [args[0], args[1], 'rotated-test-key'],
  ]) assert.notEqual(monitorBrowserCookie(...changed).value, cookie.value);
});

test('missing configuration or insecure origins fail before login', () => {
  assert.throws(() => monitorBrowserCookie('https://app.example.test', 'monitor@example.test', ''));
  assert.throws(() => monitorBrowserCookie('http://app.example.test', 'monitor@example.test', 'test-key'));
});
