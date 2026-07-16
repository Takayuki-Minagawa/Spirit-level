/**
 * app.js - Accessible UI controller for Spirit Level.
 */
const App = (function() {
  const measurementState = MeasurementState.create();
  const levelState = Level.createLevelState();
  let stopSensor = null;
  let animationFrameId = null;
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

    document.getElementById('rollValue').textContent = '--.-°';
    document.getElementById('pitchValue').textContent = '--.-°';
    document.getElementById('bubble').style.transform = 'translate(-50%, -50%)';
    const indicator = document.getElementById('levelIndicator');
    const label = indicator.querySelector('span');
    indicator.className = 'level-indicator waiting';
    label.setAttribute('data-i18n', 'waitingForMeasurement');
    label.textContent = i18n[currentLang].waitingForMeasurement;
    updateBasis();
    showSensorUnavailable();
  }

  function startSensor() {
    if (stopSensor === null) {
      stopSensor = Sensor.startListening(onSensorData);
    }
  }

  function resumeAll() {
    if (!hasValidProfile || document.hidden) return;
    isRunning = true;
    startSensor();
    if (!measurementState.hasMeasurement()) setStatus('statusWaiting', 'waiting');
  }

  function stopAll() {
    isRunning = false;
    if (stopSensor) {
      stopSensor();
      stopSensor = null;
    }
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  function scheduleDisplayUpdate() {
    if (isRunning && animationFrameId === null) {
      animationFrameId = requestAnimationFrame(updateDisplay);
    }
  }

  function onSensorData({ gx, gy, gz, timestamp }) {
    if (!hasValidProfile) return;
    const angles = Level.calculateAngles(gx, gy, gz);
    if (!angles) return;

    const displayChanged = measurementState.receive({ ...angles, timestamp });
    if (!measurementState.isHolding()) setStatus('statusActive', 'active');
    updateControls();
    if (displayChanged) scheduleDisplayUpdate();
  }

  function updateDisplay() {
    animationFrameId = null;
    if (!isRunning) return;

    const measurement = measurementState.consumeDisplayUpdate();
    if (!measurement) return;
    const { roll, pitch } = measurement;

    document.getElementById('rollValue').textContent = `${roll.toFixed(1)}°`;
    document.getElementById('pitchValue').textContent = `${pitch.toFixed(1)}°`;

    const state = levelState.update(roll, pitch);
    updateLevelIndicator(state.isLevel);
    if (state.becameLevel) triggerFeedback();
    updateBubblePosition(roll, pitch);
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
    if (navigator.vibrate) navigator.vibrate(100);

    try {
      const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextConstructor) return;
      const audioContext = new AudioContextConstructor();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 440;
      gainNode.gain.value = 0.3;
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.1);
    } catch (error) {
      console.warn('Audio feedback not available');
    }
  }

  function onCalibrate() {
    if (!hasValidProfile || measurementState.isHolding() || !Level.calibrate()) return;
    replaceLiveAngles(Level.getCurrentAngles());
    levelState.reset();
    updateBasis();
    updateControls();
    showToast(i18n[currentLang].calibrateSuccess);
  }

  function onResetLevel() {
    if (!hasValidProfile || measurementState.isHolding() || !measurementState.hasMeasurement()) return;
    Level.resetCalibration();
    replaceLiveAngles(Level.getCurrentAngles());
    levelState.reset();
    updateBasis();
    updateControls();
    showToast(i18n[currentLang].resetSuccess);
  }

  function replaceLiveAngles(angles) {
    const live = measurementState.getLiveMeasurement();
    if (!angles || !live) return;
    measurementState.receive({ ...angles, timestamp: live.timestamp });
    scheduleDisplayUpdate();
  }

  function onToggleHold() {
    if (!hasValidProfile) return;
    const result = measurementState.toggleHold();
    if (!result.changed) return;

    levelState.reset();
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
    const hasMeasurement = hasValidProfile && measurementState.hasMeasurement();
    const holding = measurementState.isHolding();
    document.getElementById('holdBtn').disabled = !hasMeasurement;
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
    document.getElementById('sensorRecovery').hidden = false;
    updateControls();
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
