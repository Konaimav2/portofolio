import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('reveal CSS is enhancement-only and reduced motion stays visible', async () => {
    const css = await read('../style.css');
    assert.match(css, /\.reveal-enhanced\s+\.reveal-item\s*\{[^}]*opacity:\s*0[^}]*transform:\s*translateY\([^)]*\)[^}]*clip-path:/s);
    assert.doesNotMatch(css, /(?:^|\})\s*\.reveal-item\s*\{[^}]*opacity:\s*0/s);
    assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.reveal-enhanced\s+\.reveal-item[^}]*opacity:\s*1\s*!important[^}]*transform:\s*none\s*!important[^}]*clip-path:\s*none\s*!important/s);
});

test('scene reveal targets chapters but excludes hero and stack lanes', async () => {
    const scene = await read('../scene.mjs');
    assert.match(scene, /\.chapter-label/);
    assert.match(scene, /\.project-feature/);
    assert.match(scene, /\.experience-row/);
    assert.match(scene, /\.comment-box/);
    assert.match(scene, /\.comment-feed/);
    assert.match(scene, /Math\.min\([^,]+,\s*240\)/);
    const revealBlock = scene.slice(scene.indexOf('function initReveal'), scene.indexOf('function laneItem'));
    assert.doesNotMatch(revealBlock, /hero|stack-lane|stack-crossing/);
});

test('stack rebuild waits for fonts, clones complete sets, and cancels before refill', async () => {
    const scene = await read('../scene.mjs');
    assert.match(scene, /document\.fonts\?\.ready/);
    assert.match(scene, /marqueeSetDistance\([^,]+,\s*gap\)/);
    assert.match(scene, /while\s*\([^)]*scrollWidth[^)]*crossing\.clientWidth\s*\*\s*2/);
    assert.match(scene, /const rebuild = \(\) => \{\s*cancelAnimations\(\);[\s\S]*fillLane/s);
});
