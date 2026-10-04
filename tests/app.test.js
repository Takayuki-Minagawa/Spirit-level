const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appDirectory = path.join(__dirname, '../spirit-level/app');
const validProfile = JSON.stringify({
  version: 1,
  sensorAvailable: true,
  hasAccG: true,
  fsHz: 50,
  eventCount: 100
});

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }

  removeEventListener(type, callback) {
    this.listeners.get(type)?.delete(callback);
  }

  dispatch(type, details = {}) {
    const event = { type, target: this, currentTarget: this, preventDefault() {}, ...details };
    for (const callback of [...(this.listeners.get(type) || [])]) callback(event);
    this[`on${type}`]?.(event);
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size || 0;
  }
}

class FakeElement extends FakeEventTarget {
  constructor(tagName, ownerDocument) {
    super();
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.attributes = new Map();
    this.children = [];
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.clientWidth = 200;
    this.offsetWidth = 16;
    this._text = '';
    this.classList = {
      add: (name) => this.classList.toggle(name, true),
      remove: (name) => this.classList.toggle(name, false),
      contains: (name) => this.className.split(/\s+/).includes(name),
      toggle: (name, force) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        const enabled = force === undefined ? !names.has(name) : force;
        if (enabled) names.add(name);
        else names.delete(name);
        this.className = [...names].join(' ');
        return enabled;
      }
    };
  }

  get className() { return this.getAttribute('class') || ''; }
  set className(value) { this.setAttribute('class', value); }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (['hidden', 'disabled', 'checked'].includes(name)) this[name] = true;
  }

  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (['hidden', 'disabled', 'checked'].includes(name)) this[name] = false;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
      this.parentNode = null;
    }
  }

  querySelectorAll(selector) {
    const selectors = selector.split(',').map((part) => part.trim());
    const matches = (element) => selectors.some((part) => {
      if (part.startsWith('.')) return element.classList.contains(part.slice(1));
      if (part === '[tabindex]:not([tabindex="-1"])') {
        return element.hasAttribute('tabindex') && element.getAttribute('tabindex') !== '-1';
      }
      if (part.startsWith('[')) return element.hasAttribute(part.slice(1, -1));
      return element.tagName.toLowerCase() === part;
    });
    const results = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (matches(child)) results.push(child);
        visit(child);
      }
    };
    visit(this);
    return results;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() { this.ownerDocument.activeElement = this; }
  click() { if (!this.disabled) this.dispatch('click'); }
}

// Only the DOM surface used by the controller is emulated. The fixture is read
// from the real page so missing controls and script dependencies fail the tests.
function createDocument() {
  const document = new FakeEventTarget();
  const root = new FakeElement('document', document);
  const stack = [root];
  const html = fs.readFileSync(path.join(appDirectory, 'index.html'), 'utf8');
  const voidTags = new Set(['meta', 'link', 'input', 'br', 'hr', 'img']);
  for (const token of html.matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/?[^>]+>|[^<]+/g)) {
    const text = token[0];
    if (text.startsWith('<!')) continue;
    if (text.startsWith('</')) { stack.pop(); continue; }
    if (!text.startsWith('<')) { stack.at(-1)._text += text; continue; }
    const tag = /^<([\w-]+)/.exec(text)[1].toLowerCase();
    const element = new FakeElement(tag, document);
    const attributes = text.slice(tag.length + 1, -1);
    for (const match of attributes.matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      element.setAttribute(match[1], match[2] ?? match[3] ?? match[4] ?? '');
    }
    stack.at(-1).appendChild(element);
    if (!voidTags.has(tag)) stack.push(element);
  }
  document.documentElement = root.querySelector('html');
  document.body = root.querySelector('body');
  document.activeElement = document.body;
  document.hidden = false;
  Object.defineProperty(document, 'visibilityState', {
    get: () => document.hidden ? 'hidden' : 'visible'
  });
  document.querySelector = root.querySelector.bind(root);
  document.querySelectorAll = root.querySelectorAll.bind(root);
  document.getElementById = (id) => root.querySelectorAll('[id]')
    .find((element) => element.getAttribute('id') === id) || null;
  document.createElement = (tag) => new FakeElement(tag, document);
  return document;
}

function createStorage(initial = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key)
  };
}

function createApp({ profile = validProfile, wakeLock = true, wakeRequestError = null } = {}) {
  const document = createDocument();
  const window = new FakeEventTarget();
  const orientation = new FakeEventTarget();
  orientation.angle = 0;
  const screen = { orientation };
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const frames = new Map();
  const audioContexts = [];
  const wakeRequests = [];
  const navigator = { language: 'en', vibrate() {} };
  if (wakeLock) {
    navigator.wakeLock = {
      async request(type) {
        wakeRequests.push(type);
        if (wakeRequestError) throw wakeRequestError;
        const sentinel = new FakeEventTarget();
        sentinel.released = false;
        sentinel.releaseCalls = 0;
        sentinel.release = async () => {
          sentinel.releaseCalls += 1;
          sentinel.released = true;
          sentinel.dispatch('release');
        };
        wakeRequests[wakeRequests.length - 1] = sentinel;
        return sentinel;
      }
    };
  }
  window.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.destination = {};
      this.closeCalls = 0;
      this.state = 'running';
      audioContexts.push(this);
    }
    createOscillator() {
      this.oscillator = new FakeEventTarget();
      Object.assign(this.oscillator, { frequency: {}, connect() {}, start() {}, stop() {} });
      return this.oscillator;
    }
    createGain() { return { gain: {}, connect() {} }; }
    async close() { this.closeCalls += 1; this.state = 'closed'; }
  };
  const localStorage = createStorage();
  const sessionStorage = createStorage(profile === null ? {} : { spirit_level_profile: profile });
  const context = vm.createContext({
    document, window, navigator, screen, localStorage, sessionStorage,
    isSecureContext: true,
    performance: { now: () => now },
    console,
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { frames.delete(id); }
  });
  Object.assign(window, { document, navigator, screen, isSecureContext: true });
  for (const script of document.querySelectorAll('script')) {
    const filename = script.getAttribute('src');
    vm.runInContext(fs.readFileSync(path.join(appDirectory, filename), 'utf8'), context, { filename });
  }
  document.dispatch('DOMContentLoaded');
  const element = (id) => {
    const found = document.getElementById(id);
    assert.ok(found, `Expected page element #${id}`);
    return found;
  };
  return {
    document, window, screen, element, sessionStorage, localStorage, audioContexts, wakeRequests,
    status: () => element('statusText').getAttribute('data-i18n'),
    click: (id) => element(id).click(),
    sample(x = 0, y = 0, z = 9.81) {
      window.dispatch('devicemotion', { accelerationIncludingGravity: { x, y, z } });
    },
    render() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(now));
    },
    advance(milliseconds) {
      const target = now + milliseconds;
      let count = 0;
      while (true) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        assert.ok(count++ < 100, 'Timer loop did not settle');
        const [id, timer] = due;
        timers.delete(id);
        now = timer.at;
        timer.callback();
      }
      now = target;
    },
    hide() { document.hidden = true; document.dispatch('visibilitychange'); },
    show() { document.hidden = false; document.dispatch('visibilitychange'); },
    rotate(angle) { orientation.angle = angle; orientation.dispatch('change'); },
    async settle() { for (let i = 0; i < 8; i += 1) await Promise.resolve(); }
  };
}

function assertBlank(app) {
  assert.equal(app.element('rollValue').textContent, '--.-°');
  assert.equal(app.element('pitchValue').textContent, '--.-°');
  assert.equal(app.element('levelIndicator').querySelector('span').getAttribute('data-i18n'), 'waitingForMeasurement');
}

function assertControlsDisabled(app) {
  for (const id of ['holdBtn', 'calibrateBtn', 'resetBtn']) assert.equal(app.element(id).disabled, true, id);
}

test('startup waits for real data, reports missing events, and recovers automatically', () => {
  const app = createApp();
  assert.equal(app.status(), 'statusWaiting');
  assertBlank(app);
  assertControlsDisabled(app);
  app.advance(2999);
  assert.equal(app.status(), 'statusWaiting');
  app.advance(1);
  assert.equal(app.status(), 'statusStale');
  assert.equal(app.element('sensorRecovery').hidden, false);
  assertBlank(app);
  assertControlsDisabled(app);

  app.sample(Number.NaN);
  app.sample(0, 0, 0);
  assert.equal(app.status(), 'statusStale');
  app.sample(-9.81, 0, 9.81);
  app.render();
  assert.equal(app.status(), 'statusActive');
  assert.equal(app.element('sensorRecovery').hidden, true);
  assert.equal(app.element('rollValue').textContent, '45.0°');
  assert.equal(app.element('holdBtn').disabled, false);
  assert.equal(app.element('calibrateBtn').disabled, false);
});

test('only valid samples extend the watchdog and expired live readings are cleared', () => {
  const app = createApp();
  app.sample(-9.81, 0, 9.81);
  app.render();
  app.advance(2000);
  app.sample(-9.81, 0, 9.81);
  app.advance(2000);
  app.sample(Infinity);
  assert.equal(app.status(), 'statusActive');
  app.advance(1000);
  assert.equal(app.status(), 'statusStale');
  assertBlank(app);
  assertControlsDisabled(app);
  app.render();
  assertBlank(app);
});

test('hiding stops pending work and late callbacks, preserving calibration for a fresh restart', () => {
  const app = createApp();
  app.sample(-9.81, 0, 9.81);
  app.render();
  app.click('calibrateBtn');
  app.render();
  assert.equal(app.element('rollValue').textContent, '0.0°');
  const lateCallback = [...app.window.listeners.get('devicemotion')][0];
  app.sample(9.81, 0, 9.81);
  app.hide();
  assert.equal(app.window.listenerCount('devicemotion'), 0);
  lateCallback({ accelerationIncludingGravity: { x: 9.81, y: 0, z: 9.81 } });
  app.render();
  app.advance(10000);
  assertBlank(app);
  assertControlsDisabled(app);
  assert.notEqual(app.status(), 'statusStale');
  assert.equal(app.element('basisValue').getAttribute('data-i18n'), 'basisRelative');

  app.show();
  app.show();
  assert.equal(app.window.listenerCount('devicemotion'), 1);
  assert.equal(app.status(), 'statusWaiting');
  assertControlsDisabled(app);
  app.sample(9.81, 0, 9.81);
  app.render();
  assert.equal(app.element('rollValue').textContent, '-90.0°');
  assert.equal(app.element('resetBtn').disabled, false);
});

test('HOLD freezes the displayed sample even when a newer animation frame is queued', () => {
  const app = createApp();
  app.sample(-9.81, 0, 9.81);
  assert.equal(app.element('holdBtn').disabled, true);
  app.render();
  const visibleRoll = app.element('rollValue').textContent;
  const visibleBubble = app.element('bubble').style.transform;
  app.sample(9.81, 0, 9.81);
  app.click('holdBtn');
  app.render();
  assert.equal(app.element('holdBtn').getAttribute('aria-pressed'), 'true');
  assert.equal(app.element('rollValue').textContent, visibleRoll);
  assert.equal(app.element('bubble').style.transform, visibleBubble);
  app.sample(9.81, 0, 9.81);
  app.render();
  assert.equal(app.element('rollValue').textContent, visibleRoll);
  assert.equal(app.element('calibrateBtn').disabled, true);
  assert.equal(app.element('resetBtn').disabled, true);

  app.click('holdBtn');
  app.render();
  assert.equal(app.status(), 'statusActive');
  assert.equal(app.element('holdBtn').getAttribute('aria-pressed'), 'false');
  assert.notEqual(app.element('rollValue').textContent, visibleRoll);
});

test('expired HOLD retains its captured value but resuming waits for a fresh sample', () => {
  const app = createApp();
  app.sample(-9.81, 0, 9.81);
  app.render();
  app.click('holdBtn');
  app.advance(3000);
  assert.equal(app.status(), 'statusHeldStale');
  assert.equal(app.element('rollValue').textContent, '45.0°');
  assert.equal(app.element('holdBtn').disabled, false);
  app.click('holdBtn');
  app.render();
  assertBlank(app);
  assertControlsDisabled(app);
  assert.equal(app.status(), 'statusStale');
  app.sample(0, 0, 9.81);
  app.render();
  assert.equal(app.element('rollValue').textContent, '0.0°');
  assert.equal(app.status(), 'statusActive');
});

test('HOLD survives backgrounding while a fresh reading is required for live resumption', () => {
  const app = createApp();
  app.sample(-9.81, 0, 9.81);
  app.render();
  app.click('calibrateBtn');
  app.render();
  app.click('holdBtn');
  app.hide();
  app.advance(10000);
  assert.equal(app.element('rollValue').textContent, '0.0°');
  assert.equal(app.element('holdBtn').getAttribute('aria-pressed'), 'true');
  assert.equal(app.status(), 'statusHeldStale');
  app.show();
  assert.equal(app.status(), 'statusHeldStale');
  assert.equal(app.element('calibrateBtn').disabled, true);
  app.sample(9.81, 0, 9.81);
  app.render();
  assert.equal(app.status(), 'statusHeld');
  assert.equal(app.element('rollValue').textContent, '0.0°');
  app.click('holdBtn');
  app.render();
  assert.equal(app.status(), 'statusActive');
  assert.equal(app.element('rollValue').textContent, '-90.0°');
  assert.equal(app.element('basisValue').getAttribute('data-i18n'), 'basisRelative');
});

test('profile invalidation on page restoration clears calibration, HOLD, and sensor subscription', () => {
  const app = createApp();
  app.sample(-9.81, 0, 9.81);
  app.render();
  app.click('calibrateBtn');
  app.render();
  app.click('holdBtn');
  app.window.dispatch('pagehide');
  app.sessionStorage.setItem('spirit_level_profile', '{corrupt');
  app.window.dispatch('pageshow', { persisted: true });
  assert.equal(app.status(), 'statusUnavailable');
  assert.equal(app.element('sensorRecovery').hidden, false);
  assert.equal(app.element('basisValue').getAttribute('data-i18n'), 'basisAbsolute');
  assert.equal(app.element('holdBtn').getAttribute('aria-pressed'), 'false');
  assert.equal(app.window.listenerCount('devicemotion'), 0);
  assertControlsDisabled(app);
  assertBlank(app);
});

test('an invalid initial profile cannot start measurements', () => {
  const app = createApp({ profile: null });
  assert.equal(app.status(), 'statusUnavailable');
  assert.equal(app.window.listenerCount('devicemotion'), 0);
  app.sample(-9.81, 0, 9.81);
  app.render();
  app.advance(10000);
  assertBlank(app);
  assertControlsDisabled(app);
  assert.equal(app.status(), 'statusUnavailable');
});

test('rotation reprojects held angles and resize constrains their bubble to the new circle', () => {
  const app = createApp();
  app.sample(-9.81, 0, 9.81);
  app.render();
  app.click('holdBtn');
  app.sample(9.81, 0, 9.81);
  app.rotate(90);
  app.render();
  assert.equal(app.element('rollValue').textContent, '0.0°');
  assert.equal(app.element('pitchValue').textContent, '-45.0°');
  assert.equal(app.element('holdBtn').getAttribute('aria-pressed'), 'true');
  const largeBubble = app.element('bubble').style.transform;
  app.element('levelVisual').clientWidth = 100;
  app.window.dispatch('resize');
  app.render();
  assert.notEqual(app.element('bubble').style.transform, largeBubble);
  assert.match(app.element('bubble').style.transform, /34px/);
  app.rotate(180);
  app.render();
  assert.equal(app.element('rollValue').textContent, '-45.0°');
  assert.equal(app.element('pitchValue').textContent, '0.0°');
});

test('legacy orientationchange reprojects without Screen Orientation API support', () => {
  const app = createApp();
  delete app.screen.orientation;
  app.window.orientation = 270;
  app.sample(-9.81, 0, 9.81);
  app.render();
  app.window.dispatch('orientationchange');
  app.render();
  assert.equal(app.element('rollValue').textContent, '0.0°');
  assert.equal(app.element('pitchValue').textContent, '45.0°');
});

test('screen wake lock is opt-in, released while hidden, and reacquired when visible', async () => {
  const app = createApp();
  const toggle = app.element('wakeLockToggle');
  assert.equal(toggle.checked, false);
  assert.equal(app.wakeRequests.length, 0);
  toggle.checked = true;
  toggle.dispatch('change');
  await app.settle();
  assert.equal(app.wakeRequests.length, 0);
  app.sample();
  await app.settle();
  assert.equal(app.wakeRequests.length, 1);
  const firstLock = app.wakeRequests[0];
  assert.equal(firstLock.released, false);
  app.hide();
  await app.settle();
  assert.equal(firstLock.released, true);
  app.show();
  await app.settle();
  assert.equal(app.wakeRequests.length, 1);
  app.sample();
  await app.settle();
  assert.equal(app.wakeRequests.length, 2);
  toggle.checked = false;
  toggle.dispatch('change');
  await app.settle();
  assert.equal(app.wakeRequests[1].released, true);
});

test('unsupported wake lock is disabled and its explanation follows the selected language', () => {
  const app = createApp({ wakeLock: false });
  assert.equal(app.element('wakeLockToggle').disabled, true);
  const english = app.element('wakeLockStatus').textContent;
  assert.ok(english.trim().length > 0);
  app.click('langToggle');
  assert.equal(app.document.documentElement.lang, 'ja');
  assert.notEqual(app.element('wakeLockStatus').textContent, english);
});

test('a stopped sensor releases wake lock during HOLD and fresh data reacquires it', async () => {
  const app = createApp();
  app.element('wakeLockToggle').checked = true;
  app.element('wakeLockToggle').dispatch('change');
  app.sample(-9.81, 0, 9.81);
  app.render();
  app.click('holdBtn');
  await app.settle();
  assert.equal(app.wakeRequests.length, 1);
  app.advance(3000);
  await app.settle();
  assert.equal(app.wakeRequests[0].released, true);
  assert.equal(app.status(), 'statusHeldStale');
  app.sample(0, 0, 9.81);
  await app.settle();
  assert.equal(app.wakeRequests.length, 2);
  assert.equal(app.status(), 'statusHeld');
  assert.equal(app.element('rollValue').textContent, '45.0°');
});

test('wake lock rejection is contained and leaves the measuring interface usable', async () => {
  const app = createApp({ wakeRequestError: new Error('NotAllowedError') });
  app.element('wakeLockToggle').checked = true;
  app.element('wakeLockToggle').dispatch('change');
  app.sample();
  await app.settle();
  assert.equal(app.wakeRequests.length, 1);
  assert.ok(app.element('wakeLockStatus').textContent.trim().length > 0);
  app.sample(-9.81, 0, 9.81);
  app.render();
  assert.equal(app.status(), 'statusActive');
  assert.equal(app.element('calibrateBtn').disabled, false);
});

function enterLevel(app) {
  app.sample(-9.81, 0, 9.81);
  app.render();
  for (let index = 0; index < 30; index += 1) {
    app.sample(0, 0, 9.81);
    app.render();
  }
}

test('audio feedback closes its context after ending and when the page is hidden', async () => {
  const app = createApp();
  enterLevel(app);
  assert.equal(app.audioContexts.length, 1);
  app.audioContexts[0].oscillator.dispatch('ended');
  await app.settle();
  assert.equal(app.audioContexts[0].closeCalls, 1);
  app.hide();
  app.show();
  enterLevel(app);
  assert.equal(app.audioContexts.length, 2);
  app.hide();
  await app.settle();
  assert.equal(app.audioContexts[1].closeCalls, 1);
  assert.equal(app.audioContexts[0].closeCalls, 1);
});
