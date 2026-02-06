/**
 * app.js - UI Controller for Spirit Level
 */
const App = (function() {
  let stopSensor = null;
  let latestGravity = { gx: 0, gy: 0, gz: 0 };
  let wasLevel = false;
  let isRunning = true;

  // i18n dictionary
  const i18n = {
    ja: {
      title: '水平器',
      rollLabel: '横方向',
      pitchLabel: '縦方向',
      level: '水平です',
      notLevel: '水平ではありません',
      calibrate: '較正',
      statusReady: '準備完了',
      calibrateSuccess: '較正しました',
      helpTitle: '使い方',
      helpBubbleTitle: 'バブル（気泡）',
      helpBubbleDesc: 'デバイスの傾きに応じて動きます。バブルが中心にあれば水平です。',
      helpAngleTitle: '角度表示',
      helpAngleDesc: '横方向（Roll）と縦方向（Pitch）の傾きを度数で表示します。',
      helpCalibrateTitle: '較正',
      helpCalibrateDesc: '現在の傾きを基準（0°）にリセットします。斜面での作業に便利です。',
      helpThemeTitle: 'テーマ',
      helpThemeDesc: '☀️/🌙 ボタンでダークモードとライトモードを切り替えます。',
      helpLangTitle: '言語',
      helpLangDesc: '🌐 ボタンで日本語と英語を切り替えます。'
    },
    en: {
      title: 'Spirit Level',
      rollLabel: 'Roll',
      pitchLabel: 'Pitch',
      level: 'Level',
      notLevel: 'Not Level',
      calibrate: 'Calibrate',
      statusReady: 'Ready',
      calibrateSuccess: 'Calibrated',
      helpTitle: 'How to Use',
      helpBubbleTitle: 'Bubble',
      helpBubbleDesc: 'Moves according to the tilt of your device. The surface is level when the bubble is centered.',
      helpAngleTitle: 'Angle Display',
      helpAngleDesc: 'Shows the tilt in degrees for Roll (horizontal) and Pitch (vertical).',
      helpCalibrateTitle: 'Calibrate',
      helpCalibrateDesc: 'Resets the current tilt as the reference (0°). Useful when working on slopes.',
      helpThemeTitle: 'Theme',
      helpThemeDesc: 'Tap ☀️/🌙 to switch between dark and light mode.',
      helpLangTitle: 'Language',
      helpLangDesc: 'Tap 🌐 to switch between Japanese and English.'
    }
  };

  let currentLang = localStorage.getItem('spirit_level_lang') ||
                   (navigator.language.startsWith('ja') ? 'ja' : 'en');

  let currentTheme = localStorage.getItem('spirit_level_theme') || 'dark';

  function init() {
    const profile = Sensor.loadProfile();
    if (!profile || !profile.sensorAvailable) {
      showError('センサーが利用できません');
      return;
    }

    // Apply saved preferences
    applyTheme();
    applyLanguage();

    // Start sensor
    stopSensor = Sensor.startListening(onSensorData);

    // Start render loop
    requestAnimationFrame(updateLoop);

    // Event listeners
    document.getElementById('calibrateBtn').addEventListener('click', onCalibrate);
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
    document.getElementById('langToggle').addEventListener('click', toggleLanguage);
    document.getElementById('helpBtn').addEventListener('click', openHelp);
    document.getElementById('helpClose').addEventListener('click', closeHelp);
    document.getElementById('helpModal').addEventListener('click', function(e) {
      if (e.target === this) closeHelp();
    });

    // Page Visibility API (battery optimization)
    document.addEventListener('visibilitychange', function() {
      if (document.hidden) {
        // Stop sensor when page is hidden
        if (stopSensor) {
          stopSensor();
          stopSensor = null;
        }
        isRunning = false;
      } else {
        // Resume when page is visible
        stopSensor = Sensor.startListening(onSensorData);
        isRunning = true;
        requestAnimationFrame(updateLoop);
      }
    });
  }

  function onSensorData({ gx, gy, gz }) {
    latestGravity = { gx, gy, gz };
  }

  function updateLoop() {
    if (!isRunning) return;

    const { gx, gy, gz } = latestGravity;

    // Calculate angles
    const { roll, pitch } = Level.calculateAngles(gx, gy, gz);

    // Update angle display
    document.getElementById('rollValue').textContent = roll.toFixed(1) + '°';
    document.getElementById('pitchValue').textContent = pitch.toFixed(1) + '°';

    // Check level status
    const isLevel = Level.isLevel(roll, pitch);
    updateLevelIndicator(isLevel);

    // Trigger feedback when becoming level
    if (isLevel && !wasLevel) {
      triggerFeedback();
    }
    wasLevel = isLevel;

    // Update bubble position
    updateBubblePosition(roll, pitch);

    requestAnimationFrame(updateLoop);
  }

  function updateLevelIndicator(isLevel) {
    const indicator = document.getElementById('levelIndicator');
    const span = indicator.querySelector('span');

    if (isLevel) {
      indicator.className = 'level-indicator level';
      span.setAttribute('data-i18n', 'level');
      span.textContent = i18n[currentLang].level;
    } else {
      indicator.className = 'level-indicator not-level';
      span.setAttribute('data-i18n', 'notLevel');
      span.textContent = i18n[currentLang].notLevel;
    }
  }

  function updateBubblePosition(roll, pitch) {
    const bubble = document.getElementById('bubble');
    const maxRadius = 100; // Maximum movement radius
    const moveScale = 1.5;  // Movement sensitivity

    const offsetX = Math.max(-maxRadius, Math.min(maxRadius, roll * moveScale));
    const offsetY = Math.max(-maxRadius, Math.min(maxRadius, pitch * moveScale));

    bubble.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`;
  }

  function triggerFeedback() {
    // Vibration (100ms)
    if (navigator.vibrate) {
      navigator.vibrate(100);
    }

    // Sound (440Hz, 0.1s)
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.value = 440; // A4
      gainNode.gain.value = 0.3; // Volume 30%

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.1);
    } catch (e) {
      // Web Audio API not supported
      console.warn('Audio feedback not available');
    }
  }

  function onCalibrate() {
    const { gx, gy, gz } = latestGravity;
    Level.calibrate(gx, gy, gz);
    showToast(i18n[currentLang].calibrateSuccess);
  }

  function applyLanguage() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (i18n[currentLang][key]) {
        el.textContent = i18n[currentLang][key];
      }
    });
    document.title = i18n[currentLang].title;
  }

  function toggleLanguage() {
    currentLang = currentLang === 'ja' ? 'en' : 'ja';
    localStorage.setItem('spirit_level_lang', currentLang);
    applyLanguage();
  }

  function applyTheme() {
    document.body.setAttribute('data-theme', currentTheme);
    const icon = document.getElementById('themeToggle');
    icon.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
  }

  function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('spirit_level_theme', currentTheme);
    applyTheme();
  }

  function openHelp() {
    document.getElementById('helpModal').classList.add('active');
  }

  function closeHelp() {
    document.getElementById('helpModal').classList.remove('active');
  }

  function showToast(msg) {
    // Remove existing toast
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    // Create new toast
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    document.body.appendChild(toast);

    // Remove after 2 seconds
    setTimeout(() => {
      toast.style.animation = 'toast-in 0.3s ease reverse';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  function showError(msg) {
    document.getElementById('statusText').textContent = msg;
    document.getElementById('statusDot').className = 'status-dot error';
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
