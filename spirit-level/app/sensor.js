/**
 * sensor.js - Sensor handling for Spirit Level
 */
const Sensor = (function() {
  let profile = null;

  /** Load profile from sessionStorage (set by index.html diagnostics) */
  function loadProfile() {
    const stored = sessionStorage.getItem('spirit_level_profile');
    if (stored) {
      profile = JSON.parse(stored);
    }
    return profile;
  }

  /**
   * Start listening to devicemotion events.
   * @param {function} callback - receives {gx, gy, gz, timestamp}
   * @returns {function} stop - call to remove listener
   */
  function startListening(callback) {
    function handler(e) {
      if (e.accelerationIncludingGravity) {
        const g = e.accelerationIncludingGravity;
        callback({
          gx: g.x || 0,
          gy: g.y || 0,
          gz: g.z || 0,
          timestamp: performance.now()
        });
      }
    }

    window.addEventListener('devicemotion', handler);

    return function stop() {
      window.removeEventListener('devicemotion', handler);
    };
  }

  return { loadProfile, startListening };
})();
