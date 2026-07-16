const test = require('node:test');
const assert = require('node:assert/strict');

const Diagnostics = require('../spirit-level/diagnostics.js');

test('sampling rate uses the median positive interval', () => {
  assert.equal(Diagnostics.calculateSamplingRate([]), 0);
  assert.equal(Diagnostics.calculateSamplingRate([100]), 0);
  assert.equal(Diagnostics.calculateSamplingRate([0, 20, 40]), 50);
  assert.equal(Diagnostics.calculateSamplingRate([0, 20, 40, 1040]), 50);
});

test('auto-start never invokes a user-gesture permission flow', () => {
  function MotionEventWithoutPermission() {}
  function MotionEventWithPermission() {}
  MotionEventWithPermission.requestPermission = async () => 'granted';

  assert.equal(Diagnostics.shouldAutoStart(true, MotionEventWithoutPermission), true);
  assert.equal(Diagnostics.shouldAutoStart(true, MotionEventWithPermission), false);
  assert.equal(Diagnostics.shouldAutoStart(false, MotionEventWithoutPermission), false);
  assert.equal(Diagnostics.shouldAutoStart(true, undefined), false);
});

test('probe classification enforces usable gravity rate boundaries', () => {
  const base = { hasEvents: true, hasAccG: true, validCount: 20, fsHz: 50 };
  assert.deepEqual(Diagnostics.classifyProbe(base), { ok: true, warn: false });
  assert.deepEqual(
    Diagnostics.classifyProbe({ ...base, fsHz: 10 }),
    { ok: true, warn: true }
  );
  assert.deepEqual(
    Diagnostics.classifyProbe({ ...base, fsHz: 9.99 }),
    { ok: false, reason: 'low-rate' }
  );
  assert.deepEqual(
    Diagnostics.classifyProbe({ ...base, validCount: 1 }),
    { ok: false, reason: 'low-rate' }
  );
  for (const invalidRate of [Number.NaN, Infinity, -Infinity]) {
    assert.deepEqual(
      Diagnostics.classifyProbe({ ...base, fsHz: invalidRate }),
      { ok: false, reason: 'low-rate' }
    );
  }
  for (const invalidCount of [2.5, Number.NaN, Infinity]) {
    assert.deepEqual(
      Diagnostics.classifyProbe({ ...base, validCount: invalidCount }),
      { ok: false, reason: 'low-rate' }
    );
  }
  assert.deepEqual(
    Diagnostics.classifyProbe({ ...base, hasAccG: false }),
    { ok: false, reason: 'no-gravity' }
  );
});

test('buildProfile only returns data accepted by the app contract', () => {
  const result = {
    hasEvents: true,
    hasAccG: true,
    validCount: 80,
    fsHz: 40
  };
  assert.deepEqual(Diagnostics.buildProfile(result, false), {
    version: 1,
    sensorAvailable: true,
    needsPermission: false,
    hasAccG: true,
    fsHz: 40,
    eventCount: 80
  });
  assert.equal(Diagnostics.buildProfile({ ...result, fsHz: 2 }, false), null);
});

test('storage helpers fail closed when browser storage is unavailable', () => {
  const blockedStorage = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {
      throw new Error('blocked');
    }
  };
  assert.equal(Diagnostics.readStorage(null, 'key'), null);
  assert.equal(Diagnostics.readStorage(blockedStorage, 'key'), null);
  assert.equal(Diagnostics.writeStorage(blockedStorage, 'key', 'value'), false);
  assert.equal(Diagnostics.removeStorage(blockedStorage, 'key'), false);
});

test('run guard invalidates asynchronous work after cancel or replacement', () => {
  const guard = Diagnostics.createRunGuard();
  const first = guard.start();
  assert.equal(guard.isCurrent(first), true);
  guard.cancel();
  assert.equal(guard.isCurrent(first), false);

  const second = guard.start();
  const third = guard.start();
  assert.equal(guard.isCurrent(second), false);
  assert.equal(guard.isCurrent(third), true);
});

test('probeSensor counts events but samples only valid finite gravity', async () => {
  let listener = null;
  let finish = null;
  let removed = false;
  const timestamps = [0, 20];
  const eventTarget = {
    addEventListener(type, handler) {
      assert.equal(type, 'devicemotion');
      listener = handler;
    },
    removeEventListener(type, handler) {
      assert.equal(type, 'devicemotion');
      assert.equal(handler, listener);
      removed = true;
    }
  };

  const resultPromise = Diagnostics.probeSensor(2000, {
    eventTarget,
    now: () => timestamps.shift() ?? 40,
    setTimer: (callback) => {
      finish = callback;
      return 1;
    },
    clearTimer: () => {}
  });

  listener({ accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 } });
  listener({ accelerationIncludingGravity: { x: Infinity, y: 0, z: 9.81 } });
  listener({ accelerationIncludingGravity: { x: 1, y: 0, z: 9.7 } });
  finish();

  assert.deepEqual(await resultPromise, {
    aborted: false,
    hasEvents: true,
    count: 3,
    hasAccG: true,
    validCount: 2,
    fsHz: 25
  });
  assert.equal(removed, true);
});

test('probeSensor abort removes its listener and cancels its timer', async () => {
  const controller = new AbortController();
  let removed = false;
  let timerCleared = false;
  const eventTarget = {
    addEventListener() {},
    removeEventListener() {
      removed = true;
    }
  };
  const resultPromise = Diagnostics.probeSensor(2000, {
    eventTarget,
    signal: controller.signal,
    setTimer: () => 7,
    clearTimer: (timerId) => {
      assert.equal(timerId, 7);
      timerCleared = true;
    }
  });

  controller.abort();
  const result = await resultPromise;
  assert.equal(result.aborted, true);
  assert.equal(removed, true);
  assert.equal(timerCleared, true);
});
