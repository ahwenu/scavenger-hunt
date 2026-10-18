import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveParticipantPath } from '../apps/cloud/app/participant/entry-link.ts';

const origin = 'https://karimono.example';

test('部屋IDと同じサイトの共有リンクを参加画面の相対パスへ整える', () => {
  for (const input of ['room-A12', ' room-A12 ', '/rooms/room-A12/join', '/rooms/room-A12/join/', 'rooms/room-A12/join', `${origin}/rooms/room-A12/join`]) {
    assert.equal(resolveParticipantPath(input, origin), '/rooms/room-A12/join', input);
  }
  assert.equal(resolveParticipantPath(`http://localhost:5173/rooms/demo/join`, 'http://localhost:5173'), '/rooms/demo/join');
});

test('URLに付いていたqueryやfragmentの秘密情報は参加先へ持ち込まない', () => {
  assert.equal(resolveParticipantPath(`${origin}/rooms/demo/join?token=secret&next=https://outside.example/#private`, origin), '/rooms/demo/join');
  assert.equal(resolveParticipantPath('/rooms/demo/join#token=secret', origin), '/rooms/demo/join');
});

test('外部サイト・認証情報・曖昧なURL・実行可能なschemeは拒否する', () => {
  for (const input of [
    'https://outside.example/rooms/demo/join', 'http://karimono.example/rooms/demo/join',
    'https://karimono.example:8443/rooms/demo/join', '//karimono.example/rooms/demo/join',
    'https://user:secret@karimono.example/rooms/demo/join', 'javascript:alert(1)',
    'data:text/html,hello', 'https:karimono.example/rooms/demo/join',
    'https://karimono.example\\@outside.example/rooms/demo/join', '/rooms/de\nmo/join',
  ]) assert.equal(resolveParticipantPath(input, origin), null, input);
});

test('参加ルート以外・不正な部屋ID・補正されるパスを受け付けない', () => {
  for (const input of ['', ' ', 'room_name', '日本語', 'a'.repeat(65), '/rooms/demo/host', '/rooms/demo/join/extra', '/rooms//join', '/rooms/demo/../other/join', '/rooms/%64emo/join', '?room=demo']) {
    assert.equal(resolveParticipantPath(input, origin), null, input);
  }
  assert.equal(resolveParticipantPath('a'.repeat(64), origin), `/rooms/${'a'.repeat(64)}/join`);
  assert.equal(resolveParticipantPath('demo', 'javascript:alert(1)'), null);
});
