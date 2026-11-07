import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLanAddress, originAllowed } from '../server/lan.js';

test('allowed ranges', { timeout: 5000 }, () => {
  for (const a of ['127.0.0.1', '127.5.5.5', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.5',
    '169.254.3.4', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', '::ffff:192.168.1.5', '::ffff:10.0.0.9', '::ffff:127.0.0.1'])
    assert.ok(isLanAddress(a), a);
});

test('public and bad addresses rejected', { timeout: 5000 }, () => {
  for (const a of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.0.1', '11.0.0.1', '169.253.0.1', '2001:db8::1',
    '2607:f8b0::1', '::ffff:8.8.8.8', 'fec0::1', '', undefined, 'garbage'])
    assert.ok(!isLanAddress(a), String(a));
});

test('originAllowed', { timeout: 5000 }, () => {
  const r = (origin, host) => ({ headers: { origin, host } });
  assert.ok(originAllowed(r('http://192.168.1.5:3000', '192.168.1.5:3000')));
  assert.ok(!originAllowed(r('http://evil.com', '192.168.1.5:3000')));
  assert.ok(!originAllowed(r(undefined, '192.168.1.5:3000')));
  assert.ok(!originAllowed(r('null', '192.168.1.5:3000')));
  assert.ok(!originAllowed(r('http://192.168.1.5:3000', undefined)));
});
