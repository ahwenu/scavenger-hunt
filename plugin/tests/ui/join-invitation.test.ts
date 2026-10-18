/** QRの配布物へ管理資格情報を混ぜず、表示と同じ参加URLを保持することを検証する。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import { createInvitationFile, createJoinQr } from '../../src/ui/join-invitation.js';

const url = 'https://karimono.example/rooms/11111111111111111111111111111111/join';

test('the invitation SVG keeps the exact participant URL, white quiet zone and local QR modules', () => {
  const file = createInvitationFile(url, 'svg');
  const code = createJoinQr(url);
  const expected = QRCode.create(url, { errorCorrectionLevel: 'M' });
  assert.equal(file.name, 'karimono-join-11111111111111111111111111111111.svg');
  assert.equal(file.mimeType, 'image/svg+xml');
  assert.equal(code.size, expected.modules.size + 8);
  assert.ok(file.text!.includes(`<desc>${url}</desc>`));
  assert.ok(file.text!.includes(`d="${code.path}"`));
  assert.match(file.text!, /width="1024" height="1024"/);
  assert.match(file.text!, /fill="#fff"/);
  assert.doesNotMatch(file.text!, /script|foreignObject|hostToken|cookie|https?:\/\/[^<]*host_/i);
});

test('invitation exports reject credentials, secret query fragments and management URLs', () => {
  for (const invalid of [
    `${url}?hostToken=private`, `${url}#private`, url.replace('https://', 'https://user:secret@'),
    url.replace('/join', '/host'), 'javascript:alert(1)', 'https://example.com/rooms/<script>/join',
  ]) assert.throws(() => createInvitationFile(invalid, 'svg'));
});
