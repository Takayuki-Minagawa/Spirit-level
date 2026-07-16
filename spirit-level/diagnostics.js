/**
 * Sensor diagnostics and consent flow for the entry screen.
 */
const Diagnostics = (function() {
  const PROFILE_KEY = 'spirit_level_profile';
  const CONSENT_KEY = 'spirit_level_consent';
  const MIN_SAMPLE_RATE_HZ = 10;
  const WARNING_SAMPLE_RATE_HZ = 25;

  function isValidGravity(gravity) {
    if (!gravity) return false;
    const { x, y, z } = gravity;
    return [x, y, z].every(Number.isFinite) && Math.hypot(x, y, z) > 1e-6;
  }

  function calculateSamplingRate(timestamps) {
    if (!Array.isArray(timestamps) || timestamps.length < 2) return 0;

    const intervals = [];
    for (let index = 1; index < timestamps.length; index += 1) {
      const interval = timestamps[index] - timestamps[index - 1];
      if (Number.isFinite(interval) && interval > 0) intervals.push(interval);
    }
    if (intervals.length === 0) return 0;

    intervals.sort((left, right) => left - right);
    const middle = Math.floor(intervals.length / 2);
    const median = intervals.length % 2 === 0
      ? (intervals[middle - 1] + intervals[middle]) / 2
      : intervals[middle];

    return 1000 / median;
  }

  function requiresPermission(MotionEventConstructor) {
    return Boolean(
      MotionEventConstructor &&
      typeof MotionEventConstructor.requestPermission === 'function'
    );
  }

  function shouldAutoStart(hasConsent, MotionEventConstructor) {
    return Boolean(
      hasConsent &&
      MotionEventConstructor &&
      !requiresPermission(MotionEventConstructor)
    );
  }

  function classifyProbe(result) {
    if (!result.hasEvents) return { ok: false, reason: 'no-events' };
    if (!result.hasAccG) return { ok: false, reason: 'no-gravity' };
    if (
      !Number.isInteger(result.validCount) ||
      result.validCount < 2 ||
      !Number.isFinite(result.fsHz) ||
      result.fsHz < MIN_SAMPLE_RATE_HZ
    ) {
      return { ok: false, reason: 'low-rate' };
    }
    return { ok: true, warn: result.fsHz < WARNING_SAMPLE_RATE_HZ };
  }

  function buildProfile(result, needsPermission) {
    const classification = classifyProbe(result);
    if (!classification.ok) return null;

    return {
      version: 1,
      sensorAvailable: true,
      needsPermission,
      hasAccG: true,
      fsHz: result.fsHz,
      eventCount: result.validCount
    };
  }

  function readStorage(storage, key) {
    if (!storage) return null;
    try {
      return storage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function writeStorage(storage, key, value) {
    if (!storage) return false;
    try {
      storage.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function removeStorage(storage, key) {
    if (!storage) return false;
    try {
      storage.removeItem(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  function createRunGuard() {
    let generation = 0;
    return {
      start() {
        generation += 1;
        return generation;
      },
      cancel() {
        generation += 1;
      },
      isCurrent(token) {
        return token === generation;
      }
    };
  }

  function probeSensor(durationMs, dependencies = {}) {
    const eventTarget = dependencies.eventTarget || window;
    const now = dependencies.now || (() => performance.now());
    const setTimer = dependencies.setTimer || setTimeout;
    const clearTimer = dependencies.clearTimer || clearTimeout;
    const signal = dependencies.signal;

    return new Promise((resolve) => {
      const validTimestamps = [];
      let eventCount = 0;
      let settled = false;
      let timerId = null;

      function handler(event) {
        eventCount += 1;
        const timestamp = now();
        if (isValidGravity(event.accelerationIncludingGravity) && Number.isFinite(timestamp)) {
          validTimestamps.push(timestamp);
        }
      }

      function cleanup() {
        eventTarget.removeEventListener('devicemotion', handler);
        if (signal) signal.removeEventListener('abort', abort);
      }

      function finish(aborted = false) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          aborted,
          hasEvents: eventCount > 0,
          count: eventCount,
          hasAccG: validTimestamps.length > 0,
          validCount: validTimestamps.length,
          fsHz: calculateSamplingRate(validTimestamps)
        });
      }

      function abort() {
        if (timerId !== null) clearTimer(timerId);
        finish(true);
      }

      eventTarget.addEventListener('devicemotion', handler);
      if (signal) {
        if (signal.aborted) {
          finish(true);
          return;
        }
        signal.addEventListener('abort', abort, { once: true });
      }
      timerId = setTimer(() => finish(false), durationMs);
    });
  }

  function init() {
    const consentCheck = document.getElementById('consentCheck');
    const startCheck = document.getElementById('startCheck');
    const diagnostics = document.getElementById('diagnostics');
    const checkList = document.getElementById('checkList');
    const resultBox = document.getElementById('resultBox');
    const goApp = document.getElementById('goApp');
    let checking = false;
    let activeAbortController = null;
    const runGuard = createRunGuard();

    let localStore = null;
    let sessionStore = null;
    try {
      localStore = window.localStorage;
    } catch (error) {
      localStore = null;
    }
    try {
      sessionStore = window.sessionStorage;
    } catch (error) {
      sessionStore = null;
    }

    const hasConsent = readStorage(localStore, CONSENT_KEY) === 'true';
    consentCheck.checked = hasConsent;
    startCheck.disabled = !hasConsent;

    consentCheck.addEventListener('change', function() {
      startCheck.disabled = !this.checked;
      if (this.checked) {
        writeStorage(localStore, CONSENT_KEY, 'true');
      } else {
        cancelActiveCheck();
        removeStorage(localStore, CONSENT_KEY);
        removeStorage(sessionStore, PROFILE_KEY);
        resetUI();
      }
    });

    startCheck.addEventListener('click', () => {
      runSensorCheck({ userInitiated: true });
    });

    window.addEventListener('pageshow', (event) => {
      if (!event.persisted) return;
      cancelActiveCheck();
      resetUI();
      if (shouldAutoStart(consentCheck.checked, window.DeviceMotionEvent)) {
        // Let an aborted, in-flight check release its single-flight lock first.
        Promise.resolve().then(() => runSensorCheck());
      }
    });

    window.addEventListener('pagehide', cancelActiveCheck);

    if (shouldAutoStart(hasConsent, window.DeviceMotionEvent)) {
      runSensorCheck();
    }

    function cancelActiveCheck() {
      runGuard.cancel();
      checking = false;
      if (activeAbortController) activeAbortController.abort();
      activeAbortController = null;
    }

    function resetUI() {
      diagnostics.hidden = true;
      checkList.replaceChildren();
      resultBox.replaceChildren();
      goApp.hidden = true;
      startCheck.disabled = !consentCheck.checked;
    }

    async function runSensorCheck({ userInitiated = false } = {}) {
      if (checking) return;
      const runToken = runGuard.start();
      checking = true;
      const runAbortController = typeof AbortController === 'function'
        ? new AbortController()
        : null;
      activeAbortController = runAbortController;
      const isCurrentRun = () => (
        runGuard.isCurrent(runToken) &&
        consentCheck.checked &&
        !(runAbortController && runAbortController.signal.aborted)
      );
      startCheck.disabled = true;
      diagnostics.hidden = false;
      checkList.replaceChildren();
      resultBox.replaceChildren();
      goApp.hidden = true;
      removeStorage(sessionStore, PROFILE_KEY);

      const results = [];

      try {
        const isSecure = window.isSecureContext;
        results.push({ label: 'HTTPS (Secure Context)', ok: isSecure });
        renderChecks(results);
        if (!isSecure) {
          showResult('ng', 'HTTPS環境が必要です。HTTPS対応のホストでお試しください。');
          return;
        }

        const MotionEventConstructor = window.DeviceMotionEvent;
        const hasMotion = Boolean(MotionEventConstructor);
        results.push({ label: 'DeviceMotionEvent', ok: hasMotion });
        renderChecks(results);
        if (!hasMotion) {
          showResult('ng', 'このブラウザはモーションセンサーに対応していません。');
          return;
        }

        const needsPermission = requiresPermission(MotionEventConstructor);
        if (needsPermission) {
          if (!userInitiated) {
            showResult('warn', 'センサーの許可には「センサーチェック開始」のタップが必要です。');
            return;
          }

          results.push({ label: 'iOS Permission Request', status: 'requesting' });
          renderChecks(results);
          try {
            const permission = await MotionEventConstructor.requestPermission();
            if (!isCurrentRun()) return;
            const granted = permission === 'granted';
            results[results.length - 1] = { label: 'iOS Permission', ok: granted };
            renderChecks(results);
            if (!granted) {
              showResult('ng', 'センサーの権限が拒否されました。ブラウザ設定をご確認ください。');
              return;
            }
          } catch (error) {
            if (!isCurrentRun()) return;
            results[results.length - 1] = { label: 'iOS Permission', ok: false };
            renderChecks(results);
            showResult('ng', `権限リクエストに失敗しました: ${error.message}`);
            return;
          }
        } else {
          results.push({ label: 'Permission', ok: true, note: 'Not required' });
          renderChecks(results);
        }

        results.push({ label: 'Sensor Probe (2s)', status: 'probing' });
        renderChecks(results);
        const probeResult = await probeSensor(2000, {
          signal: runAbortController ? runAbortController.signal : undefined
        });
        if (!isCurrentRun() || probeResult.aborted) return;

        const classification = classifyProbe(probeResult);
        results[results.length - 1] = {
          label: `Sensor Probe: ${probeResult.count} events`,
          ok: probeResult.hasEvents
        };
        renderChecks(results);

        if (classification.reason === 'no-events') {
          showResult('ng', 'センサーイベントを取得できませんでした。実機でお試しください。');
          return;
        }
        if (classification.reason === 'no-gravity') {
          results.push({ label: 'Acceleration incl. gravity', ok: false });
          renderChecks(results);
          showResult('ng', '重力加速度データを取得できません。この端末では計測できません。');
          return;
        }

        results.push({
          label: `Sampling Rate: ~${probeResult.fsHz.toFixed(1)} Hz`,
          ok: classification.ok,
          warn: classification.warn
        });
        results.push({ label: 'Acceleration incl. gravity', ok: true });
        renderChecks(results);

        if (!classification.ok) {
          showResult('ng', '有効なセンサーデータが不足しています。端末を動かして再試行してください。');
          return;
        }

        if (!isCurrentRun()) return;
        const profile = buildProfile(probeResult, needsPermission);
        if (!writeStorage(sessionStore, PROFILE_KEY, JSON.stringify(profile))) {
          showResult('ng', '診断結果を一時保存できません。ブラウザのストレージ設定をご確認ください。');
          return;
        }
        showResult(
          classification.warn ? 'warn' : 'ok',
          classification.warn
            ? 'センサーを利用できますが、更新頻度が低いため表示が遅れる場合があります。'
            : 'センサーチェック完了。水平器を利用できます。'
        );
        goApp.hidden = false;
      } finally {
        if (runGuard.isCurrent(runToken)) {
          checking = false;
          activeAbortController = null;
          startCheck.disabled = !consentCheck.checked;
        }
      }
    }

    function renderChecks(items) {
      const fragment = document.createDocumentFragment();
      items.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'check-item';
        const icon = document.createElement('span');
        icon.className = 'check-icon wait';

        if (item.status === 'requesting' || item.status === 'probing') {
          const spinner = document.createElement('span');
          spinner.className = 'spinner';
          icon.appendChild(spinner);
        } else if (item.ok === true && item.warn) {
          icon.className = 'check-icon warn';
          icon.textContent = '!';
        } else if (item.ok === true) {
          icon.className = 'check-icon ok';
          icon.textContent = '\u2713';
        } else if (item.ok === false) {
          icon.className = 'check-icon ng';
          icon.textContent = '\u2717';
        } else {
          icon.textContent = '...';
        }

        const label = document.createElement('span');
        label.textContent = item.note ? `${item.label} (${item.note})` : item.label;
        row.append(icon, label);
        fragment.appendChild(row);
      });
      checkList.replaceChildren(fragment);
    }

    function showResult(type, message) {
      const result = document.createElement('div');
      result.className = `result-box result-${type}`;
      result.textContent = message;
      resultBox.replaceChildren(result);
    }
  }

  return {
    init,
    isValidGravity,
    calculateSamplingRate,
    requiresPermission,
    shouldAutoStart,
    classifyProbe,
    buildProfile,
    readStorage,
    writeStorage,
    removeStorage,
    createRunGuard,
    probeSensor
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Diagnostics;
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', Diagnostics.init);
}
