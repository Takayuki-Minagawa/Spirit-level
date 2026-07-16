/**
 * sensor.js - Validated sensor input and diagnostic profile handling.
 */
const Sensor = (function() {
  let profile = null;

  function isValidProfile(candidate) {
    return Boolean(
      candidate &&
      candidate.version === 1 &&
      candidate.sensorAvailable === true &&
      candidate.hasAccG === true &&
      Number.isFinite(candidate.fsHz) &&
      candidate.fsHz >= 10 &&
      Number.isInteger(candidate.eventCount) &&
      candidate.eventCount >= 2
    );
  }

  function loadProfile(storage) {
    if (storage === undefined) {
      try {
        storage = sessionStorage;
      } catch (error) {
        profile = null;
        return profile;
      }
    }

    let stored = null;
    try {
      stored = storage.getItem('spirit_level_profile');
    } catch (error) {
      profile = null;
      return profile;
    }
    if (!stored) {
      profile = null;
      return profile;
    }

    try {
      const parsed = JSON.parse(stored);
      profile = isValidProfile(parsed) ? parsed : null;
    } catch (error) {
      profile = null;
    }

    if (profile === null) {
      try {
        storage.removeItem('spirit_level_profile');
      } catch (error) {
        // A blocked storage backend is treated the same as a missing profile.
      }
    }

    return profile;
  }

  function normalizeMotionEvent(event, timestamp) {
    const gravity = event && event.accelerationIncludingGravity;
    if (!gravity) return null;

    const { x, y, z } = gravity;
    if (
      ![x, y, z, timestamp].every(Number.isFinite) ||
      Math.hypot(x, y, z) <= 1e-6
    ) {
      return null;
    }

    return { gx: x, gy: y, gz: z, timestamp };
  }

  /**
   * Start listening to devicemotion events.
   * @param {function} callback - receives {gx, gy, gz, timestamp}
   * @param {EventTarget} eventTarget - injectable for tests
   * @param {function} now - injectable monotonic clock for tests
   * @returns {function} stop - call to remove listener
   */
  function startListening(
    callback,
    eventTarget = window,
    now = () => performance.now()
  ) {
    if (typeof callback !== 'function') {
      throw new TypeError('callback must be a function');
    }

    function handler(event) {
      const sample = normalizeMotionEvent(event, now());
      if (sample) callback(sample);
    }

    eventTarget.addEventListener('devicemotion', handler);

    return function stop() {
      eventTarget.removeEventListener('devicemotion', handler);
    };
  }

  return {
    isValidProfile,
    loadProfile,
    normalizeMotionEvent,
    startListening
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Sensor;
}
