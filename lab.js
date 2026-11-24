const media = "./media/";
const publicSampleUrl = "https://seoacenetwork-maker.github.io/VideoBLOB/media/sample.mp4";
const urlBlobLimit = 100_000_000;
const videoTypes = new Map([
  ["mp4", "video/mp4"], ["m4v", "video/mp4"], ["webm", "video/webm"],
  ["mov", "video/quicktime"], ["ogv", "video/ogg"], ["mkv", "video/x-matroska"],
]);

const scenarios = {
  mp4: {
    title: "MP4 z napisami",
    summary: "Sprawdź bezpośredni adres wideo i osobną ścieżkę napisów. Napisy włączysz w menu odtwarzacza.",
    variants: [{ path: "sample.mp4", expected: "MP4 i napisy VTT" }],
  },
  webm: {
    title: "Bezpośredni plik WebM",
    summary: "Klip VP9 z dźwiękiem Opus. Rozszerzenie powinno znaleźć bezpośredni adres pliku.",
    variants: [{ path: "sample.webm", expected: "WebM" }],
  },
  blob: {
    title: "Wideo z obiektu Blob",
    summary: "Utwórz tymczasowy adres z klipu testowego, adresu URL albo własnego pliku. Unieważnij go i powtórz skanowanie.",
    variants: [{ path: "sample.mp4", expected: "Blob · wideo" }],
  },
  hls: {
    title: "Strumień HLS VOD",
    summary: "Sprawdź playlistę z dwiema rozdzielczościami oraz wariant z segmentami MPEG-TS. Próbki są jawne i kończą się po ośmiu sekundach.",
    variants: [
      { path: "hls/master.m3u8", label: "Playlisty fMP4 · 360p i 180p", expected: "HLS z dwiema jakościami" },
      { path: "hls/ts/index.m3u8", label: "Playlista MPEG-TS · 360p", expected: "HLS MPEG-TS" },
      { path: "hls/live/index.m3u8", label: "MPEG-TS · symulacja live", expected: "HLS live · zatrzymaj i zapisz" },
    ],
  },
  dash: {
    title: "Strumień MPEG-DASH",
    summary: "Sprawdź statyczny manifest z segmentami fMP4. Możesz wybrać próbkę z osobnymi ścieżkami wideo i audio lub samo wideo.",
    variants: [
      { path: "dash/av/manifest.mpd", label: "Wideo i osobna ścieżka audio", expected: "DASH · obraz i dźwięk" },
      { path: "dash/video/manifest.mpd", label: "Sama ścieżka wideo", expected: "DASH · obraz" },
    ],
  },
};

const selectedCase = new URL(location.href).searchParams.get("case");
const activeCase = Object.hasOwn(scenarios, selectedCase) ? selectedCase : "mp4";
const scenario = scenarios[activeCase];
const byId = (id) => document.getElementById(id);
const video = byId("preview");
const variant = byId("variant");
const chooseFile = byId("file");
const importForm = byId("blob-import");
const sourceInput = byId("source-url");
const importButton = byId("import-url");
const exampleButton = byId("example-url");
const importError = byId("blob-import-error");
const loadButton = byId("load");
const revokeButton = byId("revoke");
const status = byId("status");
const events = byId("events");
const resource = byId("resource");
const displayedBlob = byId("blob-url");
const numberForms = new Intl.PluralRules("pl");
let run;
let objectUrl;

document.querySelector(`[data-case=${activeCase}]`).setAttribute("aria-current", "page");
byId("case-title").textContent = scenario.title;
byId("case-summary").textContent = scenario.summary;
byId("local").hidden = activeCase !== "blob";
importForm.hidden = activeCase !== "blob";
byId("options").hidden = scenario.variants.length === 1;

for (const sample of scenario.variants) {
  variant.add(new Option(sample.label ?? sample.expected, sample.path));
}

function sampleUrl() {
  return new URL(media + variant.value, location.href);
}

function updateResource() {
  const sample = scenario.variants[variant.selectedIndex];
  byId("expected").textContent = sample.expected;
  resource.href = sampleUrl();
  resource.textContent = sampleUrl().pathname;
  resource.hidden = activeCase === "blob";
  displayedBlob.hidden = activeCase !== "blob";
  displayedBlob.textContent = "Adres powstanie po wczytaniu próbki.";
}

function setStatus(state, text) {
  status.dataset.state = state;
  status.textContent = text;
}

function log(message) {
  byId("empty-events").hidden = true;
  const row = document.createElement("li");
  const time = document.createElement("time");
  const now = new Date();
  time.dateTime = now.toISOString();
  time.textContent = now.toLocaleTimeString("pl-PL");
  const detail = document.createElement("span");
  detail.textContent = message;
  row.append(time, detail);
  events.append(row);
}

function segmentCount(total) {
  const forms = { one: "segment", few: "segmenty", many: "segmentów" };
  return `${total} ${forms[numberForms.select(total)]}`;
}

function clearPreview() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = undefined;
  }
  video.pause();
  video.removeAttribute("src");
  video.replaceChildren();
  video.preload = "none";
  video.load();
  revokeButton.hidden = true;
  updateResource();
}

function resetPreview() {
  run?.abort();
  run = undefined;
  clearPreview();
}

function onMedia(target, name, signal) {
  return new Promise((resolve, reject) => {
    const listeners = new AbortController();
    function finish(error) {
      listeners.abort();
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    }
    const abort = () => finish(new DOMException("Przerwano test.", "AbortError"));
    if (signal.aborted) {
      abort();
      return;
    }
    const options = { once: true, signal: listeners.signal };
    target.addEventListener(name, () => finish(), options);
    target.addEventListener("error", () => finish(new Error("Przeglądarka odrzuciła próbkę wideo.")), options);
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function get(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status} dla ${new URL(url).pathname}`);
  return response;
}

async function attachSource(src, signal) {
  const loaded = onMedia(video, "loadedmetadata", signal);
  video.preload = "metadata";
  video.src = src;
  video.load();
  await loaded;
  log(`Metadane gotowe · ${video.videoWidth} × ${video.videoHeight} · ${video.duration.toFixed(2)} s`);
}

async function loadDirect(signal) {
  if (activeCase === "mp4") {
    const track = document.createElement("track");
    Object.assign(track, { kind: "subtitles", label: "Polski", srclang: "pl", src: media + "napisy-pl.vtt", default: true });
    video.append(track);
    log("Dodano ścieżkę napisów VTT.");
  }
  await attachSource(sampleUrl(), signal);
}

function parseBlobSource(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Wpisz pełny adres URL pliku wideo.");
  }
  if (url.protocol === "blob:" && url.origin === location.origin) return url;
  if (url.protocol === "blob:") throw new Error("Adres Blob musi być dostępny w tej samej witrynie i sesji przeglądarki.");
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Użyj adresu HTTP, HTTPS lub dostępnego tutaj adresu blob:.");
  if (url.username || url.password) throw new Error("Adres URL nie może zawierać loginu ani hasła.");
  return url;
}

function responseVideoType(response) {
  const suppliedType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (suppliedType?.startsWith("video/")) return suppliedType;
  if (!suppliedType || suppliedType === "application/octet-stream" || suppliedType === "application/ogg") {
    const extension = new URL(response.url).pathname.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
    return videoTypes.get(extension);
  }
  return undefined;
}

async function readUrlBlob(value, signal) {
  const url = parseBlobSource(value);
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(45_000)]);
  let response;
  try {
    response = await fetch(url, { signal: requestSignal, mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" });
  } catch {
    requestSignal.throwIfAborted();
    if (url.protocol === "blob:") throw new Error("Adres Blob jest nieaktywny lub niedostępny w tej karcie.");
    throw new Error("Nie udało się pobrać pliku. Sprawdź adres, HTTPS oraz ustawienia CORS serwera.");
  }

  const limitError = "Plik przekracza limit 100 MB.";
  const type = responseVideoType(response);
  let problem;
  if (!response.ok || response.status === 206) problem = `Serwer nie zwrócił pełnego pliku (HTTP ${response.status}).`;
  else if (!response.body || response.headers.get("content-length") === "0") problem = "Plik wideo jest pusty.";
  else if (Number(response.headers.get("content-length")) > urlBlobLimit) problem = limitError;
  else if (!type) problem = "Ten adres nie zwrócił pliku wideo. Wklej bezpośredni adres pliku, np. MP4 lub WebM.";
  if (problem) {
    void response.body?.cancel().catch(() => {});
    throw new Error(problem);
  }

  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value: part } = await reader.read();
      if (done) break;
      size += part.byteLength;
      if (size > urlBlobLimit) {
        void reader.cancel().catch(() => {});
        throw new Error(limitError);
      }
      parts.push(part);
    }
  } catch (error) {
    requestSignal.throwIfAborted();
    if (error instanceof TypeError) throw new Error("Połączenie zostało przerwane przed ukończeniem pobierania.");
    throw error;
  } finally {
    reader.releaseLock();
  }

  return new Blob(parts, { type });
}

async function loadBlob(signal, { file, url }) {
  const blob = url ? await readUrlBlob(url, signal) : file ?? await (await get(sampleUrl(), signal)).blob();
  if (signal.aborted) return;
  if (!blob.size) throw new Error("Plik wideo jest pusty.");
  clearPreview();
  objectUrl = URL.createObjectURL(blob);
  displayedBlob.textContent = objectUrl;
  revokeButton.hidden = false;
  log(`Utworzono adres Blob · ${blob.size.toLocaleString("pl-PL")} B`);
  await attachSource(objectUrl, signal);
}

function relativeTo(url, entries) {
  return entries.map((entry) => new URL(entry, url));
}

function playlistEntries(body) {
  return body.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
}

async function bytes(url, signal) {
  return (await get(url, signal)).arrayBuffer();
}

async function appendTrack(source, track, signal) {
  const output = source.addSourceBuffer(track.mime);
  for (const segment of track.segments) {
    const data = await bytes(segment, signal);
    const appended = onMedia(output, "updateend", signal);
    output.appendBuffer(data);
    await appended;
  }
}

async function loadAdaptive(tracks, signal) {
  if (!window.MediaSource || !tracks.every(({ mime }) => MediaSource.isTypeSupported(mime))) {
    await Promise.all(tracks.flatMap(({ segments }) => segments.map((segment) => bytes(segment, signal))));
    log("Pobrano segmenty do testu. Ta przeglądarka nie obsługuje podglądu użytych kodeków.");
    return;
  }
  const source = new MediaSource();
  const opened = onMedia(source, "sourceopen", signal);
  objectUrl = URL.createObjectURL(source);
  video.preload = "auto";
  video.src = objectUrl;
  await opened;
  await Promise.all(tracks.map((track) => appendTrack(source, track, signal)));
  source.endOfStream();
  const total = tracks.reduce((count, track) => count + track.segments.length - 1, 0);
  log(`Odtwarzacz otrzymał ${segmentCount(total)}.`);
}

async function loadHls(signal) {
  const origin = sampleUrl();
  const playlist = await (await get(origin, signal)).text();
  log(`Wczytano playlistę ${origin.pathname}.`);
  const variants = relativeTo(origin, playlistEntries(playlist));

  if (!playlist.includes("#EXT-X-STREAM-INF:")) {
    if (!playlist.includes("#EXT-X-ENDLIST")) log("Symulacja live: playlista bez znacznika końca ma stałe segmenty.");
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      await attachSource(origin, signal);
    } else {
      await Promise.all(variants.map((segment) => bytes(segment, signal)));
      log(`Pobrano ${segmentCount(variants.length)} MPEG-TS. Próbka jest gotowa do skanowania.`);
    }
    return;
  }

  const [preferred] = variants;
  log(`Playlista wskazuje ${variants.length} rozdzielczości.`);
  const stream = await (await get(preferred, signal)).text();
  const [, initialization] = stream.match(/#EXT-X-MAP:URI="([^"]+)"/) ?? [];
  if (!initialization) throw new Error("W playliście brakuje adresu segmentu inicjalizacyjnego.");
  await loadAdaptive([{
    mime: 'video/mp4; codecs="avc1.42c01e,mp4a.40.2"',
    segments: relativeTo(preferred, [initialization, ...playlistEntries(stream)]),
  }], signal);
}

function dashTracks(document, origin) {
  return [...document.querySelectorAll("Representation")].map((representation) => {
    const id = representation.getAttribute("id");
    const mime = `${representation.getAttribute("mimeType")}; codecs="${representation.getAttribute("codecs")}"`;
    const template = representation.querySelector("SegmentTemplate");
    const initialization = template.getAttribute("initialization").replaceAll("$RepresentationID$", id);
    const pattern = template.getAttribute("media").replaceAll("$RepresentationID$", id);
    let number = Number(template.getAttribute("startNumber") ?? 1);
    const entries = [initialization];
    for (const interval of template.querySelectorAll("SegmentTimeline > S")) {
      const repeat = Number(interval.getAttribute("r") ?? 0);
      for (let index = 0; index <= repeat; index += 1) {
        entries.push(pattern.replace(/\$Number(?:%0(\d+)d)?\$/g, (_, width) => String(number).padStart(Number(width ?? 0), "0")));
        number += 1;
      }
    }
    return { mime, segments: relativeTo(origin, entries) };
  });
}

async function loadDash(signal) {
  const url = sampleUrl();
  const manifest = await (await get(url, signal)).text();
  log(`Wczytano manifest ${url.pathname}.`);
  const xml = new DOMParser().parseFromString(manifest, "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("Nie można odczytać manifestu MPD.");
  const tracks = dashTracks(xml, url);
  if (!tracks.length) throw new Error("Manifest nie zawiera ścieżek.");
  log(`Manifest wskazuje ${tracks.length === 1 ? "jedną ścieżkę" : "osobne ścieżki wideo i audio"}.`);
  await loadAdaptive(tracks, signal);
}

async function start(blobSource = {}) {
  run?.abort();
  if (activeCase !== "blob") clearPreview();
  const controller = new AbortController();
  run = controller;
  const controls = [loadButton, chooseFile, variant, sourceInput, importButton, exampleButton];
  for (const control of controls) control.disabled = true;
  importError.hidden = true;
  importError.textContent = "";
  setStatus("loading", "Wczytywanie");
  log(blobSource.url ? "Rozpoczęto pobieranie pliku z URL." : "Uruchomiono próbkę.");
  try {
    const signal = controller.signal;
    switch (activeCase) {
      case "blob": await loadBlob(signal, blobSource); break;
      case "hls": await loadHls(signal); break;
      case "dash": await loadDash(signal); break;
      default: await loadDirect(signal);
    }
    if (run === controller) setStatus("ready", "Gotowe do skanu");
  } catch (error) {
    if (error.name !== "AbortError") {
      setStatus("error", "Błąd próbki");
      const message = error.name === "TimeoutError" ? "Pobieranie wideo nie zakończyło się w ciągu 45 sekund." : error.message;
      log(message);
      if (blobSource.url) {
        importError.textContent = message;
        importError.hidden = false;
      }
    }
  } finally {
    if (run === controller || !run) {
      for (const control of controls) control.disabled = false;
    }
  }
}

loadButton.addEventListener("click", () => start());
chooseFile.addEventListener("change", () => {
  if (chooseFile.files[0]) start({ file: chooseFile.files[0] });
});
importForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const url = sourceInput.value.trim();
  if (url) start({ url });
});
exampleButton.addEventListener("click", () => {
  sourceInput.value = location.hostname.endsWith(".chatgpt.site") ? publicSampleUrl : sampleUrl().href;
  sourceInput.focus();
});
revokeButton.addEventListener("click", () => {
  resetPreview();
  chooseFile.value = "";
  setStatus("idle", "Unieważniono");
  displayedBlob.textContent = "Ten adres jest już nieaktywny.";
  log("Unieważniono adres Blob i usunięto go z odtwarzacza.");
});
variant.addEventListener("change", () => {
  resetPreview();
  setStatus("idle", "Oczekuje");
});
window.addEventListener("pagehide", (event) => {
  if (!event.persisted) {
    run?.abort();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
});
updateResource();
