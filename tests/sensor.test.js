const test = require('node:test');
const assert = require('node:assert/strict');

const Sensor = require('../spirit-level/app/sensor.js');

function createStorage(initialValue = null) {
  const values = new Map();
  if (initialValue !== null) values.set('spirit_level_profile', initialValue);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

function validProfile(overrides = {}) {
  return {
    version: 1,
    sensorAvailable: true,
    needsPermission: false,
    hasAccG: true,
    fsHz: 50,
    eventCount: 100,
    ...overrides
  };
}

test('loadProfile returns valid data and clears corrupt data', () => {
  const validStorage = createStorage(JSON.stringify(validProfile()));
  assert.deepEqual(Sensor.loadProfile(validStorage), validProfile());

  const corruptStorage = createStorage('{not-json');
  assert.equal(Sensor.loadProfile(corruptStorage), null);
  assert.equal(corruptStorage.getItem('spirit_level_profile'), null);
});

test('loadProfile treats an unavailable storage backend as missing', () => {
  const blockedStorage = {
    getItem() {
      throw new Error('blocked');
    },
    removeItem() {
      throw new Error('blocked');
    }
  };
  assert.equal(Sensor.loadProfile(blockedStorage), null);
  assert.equal(Sensor.loadProfile(undefined), null);
});

test('profiles require usable gravity data and sampling rate', () => {
  assert.equal(Sensor.isValidProfile(validProfile()), true);
  assert.equal(Sensor.isValidProfile(validProfile({ fsHz: 9.9 })), false);
  assert.equal(Sensor.isValidProfile(validProfile({ eventCount: 1 })), false);
  assert.equal(Sensor.isValidProfile(validProfile({ hasAccG: false })), false);
  assert.equal(Sensor.isValidProfile(validProfile({ version: 999 })), false);
});

test('normalizeMotionEvent accepts finite non-zero vectors only', () => {
  assert.deepEqual(
    Sensor.normalizeMotionEvent(
      { accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 } },
      123
    ),
    { gx: 0, gy: 0, gz: 9.81, timestamp: 123 }
  );
  assert.equal(
    Sensor.normalizeMotionEvent(
      { accelerationIncludingGravity: { x: Number.NaN, y: 0, z: 9.81 } },
      123
    ),
    null
  );
  assert.equal(
    Sensor.normalizeMotionEvent(
      { accelerationIncludingGravity: { x: 0, y: 0, z: 0 } },
      123
    ),
    null
  );
  assert.equal(
    Sensor.normalizeMotionEvent(
      { accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 } },
      Number.NaN
    ),
    null
  );
});

test('startListening forwards valid samples and removes its listener', () => {
  let listener = null;
  const eventTarget = {
    addEventListener(type, handler) {
      assert.equal(type, 'devicemotion');
      listener = handler;
    },
    removeEventListener(type, handler) {
      assert.equal(type, 'devicemotion');
      assert.equal(handler, listener);
      listener = null;
    }
  };
  const samples = [];
  const stop = Sensor.startListening((sample) => samples.push(sample), eventTarget, () => 42);

  listener({ accelerationIncludingGravity: { x: 1, y: 2, z: 9 } });
  listener({ accelerationIncludingGravity: { x: Infinity, y: 2, z: 9 } });

  assert.deepEqual(samples, [{ gx: 1, gy: 2, gz: 9, timestamp: 42 }]);
  stop();
  assert.equal(listener, null);
});
