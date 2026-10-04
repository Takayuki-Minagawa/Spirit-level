const test = require('node:test');
const assert = require('node:assert/strict');

const Level = require('../spirit-level/app/level.js');

const degreesToGravity = (degrees) => {
  const radians = degrees * (Math.PI / 180);
  return {
    gx: -Math.sin(radians) * 9.81,
    gy: 0,
    gz: Math.cos(radians) * 9.81
  };
};

test('anglesFromGravity calculates representative roll angles', () => {
  assert.deepEqual(Level.anglesFromGravity(0, 0, 9.81), { roll: -0, pitch: 0 });

  const positive = Level.anglesFromGravity(...Object.values(degreesToGravity(30)));
  const negative = Level.anglesFromGravity(...Object.values(degreesToGravity(-30)));
  assert.ok(Math.abs(positive.roll - 30) < 1e-10);
  assert.ok(Math.abs(negative.roll + 30) < 1e-10);
});

test('invalid and zero gravity vectors are rejected', () => {
  assert.equal(Level.anglesFromGravity(0, 0, 0), null);
  assert.equal(Level.anglesFromGravity(Number.NaN, 0, 9.81), null);
  assert.equal(Level.anglesFromGravity(0, Infinity, 9.81), null);
});

test('screen projection follows portrait, landscape, and upside-down axes', () => {
  assert.deepEqual(Level.projectAnglesToScreen(10, 20, 0), { roll: 10, pitch: 20 });
  assert.deepEqual(Level.projectAnglesToScreen(10, 20, 90), { roll: 20, pitch: -10 });
  assert.deepEqual(Level.projectAnglesToScreen(10, 20, 180), { roll: -10, pitch: -20 });
  assert.deepEqual(Level.projectAnglesToScreen(10, 20, 270), { roll: -20, pitch: 10 });
  assert.deepEqual(Level.projectAnglesToScreen(10, 20, -90), { roll: -20, pitch: 10 });
  assert.deepEqual(Level.projectAnglesToScreen(10, 20, 450), { roll: 20, pitch: -10 });
  assert.deepEqual(Level.projectAnglesToScreen(10, 20), { roll: 10, pitch: 20 });
  assert.equal(Level.projectAnglesToScreen(NaN, 20, 90), null);
  assert.equal(Level.projectAnglesToScreen(10, Infinity, 90), null);
});

test('landscape tilt axes match the physical screen frame', () => {
  // At screen.angle=90°, device +X points up and device +Y points left.
  // A device +X acceleration must therefore become positive screen pitch,
  // while device +Y acceleration must become positive screen roll.
  const deviceX = Level.anglesFromGravity(3, 0, 9);
  const deviceY = Level.anglesFromGravity(0, 3, 9);
  const projectedX = Level.projectAnglesToScreen(deviceX.roll, deviceX.pitch, 90);
  const projectedY = Level.projectAnglesToScreen(deviceY.roll, deviceY.pitch, 90);
  assert.ok(projectedX.pitch > 0);
  assert.ok(projectedY.roll > 0);
});

test('screen angles normalize to the nearest cardinal orientation', () => {
  assert.equal(Level.normalizeScreenAngle(-90), 270);
  assert.equal(Level.normalizeScreenAngle(360), 0);
  assert.equal(Level.normalizeScreenAngle(89.9), 90);
  for (const invalid of [undefined, null, NaN, Infinity, '90']) {
    assert.equal(Level.normalizeScreenAngle(invalid), 0);
  }
});

test('tracker supports repeated calibration and reset', () => {
  const tracker = Level.createTracker({ alpha: 1 });
  const thirty = degreesToGravity(30);
  const fortyFive = degreesToGravity(45);

  tracker.update(thirty.gx, thirty.gy, thirty.gz);
  assert.equal(tracker.calibrate(), true);
  assert.ok(Math.abs(tracker.getCurrentAngles().roll) < 1e-10);

  tracker.update(fortyFive.gx, fortyFive.gy, fortyFive.gz);
  assert.ok(Math.abs(tracker.getCurrentAngles().roll - 15) < 1e-10);
  assert.equal(tracker.calibrate(), true);
  assert.ok(Math.abs(tracker.getCurrentAngles().roll) < 1e-10);

  tracker.resetCalibration();
  assert.ok(Math.abs(tracker.getCurrentAngles().roll - 45) < 1e-10);
});

test('calibration rebases a settling filter and keeps the new zero stable', () => {
  const tracker = Level.createTracker();
  const zero = degreesToGravity(0);
  const thirty = degreesToGravity(30);

  tracker.update(zero.gx, zero.gy, zero.gz);
  tracker.update(thirty.gx, thirty.gy, thirty.gz);
  assert.equal(tracker.calibrate(), true);
  assert.equal(tracker.isCalibrated(), true);
  assert.ok(Math.abs(tracker.getCurrentAngles().roll) < 1e-10);

  for (let index = 0; index < 30; index += 1) {
    const angles = tracker.update(thirty.gx, thirty.gy, thirty.gz);
    assert.ok(Math.abs(angles.roll) < 1e-10);
  }

  tracker.resetCalibration();
  assert.equal(tracker.isCalibrated(), false);
});

test('calibration state records the operation even at absolute level', () => {
  const tracker = Level.createTracker();
  tracker.update(0, 0, 9.81);
  tracker.calibrate();
  assert.equal(tracker.isCalibrated(), true);
});

test('tracker only advances its filter when update receives a sensor sample', () => {
  const tracker = Level.createTracker({ alpha: 0.5 });
  const zero = degreesToGravity(0);
  const thirty = degreesToGravity(30);

  tracker.update(zero.gx, zero.gy, zero.gz);
  const first = tracker.update(thirty.gx, thirty.gy, thirty.gz);
  const repeatedRead = tracker.getCurrentAngles();

  assert.deepEqual(repeatedRead, first);
  assert.notDeepEqual(tracker.update(thirty.gx, thirty.gy, thirty.gz), first);
});

test('measurement reset clears stale filter history while keeping relative zero', () => {
  const tracker = Level.createTracker();
  const thirty = degreesToGravity(30);
  const fortyFive = degreesToGravity(45);
  tracker.update(thirty.gx, thirty.gy, thirty.gz);
  tracker.calibrate();

  tracker.resetMeasurements();
  assert.equal(tracker.getCurrentAngles(), null);
  assert.equal(tracker.calibrate(), false);
  assert.equal(tracker.isCalibrated(), true);
  const resumed = tracker.update(fortyFive.gx, fortyFive.gy, fortyFive.gz);
  assert.ok(Math.abs(resumed.roll - 15) < 1e-10);

  // Screen rotations affect only presentation, not the tracker or calibration.
  const landscape = Level.projectAnglesToScreen(resumed.roll, resumed.pitch, 90);
  assert.ok(Math.abs(landscape.pitch + 15) < 1e-10);
  assert.deepEqual(tracker.getCurrentAngles(), resumed);
  tracker.reset();
  assert.equal(tracker.getCurrentAngles(), null);
  assert.equal(tracker.isCalibrated(), false);
});

test('level threshold is inclusive and hysteresis prevents edge chatter', () => {
  assert.equal(Level.isLevel(0.5, -0.5), true);
  assert.equal(Level.isLevel(0.5001, 0), false);
  assert.equal(Level.isLevelWithHysteresis(0.7, 0, true), true);
  assert.equal(Level.isLevelWithHysteresis(0.7, 0, false), false);
});

test('level state suppresses initial feedback and reports only transitions', () => {
  const state = Level.createLevelState();
  assert.deepEqual(state.update(0, 0), { isLevel: true, becameLevel: false });
  assert.deepEqual(state.update(0.1, 0), { isLevel: true, becameLevel: false });
  assert.deepEqual(state.update(2, 0), { isLevel: false, becameLevel: false });
  assert.deepEqual(state.update(0.4, 0), { isLevel: true, becameLevel: true });
  assert.deepEqual(state.update(0.2, 0), { isLevel: true, becameLevel: false });
});

test('bubble projection stays inside its circular movement radius', () => {
  const projected = Level.projectBubble(100, 100, 100, 1);
  assert.ok(Math.abs(Math.hypot(projected.x, projected.y) - 100) < 1e-10);
  assert.deepEqual(Level.projectBubble(10, -20, 100, 1), { x: 10, y: -20 });
});
