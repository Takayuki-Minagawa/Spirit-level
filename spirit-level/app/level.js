/**
 * level.js - Angle calculation and filtering for Spirit Level
 */
const Level = (function() {
  let filterState = { x: 0, y: 0, z: 0 };
  let calibrationOffset = { roll: 0, pitch: 0 };

  // Low-pass filter for noise reduction
  function lowPassFilter(current, previous, alpha = 0.2) {
    return alpha * current + (1 - alpha) * previous;
  }

  // Calculate roll and pitch angles from gravity vector
  function calculateAngles(gx, gy, gz) {
    // Apply low-pass filter
    filterState.x = lowPassFilter(gx, filterState.x);
    filterState.y = lowPassFilter(gy, filterState.y);
    filterState.z = lowPassFilter(gz, filterState.z);

    const { x, y, z } = filterState;

    // Roll angle (rotation around x-axis, -90° to +90°)
    const roll = Math.atan2(-x, Math.sqrt(y * y + z * z)) * (180 / Math.PI);

    // Pitch angle (rotation around y-axis, -90° to +90°)
    const pitch = Math.atan2(y, Math.sqrt(x * x + z * z)) * (180 / Math.PI);

    // Apply calibration offset
    return {
      roll: roll - calibrationOffset.roll,
      pitch: pitch - calibrationOffset.pitch
    };
  }

  // Check if device is level (within threshold)
  function isLevel(roll, pitch, threshold = 0.5) {
    return Math.abs(roll) < threshold && Math.abs(pitch) < threshold;
  }

  // Calibrate: set current angle as zero point
  function calibrate(gx, gy, gz) {
    const angles = calculateAngles(gx, gy, gz);
    calibrationOffset = { roll: angles.roll, pitch: angles.pitch };
  }

  // Reset calibration to default
  function resetCalibration() {
    calibrationOffset = { roll: 0, pitch: 0 };
  }

  return { calculateAngles, isLevel, calibrate, resetCalibration };
})();
