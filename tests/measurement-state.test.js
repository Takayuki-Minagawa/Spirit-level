const test = require('node:test');
const assert = require('node:assert/strict');

const MeasurementState = require('../spirit-level/app/measurement-state.js');

const sample = (roll, timestamp) => ({ roll, pitch: -roll, timestamp });

test('rejects malformed measurements', () => {
  const state = MeasurementState.create();
  assert.equal(state.receive(null), false);
  assert.equal(state.receive(sample(Number.NaN, 1)), false);
  assert.equal(state.receive(sample(1, Infinity)), false);
  assert.equal(state.hasMeasurement(), false);
});

test('publishes the newest live measurement once per display update', () => {
  const state = MeasurementState.create();
  state.receive(sample(1, 10));
  state.receive(sample(2, 20));
  assert.deepEqual(state.consumeDisplayUpdate(), sample(2, 20));
  assert.equal(state.consumeDisplayUpdate(), null);
});

test('HOLD freezes display while retaining the latest live measurement', () => {
  const state = MeasurementState.create();
  assert.deepEqual(state.toggleHold(), { changed: false, holding: false });

  state.receive(sample(1, 10));
  state.consumeDisplayUpdate();
  assert.deepEqual(state.toggleHold(), { changed: true, holding: true });
  assert.equal(state.receive(sample(8, 20)), false);
  assert.equal(state.consumeDisplayUpdate(), null);
  assert.deepEqual(state.getLiveMeasurement(), sample(8, 20));

  assert.deepEqual(state.toggleHold(), { changed: true, holding: false });
  assert.deepEqual(state.consumeDisplayUpdate(), sample(8, 20));
});

test('reset clears live, held, and pending display state', () => {
  const state = MeasurementState.create();
  state.receive(sample(3, 10));
  state.toggleHold();
  state.reset();
  assert.equal(state.hasMeasurement(), false);
  assert.equal(state.isHolding(), false);
  assert.equal(state.consumeDisplayUpdate(), null);
});
