const test = require('node:test');
const assert = require('node:assert/strict');

const ScreenWakeLock = require('../spirit-level/app/wake-lock.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fakeSentinel() {
  const events = new EventTarget();
  return {
    released: false,
    releases: 0,
    addEventListener: events.addEventListener.bind(events),
    release() {
      this.releases += 1;
      this.systemRelease();
      return Promise.resolve();
    },
    systemRelease() {
      this.released = true;
      events.dispatchEvent(new Event('release'));
    }
  };
}

function fixture() {
  const requests = [];
  const changes = [];
  const controller = ScreenWakeLock.create({
    wakeLock: {
      request(type) {
        assert.equal(type, 'screen');
        const next = deferred();
        requests.push(next);
        return next.promise;
      }
    },
    onChange: state => changes.push(state)
  });
  return { controller, requests, changes };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('starts off and requires both explicit opt-in and active measurement', async () => {
  const { controller, requests, changes } = fixture();
  assert.deepEqual(controller.getState(), {
    supported: true, enabled: false, active: false, pending: false, status: 'off'
  });
  controller.setEnabled(true);
  assert.equal(requests.length, 0);
  controller.setActive(true);
  assert.equal(controller.getState().pending, true);
  const lock = fakeSentinel();
  requests[0].resolve(lock);
  await settle();
  assert.equal(controller.getState().active, true);
  assert.equal(changes.at(-1).status, 'active');
  controller.setEnabled(false);
  await settle();
  assert.equal(lock.releases, 1);
  assert.equal(controller.getState().status, 'off');
});

test('unsupported browsers expose a useful state without requesting anything', () => {
  const controller = ScreenWakeLock.create({ wakeLock: null });
  controller.setEnabled(true);
  controller.setActive(true);
  assert.deepEqual(controller.getState(), {
    supported: false, enabled: true, active: false, pending: false, status: 'unsupported'
  });
});

test('visibility/measurement suspension releases the lock and return reacquires it', async () => {
  const { controller, requests } = fixture();
  controller.setActive(true);
  controller.setEnabled(true);
  const first = fakeSentinel();
  requests[0].resolve(first);
  await settle();
  controller.setActive(false);
  assert.equal(first.releases, 1);
  assert.equal(controller.getState().enabled, true);
  assert.equal(controller.getState().status, 'off');
  controller.setActive(true);
  const second = fakeSentinel();
  requests[1].resolve(second);
  await settle();
  assert.equal(controller.getState().active, true);
  assert.equal(second.releases, 0);
});

test('disabling a pending request releases its eventual lock', async () => {
  const { controller, requests } = fixture();
  controller.setActive(true);
  controller.setEnabled(true);
  controller.setEnabled(false);
  assert.equal(controller.getState().pending, false);
  const lateLock = fakeSentinel();
  requests[0].resolve(lateLock);
  await settle();
  assert.equal(lateLock.releases, 1);
  assert.equal(controller.getState().status, 'off');
  assert.equal(requests.length, 1);
});

for (const transition of ['setActive', 'setEnabled']) {
  test(`rapid ${transition} off/on replaces a pending stale request once`, async () => {
    const { controller, requests } = fixture();
    controller.setActive(true);
    controller.setEnabled(true);
    controller[transition](false);
    controller[transition](true);
    controller[transition](true);
    assert.equal(requests.length, 1);
    const staleLock = fakeSentinel();
    requests[0].resolve(staleLock);
    await settle();
    assert.equal(staleLock.releases, 1);
    assert.equal(requests.length, 2);
    assert.equal(controller.getState().status, 'pending');
    requests[1].resolve(fakeSentinel());
    await settle();
    assert.equal(controller.getState().status, 'active');
  });
}

test('an obsolete rejection cannot cancel the latest request intent', async () => {
  const { controller, requests } = fixture();
  controller.setActive(true);
  controller.setEnabled(true);
  controller.setActive(false);
  controller.setActive(true);
  requests[0].reject(new Error('Document was hidden'));
  await settle();
  assert.equal(requests.length, 2);
  requests[1].resolve(fakeSentinel());
  await settle();
  assert.equal(controller.getState().status, 'active');
});

test('request denial preserves intent without retrying on repeated active samples', async () => {
  const { controller, requests } = fixture();
  controller.setActive(true);
  controller.setEnabled(true);
  requests[0].reject(new Error('Low battery'));
  await settle();
  assert.equal(controller.getState().status, 'unavailable');
  assert.equal(controller.getState().enabled, true);
  controller.setActive(true);
  controller.setEnabled(true);
  await settle();
  assert.equal(requests.length, 1);
  controller.setEnabled(false);
  controller.setEnabled(true);
  assert.equal(requests.length, 2);
  requests[1].resolve(fakeSentinel());
  await settle();
  assert.equal(controller.getState().status, 'active');
});

test('system release reports actual lock loss without an automatic retry loop', async () => {
  const { controller, requests } = fixture();
  controller.setActive(true);
  controller.setEnabled(true);
  const lock = fakeSentinel();
  requests[0].resolve(lock);
  await settle();
  lock.systemRelease();
  controller.setActive(true);
  await settle();
  assert.equal(controller.getState().status, 'released');
  assert.equal(controller.getState().active, false);
  assert.equal(controller.getState().enabled, true);
  assert.equal(requests.length, 1);
});

test('already released sentinels never appear active', async () => {
  const { controller, requests } = fixture();
  controller.setActive(true);
  controller.setEnabled(true);
  const lock = fakeSentinel();
  lock.systemRelease();
  requests[0].resolve(lock);
  await settle();
  assert.equal(controller.getState().status, 'released');
  assert.equal(controller.getState().active, false);
  assert.equal(requests.length, 1);
});

test('a late release event from a previous lock cannot clear a new lock', async () => {
  const { controller, requests } = fixture();
  controller.setActive(true);
  controller.setEnabled(true);
  const oldLock = fakeSentinel();
  oldLock.release = () => Promise.resolve();
  requests[0].resolve(oldLock);
  await settle();
  controller.setActive(false);
  controller.setActive(true);
  requests[1].resolve(fakeSentinel());
  await settle();
  oldLock.systemRelease();
  assert.equal(controller.getState().status, 'active');
});

test('synchronous request errors and rejected releases are handled safely', async () => {
  const controller = ScreenWakeLock.create({
    wakeLock: { request() { throw new Error('Not allowed'); } }
  });
  controller.setActive(true);
  controller.setEnabled(true);
  await settle();
  assert.equal(controller.getState().status, 'unavailable');

  const { controller: other, requests } = fixture();
  other.setActive(true);
  other.setEnabled(true);
  const lock = fakeSentinel();
  lock.release = () => Promise.reject(new Error('Document detached'));
  requests[0].resolve(lock);
  await settle();
  other.setEnabled(false);
  await settle();
  assert.equal(other.getState().status, 'off');
});
