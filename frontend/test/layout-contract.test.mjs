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

test('admin uses compact workspace navigation, status, and mobile controls', async () => {
    const [html, css, script] = await Promise.all([
        read('../admin.html'),
        read('../admin.css'),
        read('../admin.js'),
    ]);

    assert.match(html, /class="admin-sidebar"/);
    assert.match(html, /class="admin-mobile-nav"/);
    assert.match(html, /id="dashboard-status"/);
    assert.match(html, /data-action="refresh"/);
    assert.match(html, /aria-label="Projects"/);
    assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.admin-sidebar\s*\{[^}]*display:\s*none/s);
    assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.admin-mobile-nav\s*\{[^}]*display:\s*grid/s);
    assert.match(script, /action === 'refresh'/);
    assert.match(script, /function renderDashboardMeta\(\)/);
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
        assert.deepEqual(new Set(versions), new Set(['cinematic-11']));
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
    assert.match(admin, /Complete Turnstile verification before signing in/);
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

test('profile copy uses Arraffi AMF and Konaima alias', async () => {
    const [english, indonesian, manifest] = await Promise.all([
        read('../index.html'),
        read('../id/index.html'),
        read('../site.webmanifest'),
    ]);

    assert.match(english, /Arraffi AMF — Junior Backend Engineer/);
    assert.match(english, /"name": "Arraffi AMF"/);
    assert.match(english, /"alternateName": "Konaima"/);
    assert.match(english, /I'm Arraffi AMF, known online as Konaima,/);
    assert.match(english, /<dd>Junior Backend Engineer<\/dd>/);

    assert.match(indonesian, /Arraffi AMF — Junior Backend Engineer/);
    assert.match(indonesian, /"name": "Arraffi AMF"/);
    assert.match(indonesian, /"alternateName": "Konaima"/);
    assert.match(indonesian, /Saya Arraffi AMF, dikenal online sebagai Konaima,/);
    assert.match(indonesian, /<dd>Junior Backend Engineer<\/dd>/);

    assert.match(manifest, /Arraffi AMF — Junior Backend Engineer/);
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

test('admin keeps local API host equal to local page host', async () => {
    const script = await read('../admin.js');
    assert.match(script, /const isLocalHost = location\.hostname === '127\.0\.0\.1' \|\| location\.hostname === 'localhost';/);
    assert.match(script, /isLocalHost \? `http:\/\/\$\{location\.hostname\}:3001\/api` : PROD_API/);
});

test('admin renders workspace before slow section fetches settle', async () => {
    const script = await read('../admin.js');
    assert.match(script, /state\.loggedIn = true;\s*password\.value = '';\s*render\(\);\s*await fetchAll\(\);/s);
});

test('admin editor uses a grouped workbench layout and switch button', async () => {
    const [script, css] = await Promise.all([read('../admin.js'), read('../admin.css')]);
    assert.match(script, /class="editor-layout editor-layout-project"/);
    assert.match(script, /class="editor-main"/);
    assert.match(script, /class="editor-aside"/);
    assert.match(script, /class="toggle-row" type="button" role="switch"/);
    assert.match(script, /data-width-switch/);
    assert.match(script, /<input[^>]*name="full_width"[^>]*type="hidden"/);
    assert.match(script, /widthSwitch\.addEventListener\('click'/);
    assert.match(script, /return `<div class="field"><label><span>\$\{esc\(label\)\}<\/span>\$\{isText/);
    assert.doesNotMatch(script, /class="check-label"/);
    assert.doesNotMatch(script, /type="checkbox"/);
    assert.match(script, /class="[^"]*modal-close[^"]*"[^>]*aria-label="Close editor"/);
    assert.match(script, /root\.setAttribute\('role', 'dialog'\);/);
    assert.match(script, /root\.removeAttribute\('role'\);/);

    assert.match(css, /\.edit-form\s*\{[^}]*display:\s*grid[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/s);
    assert.match(css, /\.editor-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(260px,\s*\.52fr\)/s);
    assert.match(css, /\.editor-aside\s*\{[^}]*border-left:/s);
    assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.editor-layout\s*\{[^}]*grid-template-columns:\s*1fr/s);
    assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.editor-aside\s*\{[^}]*border-left:\s*0/s);
});

test('payment page is a server-readable QRIS utility with verified recipient copy', async () => {
    const html = await read('../payment/index.html');
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<title>Pay Arraffi with QRIS<\/title>/);
    assert.match(html, /<link rel="canonical" href="https:\/\/arraffi\.com\/payment\/">/);
    assert.match(html, /property="og:url" content="https:\/\/arraffi\.com\/payment\/"/);
    assert.match(html, /property="og:image:width" content="1200"/);
    assert.match(html, /property="og:image:height" content="630"/);
    assert.match(html, /payment-preview\.765b695a549b\.webp/);
    assert.match(html, /payment-qris\.841c36ba666e\.jpg/);
    assert.match(html, />ArraffiPay</);
    assert.match(html, /Verify that your payment application shows <strong>ArraffiPay<\/strong> before confirming/);
    assert.match(html, /Pastikan nama penerima yang tampil adalah <strong>ArraffiPay<\/strong>/);
    assert.match(html, /id="payment-share"/);
    assert.match(html, /id="payment-share-status"[^>]*role="status"[^>]*aria-live="polite"/);
    assert.match(html, /href="https:\/\/banquet\.arraffi\.com\/portfolio\/assets\/payment-qris\.841c36ba666e\.jpg"/);
    assert.equal((html.match(/href="\.\.\/"/g) || []).length, 3);
    assert.doesNotMatch(html, /href="\/"/);
    assert.doesNotMatch(html, /<form\b|<input\b|name="amount"|invoice_id|payment_success|transaction_id/i);
    assert.doesNotMatch(html, /privacy|terms/i);
});

test('payment route has canonical redirects, cache policy, sitemap entry, and footer discovery', async () => {
    const [redirects, headers, sitemap, english, indonesian] = await Promise.all([
        read('../_redirects'),
        read('../_headers'),
        read('../sitemap.xml'),
        read('../index.html'),
        read('../id/index.html'),
    ]);
    assert.match(redirects, /^\/pay\s+\/payment\/\s+301$/m);
    assert.match(redirects, /^\/payment\s+\/payment\/\s+301$/m);
    assert.match(headers, /\/payment\/\s+Cache-Control: public, max-age=0, must-revalidate/s);
    assert.match(sitemap, /<loc>https:\/\/arraffi\.com\/payment\/<\/loc>/);
    assert.match(english, /href="\/payment\/">Payment<\/a>/);
    assert.match(indonesian, /href="\/payment\/">Pembayaran<\/a>/);
});

test('payment JSON-LD has a matching CSP hash', async () => {
    const { createHash } = await import('node:crypto');
    const [headers, payment] = await Promise.all([read('../_headers'), read('../payment/index.html')]);
    const body = payment.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
    const digest = createHash('sha256').update(body, 'utf8').digest('base64');
    assert.ok(headers.includes(`'sha256-${digest}'`), 'missing CSP hash for payment JSON-LD');
});

test('shared frontend cache version advances consistently after viewer styling', async () => {
    for (const path of ['../index.html', '../id/index.html', '../payment/index.html']) {
        const html = await read(path);
        assert.match(html, /style\.css\?v=cinematic-11/);
    }
    for (const path of ['../index.html', '../id/index.html']) {
        const html = await read(path);
        assert.doesNotMatch(html, /cinematic-10/);
    }
});

test('payment utility links keep touch targets at least 44 pixels high', async () => {
    const css = await read('../style.css');
    assert.match(css, /\.payment-header \.nav-brand,\s*\.payment-support a,\s*\.payment-footer a\s*\{[^}]*display:\s*inline-flex[^}]*min-height:\s*44px[^}]*align-items:\s*center/s);
});

test('payment image failure hides the broken image before showing recovery copy', async () => {
    const css = await read('../style.css');
    assert.match(css, /\.payment-visual img\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
});

test('payment verification translations keep normal-text contrast', async () => {
    const css = await read('../style.css');
    assert.match(css, /\.payment-warning p \+ p\s*\{[^}]*color:\s*var\(--ink\)/s);
});

test('payment QR has two progressive image-viewer triggers', async () => {
    const html = await read('../payment/index.html');
    assert.equal((html.match(/data-payment-viewer-open/g) || []).length, 2);
    assert.equal((html.match(/data-payment-viewer-open[^>]*href="https:\/\/banquet\.arraffi\.com\/portfolio\/assets\/payment-qris\.841c36ba666e\.jpg"/g) || []).length, 2);
    assert.match(html, /data-payment-viewer-open[^>]*aria-label="Open ArraffiPay QRIS image viewer"/);
    assert.match(html, /class="payment-viewer-hint"[^>]*>Click to enlarge</);
    assert.match(html, />View full QR<\/a>/);
});

test('payment viewer uses a labelled native dialog with complete controls', async () => {
    const html = await read('../payment/index.html');
    assert.match(html, /<dialog id="payment-viewer"[^>]*aria-labelledby="payment-viewer-title"/);
    assert.match(html, /id="payment-viewer-title"[^>]*>ArraffiPay QRIS</);
    assert.match(html, /id="payment-viewer-stage"/);
    assert.match(html, /id="payment-viewer-image"/);
    assert.match(html, /id="payment-viewer-zoom-out"/);
    assert.match(html, /id="payment-viewer-zoom"[^>]*role="status"[^>]*aria-live="polite"/);
    assert.match(html, /id="payment-viewer-zoom-in"/);
    assert.match(html, /id="payment-viewer-reset"/);
    assert.match(html, /id="payment-viewer-close"/);
    assert.match(html, /class="payment-viewer-original"[^>]*href="https:\/\/banquet\.arraffi\.com\/portfolio\/assets\/payment-qris\.841c36ba666e\.jpg"/);
});

test('payment viewer leaves social-preview metadata unchanged', async () => {
    const html = await read('../payment/index.html');
    assert.match(html, /name="twitter:card" content="summary_large_image"/);
    assert.match(html, /payment-preview\.765b695a549b\.webp/);
    assert.match(html, /property="og:image:width" content="1200"/);
    assert.match(html, /property="og:image:height" content="630"/);
});

test('payment viewer CSS owns gestures, modality, and hidden state', async () => {
    const css = await read('../style.css');
    assert.match(css, /\.payment-viewer-stage\s*\{[^}]*touch-action:\s*none/s);
    assert.match(css, /\.payment-viewer:not\(\[open\]\)\s*\{[^}]*display:\s*none/s);
    assert.match(css, /\.payment-viewer-image\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s);
    assert.match(css, /body\.payment-viewer-open\s*\{[^}]*overflow:\s*hidden/s);
    assert.match(css, /\.payment-viewer-control\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s);
    assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.payment-viewer-image\s*\{[^}]*transition:\s*none/s);
});

test('payment viewer fits the intrinsic QR dimensions before applying zoom', async () => {
    const script = await read('../payment.js');
    const css = await read('../style.css');
    assert.match(
        script,
        /viewerFitSize\(\s*image\.naturalWidth,\s*image\.naturalHeight,\s*stage\.clientWidth,\s*stage\.clientHeight,\s*32\s*\)/s
    );
    assert.match(script, /image\.style\.width\s*=\s*`\$\{size\.width\}px`/);
    assert.match(script, /image\.style\.height\s*=\s*`\$\{size\.height\}px`/);
    assert.ok((script.match(/syncBaseSize\(\)/g) || []).length >= 3);
    assert.match(css, /\.payment-viewer-image\s*\{[^}]*max-width:\s*none[^}]*max-height:\s*none/s);
    assert.doesNotMatch(css, /\.payment-viewer-image\s*\{[^}]*max-height:\s*calc\(100% - 32px\)/s);
});

test('payment viewer enables safe areas and gates hover feedback to precise pointers', async () => {
    const html = await read('../payment/index.html');
    const css = await read('../style.css');
    assert.match(html, /name="viewport" content="[^"]*viewport-fit=cover[^"]*"/);
    assert.doesNotMatch(html, /name="viewport" content="[^"]*(?:user-scalable=no|maximum-scale=1)[^"]*"/);
    assert.match(
        css,
        /@media \(hover:\s*hover\) and \(pointer:\s*fine\)\s*\{[\s\S]*\.payment-visual:hover[\s\S]*\.payment-viewer-control:hover[\s\S]*\.payment-viewer-original:hover[\s\S]*\}/
    );
    assert.doesNotMatch(css, /\.payment-viewer-control:hover,\s*\.payment-viewer-control:focus-visible/);
});

test('viewer release advances shared frontend cache version consistently', async () => {
    for (const path of ['../index.html', '../id/index.html', '../payment/index.html']) {
        const html = await read(path);
        assert.match(html, /cinematic-11/);
        assert.doesNotMatch(html, /cinematic-10/);
    }
});
