import { allowedHttpUrl, fileNameWithExtension, hostPattern, safeName } from './lib/media.js';
import { recordPlayer } from './lib/record-player.js';

const limit = 256 * 1024 * 1024;
const id = location.hash.slice(1);
const byId = name => document.getElementById(name);
const start = byId('start');
const save = byId('save');
const cancel = byId('cancel');
const filename = byId('filename');
const consent = byId('consent');
const progress = byId('progress');
const message = byId('message');
let pulse;
let abort;
let busy = false;

const key = `record:${id}`;
const request = /^[a-f0-9-]{36}$/.test(id) ? (await chrome.storage.session.get(key))[key] : null;
const source = request && Date.now() - (request.createdAt || 0) < 600_000 && allowedHttpUrl(request.url);
if (request) await chrome.storage.session.remove(key);
if (id) history.replaceState(null, '', location.pathname);

function buttons(state) {
  busy = ['recording', 'saving', 'ready', 'converting'].includes(state);
  const capture = ['recording', 'ready'].includes(state);
  start.disabled = busy || !consent.checked || !source;
  save.hidden = !capture;
  cancel.hidden = !busy || state === 'saving';
  progress.hidden = state !== 'converting';
  consent.disabled = busy;
}

async function send(command, name = '') {
  const tab = await chrome.tabs.get(request.tabId);
  const tabUrl = allowedHttpUrl(tab.url);
  if (!tabUrl || tabUrl.origin !== source.origin || tabUrl.pathname !== source.pathname ||
      tabUrl.search !== source.search) {
    throw new Error('The source tab changed. Open the extension on that page again.');
  }
  const [reply] = await chrome.scripting.executeScript({
    target: { tabId: request.tabId },
    func: recordPlayer,
    args: [command, id, request.mediaUrl || '', name],
  });
  if (!reply?.result) throw new Error('The browser could not contact the source player.');
  return reply.result;
}

function showCapture(result) {
  buttons(result.state);
  if (result.state === 'recording') {
    const elapsed = Math.max(0, Math.floor((Date.now() - result.startedAt) / 1000));
    const minutes = Math.floor(elapsed / 60);
    const seconds = String(elapsed % 60).padStart(2, '0');
    message.textContent = `Recording · ${minutes}:${seconds}`;
  } else if (result.state === 'ready') {
    message.textContent = 'Recording ready. Save it within one minute.';
  } else if (result.state === 'saving') {
    message.textContent = 'Finishing the recording…';
  } else {
    clearTimeout(pulse);
    message.textContent = result.message || ({
      completed: 'Recording sent to Chrome Downloads.',
      discarded: 'Recording discarded.',
      inactive: 'The recording is no longer active.',
    })[result.state] || 'Recording stopped.';
  }
  if (busy) {
    clearTimeout(pulse);
    pulse = setTimeout(async () => {
      try { showCapture(await send('pulse')); }
      catch (error) {
        buttons('inactive');
        message.textContent = error.message;
      }
    }, 800);
  }
}

async function fetchInput(signal) {
  const response = await fetch(source.href, {
    signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
  });
  if (!response.ok || !response.body) throw new Error(`Media server returned HTTP ${response.status}.`);
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Input exceeds 256 MiB.');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error('Input exceeds 256 MiB.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return new Blob(chunks);
}

async function startAudio() {
  buttons('converting');
  progress.removeAttribute('value');
  cancel.textContent = 'Cancel';
  message.textContent = 'Waiting for access to the media host…';
  abort = new AbortController();
  try {
    const granted = await chrome.permissions.request({ origins: [hostPattern(source.href)] });
    if (!granted) throw new Error('Access to the media host was declined.');
    message.textContent = 'Reading source media…';
    const { extractAudio } = await import('./lib/convert.js');
    const input = await fetchInput(abort.signal);
    message.textContent = 'Extracting audio locally…';
    const output = await extractAudio(input, {
      signal: abort.signal,
      onProgress: value => { progress.value = value; },
    });
    const url = URL.createObjectURL(output);
    try {
      await chrome.downloads.download({
        url, filename: fileNameWithExtension(filename.value, 'm4a'), saveAs: byId('save-as').checked,
        conflictAction: 'uniquify',
      });
      message.textContent = 'Audio sent to Chrome Downloads.';
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  } catch (error) {
    message.textContent = abort.signal.aborted ? 'Extraction cancelled.' : error.message;
  } finally {
    abort = null;
    buttons('inactive');
  }
}

if (!source) {
  message.textContent = 'Open this tool from the VideoBLOB popup on a supported website.';
} else {
  const audio = request.mode === 'audio';
  byId('save-location').hidden = !audio;
  byId('task').textContent = audio ? 'Extract audio' : 'Record player';
  byId('context').textContent = source.hostname;
  byId('help').textContent = audio
    ? 'Create an M4A from a readable MP4 or WebM. Your browser needs a compatible AAC encoder for audio that requires conversion.'
    : 'Start playback in the source tab, then start recording here. This records that player while it runs. Limit of 15 minutes or 256 MiB.';
  filename.value = safeName(request.title, audio ? 'videoblob-audio' : 'videoblob-recording')
    .replace(/\.(mp4|webm|m4a)$/i, '');
  start.textContent = audio ? 'Extract M4A' : 'Start recording';
  consent.addEventListener('change', () => { start.disabled = busy || !consent.checked; });
  start.addEventListener('click', async () => {
    if (!consent.checked || busy) return;
    if (audio) {
      await startAudio();
      return;
    }
    start.disabled = true;
    try { showCapture(await send('start')); }
    catch (error) {
      message.textContent = error.message;
      buttons('inactive');
    }
  });
  save.addEventListener('click', async () => {
    try { showCapture(await send('save', safeName(filename.value, 'videoblob-recording'))); }
    catch (error) { message.textContent = error.message; }
  });
  cancel.addEventListener('click', async () => {
    if (audio) {
      abort?.abort();
      return;
    }
    try { showCapture(await send('discard')); }
    catch (error) { message.textContent = error.message; }
  });
}
