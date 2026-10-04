/**
 * level.js - Angle calculation, filtering, calibration, and display helpers.
 */
const Level = (function() {
  const DEFAULT_ALPHA = 0.2;
  const DEFAULT_ENTER_THRESHOLD = 0.5;
  const DEFAULT_EXIT_THRESHOLD = 0.8;
  const MIN_VECTOR_MAGNITUDE = 1e-6;

  function isFiniteGravity(gx, gy, gz) {
    if (![gx, gy, gz].every(Number.isFinite)) return false;
    return Math.hypot(gx, gy, gz) > MIN_VECTOR_MAGNITUDE;
  }

  function anglesFromGravity(gx, gy, gz) {
    if (!isFiniteGravity(gx, gy, gz)) return null;

    return {
      roll: Math.atan2(-gx, Math.hypot(gy, gz)) * (180 / Math.PI),
      pitch: Math.atan2(gy, Math.hypot(gx, gz)) * (180 / Math.PI)
    };
  }

  function lowPassFilter(current, previous, alpha = DEFAULT_ALPHA) {
    return alpha * current + (1 - alpha) * previous;
  }

  function normalizeScreenAngle(angle = 0) {
    if (!Number.isFinite(angle)) return 0;
    return ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  }

  function projectAnglesToScreen(roll, pitch, screenAngle = 0) {
    if (![roll, pitch].every(Number.isFinite)) return null;

    // Sensor axes stay attached to the device when the viewport rotates.
    // Transform only the display axes, keeping filtering and relative zero in
    // the device frame so rotating the screen cannot move the calibrated zero.
    // Positive screen angles mean counterclockwise device rotation: at 90°,
    // device +X points up on screen and device +Y points left on screen.
    switch (normalizeScreenAngle(screenAngle)) {
      case 90: return { roll: pitch, pitch: -roll };
      case 180: return { roll: -roll, pitch: -pitch };
      case 270: return { roll: -pitch, pitch: roll };
      default: return { roll, pitch };
    }
  }

  function createTracker({ alpha = DEFAULT_ALPHA } = {}) {
    if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1) {
      throw new RangeError('alpha must be greater than 0 and at most 1');
    }

    let filteredGravity = null;
    let latestGravity = null;
    let latestRawAngles = null;
    let calibrationOffset = { roll: 0, pitch: 0 };
    let calibrationActive = false;

    function update(gx, gy, gz) {
      if (!isFiniteGravity(gx, gy, gz)) return null;
      latestGravity = { x: gx, y: gy, z: gz };

      if (filteredGravity === null) {
        filteredGravity = { x: gx, y: gy, z: gz };
      } else {
        filteredGravity.x = lowPassFilter(gx, filteredGravity.x, alpha);
        filteredGravity.y = lowPassFilter(gy, filteredGravity.y, alpha);
        filteredGravity.z = lowPassFilter(gz, filteredGravity.z, alpha);
      }

      latestRawAngles = anglesFromGravity(
        filteredGravity.x,
        filteredGravity.y,
        filteredGravity.z
      );

      return getCurrentAngles();
    }

    function getCurrentAngles() {
      if (latestRawAngles === null) return null;

      return {
        roll: latestRawAngles.roll - calibrationOffset.roll,
        pitch: latestRawAngles.pitch - calibrationOffset.pitch
      };
    }

    function calibrate() {
      if (latestGravity === null) return false;

      // Rebase the filter to the physical sample used for calibration. Without
      // this, a filter that is still settling would continue moving the zero.
      filteredGravity = { ...latestGravity };
      latestRawAngles = anglesFromGravity(
        filteredGravity.x,
        filteredGravity.y,
        filteredGravity.z
      );
      calibrationOffset = { ...latestRawAngles };
      calibrationActive = true;
      return true;
    }

    function resetCalibration() {
      calibrationOffset = { roll: 0, pitch: 0 };
      calibrationActive = false;
    }

    function isCalibrated() {
      return calibrationActive;
    }

    function resetMeasurements() {
      filteredGravity = null;
      latestGravity = null;
      latestRawAngles = null;
    }

    function reset() {
      resetMeasurements();
      resetCalibration();
    }

    return {
      update,
      getCurrentAngles,
      calibrate,
      resetCalibration,
      isCalibrated,
      resetMeasurements,
      reset
    };
  }

  function isLevel(roll, pitch, threshold = DEFAULT_ENTER_THRESHOLD) {
    if (![roll, pitch, threshold].every(Number.isFinite) || threshold < 0) {
      return false;
    }
    return Math.abs(roll) <= threshold && Math.abs(pitch) <= threshold;
  }

  function isLevelWithHysteresis(
    roll,
    pitch,
    wasLevel,
    enterThreshold = DEFAULT_ENTER_THRESHOLD,
    exitThreshold = DEFAULT_EXIT_THRESHOLD
  ) {
    const threshold = wasLevel ? exitThreshold : enterThreshold;
    return isLevel(roll, pitch, threshold);
  }

  function createLevelState() {
    let initialized = false;
    let wasLevel = false;

    function update(roll, pitch) {
      const level = isLevelWithHysteresis(roll, pitch, wasLevel);
      const becameLevel = initialized && level && !wasLevel;
      initialized = true;
      wasLevel = level;
      return { isLevel: level, becameLevel };
    }

    function reset() {
      initialized = false;
      wasLevel = false;
    }

    return { update, reset };
  }

  function projectBubble(roll, pitch, maxRadius = 100, moveScale = 1.5) {
    if (![roll, pitch, maxRadius, moveScale].every(Number.isFinite)) {
      return { x: 0, y: 0 };
    }

    const radius = Math.max(0, maxRadius);
    const x = roll * moveScale;
    const y = pitch * moveScale;
    const distance = Math.hypot(x, y);

    if (distance <= radius || distance === 0) return { x, y };

    const ratio = radius / distance;
    return { x: x * ratio, y: y * ratio };
  }

  const tracker = createTracker();

  return {
    calculateAngles: tracker.update,
    getCurrentAngles: tracker.getCurrentAngles,
    calibrate: tracker.calibrate,
    resetCalibration: tracker.resetCalibration,
    isCalibrated: tracker.isCalibrated,
    resetMeasurements: tracker.resetMeasurements,
    reset: tracker.reset,
    anglesFromGravity,
    normalizeScreenAngle,
    projectAnglesToScreen,
    createTracker,
    isFiniteGravity,
    isLevel,
    isLevelWithHysteresis,
    createLevelState,
    projectBubble
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Level;
}
