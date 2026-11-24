import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BlobSource, Input, MP4, WEBM } from '../extension/vendor/mediabunny.mjs';

const { chromium } = await import(process.env.VIDEOBLOB_PLAYWRIGHT
  ? pathToFileURL(resolve(process.env.VIDEOBLOB_PLAYWRIGHT)).href
  : 'playwright-core');
const extensionPath = fileURLToPath(new URL('../extension', import.meta.url));
const sitePath = fileURLToPath(new URL('../test-site/dist', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'videoblob-chrome-'));
const screenshots = process.env.VIDEOBLOB_SCREENSHOTS;
const types = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.vtt': 'text/vtt', '.jpg': 'image/jpeg', '.ts': 'video/mp2t',
  '.mpd': 'application/dash+xml', '.m3u8': 'application/vnd.apple.mpegurl',
};
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  const file = resolve(sitePath, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(sitePath + sep)) return response.writeHead(404).end();
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)], 'Content-Length': body.length });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
const errors = [];
const seenDownloads = new Set();
let context;
let driver;
let extensionId;
let origin;
let fixtureHost;

async function boot(path, profile) {
  context = await chromium.launchPersistentContext(join(scratch, profile), {
    executablePath: process.env.VIDEOBLOB_CHROME,
    headless: true,
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required'],
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const cdp = await context.browser().newBrowserCDPSession();
  await cdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow', downloadPath: join(scratch, 'downloads'), eventsEnabled: true,
  });
  ({ id: extensionId } = await cdp.send('Extensions.loadUnpacked', { path }));
  assert.ok((await cdp.send('Extensions.getExtensions')).extensions.some(extension => (
    extension.id === extensionId && extension.enabled
  )));
  driver = context.pages()[0];
  await driver.goto(`chrome-extension://${extensionId}/record.html`);
}

async function openTool(kind, request) {
  const id = randomUUID();
  await driver.evaluate(({ id, kind, request }) => (
    chrome.storage.session.set({ [`${kind}:${id}`]: request })
  ), { id, kind, request: { createdAt: Date.now(), ...request } });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${kind}.html#${id}`);
  return page;
}

async function inspect(kind, pathname, title) {
  const page = await openTool('job', { kind, url: origin + pathname, title });
  await page.locator('#inspect').click();
  return page;
}

async function awaitDownload(name) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const downloads = await driver.evaluate(() => chrome.downloads.search({ state: 'complete' }));
    const download = downloads.find(item => !seenDownloads.has(item.id));
    if (download) {
      seenDownloads.add(download.id);
      const filename = download.filename;
      assert.ok(filename.endsWith(extname(name)), `Unexpected download format for ${name}: ${filename}`);
      const contents = await readFile(filename);
      assert.ok(contents.length > 1000, `${name} has ${contents.length} bytes`);
      return contents;
    }
    await delay(150);
  }
  const seen = await driver.evaluate(async () => (
    (await chrome.downloads.search({})).map(({ filename, state, error }) => ({ filename, state, error }))
  ));
  throw new Error(`Chrome did not finish saving ${name}. Download records: ${JSON.stringify(seen)}`);
}

async function assertMedia(contents, trackTypes, durationRange = [7.8, 8.3]) {
  const input = new Input({ source: new BlobSource(new Blob([contents])), formats: [MP4, WEBM] });
  try {
    const tracks = await input.getTracks();
    assert.deepEqual(tracks.map(track => track.type).sort(), [...trackTypes].sort());
    const duration = await input.computeDuration();
    assert.ok(duration >= durationRange[0] && duration <= durationRange[1], `Duration ${duration}`);
    assert.ok(await tracks[0].getCodec());
  } finally {
    input.dispose();
  }
}

async function checkStatus(page, selector, pattern) {
  try {
    await page.waitForFunction(({ selector, pattern }) => (
      new RegExp(pattern).test(document.querySelector(selector).textContent)
    ), { selector, pattern: pattern.source }, { timeout: 12_000 });
  } catch (error) {
    throw new Error(`${selector} expected ${pattern} but received "${await page.locator(selector).textContent()}"`, { cause: error });
  }
}

async function screenshot(page, name) {
  if (screenshots) await page.screenshot({ path: join(screenshots, name) });
}

async function saveJob(page, name) {
  await page.locator('#authorized').check();
  await page.locator('#start').click();
  await checkStatus(page, '#state', /^(?:Saved |Files saved)/);
  return awaitDownload(name);
}

try {
  await new Promise((ready, reject) => server.once('error', reject).listen(0, '127.0.0.1', ready));
  origin = (process.env.VIDEOBLOB_FIXTURE_SITE || `http://127.0.0.1:${server.address().port}`).replace(/\/$/, '');
  fixtureHost = new URL(origin);
  if (screenshots) await mkdir(screenshots, { recursive: true });

  await boot(extensionPath, 'exact-release');
  const consent = await inspect('hls', '/media/hls/master.m3u8', 'consent');
  await consent.locator('#grant').waitFor({ state: 'visible' });
  assert.ok((await consent.locator('#permission-hosts').textContent()).includes(fixtureHost.hostname));
  assert.equal(await consent.locator('#controls').isVisible(), false);
  console.log('PASS exact release loads in Chrome and asks for a specific media origin');
  await context.close();
  context = null;

  // The browser's native permission dialogue is outside DOM automation. Install
  // a test-only manifest with access to the local fixture server for media flows.
  const testExtension = join(scratch, 'extension');
  await cp(extensionPath, testExtension, { recursive: true });
  const manifestPath = join(testExtension, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = [`${fixtureHost.protocol}//${fixtureHost.hostname}/*`];
  await writeFile(manifestPath, JSON.stringify(manifest));
  await boot(testExtension, 'local-fixtures');

  const hls = await inspect('hls', '/media/hls/master.m3u8', 'VideoBLOB HLS');
  await hls.locator('#controls').waitFor({ state: 'visible' });
  assert.equal(await hls.locator('#variant option').count(), 2);
  await hls.locator('#variant').selectOption({ index: 1 });
  await hls.locator('#preview-first').click();
  await hls.locator('#stream-preview video').waitFor();
  await hls.waitForFunction(() => document.querySelector('#stream-preview video')?.videoWidth > 0);
  await hls.locator('#stream-preview video').evaluate(async video => {
    await video.play();
    await new Promise(ready => video.requestVideoFrameCallback(ready));
    video.pause();
    video.blur();
  });
  await screenshot(hls, '01-hls-preview.png');
  await assertMedia(await saveJob(hls, 'VideoBLOB HLS.mp4'), ['video', 'audio']);
  console.log('PASS HLS fMP4 quality selection, preview and downloaded MP4');

  const ts = await inspect('hls', '/media/hls/ts/index.m3u8', 'VideoBLOB TS');
  await assertMedia(await saveJob(ts, 'VideoBLOB TS.mp4'), ['video', 'audio']);
  console.log('PASS HLS MPEG-TS export to MP4');

  const live = await inspect('hls', '/media/hls/live/index.m3u8', 'VideoBLOB live');
  await live.locator('#authorized').check();
  await live.locator('#start').click();
  await checkStatus(live, '#state', /Captured 4 segments/);
  await live.locator('#save-live').click();
  await checkStatus(live, '#state', /^(?:Saved |Files saved)/);
  await assertMedia(await awaitDownload('VideoBLOB live.mp4'), ['video', 'audio']);
  console.log('PASS simulated HLS live capture and Save captured');

  const dash = await inspect('dash', '/media/dash/av/manifest.mpd', 'VideoBLOB DASH');
  await dash.locator('#controls').waitFor({ state: 'visible' });
  assert.equal(await dash.locator('#variant option').count(), 2);
  await assertMedia(await saveJob(dash, 'VideoBLOB DASH.mp4'), ['video', 'audio']);
  await screenshot(dash, '02-dash-download.png');
  const dashAudio = await inspect('dash', '/media/dash/av/manifest.mpd', 'VideoBLOB DASH audio');
  await dashAudio.locator('#variant').selectOption({ index: 1 });
  await assertMedia(await saveJob(dashAudio, 'VideoBLOB DASH audio.m4a'), ['audio']);
  console.log('PASS DASH video + audio multiplexing and standalone audio');

  const parserChecks = await driver.evaluate(async () => {
    const { parseDash } = await import('/lib/dash.js');
    const { parseHls } = await import('/lib/hls.js');
    const rejects = (callback, pattern) => {
      try { callback(); return false; }
      catch (error) { return pattern.test(error.message); }
    };
    const template = [
      '<MPD mediaPresentationDuration="PT6S"><BaseURL>../assets/</BaseURL>',
      '<Period><AdaptationSet mimeType="video/mp4">',
      '<SegmentTemplate timescale="2" startNumber="4" initialization="$RepresentationID$-init.mp4"',
      'media="$RepresentationID$-$$-$Number%02d$-$Time$.m4s">',
      '<SegmentTimeline><S d="4" r="-1"/></SegmentTimeline></SegmentTemplate>',
      '<Representation id="stream" width="640" height="360"/></AdaptationSet></Period></MPD>',
    ].join(' ');
    const source = 'https://example.invalid/manifests/test.mpd';
    const parsed = parseDash(template, source).variants[0];
    return {
      protectedDash: rejects(() => parseDash('<MPD><ContentProtection/></MPD>', source), /DRM/),
      protectedHls: rejects(() => parseHls('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES\n#EXTINF:2,\na.ts', 'https://example.invalid/a.m3u8'), /encrypt|protect/i),
      invalidXML: rejects(() => parseDash('<MPD><Period></MPD>', source), /invalid/i),
      liveDash: rejects(() => parseDash('<MPD type="dynamic"/>', source), /on-demand/),
      init: parsed.initUrl,
      segments: parsed.segmentUrls,
    };
  });
  assert.deepEqual(parserChecks, {
    protectedDash: true, protectedHls: true, invalidXML: true, liveDash: true,
    init: 'https://example.invalid/assets/stream-init.mp4',
    segments: [0, 4, 8].map((time, index) => `https://example.invalid/assets/stream-$-0${index + 4}-${time}.m4s`),
  });
  console.log('PASS parser bounds, inherited DASH templates and protected playback rejection');

  const audio = await openTool('record', {
    mode: 'audio', title: 'VideoBLOB extracted', url: origin + '/media/sample.mp4',
  });
  await audio.locator('#consent').check();
  await audio.locator('#start').click();
  await checkStatus(audio, '#message', /Audio sent to Chrome Downloads/);
  await assertMedia(await awaitDownload('VideoBLOB extracted.m4a'), ['audio']);
  console.log('PASS extraction of an M4A from an AAC-equipped MP4');

  const fixture = await context.newPage();
  await fixture.goto(origin + '/?case=blob');
  await fixture.getByLabel('Adres URL pliku wideo').fill(origin + '/media/sample.mp4');
  await fixture.getByRole('button', { name: 'Utwórz Blob z URL' }).click();
  await fixture.waitForFunction(() => document.querySelector('#preview')?.readyState >= 2);
  const urlBlob = await fixture.locator('#preview').evaluate(async video => {
    const source = video.currentSrc;
    const response = await fetch(source);
    const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
    const sha = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return { source, mime: response.headers.get('content-type'), sha };
  });
  assert.match(urlBlob.source, /^blob:/);
  assert.equal(urlBlob.mime, 'video/mp4');
  assert.equal(urlBlob.sha, createHash('sha256').update(await readFile(join(sitePath, 'media/sample.mp4'))).digest('hex'));
  console.log('PASS lab creates a byte-identical playable Blob from a video URL');
  const tabId = await driver.evaluate(async url => (await chrome.tabs.query({ url }))[0].id, fixture.url());
  const record = await openTool('record', { title: 'VideoBLOB recorded', url: fixture.url(), tabId });
  await record.locator('#consent').check();
  await fixture.locator('#preview').evaluate(video => video.play());
  await record.locator('#start').click();
  await checkStatus(record, '#message', /^Recording ·/);
  await checkStatus(record, '#message', /^Recording · 0:02/);
  const recording = fixture.waitForEvent('download', { timeout: 10_000 });
  await record.locator('#save').click();
  await checkStatus(record, '#message', /Recording sent to Chrome Downloads/);
  const recordedFile = await recording;
  assert.match(recordedFile.suggestedFilename(), /^VideoBLOB recorded\.(mp4|webm)$/);
  await assertMedia(await awaitDownload(recordedFile.suggestedFilename()), ['video', 'audio'], [1, 5]);
  console.log('PASS active Blob video capture with both picture and audio');
  assert.deepEqual(errors, []);
} finally {
  if (context) await context.close();
  server.close();
  await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
}
