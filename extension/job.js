import { allowedHttpUrl, fileNameWithExtension, hostPattern } from "./lib/media.js";
import { hlsOutput, parseHls } from "./lib/hls.js";
import { parseDash } from "./lib/dash.js";

const byId = id => document.getElementById(id);
const progress = byId("progress");
const state = byId("state");
const inspect = byId("inspect");
const start = byId("start");
const authorized = byId("authorized");
const preview = byId("preview-first");
const variantSelect = byId("variant");
const audioSelect = byId("audio");
const captureLimit = 384 * 1024 * 1024;
const playlistLimit = 4 * 1024 * 1024;
const segmentLimit = 10_000;
const fetchConcurrency = 4;
const activeDownloads = new Map();
let job;
let plan;
let pendingPermission;
let operation;
let previewUrl;
let downloadNotes = "";
let downloadInterrupted = false;

class PermissionNeeded extends Error {
  constructor(origins) {
    super("Allow access to the media hosts to continue.");
    this.origins = origins;
  }
}

function status(text, kind = "") {
  state.textContent = text;
  state.dataset.kind = kind;
}

function option(value, label) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

function setProgress(done, total) {
  progress.hidden = false;
  if (total > 0) {
    progress.max = total;
    progress.value = done;
  } else {
    progress.removeAttribute("value");
  }
}

async function requireHosts(urls) {
  const patterns = [...new Set(urls.filter(Boolean).map(url => {
    const pattern = hostPattern(url);
    if (!pattern) throw new Error("A playlist address is unsupported.");
    return pattern;
  }))];
  const checks = await Promise.all(patterns.map(pattern => chrome.permissions.contains({ origins: [pattern] })));
  const missing = patterns.filter((_, index) => !checks[index]);
  if (missing.length) throw new PermissionNeeded(missing);
}

async function readParts(url, { signal, range, limit, memory }) {
  const address = allowedHttpUrl(url);
  if (!address) throw new Error("A playlist address is unsupported.");
  const requestHeaders = range ? { Range: `bytes=${range.start}-${range.end}` } : undefined;
  const response = await fetch(address.href, {
    headers: requestHeaders, signal, credentials: "omit", cache: "no-store",
    referrerPolicy: "no-referrer", redirect: "manual"
  }).catch(error => {
    if (signal.aborted) throw error;
    throw new Error(`Could not reach ${address.hostname}.`);
  });
  if (response.type === "opaqueredirect") throw new Error("The server redirected the request. Open and scan the destination page.");
  if (!response.ok || !response.body) {
    const code = response.status || "unknown";
    throw new Error(`${address.hostname} returned HTTP ${code}.`);
  }
  if (range) {
    const contentRange = response.headers.get("content-range");
    if (response.status !== 206 || !contentRange?.startsWith(`bytes ${range.start}-${range.end}/`)) {
      await response.body.cancel();
      throw new Error("The server did not honor a requested byte range.");
    }
  }
  const reader = response.body.getReader();
  const parts = [];
  let received = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > limit || (memory && memory.bytes + value.byteLength > captureLimit)) {
        await reader.cancel();
        throw new Error(memory ? "This stream exceeded the 384 MiB buffer limit." : "This playlist is larger than 4 MiB.");
      }
      if (memory) memory.bytes += value.byteLength;
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!received || (range && received !== range.end - range.start + 1)) {
    throw new Error("A media response was empty or incomplete.");
  }
  return { parts, url: response.url || address.href };
}

async function readPlaylist(url, signal) {
  await requireHosts([url]);
  const { parts, url: responseUrl } = await readParts(url, { signal, limit: playlistLimit });
  const text = await new Blob(parts).text();
  return job.kind === "dash" ? parseDash(text, responseUrl) : parseHls(text, responseUrl);
}

function configureAudio() {
  const selected = plan?.variants?.[variantSelect.selectedIndex];
  if (job.kind !== "hls" || !selected?.audio?.length) {
    byId("audio-field").hidden = true;
    return;
  }
  byId("audio-field").hidden = false;
  audioSelect.replaceChildren(...selected.audio.map((item, index) => option(index, item.label)));
  const preferred = selected.audio.findIndex(item => item.default);
  audioSelect.selectedIndex = Math.max(0, preferred);
  audioSelect.disabled = selected.audio.length < 2;
}

async function loadPlan(controller) {
  status("Opening playlist…");
  plan = await readPlaylist(job.url, controller.signal);
  const options = plan.variants || [{ label: plan.endList ? "Original quality" : "Original quality · Live" }];
  if (!options.length) throw new Error("This playlist does not list a supported stream.");
  variantSelect.replaceChildren(...options.map((item, index) => option(index, item.label || "Stream")));
  variantSelect.disabled = options.length === 1;
  configureAudio();
  byId("controls").hidden = false;
  status(plan.endList === false ? "Start capturing, then use Save captured to finish." : "Choose a quality and save or preview the stream.");
}

function mapKey(map) {
  return map ? `${map.url}#${map.range?.start ?? ""}-${map.range?.end ?? ""}` : "";
}

function segmentAddresses(segments) {
  return segments.flatMap(segment => [segment.url, segment.map?.url]);
}

async function fetchChunk(segment, context) {
  const { parts: chunk } = await readParts(segment.url, {
    signal: context.signal, range: segment.range, memory: context.memory, limit: captureLimit
  });
  return chunk;
}

function appendParts(target, chunk) {
  for (const part of chunk) target.push(part);
}

async function collectParts(parts, segments, context) {
  for (let first = 0; first < segments.length; first += fetchConcurrency) {
    const batch = segments.slice(first, first + fetchConcurrency);
    const chunks = await Promise.all(batch.map(segment => fetchChunk(segment, context)));
    for (const chunk of chunks) {
      appendParts(parts, chunk);
      reportChunk(context);
    }
  }
}

async function prepareHls(signal) {
  const variant = plan.variants?.[variantSelect.selectedIndex];
  const audioUrl = variant?.audio?.[audioSelect.selectedIndex]?.url;
  const videoUrl = variant?.url || job.url;
  const prepared = await Promise.all([
    readPlaylist(videoUrl, signal),
    audioUrl ? readPlaylist(audioUrl, signal) : null
  ]);
  const tracks = [{ url: videoUrl, playlist: prepared[0], isAudio: false }];
  if (audioUrl) tracks.push({ url: audioUrl, playlist: prepared[1], isAudio: true });
  if (tracks.some(track => track.playlist.type !== "media")) throw new Error("Nested master playlists are not supported.");
  const resources = tracks.flatMap(track => segmentAddresses(track.playlist.segments));
  await requireHosts(resources);
  return tracks;
}

async function wait(milliseconds, signal) {
  signal.throwIfAborted();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    function abort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function collectHls(track, context, onlyFirst) {
  let playlist = track.playlist;
  const output = hlsOutput(playlist, track.isAudio);
  const parts = [];
  const initialMap = mapKey(playlist.segments[0].map);
  let lastSequence = playlist.segments[0].sequence - 1;
  let count = 0;
  if (initialMap) appendParts(parts, await fetchChunk(playlist.segments[0].map, context));
  if (playlist.endList && !onlyFirst && !context.live) {
    if (playlist.segments.length > segmentLimit) throw new Error("The stream exceeded the segment limit.");
    if (playlist.segments.some((segment, index) => mapKey(segment.map) !== initialMap || initialMap && segment.discontinuity && index > 0)) {
      throw new Error("This fragmented stream changes its initialization data or timeline.");
    }
    await collectParts(parts, playlist.segments, context);
    return { ...output, blob: new Blob(parts, { type: output.mimeType }) };
  }
  while (true) {
    const newSegments = playlist.segments.filter(segment => segment.sequence > lastSequence);
    if (newSegments[0]?.sequence > lastSequence + 1) throw new Error("The live playlist advanced before all segments could be saved.");
    await requireHosts(segmentAddresses(onlyFirst ? newSegments.slice(0, 1) : newSegments));
    for (const segment of newSegments) {
      if (context.finish && count > 0) break;
      if (mapKey(segment.map) !== initialMap || initialMap && segment.discontinuity && count > 0) {
        throw new Error("This fragmented stream changes its initialization data or timeline.");
      }
      appendParts(parts, await fetchChunk(segment, context));
      count++;
      lastSequence = segment.sequence;
      reportChunk(context);
      if (onlyFirst) break;
      if (count > segmentLimit) throw new Error("The stream exceeded the segment limit.");
    }
    if (onlyFirst || playlist.endList || context.finish) break;
    await wait(Math.min(4000, Math.max(500, playlist.targetDuration * 500)), context.signal);
    if (context.finish) break;
    playlist = await readPlaylist(track.url, context.signal);
    if (playlist.type !== "media") throw new Error("The live playlist changed to a master playlist.");
  }
  return { ...output, blob: new Blob(parts, { type: output.mimeType }) };
}

function dashOutput(track) {
  return track.mimeType?.startsWith("audio/")
    ? { extension: "m4a", mimeType: "audio/mp4" }
    : { extension: "mp4", mimeType: "video/mp4" };
}

async function collectDash(track, context, onlyFirst) {
  const segments = onlyFirst ? track.segmentUrls.slice(0, 1) : track.segmentUrls;
  if (segments.length > segmentLimit) throw new Error("The stream exceeded the segment limit.");
  const parts = [];
  await collectParts(parts, [track.initUrl, ...segments].filter(Boolean).map(url => ({ url })), context);
  const output = dashOutput(track);
  return { ...output, blob: new Blob(parts, { type: output.mimeType }) };
}

function reportChunk(context) {
  context.done++;
  if (context.live) {
    status(`Captured ${context.done} segments · ${(context.memory.bytes / (1024 * 1024)).toFixed(1)} MiB`);
  } else if (!context.onlyFirst) {
    setProgress(context.done, context.total);
    status(`Fetched ${context.done} of ${context.total} media parts`);
  }
}

function splitTrackNames(outputs) {
  const name = byId("filename").value;
  const stem = fileNameWithExtension(name, outputs[0].extension).replace(/\.[^.]+$/, "");
  return outputs.length === 1
    ? [fileNameWithExtension(stem, outputs[0].extension)]
    : outputs.map((output, index) => fileNameWithExtension(`${stem}-${index ? "audio" : "video"}`, output.extension));
}

async function prepareDownload(outputs, signal) {
  const names = splitTrackNames(outputs);
  for (const [index, item] of outputs.entries()) {
    signal.throwIfAborted();
    const objectUrl = URL.createObjectURL(item.blob);
    try {
      const id = await chrome.downloads.download({
        url: objectUrl, filename: names[index], saveAs: byId("save-as").checked, conflictAction: "uniquify"
      });
      activeDownloads.set(id, objectUrl);
      await checkDownload(id, false);
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
  }
  progress.hidden = true;
  if (downloadInterrupted) status("Chrome interrupted a download. Check Chrome’s downloads.", "error");
  else if (activeDownloads.size) status(`Chrome is saving ${names.join(" and ")}.${downloadNotes}`);
  else status(`Saved ${names.join(" and ")}.${downloadNotes}`, "success");
}

async function checkDownload(id, notify = true) {
  const url = activeDownloads.get(id);
  if (!url) return;
  const [download] = await chrome.downloads.search({ id });
  if (!download || download.state === "in_progress") return;
  URL.revokeObjectURL(url);
  activeDownloads.delete(id);
  if (download.state === "interrupted") {
    downloadInterrupted = true;
    if (notify) status("Chrome interrupted a download. Check Chrome’s downloads.", "error");
  } else if (notify && !activeDownloads.size && !downloadInterrupted) {
    status(`Files saved.${downloadNotes}`, "success");
  }
  if (!operation) setBusy(false);
}

function clearPreview() {
  byId("stream-preview").replaceChildren();
  byId("stream-preview").hidden = true;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}

async function displayPreview(output) {
  if (output.extension === "ts") {
    throw new Error("Chrome cannot preview transport streams. Save the stream or choose an MP4 variant.");
  }
  clearPreview();
  previewUrl = URL.createObjectURL(output.blob);
  const media = document.createElement(output.mimeType.startsWith("audio/") ? "audio" : "video");
  media.src = previewUrl;
  media.controls = true;
  media.preload = "metadata";
  media.addEventListener("error", () => status("Chrome could not play a preview of this format.", "error"));
  byId("stream-preview").appendChild(media);
  byId("stream-preview").hidden = false;
  status("Previewing the first media segment.");
}

async function collectStream(controller, onlyFirst = false) {
  downloadNotes = "";
  downloadInterrupted = false;
  const context = {
    signal: controller.signal, memory: { bytes: 0 }, total: 0, done: 0, live: false, finish: false, onlyFirst
  };
  operation.context = context;
  status(onlyFirst ? "Preparing preview…" : "Checking stream parts…");
  let outputs;
  if (job.kind === "hls") {
    const tracks = await prepareHls(context.signal);
    context.live = !onlyFirst && tracks.some(track => !track.playlist.endList);
    context.total = tracks.reduce((total, track) => total + track.playlist.segments.length, 0);
    if (!onlyFirst) setProgress(0, context.live ? 0 : context.total);
    byId("save-live").hidden = !context.live;
    if (onlyFirst) outputs = [await collectHls(tracks[0], context, true)];
    else if (context.live) outputs = await Promise.all(tracks.map(track => collectHls(track, context, false)));
    else {
      outputs = [];
      for (const track of tracks) outputs.push(await collectHls(track, context, false));
    }
  } else {
    const chosen = plan.variants[variantSelect.selectedIndex];
    const tracks = onlyFirst || !chosen.audio ? [chosen] : [chosen, chosen.audio];
    const urls = tracks.flatMap(track => [track.initUrl, ...(onlyFirst ? track.segmentUrls.slice(0, 1) : track.segmentUrls)]);
    await requireHosts(urls);
    context.total = urls.length;
    if (!onlyFirst) setProgress(0, context.total);
    outputs = [];
    for (const track of tracks) outputs.push(await collectDash(track, context, onlyFirst));
  }
  byId("save-live").hidden = true;
  controller.signal.throwIfAborted();
  if (outputs.length === 2 && outputs.every(output => output.mimeType.endsWith("/mp4"))) {
    try {
      const { combineDash } = await import("./lib/convert.js");
      status("Combining video and audio…");
      const blob = await combineDash(outputs[0].blob, outputs[1].blob, { signal: context.signal });
      outputs = [{ ...outputs[0], blob }];
    } catch {
      context.signal.throwIfAborted();
      downloadNotes = " Audio and video were saved as separate files.";
    }
  }
  if (outputs.length === 1 && outputs[0].extension === "ts") {
    try {
      const { remuxToMp4 } = await import("./lib/convert.js");
      status(onlyFirst ? "Preparing MP4 preview…" : "Preparing MP4…");
      const blob = await remuxToMp4(outputs[0].blob, { signal: context.signal });
      outputs = [{ blob, extension: "mp4", mimeType: "video/mp4" }];
    } catch {
      context.signal.throwIfAborted();
      downloadNotes = " The original MPEG-TS format was kept.";
    }
  }
  if (onlyFirst) await displayPreview(outputs[0]);
  else await prepareDownload(outputs, context.signal);
}

function setBusy(busy) {
  inspect.disabled = busy;
  start.disabled = busy || !authorized.checked || activeDownloads.size > 0;
  preview.disabled = busy;
  variantSelect.disabled = busy || variantSelect.options.length < 2;
  audioSelect.disabled = busy || audioSelect.options.length < 2;
  byId("cancel").hidden = !busy || byId("controls").hidden;
}

async function run(action) {
  if (operation) return;
  const controller = new AbortController();
  operation = { controller };
  setBusy(true);
  byId("permission-panel").hidden = true;
  pendingPermission = null;
  try {
    await action(controller);
  } catch (error) {
    if (controller.signal.aborted) {
      status("Canceled.");
    } else if (error instanceof PermissionNeeded) {
      pendingPermission = { action, origins: error.origins };
      byId("permission-hosts").textContent = error.origins.map(pattern => pattern.replace(/\/\*$/, "")).join(", ");
      byId("permission-panel").hidden = false;
      status(error.message);
    } else {
      status(error?.message || "The stream could not be read.", "error");
    }
    progress.hidden = true;
  } finally {
    controller.abort();
    operation = null;
    byId("save-live").hidden = true;
    byId("save-live").disabled = false;
    setBusy(false);
  }
}

async function grantPermission() {
  if (!pendingPermission) return;
  const { action, origins } = pendingPermission;
  try {
    const granted = await chrome.permissions.request({ origins });
    if (granted) await run(action);
    else status("Chrome did not grant access to the media hosts.", "error");
  } catch {
    status("Could not request access to the media hosts.", "error");
  }
}

async function init() {
  const identifier = location.hash.slice(1);
  if (!/^[\da-f-]{36}$/i.test(identifier)) throw new Error("Open a stream from the VideoBLOB popup.");
  const key = `job:${identifier}`;
  ({ [key]: job } = await chrome.storage.session.get(key));
  await chrome.storage.session.remove(key);
  history.replaceState(null, "", location.pathname);
  const url = allowedHttpUrl(job?.url);
  if (!url || !["hls", "dash"].includes(job.kind) || (job.createdAt && Date.now() - job.createdAt > 600_000)) {
    throw new Error("Open a stream from the VideoBLOB popup.");
  }
  byId("source").textContent = job.kind === "hls" ? "HLS playlist" : "DASH manifest";
  byId("host").textContent = url.hostname;
  byId("filename").value = fileNameWithExtension(job.title, "mp4").replace(/\.mp4$/, "");
  inspect.disabled = false;
  status("Open the playlist to see the available quality options.");
}

inspect.addEventListener("click", () => void run(loadPlan));
byId("grant").addEventListener("click", grantPermission);
variantSelect.addEventListener("change", configureAudio);
start.addEventListener("click", () => void run(collectStream));
preview.addEventListener("click", () => void run(controller => collectStream(controller, true)));
authorized.addEventListener("change", () => setBusy(Boolean(operation)));
byId("cancel").addEventListener("click", () => operation?.controller.abort());
byId("save-live").addEventListener("click", () => {
  if (!operation?.context) return;
  operation.context.finish = true;
  byId("save-live").disabled = true;
  status("Finishing the live capture…");
});
chrome.downloads.onChanged.addListener(change => void checkDownload(change.id));
window.addEventListener("pagehide", () => {
  operation?.controller.abort();
  clearPreview();
});
void init().catch(error => status(error.message, "error"));
