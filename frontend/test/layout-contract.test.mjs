import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('both pages keep five-screen order', async () => {
    for (const path of ['../index.html', '../id/index.html']) {
        const html = await read(path);
        const positions = ['home', 'about', 'projects', 'experience', 'comments']
            .map(id => html.indexOf(`id="${id}"`));
        assert.ok(positions.every(position => position >= 0));
        assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
    }
});

test('header precedes scene and scene fills remaining viewport', async () => {
    const [html, css] = await Promise.all([read('../index.html'), read('../style.css')]);
    assert.ok(html.indexOf('<header') < html.indexOf('id="home"'));
    assert.match(css, /\.hero-scene\s*\{[^}]*height:\s*calc\(100svh\s*-\s*var\(--header-height\)/s);
});

test('hero word reserves one responsive width and centers every mutation frame', async () => {
    const css = await read('../style.css');
    const wordRule = css.match(/\.hero-word\s*\{([^}]*)\}/s)?.[1] || '';
    assert.match(wordRule, /inline-size:\s*min\(60rem,\s*100vw\)/);
    assert.match(wordRule, /text-align:\s*center/);
    assert.match(wordRule, /font-size:\s*clamp\(5rem,\s*17vw,\s*16rem\)/);

    const mobileRule = css.match(/@media \(max-width:\s*768px\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
    const mobileWordRule = mobileRule.match(/\.hero-word\s*\{([^}]*)\}/s)?.[1] || '';
    assert.match(mobileWordRule, /font-size:\s*clamp\(4rem,\s*18\.75vw,\s*8rem\)/);
    assert.doesNotMatch(mobileWordRule, /letter-spacing/);
});

test('hero uses approved sticky depth stage and centered character geometry', async () => {
    const [english, indonesian, css] = await Promise.all([
        read('../index.html'),
        read('../id/index.html'),
        read('../style.css'),
    ]);

    for (const html of [english, indonesian]) {
        assert.match(html, /<div class="scene-character"[^>]*>\s*<div class="scene-character-float"[^>]*>\s*<img[^>]*character-default\.png[^>]*>\s*<\/div>\s*<\/div>/);
    }

    assert.match(css, /\.hero\s*\{[^}]*height:\s*130svh/s);
    assert.match(css, /\.hero-scene\s*\{[^}]*position:\s*sticky[^}]*top:\s*var\(--header-height\)/s);

    const characterRule = css.match(/\.scene-character\s*\{([^}]*)\}/s)?.[1] || '';
    assert.match(characterRule, /left:\s*50%/);
    assert.match(characterRule, /top:\s*54%/);
    assert.match(characterRule, /width:\s*min\(35vw,\s*500px\)/);
    assert.match(characterRule, /aspect-ratio:\s*433\s*\/\s*577/);

    const floatRule = css.match(/\.scene-character-float\s*\{([^}]*)\}/s)?.[1] || '';
    assert.match(floatRule, /animation:\s*scene-character-float\s+6s\s+ease-in-out\s+infinite/);
    assert.match(floatRule, /animation-play-state:\s*paused/);
    assert.match(css, /\.scene-motion-active\s+\.scene-character-float\s*\{[^}]*animation-play-state:\s*running/s);
    assert.match(css, /@keyframes\s+scene-character-float\s*\{[\s\S]*50%\s*\{\s*transform:\s*translateY\(-20px\)\s+rotate\(2deg\);?\s*\}/s);

    assert.match(css, /@media \(max-width:\s*768px\)[\s\S]*\.scene-character\s*\{[^}]*top:\s*56%[^}]*width:\s*min\(92vw,\s*380px\)/s);
    assert.match(css, /@media \(max-width:\s*768px\)[\s\S]*\.hero-mini-text-c,\s*\.hero-mini-text-d\s*\{[^}]*display:\s*none/s);
    assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.hero\s*\{[^}]*height:\s*auto/s);
    assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.scene-character-float\s*\{[^}]*animation:\s*none\s*!important/s);
    assert.doesNotMatch(css, /--pointer-[xy]/);
});

test('cloud loops stay populated without a centered anchor marker', async () => {
    const [english, indonesian, css] = await Promise.all([
        read('../index.html'),
        read('../id/index.html'),
        read('../style.css'),
    ]);

    for (const html of [english, indonesian]) {
        assert.match(html, /class="hero-scroll-cue"[\s\S]*class="hero-down"/);
        assert.doesNotMatch(html, /scene-compass/);
        const frontClouds = html.match(/class="scene-clouds scene-clouds-front"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '';
        assert.equal((frontClouds.match(/<img\b/g) || []).length, 2);
    }

    assert.match(css, /@keyframes\s+drift-rear\s*\{[\s\S]*translateX\(-60vw\)[\s\S]*translateX\(120vw\)/);
    assert.match(css, /@keyframes\s+drift-front\s*\{[\s\S]*translateX\(60vw\)[\s\S]*translateX\(-120vw\)/);
    assert.match(css, /\.scene-clouds-front img\s*\{[^}]*animation:\s*drift-front\s+70s\s+linear\s+infinite\s+-36s/s);
    assert.match(css, /\.scene-clouds-front img:nth-child\(2\)\s*\{[^}]*animation-delay:\s*-1s/s);
    assert.doesNotMatch(css, /\.scene-compass/);

    const cueRule = css.match(/\.hero-scroll-cue\s*\{([^}]*)\}/s)?.[1] || '';
    assert.match(cueRule, /z-index:\s*6/);
    assert.match(cueRule, /bottom:\s*18px/);
    assert.doesNotMatch(cueRule, /--scene-character-y/);
});

test('Screen 1 has environmental typography but no information panel', async () => {
    const html = await read('../index.html');
    const scene = html.slice(html.indexOf('id="home"'), html.indexOf('id="about"'));
    assert.match(scene, /class="hero-word"[^>]*>ARRAFFI</);
    assert.match(scene, /hero-mini-text/);
    assert.doesNotMatch(scene, /hero-copy|hero-actions|social-links|hero-greeting/);
    assert.doesNotMatch(scene, /<button[^>]+hero-character/);
    assert.doesNotMatch(scene, /character-alt/);
});

test('About contains square dual portrait and two stack lanes', async () => {
    const html = await read('../index.html');
    assert.match(html, /https:\/\/banquet\.arraffi\.com\/portfolio\/assets\/hero-oc\.18b0b8c4a67f\.webp/);
        assert.match(html, /hero-real\.ba9ca0a6abd4\.webp/);
    assert.match(html, /stack-lane-top/);
    assert.match(html, /stack-lane-bottom/);
});

test('comments use native authentication dialog', async () => {
    const html = await read('../index.html');
    assert.match(html, /<dialog[^>]+id="comment-auth-dialog"/);
    assert.doesNotMatch(html, /<details[^>]+id="comment-auth"/);
});

function extractIds(html) {
    return [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]).sort();
}

test('English and Indonesian pages expose identical IDs', async () => {
    const [english, indonesian] = await Promise.all([
        read('../index.html'),
        read('../id/index.html'),
    ]);
    assert.deepEqual(extractIds(english), extractIds(indonesian));
});

test('public API endpoints and payload field names remain present', async () => {
    const app = await read('../app.js');
    for (const endpoint of [
        '/api/projects',
        '/api/experience',
        '/api/comment/me',
        '/api/comment/logout',
        '/api/comments',
    ]) assert.match(app, new RegExp(endpoint.replaceAll('/', '\\/')));

    assert.match(app, /\/api\/comment\/\$\{mode\}/);
    assert.match(app, /'login'|"login"/);
    assert.match(app, /'register'|"register"/);

    for (const field of [
        'anonymous_name',
        'anonymous_email',
        'website_url',
        'turnstile',
        'avatar_data',
    ]) assert.match(app, new RegExp(`\\b${field}\\b`));
});

test('CMS sections use API data without hardcoded record placeholders', async () => {
    const app = await read('../app.js');
    assert.doesNotMatch(app, /fallbackProjects|fallbackExperience/);
    assert.doesNotMatch(app, /cdn\.discordapp\.my\.id/);
    assert.match(app, /Failed to fetch API\./);
    assert.match(app, /renderCMSFailure\('dynamic-projects'\)/);
    assert.match(app, /renderCMSFailure\('dynamic-experience'\)/);
    assert.match(app, /Promise\.allSettled/);
});

test('static image references use portfolio R2 assets only', async () => {
    const paths = ['../index.html', '../id/index.html', '../admin.html', '../_headers'];
    for (const path of paths) {
        const source = await read(path);
        assert.doesNotMatch(source, /cdn\.discordapp\.my\.id/);
    }
    for (const path of ['../index.html', '../id/index.html', '../admin.html']) {
        const html = await read(path);
        assert.match(html, /https:\/\/banquet\.arraffi\.com\/portfolio\/assets\/site\.webp/);
    }
});

test('Screen 1 contains only environmental text', async () => {
    const html = await read('../index.html');
    const screen = html.slice(html.indexOf('id="home"'), html.indexOf('id="about"'));
    for (const forbidden of ['hero-copy', 'hero-actions', 'hero-greeting', 'social-links']) {
        assert.doesNotMatch(screen, new RegExp(forbidden));
    }
    assert.doesNotMatch(screen, /<button[^>]+hero-character/);
    assert.doesNotMatch(screen, /character-alt/);
});

test('experience rows remain cardless with logos and strong lines', async () => {
    const [app, css] = await Promise.all([read('../app.js'), read('../style.css')]);
    assert.match(app, /exp-logo-frame/);
    assert.match(app, /logo_url/);
    assert.match(css, /--line-strong:/);
    const rowRule = css.match(/\.experience-row\s*\{([^}]*)\}/s)?.[1] || '';
    assert.doesNotMatch(rowRule, /border-radius|box-shadow/);
});

test('authentication fields exist once and live inside dialog', async () => {
    const html = await read('../index.html');
    for (const id of [
        'comment-auth-form',
        'comment-auth-name',
        'comment-auth-email',
        'comment-auth-password',
        'comment-avatar',
        'comment-auth-submit',
    ]) {
        assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
    }
    const dialog = html.slice(
        html.indexOf('id="comment-auth-dialog"'),
        html.indexOf('</dialog>')
    );
    assert.match(dialog, /id="comment-auth-form"/);
});

test('scene code has no self-scheduling permanent animation loop', async () => {
    const scene = await read('../scene.mjs');
    assert.doesNotMatch(scene, /function\s+animate\w*\([^)]*\)[\s\S]*requestAnimationFrame\(animate\w*\)/);
});

test('hero runtime uses passive scroll depth and bounded name mutation', async () => {
    const scene = await read('../scene.mjs');
    assert.match(scene, /addEventListener\('scroll',\s*requestPaint,\s*\{\s*passive:\s*true\s*\}\)/);
    assert.match(scene, /SCENE_NAME_INTERVAL_MS/);
    assert.match(scene, /SCENE_SCRAMBLE_DURATION_MS/);
    assert.match(scene, /--scene-word-y/);
    assert.match(scene, /--scene-character-y/);
    assert.doesNotMatch(scene, /\b(?:hero|scene)\.addEventListener\('pointer(?:move|leave)'/);
    assert.doesNotMatch(scene, /--pointer-x|--pointer-y/);
    assert.match(scene, /portrait\.addEventListener\('pointerenter', event => \{ if \(event\.pointerType !== 'touch'\) preview\(true\); \}\)/);
    assert.match(scene, /portrait\.addEventListener\('pointerleave', event => \{ if \(event\.pointerType !== 'touch'\) preview\(false\); \}\)/);
    assert.match(scene, /crossing\.addEventListener\('pointerenter', event => \{ if \(event\.pointerType !== 'touch'\) rampTo\(0\); \}\)/);
    assert.match(scene, /crossing\.addEventListener\('pointerleave', event => \{ if \(event\.pointerType !== 'touch'\) rampTo\(1\); \}\)/);
});

test('projects use bounded media height without brown literal', async () => {
    const css = await read('../style.css');
    const mediaRule = css.match(/\.project-media\s*\{([^}]*)\}/s)?.[1] || '';
    assert.match(mediaRule, /clamp\([^)]*\)/);
    assert.doesNotMatch(css, /#8b5a2b|#a0522d|saddlebrown|brown/i);
});

test('project category has exact compensated ten-pixel title spacing', async () => {
    const css = await read('../style.css');
    const infoRule = css.match(/\.project-info\s*\{([^}]*)\}/s)?.[1] || '';
    const categoryRule = css.match(/\.project-cat\s*\{([^}]*)\}/s)?.[1] || '';
    assert.match(infoRule, /padding:\s*6px\s+16px\s+16px/);
    assert.match(categoryRule, /margin-bottom:\s*10px/);
});

test('footer is a compact strip without giant outlined wordmark', async () => {
    const [html, css] = await Promise.all([read('../index.html'), read('../style.css')]);
    assert.match(html, /class="footer-topline"/);
    assert.doesNotMatch(css, /\.footer::before/);
    const footerRule = css.match(/\.footer\s*\{([^}]*)\}/s)?.[1] || '';
    assert.doesNotMatch(footerRule, /min-height/);
});

test('player uses one hashed R2 audio source and required controls on both pages', async () => {
    for (const path of ['../index.html', '../id/index.html']) {
        const html = await read(path);
        for (const id of ['music-expand', 'music-panel', 'soundtrack-audio', 'music-play', 'music-volume', 'music-time', 'music-minimize', 'music-status']) {
            assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} in ${path}`);
        }
        const audio = html.match(/<audio[^>]+id="soundtrack-audio"[^>]*>/)?.[0] || '';
        assert.match(audio, /preload="none"/);
        assert.match(audio, /data-src="https:\/\/banquet\.arraffi\.com\/portfolio\/assets\/past-life\.657ac7cbae70\.mp3"/);
        assert.doesNotMatch(audio, /\ssrc=/);
        assert.doesNotMatch(html, /id="youtube-player"/);
        assert.match(html, /player\.mjs/);
    }
    const [player, css, headers] = await Promise.all([
        read('../player.mjs'),
        read('../style.css'),
        read('../_headers'),
    ]);
    assert.doesNotMatch(player, /window\.YT|iframe_api|youtube-player/);
    assert.match(player, /fetch\(audio\.dataset\.src/);
    assert.match(player, /URL\.createObjectURL/);
    assert.doesNotMatch(css, /\.youtube-player/);
    assert.doesNotMatch(headers, /youtube\.com|youtube-nocookie\.com|i\.ytimg\.com/);
    assert.match(headers, /media-src 'self' blob: https:\/\/banquet\.arraffi\.com/);
    assert.match(headers, /connect-src[^;]*https:\/\/banquet\.arraffi\.com/);
});

test('scripts load in the same order on both pages', async () => {
    const order = html => [...html.matchAll(/<script[^>]+src="[^"]*?([\w.-]+\.m?js)(?:\?[^"]*)?"/g)].map(match => match[1]);
    const [english, indonesian] = await Promise.all([read('../index.html'), read('../id/index.html')]);
    assert.deepEqual(order(english), order(indonesian));
    assert.deepEqual(order(english), ['theme-init.js', 'loader.js', 'turnstile.js', 'api-client.js', 'app.js', 'scene.mjs', 'player.mjs']);
});

test('both pages use one current cache version for local assets', async () => {
    for (const path of ['../index.html', '../id/index.html']) {
        const html = await read(path);
        const versions = [...html.matchAll(/(?:src|href)="(?:\.\.\/|\.\/)?(?:theme-init|style|loader|turnstile|api-client|app|scene|player)\.(?:css|m?js)\?v=([^"]+)"/g)]
            .map(match => match[1]);
        assert.ok(versions.length >= 7);
        assert.deepEqual(new Set(versions), new Set(['cinematic-9']));
    }
});

test('Turnstile containers are unique and registration stays inside registration content', async () => {
    for (const path of ['../index.html', '../id/index.html']) {
        const html = await read(path);
        assert.equal((html.match(/id="comment-turnstile"/g) || []).length, 1);
        assert.equal((html.match(/id="register-turnstile"/g) || []).length, 1);
        const dialog = html.slice(html.indexOf('id="comment-auth-dialog"'), html.indexOf('</dialog>'));
        assert.match(dialog, /class="[^"]*register-only[^"]*"[^>]*>[\s\S]*id="register-turnstile"/);
        assert.doesNotMatch(html.slice(0, html.indexOf('id="comment-auth-dialog"')), /id="register-turnstile"/);
        assert.doesNotMatch(html, /class="cf-turnstile"/);
    }

    const admin = await read('../admin.html');
    assert.equal((admin.match(/id="admin-turnstile"/g) || []).length, 1);
    assert.doesNotMatch(admin, /class="cf-turnstile"/);
    assert.ok(admin.indexOf('turnstile.js') < admin.indexOf('admin.js'));
});

test('Turnstile uses explicit lazy rendering and never reads global response fields', async () => {
    const [helper, app, admin] = await Promise.all([
        read('../turnstile.js'),
        read('../app.js'),
        read('../admin.js'),
    ]);
    assert.match(helper, /api\.js\?render=explicit/);
    assert.doesNotMatch(app, /cf-turnstile-response|window\.turnstile\.reset\(\s*\)/);
    assert.doesNotMatch(admin, /cf-turnstile-response|window\.turnstile\.reset\(\s*\)/);

    assert.match(app, /render\(['"]comment-turnstile['"][\s\S]*action:\s*['"]comment_post['"]/);
    assert.match(app, /render\(['"]register-turnstile['"][\s\S]*action:\s*['"]comment_register['"]/);
    assert.match(app, /getToken\(['"]comment-turnstile['"]\)/);
    assert.match(app, /getToken\(['"]register-turnstile['"]\)/);
    assert.match(app, /reset\(['"]comment-turnstile['"]\)/);
    assert.match(app, /reset\(['"]register-turnstile['"]\)/);
    assert.match(admin, /render\(['"]admin-turnstile['"][\s\S]*action:\s*['"]admin_login['"]/);
    assert.match(admin, /getToken\(['"]admin-turnstile['"]\)/);
    assert.match(admin, /reset\(['"]admin-turnstile['"]\)/);
});

test('Turnstile helper isolates widgets and ignores unrendered reset or remove', async () => {
    const source = await read('../turnstile.js');
    const calls = [];
    const api = {
        render: (selector, options) => { calls.push(['render', selector, options.action]); return selector; },
        getResponse: widgetId => `${widgetId}-token`,
        reset: widgetId => calls.push(['reset', widgetId]),
        remove: widgetId => calls.push(['remove', widgetId]),
    };
    const context = {
        window: { turnstile: api },
        document: { getElementById: () => ({}), createElement: () => ({}), head: { appendChild: () => {} } },
        Promise,
        Map,
        Error,
    };
    vm.runInNewContext(source, context);
    const helper = context.window.PortfolioTurnstile;

    helper.reset('missing');
    helper.remove('missing');
    await Promise.all([
        helper.render('comment-turnstile', { action: 'comment_post' }),
        helper.render('comment-turnstile', { action: 'comment_post' }),
    ]);
    assert.equal(typeof helper.render('comment-turnstile', { action: 'comment_post' }).then, 'function');
    await helper.render('register-turnstile', { action: 'comment_register' });

    assert.equal(helper.getToken('comment-turnstile'), '#comment-turnstile-token');
    assert.equal(helper.getToken('register-turnstile'), '#register-turnstile-token');
    helper.reset('comment-turnstile');
    helper.remove('register-turnstile');
    assert.deepEqual(calls, [
        ['render', '#comment-turnstile', 'comment_post'],
        ['render', '#register-turnstile', 'comment_register'],
        ['reset', '#comment-turnstile'],
        ['remove', '#register-turnstile'],
    ]);
});

test('SEO head keeps canonical, hreflang, OG image sizing, and CDN preconnect', async () => {
    for (const [path, canonical] of [['../index.html', 'https://arraffi.com/'], ['../id/index.html', 'https://arraffi.com/id/']]) {
        const html = await read(path);
        assert.match(html, new RegExp(`<link rel="canonical" href="${canonical}">`));
        assert.match(html, /hreflang="x-default" href="https:\/\/arraffi\.com\/"/);
        assert.match(html, /hreflang="en" href="https:\/\/arraffi\.com\/"/);
        assert.match(html, /hreflang="id" href="https:\/\/arraffi\.com\/id\/"/);
        assert.match(html, /property="og:image:width" content="560"/);
        assert.match(html, /property="og:image:height" content="695"/);
        assert.match(html, /property="og:image:secure_url"/);
        assert.match(html, /rel="preconnect" href="https:\/\/banquet\.arraffi\.com"/);
    }
});

test('robots and sitemap stay on canonical domain', async () => {
    const robots = await read('../robots.txt');
    assert.match(robots, /User-agent: Googlebot/);
    assert.match(robots, /User-agent: Bingbot/);
    assert.match(robots, /Disallow: \/admin\.html/);
    assert.match(robots, /Sitemap: https:\/\/arraffi\.com\/sitemap\.xml/);
    const sitemap = await read('../sitemap.xml');
    assert.match(sitemap, /<loc>https:\/\/arraffi\.com\/<\/loc>/);
    assert.match(sitemap, /<loc>https:\/\/arraffi\.com\/id\/<\/loc>/);
});

test('CSP script-src carries a hash for each inline JSON-LD block', async () => {
    const { createHash } = await import('node:crypto');
    const headers = await read('../_headers');
    for (const path of ['../index.html', '../id/index.html']) {
        const html = await read(path);
        const body = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
        const digest = createHash('sha256').update(body, 'utf8').digest('base64');
        assert.ok(headers.includes(`'sha256-${digest}'`), `missing CSP hash for ${path}`);
    }
    assert.doesNotMatch(headers, /script-src[^;]*'unsafe-inline'/);
});
