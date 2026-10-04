/**
 * Keeps an optional screen wake lock only during active measurement.
 * The app supplies visibility/measurement eligibility via setActive().
 */
const ScreenWakeLock = (function() {
  function create({
    wakeLock = typeof navigator !== 'undefined' ? navigator.wakeLock : null,
    onChange = () => {}
  } = {}) {
    const supported = Boolean(wakeLock && typeof wakeLock.request === 'function');
    let enabled = false;
    let eligible = false;
    let sentinel = null;
    let requesting = false;
    let generation = 0;
    let status = supported ? 'off' : 'unsupported';

    function getState() {
      return {
        supported,
        enabled,
        active: sentinel !== null,
        pending: status === 'pending',
        status
      };
    }

    function publish(nextStatus) {
      status = nextStatus;
      onChange(getState());
    }

    function release(lock) {
      if (!lock || lock.released) return;
      // Release may reject when the document/underlying platform disappears.
      // Cleanup must never turn into an unhandled rejection or retry loop.
      try {
        Promise.resolve(lock.release()).catch(() => {});
      } catch (_) {
        // Accommodate implementations that throw before returning a Promise.
      }
    }

    async function request() {
      const requestGeneration = generation;
      requesting = true;
      publish('pending');
      let lock;
      try {
        lock = await wakeLock.request('screen');
      } catch (_) {
        requesting = false;
        if (requestGeneration !== generation) reconcile();
        else publish('unavailable');
        return;
      }
      requesting = false;

      // A request can settle after the user disables this feature or leaves
      // measurement. Never adopt that old lock, even after a quick return.
      if (requestGeneration !== generation) {
        release(lock);
        reconcile();
        return;
      }
      if (lock.released) {
        publish('released');
        return;
      }

      sentinel = lock;
      lock.addEventListener('release', () => {
        if (sentinel !== lock) return;
        sentinel = null;
        // Respect system releases. A new user/visibility transition can retry;
        // repeated sensor samples must not fight the battery-saving policy.
        publish('released');
      }, { once: true });
      publish('active');
    }

    function reconcile() {
      if (!supported) {
        publish('unsupported');
      } else if (!enabled || !eligible) {
        const oldLock = sentinel;
        sentinel = null;
        release(oldLock);
        publish('off');
      } else if (sentinel) {
        publish('active');
      } else if (requesting) {
        publish('pending');
      } else {
        void request();
      }
    }

    function setEnabled(value) {
      const next = Boolean(value);
      if (enabled === next) return;
      enabled = next;
      generation += 1;
      reconcile();
    }

    function setActive(value) {
      const next = Boolean(value);
      if (eligible === next) return;
      eligible = next;
      generation += 1;
      reconcile();
    }

    return { setEnabled, setActive, getState };
  }

  return { create };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ScreenWakeLock;
}
