import test from 'node:test';
import assert from 'node:assert/strict';
import { clampVolume, formatTimestamp, loopStartForState, progressToSeconds, waitForMediaMetadata } from '../player.mjs';

test('formatTimestamp formats player time', () => {
    assert.equal(formatTimestamp(0), '0:00');
    assert.equal(formatTimestamp(96), '1:36');
    assert.equal(formatTimestamp(367), '6:07');
    assert.equal(formatTimestamp(-5), '0:00');
    assert.equal(formatTimestamp('abc'), '0:00');
});

test('first play starts at 1:36 and later loop starts at zero', () => {
    assert.equal(loopStartForState({ firstPlayback: true, ended: false }), 96);
    assert.equal(loopStartForState({ firstPlayback: false, ended: false }), null);
    assert.equal(loopStartForState({ firstPlayback: false, ended: true }), 0);
    assert.equal(loopStartForState({ firstPlayback: true, ended: true }), 0);
});

test('clampVolume keeps values inside slider range', () => {
    assert.equal(clampVolume(-20), 0);
    assert.equal(clampVolume(140), 100);
    assert.equal(clampVolume('42'), 42);
    assert.equal(clampVolume('nope'), 60);
});

test('progressToSeconds clamps slider position into media duration', () => {
    assert.equal(progressToSeconds(0, 200.52), 0);
    assert.equal(progressToSeconds(500, 200.52), 100.26);
    assert.equal(progressToSeconds(1000, 200.52), 200.52);
    assert.equal(progressToSeconds(-20, 200.52), 0);
    assert.equal(progressToSeconds(1200, 200.52), 200.52);
    assert.equal(progressToSeconds(500, 0), 0);
});

test('waitForMediaMetadata resolves on metadata and rejects on timeout', async () => {
    const ready = new EventTarget();
    ready.readyState = 0;
    const loaded = waitForMediaMetadata(ready, 100);
    ready.dispatchEvent(new Event('loadedmetadata'));
    await assert.doesNotReject(loaded);

    const stalled = new EventTarget();
    stalled.readyState = 0;
    await assert.rejects(waitForMediaMetadata(stalled, 10), /metadata timeout/);
});
