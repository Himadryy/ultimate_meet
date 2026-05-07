import assert from 'assert';
import { RoomStateMachine } from '../src/roomState';

function runTests() {
  const m = new RoomStateMachine();

  // Duplicate joins should not create multiple entries for same participant in same room
  m.join('room-dup', 'p-dup', 'viewer');
  const participantsAfterDup = m.join('room-dup', 'p-dup', 'viewer');
  assert.strictEqual(participantsAfterDup.filter(p => p.id === 'p-dup').length, 1, 'duplicate join should not create duplicates');

  // Rapid leave/join
  m.join('room-rapid', 'p-rapid', 'viewer');
  const left = m.leave('p-rapid');
  assert.ok(left && left.roomId === 'room-rapid', 'leave should return room info');
  // rejoin immediately
  const participantsAfterRejoin = m.join('room-rapid', 'p-rapid', 'viewer');
  assert.ok(participantsAfterRejoin.find(p => p.id === 'p-rapid'), 'participant should be present after rapid rejoin');

  // Talkback toggles
  m.join('room-talkback', 'p-talk', 'viewer');
  const updatedOn = m.setTalkback('room-talkback', 'p-talk', true);
  assert.strictEqual(updatedOn.talkbackEnabled, true, 'talkback should be enabled after toggle on');
  const updatedOff = m.setTalkback('room-talkback', 'p-talk', false);
  assert.strictEqual(updatedOff.talkbackEnabled, false, 'talkback should be disabled after toggle off');

  console.log('All RoomStateMachine tests passed');
}

try {
  runTests();
  process.exit(0);
} catch (err) {
  console.error('RoomStateMachine tests failed', err);
  process.exit(1);
}
