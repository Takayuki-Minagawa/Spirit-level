/**
 * app.js - Accessible UI controller for Spirit Level.
 */
const App = (function() {
  const measurementState = MeasurementState.create();
  const levelState = Level.createLevelState();
  const wakeLock = ScreenWakeLock.create({ onChange: updateWakeLock });
  const SENSOR_TIMEOUT_MS = 3000;
  let stopSensor = null;
  let animationFrameId = null;
  let sensorTimer = null;
  let sensorStalled = false;
  let hasFreshMeasurement = false;
  let feedbackContext = null;
  let isRunning = false;
  let hasValidProfile = false;
  let previousFocus = null;

  const i18n = {
    ja: {
      title: '水平器',
      rollLabel: '横方向',
      pitchLabel: '縦方向',
      level: '水平です',
      notLevel: '水平ではありません',
      waitingForMeasurement: '計測待機中',
      calibrate: 'ゼロリセット',
      resetLevel: '水平に戻す',
      hold: 'HOLD',
      resume: '計測を再開',
      statusWaiting: 'センサーを待っています',
      statusActive: '計測中',
      statusHeld: '表示を固定中',
      statusUnavailable: 'センサーを利用できません',
      statusStale: 'センサーの更新が止まっています',
      statusHeldStale: '表示を固定中・センサー更新待ち',
      sensorStale: '3秒以上センサー値を受信していません。更新時に自動で復帰します。復帰しない場合は再診断してください。',
      wakeLockLabel: '画面の消灯を防ぐ',
      wakeLockOff: '計測中に画面を点灯できます',
      wakeLockWaiting: '計測の再開時に画面を点灯します',
      wakeLockPending: '画面の点灯を設定中',
      wakeLockActive: '画面の点灯を維持しています',
      wakeLockReleased: '点灯の維持が解除されました。再試行は設定を入れ直してください',
      wakeLockUnavailable: '点灯を維持できません。再試行は設定を入れ直してください',
      wakeLockUnsupported: 'このブラウザでは画面の点灯維持に対応していません',
      helpWakeLockTitle: '画面の消灯を防ぐ',
      helpWakeLockDesc: '計測中・HOLD中の画面を点灯します。別画面への移動やセンサー停止時に解除され、復帰すると再取得します。省電力設定などにより使えない場合があります。',
      sensorUnavailable: '有効なセンサー診断情報がありません。',
      backToCheck: 'センサーチェックへ戻る',
      calibrateSuccess: '現在の傾きを基準に設定しました',
      resetSuccess: '絶対水平の基準に戻しました',
      holdSuccess: '表示を固定しました',
      resumeSuccess: '最新の計測を再開しました',
      basisLabel: '基準',
      basisAbsolute: '絶対水平',
      basisRelative: '相対基準',
      angleDisplayLabel: '角度表示',
      levelVisualLabel: '気泡式水平器',
      settingsLabel: '設定',
      helpLabel: 'ヘルプ',
      themeLabel: 'テーマ切り替え',
      languageLabel: '言語切り替え',
      closeHelpLabel: 'ヘルプを閉じる',
      helpTitle: '使い方',
      helpBubbleTitle: 'バブル（気泡）',
      helpBubbleDesc: 'デバイスの傾きに応じて動きます。バブルが中心にあれば水平です。',
      helpAngleTitle: '角度表示',
      helpAngleDesc: '横方向と縦方向の傾きを度数で表示します。',
      helpHoldTitle: 'HOLD',
      helpHoldDesc: '表示中の角度と気泡を固定します。再開すると最新値に戻ります。',
      helpCalibrateTitle: 'ゼロリセット',
      helpCalibrateDesc: '現在の傾きを相対基準の0°に設定します。',
      helpResetTitle: '水平に戻す',
      helpResetDesc: '相対基準を解除し、重力センサー基準の絶対水平に戻します。',
      helpThemeTitle: 'テーマ',
      helpThemeDesc: 'ボタンでダークモードとライトモードを切り替えます。',
      helpLangTitle: '言語',
      helpLangDesc: 'ボタンで日本語と英語を切り替えます。'
    },
    en: {
      title: 'Spirit Level',
      rollLabel: 'Roll',
      pitchLabel: 'Pitch',
      level: 'Level',
      notLevel: 'Not level',
      waitingForMeasurement: 'Waiting for measurement',
      calibrate: 'Set relative zero',
      resetLevel: 'Use absolute level',
      hold: 'HOLD',
      resume: 'Resume measurement',
      statusWaiting: 'Waiting for sensor',
      statusActive: 'Measuring',
      statusHeld: 'Display held',
      statusUnavailable: 'Sensor unavailable',
      statusStale: 'Sensor updates stopped',
      statusHeldStale: 'Display held · waiting for sensor',
      sensorStale: 'No sensor reading for at least 3 seconds. Measurement resumes automatically when data returns. Run the sensor check again if needed.',
      wakeLockLabel: 'Keep screen awake',
      wakeLockOff: 'Keep the screen on while measuring',
      wakeLockWaiting: 'Screen will stay on when measurement resumes',
      wakeLockPending: 'Requesting screen wake lock',
      wakeLockActive: 'Keeping the screen awake',
      wakeLockReleased: 'Screen wake lock released. Toggle the setting to retry',
      wakeLockUnavailable: 'Cannot keep the screen awake. Toggle the setting to retry',
      wakeLockUnsupported: 'Keeping the screen awake is not supported by this browser',
      helpWakeLockTitle: 'Keep screen awake',
      helpWakeLockDesc: 'Keeps the screen on during measurement and HOLD. Releases when you leave or sensor updates stop, then reacquires on return. Power saving settings may prevent it.',
      sensorUnavailable: 'No valid sensor diagnostic profile was found.',
      backToCheck: 'Return to sensor check',
      calibrateSuccess: 'Current tilt set as the reference',
      resetSuccess: 'Returned to absolute level',
      holdSuccess: 'Display held',
      resumeSuccess: 'Live measurement resumed',
      basisLabel: 'Reference',
      basisAbsolute: 'Absolute level',
      basisRelative: 'Relative zero',
      angleDisplayLabel: 'Angle display',
      levelVisualLabel: 'Bubble spirit level',
      settingsLabel: 'Settings',
      helpLabel: 'Help',
      themeLabel: 'Switch theme',
      languageLabel: 'Switch language',
      closeHelpLabel: 'Close help',
      helpTitle: 'How to use',
      helpBubbleTitle: 'Bubble',
      helpBubbleDesc: 'Moves with the device tilt. The surface is level when the bubble is centered.',
      helpAngleTitle: 'Angle display',
      helpAngleDesc: 'Shows horizontal and vertical tilt in degrees.',
      helpHoldTitle: 'HOLD',
      helpHoldDesc: 'Freezes the displayed angles and bubble. Resume to show the latest measurement.',
      helpCalibrateTitle: 'Set relative zero',
      helpCalibrateDesc: 'Sets the current tilt as a relative 0° reference.',
      helpResetTitle: 'Use absolute level',
      helpResetDesc: 'Clears the relative reference and returns to gravity-based absolute level.',
      helpThemeTitle: 'Theme',
      helpThemeDesc: 'Use the button to switch between dark and light mode.',
      helpLangTitle: 'Language',
      helpLangDesc: 'Use the button to switch between Japanese and English.'
    }
  };

  const savedLanguage = readPreference('spirit_level_lang');
  const browserLanguage = navigator.language && navigator.language.startsWith('ja') ? 'ja' : 'en';
  let currentLang = ['ja', 'en'].includes(savedLanguage) ? savedLanguage : browserLanguage;

  const savedTheme = readPreference('spirit_level_theme');
  let currentTheme = ['dark', 'light'].includes(savedTheme) ? savedTheme : 'dark';

  function readPreference(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function writePreference(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      // Preferences are optional when browser storage is unavailable.
    }
  }

  function init() {
    applyTheme();
    applyLanguage();
    bindEventListeners();
    setStatus('statusWaiting', 'waiting');
    updateBasis();
    updateControls();
    updateWakeLock();

    validateProfileAndResume();
  }

  function bindEventListeners() {
    document.getElementById('calibrateBtn').addEventListener('click', onCalibrate);
    document.getElementById('resetBtn').addEventListener('click', onResetLevel);
    document.getElementById('holdBtn').addEventListener('click', onToggleHold);
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
    document.getElementById('langToggle').addEventListener('click', toggleLanguage);
    document.getElementById('helpBtn').addEventListener('click', openHelp);
    document.getElementById('helpClose').addEventListener('click', closeHelp);
    document.getElementById('wakeLockToggle').addEventListener('change', (event) => {
      wakeLock.setEnabled(event.target.checked);
    });
    document.getElementById('helpModal').addEventListener('click', (event) => {
      if (event.target === event.currentTarget) closeHelp();
    });
    document.addEventListener('keydown', onModalKeydown);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopAll();
      } else {
        validateProfileAndResume();
      }
    });
    window.addEventListener('pagehide', stopAll);
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) validateProfileAndResume();
    });
    window.addEventListener('resize', redrawMeasurement);
    window.addEventListener('orientationchange', redrawMeasurement);
    if (window.screen && window.screen.orientation) {
      window.screen.orientation.addEventListener('change', redrawMeasurement);
    }
  }

  function validateProfileAndResume() {
    const profile = Sensor.loadProfile();
    if (!profile) {
      invalidateProfile();
      return false;
    }

    hasValidProfile = true;
    document.getElementById('sensorRecovery').hidden = true;
    resumeAll();
    return true;
  }

  function invalidateProfile() {
    hasValidProfile = false;
    stopAll();
    measurementState.reset();
    Level.reset();
    levelState.reset();
    clearMeasurementDisplay();
    updateBasis();
    showSensorUnavailable();
  }

  function clearMeasurementDisplay() {
    document.getElementById('rollValue').textContent = '--.-°';
    document.getElementById('pitchValue').textContent = '--.-°';
    document.getElementById('bubble').style.transform = 'translate(-50%, -50%)';
    const indicator = document.getElementById('levelIndicator');
    const label = indicator.querySelector('span');
    indicator.className = 'level-indicator waiting';
    label.setAttribute('data-i18n', 'waitingForMeasurement');
    label.textContent = i18n[currentLang].waitingForMeasurement;
  }

  function startSensor() {
    if (stopSensor === null) {
      stopSensor = Sensor.startListening(onSensorData);
    }
  }

  function resumeAll() {
    if (!hasValidProfile || document.hidden || isRunning) return;
    isRunning = true;
    sensorStalled = false;
    startSensor();
    armSensorTimeout();
    setStatus(measurementState.isHolding() ? 'statusHeldStale' : 'statusWaiting', 'waiting');
    updateControls();
  }

  function stopAll() {
    isRunning = false;
    clearTimeout(sensorTimer);
    sensorTimer = null;
    hasFreshMeasurement = false;
    wakeLock.setActive(false);
    closeFeedback();
    if (stopSensor) {
      stopSensor();
      stopSensor = null;
    }
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    clearLiveMeasurement();
    setStatus(measurementState.isHolding() ? 'statusHeldStale' : 'statusWaiting', 'waiting');
    updateControls();
  }

  function armSensorTimeout() {
    clearTimeout(sensorTimer);
    sensorTimer = setTimeout(onSensorTimeout, SENSOR_TIMEOUT_MS);
  }

  function onSensorTimeout() {
    sensorTimer = null;
    if (!isRunning) return;
    sensorStalled = true;
    hasFreshMeasurement = false;
    wakeLock.setActive(false);
    closeFeedback();
    clearLiveMeasurement();
    setStatus(measurementState.isHolding() ? 'statusHeldStale' : 'statusStale', 'error');
    showRecovery('sensorStale');
    updateControls();
  }

  function clearLiveMeasurement() {
    Level.resetMeasurements();
    levelState.reset();
    if (!measurementState.isHolding()) {
      measurementState.reset();
      clearMeasurementDisplay();
    }
  }

  function scheduleDisplayUpdate() {
    if (isRunning && animationFrameId === null) {
      animationFrameId = requestAnimationFrame(updateDisplay);
    }
  }

  function onSensorData({ gx, gy, gz, timestamp }) {
    if (!hasValidProfile || !isRunning) return;
    const angles = Level.calculateAngles(gx, gy, gz);
    if (!angles) return;

    hasFreshMeasurement = true;
    sensorStalled = false;
    armSensorTimeout();
    wakeLock.setActive(true);
    document.getElementById('sensorRecovery').hidden = true;
    const displayChanged = measurementState.receive({ ...angles, timestamp });
    setStatus(measurementState.isHolding() ? 'statusHeld' : 'statusActive', measurementState.isHolding() ? 'held' : 'active');
    updateControls();
    if (displayChanged) scheduleDisplayUpdate();
  }

  function updateDisplay() {
    animationFrameId = null;
    if (!isRunning) return;

    const measurement = measurementState.consumeDisplayUpdate();
    if (!measurement) return;
    renderMeasurement(measurement);

    const { roll, pitch } = measurement;
    const state = levelState.update(roll, pitch);
    updateLevelIndicator(state.isLevel);
    if (state.becameLevel) triggerFeedback();
    updateControls();
  }

  function renderMeasurement(measurement) {
    const orientation = window.screen && window.screen.orientation;
    const angle = orientation && Number.isFinite(orientation.angle) ? orientation.angle : window.orientation;
    const { roll, pitch } = Level.projectAnglesToScreen(measurement.roll, measurement.pitch, angle);
    document.getElementById('rollValue').textContent = `${roll.toFixed(1)}°`;
    document.getElementById('pitchValue').textContent = `${pitch.toFixed(1)}°`;
    updateBubblePosition(roll, pitch);
  }

  function redrawMeasurement() {
    const measurement = measurementState.getDisplayMeasurement();
    if (measurement) renderMeasurement(measurement);
  }

  function updateLevelIndicator(isLevel) {
    const indicator = document.getElementById('levelIndicator');
    const label = indicator.querySelector('span');
    const key = isLevel ? 'level' : 'notLevel';
    if (label.getAttribute('data-i18n') === key) return;
    indicator.className = `level-indicator ${isLevel ? 'level' : 'not-level'}`;
    label.setAttribute('data-i18n', key);
    label.textContent = i18n[currentLang][key];
  }

  function updateBubblePosition(roll, pitch) {
    const bubble = document.getElementById('bubble');
    const circle = document.getElementById('levelVisual');
    const maxRadius = Math.max(0, (circle.clientWidth - bubble.offsetWidth) / 2 - 8);
    const { x, y } = Level.projectBubble(roll, pitch, maxRadius);
    bubble.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }

  function triggerFeedback() {
    try {
      if (navigator.vibrate) navigator.vibrate(100);
    } catch (error) {
      // Optional feedback must not interrupt measurement.
    }

    closeFeedback();
    try {
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) return;
      const audioContext = new AudioContextConstructor();
      feedbackContext = audioContext;
      if (audioContext.state === 'suspended') {
        closeFeedback();
        return;
      }
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 440;
      gainNode.gain.value = 0.3;
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.onended = () => closeFeedback(audioContext);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.1);
    } catch (error) {
      closeFeedback();
      console.warn('Audio feedback not available');
    }
  }

  function closeFeedback(context = feedbackContext) {
    if (!context) return;
    if (context === feedbackContext) feedbackContext = null;
    try {
      if (context.state !== 'closed') Promise.resolve(context.close()).catch(() => {});
    } catch (error) {
      // Closing optional audio must not interrupt lifecycle cleanup.
    }
  }

  function onCalibrate() {
    if (!hasValidProfile || !hasFreshMeasurement || measurementState.isHolding() || !Level.calibrate()) return;
    levelState.reset();
    replaceLiveAngles(Level.getCurrentAngles());
    updateBasis();
    updateControls();
    showToast(i18n[currentLang].calibrateSuccess);
  }

  function onResetLevel() {
    if (!hasValidProfile || !hasFreshMeasurement || measurementState.isHolding()) return;
    Level.resetCalibration();
    levelState.reset();
    replaceLiveAngles(Level.getCurrentAngles());
    updateBasis();
    updateControls();
    showToast(i18n[currentLang].resetSuccess);
  }

  function replaceLiveAngles(angles) {
    const live = measurementState.getLiveMeasurement();
    if (!angles || !live) return;
    measurementState.receive({ ...angles, timestamp: live.timestamp });
    // Reference changes must be painted together with the basis label. Otherwise
    // HOLD could capture an old-basis reading while this update waits for a frame.
    if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
    updateDisplay();
  }

  function onToggleHold() {
    if (!hasValidProfile) return;
    const result = measurementState.toggleHold();
    if (!result.changed) return;

    levelState.reset();
    if (!result.holding && !hasFreshMeasurement) {
      measurementState.reset();
      clearMeasurementDisplay();
      updateControls();
      setStatus(sensorStalled ? 'statusStale' : 'statusWaiting', sensorStalled ? 'error' : 'waiting');
      return;
    }
    updateHoldButton();
    updateControls();
    setStatus(result.holding ? 'statusHeld' : 'statusActive', result.holding ? 'held' : 'active');
    showToast(i18n[currentLang][result.holding ? 'holdSuccess' : 'resumeSuccess']);
    if (!result.holding) scheduleDisplayUpdate();
  }

  function updateBasis() {
    const basis = document.getElementById('basisValue');
    const key = Level.isCalibrated() ? 'basisRelative' : 'basisAbsolute';
    basis.setAttribute('data-i18n', key);
    basis.textContent = i18n[currentLang][key];
    basis.classList.toggle('relative', Level.isCalibrated());
  }

  function updateHoldButton() {
    const button = document.getElementById('holdBtn');
    const label = button.querySelector('span');
    const holding = measurementState.isHolding();
    const key = holding ? 'resume' : 'hold';
    button.setAttribute('aria-pressed', String(holding));
    button.classList.toggle('active', holding);
    label.setAttribute('data-i18n', key);
    label.textContent = i18n[currentLang][key];
  }

  function updateControls() {
    const hasMeasurement = hasValidProfile && hasFreshMeasurement && measurementState.hasDisplayMeasurement();
    const holding = measurementState.isHolding();
    document.getElementById('holdBtn').disabled = !hasMeasurement && !holding;
    document.getElementById('calibrateBtn').disabled = !hasMeasurement || holding;
    document.getElementById('resetBtn').disabled = !hasMeasurement || holding || !Level.isCalibrated();
    updateHoldButton();
  }

  function setStatus(key, state) {
    const statusText = document.getElementById('statusText');
    if (statusText.getAttribute('data-i18n') !== key) {
      statusText.setAttribute('data-i18n', key);
      statusText.textContent = i18n[currentLang][key];
    }
    const statusDot = document.getElementById('statusDot');
    const className = `status-dot ${state}`;
    if (statusDot.className !== className) statusDot.className = className;
  }

  function showSensorUnavailable() {
    setStatus('statusUnavailable', 'error');
    showRecovery('sensorUnavailable');
    updateControls();
  }

  function showRecovery(key) {
    const recovery = document.getElementById('sensorRecovery');
    const message = recovery.querySelector('p');
    message.setAttribute('data-i18n', key);
    message.textContent = i18n[currentLang][key];
    recovery.hidden = false;
  }

  function updateWakeLock() {
    const state = wakeLock.getState();
    const checkbox = document.getElementById('wakeLockToggle');
    checkbox.disabled = !state.supported;
    checkbox.checked = state.enabled;
    const keys = {
      off: state.enabled ? 'wakeLockWaiting' : 'wakeLockOff',
      pending: 'wakeLockPending', active: 'wakeLockActive', released: 'wakeLockReleased',
      unavailable: 'wakeLockUnavailable', unsupported: 'wakeLockUnsupported'
    };
    const status = document.getElementById('wakeLockStatus');
    const key = keys[state.status];
    status.setAttribute('data-i18n', key);
    status.textContent = i18n[currentLang][key];
  }

  function applyLanguage() {
    document.documentElement.lang = currentLang;
    document.querySelectorAll('[data-i18n]').forEach((element) => {
      const key = element.getAttribute('data-i18n');
      if (i18n[currentLang][key]) element.textContent = i18n[currentLang][key];
    });
    document.querySelectorAll('[data-i18n-aria]').forEach((element) => {
      const key = element.getAttribute('data-i18n-aria');
      if (!i18n[currentLang][key]) return;
      element.setAttribute('aria-label', i18n[currentLang][key]);
      if (element.hasAttribute('title')) element.title = i18n[currentLang][key];
    });
    document.title = i18n[currentLang].title;
  }

  function toggleLanguage() {
    currentLang = currentLang === 'ja' ? 'en' : 'ja';
    writePreference('spirit_level_lang', currentLang);
    applyLanguage();
  }

  function applyTheme() {
    document.body.setAttribute('data-theme', currentTheme);
    document.getElementById('themeIcon').textContent = currentTheme === 'dark' ? '☀️' : '🌙';
  }

  function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    writePreference('spirit_level_theme', currentTheme);
    applyTheme();
  }

  function openHelp() {
    const modal = document.getElementById('helpModal');
    previousFocus = document.activeElement;
    modal.hidden = false;
    modal.classList.add('active');
    document.getElementById('helpClose').focus();
  }

  function closeHelp() {
    const modal = document.getElementById('helpModal');
    if (modal.hidden) return;
    modal.classList.remove('active');
    modal.hidden = true;
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
  }

  function onModalKeydown(event) {
    const overlay = document.getElementById('helpModal');
    if (overlay.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeHelp();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = Array.from(overlay.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])'))
      .filter((element) => !element.disabled && !element.hidden);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toast-in 0.3s ease reverse';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
