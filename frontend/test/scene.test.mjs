import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SCENE_NAMES,
    SCENE_NAME_INTERVAL_MS,
    SCENE_SCRAMBLE_DURATION_MS,
    STACK_LANES,
    marqueeSetDistance,
    nextPlaybackRate,
    revealTransition,
    resolveTheme,
    sceneLayerOffsets,
    sceneMotionAllowed,
    sceneNamesAreCompatible,
    sceneScrambleFrame,
    sceneScrollDistance,
} from '../scene.mjs';

test('resolveTheme prefers valid stored choice', () => {
    assert.equal(resolveTheme('light', true), 'light');
    assert.equal(resolveTheme('dark', false), 'dark');
});

test('resolveTheme falls back to system preference', () => {
    assert.equal(resolveTheme('', true), 'dark');
    assert.equal(resolveTheme('invalid', false), 'light');
});

test('sceneScrollDistance clamps to the local hero depth range', () => {
    assert.equal(sceneScrollDistance({ heroTop: 72, stickyTop: 72, depthRange: 300 }), 0);
    assert.equal(sceneScrollDistance({ heroTop: -228, stickyTop: 72, depthRange: 300 }), 300);
    assert.equal(sceneScrollDistance({ heroTop: -500, stickyTop: 72, depthRange: 300 }), 300);
    assert.equal(sceneScrollDistance({ heroTop: 200, stickyTop: 72, depthRange: 300 }), 0);
});

test('sceneLayerOffsets matches verified reference ratios', () => {
    assert.deepEqual(sceneLayerOffsets(300, false), {
        word: 120,
        label: 120,
        character: -90,
    });
    assert.deepEqual(sceneLayerOffsets(300, true), {
        word: 0,
        label: 0,
        character: 0,
    });
});

test('sceneMotionAllowed pauses hidden, reduced, or offscreen scenes on every viewport', () => {
    assert.equal(sceneMotionAllowed({ visible: true, hidden: false, reduced: false }), true);
    assert.equal(sceneMotionAllowed({ visible: false, hidden: false, reduced: false }), false);
    assert.equal(sceneMotionAllowed({ visible: true, hidden: true, reduced: false }), false);
    assert.equal(sceneMotionAllowed({ visible: true, hidden: false, reduced: true }), false);
});

test('scene names stay equal-width and use approved timing', () => {
    assert.deepEqual(SCENE_NAMES, ['ARRAFFI', 'KONAIMA']);
    assert.equal(sceneNamesAreCompatible(SCENE_NAMES), true);
    assert.equal(sceneNamesAreCompatible(['ARRAFFI', 'KONA']), false);
    assert.equal(SCENE_NAME_INTERVAL_MS, 4000);
    assert.equal(SCENE_SCRAMBLE_DURATION_MS, 480);
});

test('sceneScrambleFrame keeps seven glyphs and resolves to target', () => {
    assert.equal(sceneScrambleFrame('KONAIMA', 0, () => 0), '!!!!!!!');
    assert.equal(sceneScrambleFrame('KONAIMA', 0.5, () => 0), 'KON!!!!');
    assert.equal(sceneScrambleFrame('KONAIMA', 1, () => 0), 'KONAIMA');
    assert.equal([...sceneScrambleFrame('ARRAFFI', 0.25, () => 0.5)].length, 7);
    assert.doesNotMatch(sceneScrambleFrame('ARRAFFI', 0, () => 0.999999), /\p{L}/u);
});

test('stack technologies exist on one lane only', () => {
    const labels = [...STACK_LANES.top, ...STACK_LANES.bottom].map(entry => entry.label);
    assert.equal(new Set(labels).size, labels.length);
    assert.deepEqual([...labels].sort(), ['JavaScript', 'Linux', 'Node.js', 'Python', 'VPS']);
    assert.deepEqual(STACK_LANES.top.map(entry => entry.label), ['Node.js', 'Linux', 'VPS']);
    assert.deepEqual(STACK_LANES.bottom.map(entry => entry.label), ['Python', 'JavaScript']);
});

test('nextPlaybackRate decelerates without overshoot', () => {
    assert.equal(nextPlaybackRate(1, 0, 0.25), 0.75);
    assert.equal(nextPlaybackRate(0.1, 0, 0.25), 0);
    assert.equal(nextPlaybackRate(0, 1, 0.25), 0.25);
    assert.equal(nextPlaybackRate(0.9, 1, 0.25), 1);
});

test('revealTransition reveals on entry and keeps visible at viewport edges', () => {
    const rootBounds = { top: 0, bottom: 800 };
    assert.equal(revealTransition({ isIntersecting: true, intersectionRatio: 0.01, rootBounds }, false), 'reveal');
    assert.equal(revealTransition({
        isIntersecting: false,
        intersectionRatio: 0,
        rootBounds,
        boundingClientRect: { top: 800, bottom: 900 },
    }, true), 'keep');
});

test('revealTransition resets only after full viewport exit', () => {
    const rootBounds = { top: 0, bottom: 800 };
    assert.equal(revealTransition({
        isIntersecting: false,
        intersectionRatio: 0,
        rootBounds,
        boundingClientRect: { top: 801, bottom: 901 },
    }, true), 'reset');
    assert.equal(revealTransition({
        isIntersecting: false,
        intersectionRatio: 0,
        rootBounds,
        boundingClientRect: { top: -101, bottom: -1 },
    }, false), 'keep');
});

test('marqueeSetDistance includes one computed flex gap', () => {
    assert.equal(marqueeSetDistance(420, 18), 438);
    assert.equal(marqueeSetDistance(420, Number.NaN), 420);
});
