import { allowedHttpUrl, fileExtension, fileNameFor, mediaKind, safeName } from "./lib/media.js";

const byId = id => document.getElementById(id);
const status = byId("status");
const results = byId("results");
const watchStatus = byId("watch-status");
const preview = byId("preview");
const downloadIds = new Map();
const nameDrafts = new Map();
let currentTab;
let pageUrl;
let scannedItems = [];
let downloadPoll;
let latestWatchItems = [];

function setStatus(text, kind = "") {
  status.textContent = text;
  status.dataset.kind = kind;
}

function scanPage() {
  if (document.contentType.startsWith("text/html") === false && !document.contentType.startsWith("video/") &&
      !document.contentType.startsWith("audio/") && document.contentType !== "application/xhtml+xml") return [];
  const entries = [];
  const added = new Set();
  const add = (value, hint, contentType, source, encrypted) => {
    if (!value || entries.length >= 100) return;
    try {
      const url = new URL(value, location.href);
      if (!["http:", "https:", "blob:"].includes(url.protocol) || added.has(url.href)) return;
      if (encrypted) {
        entries.push({ url: url.href, encrypted: true });
      } else {
        entries.push({ url: url.href, hint, contentType: contentType || "", source });
      }
      added.add(url.href);
    } catch { /* skip malformed URLs */ }
  };

  const roots = [document];
  for (const root of roots) {
    for (const media of root.querySelectorAll("video, audio")) {
      const kind = media.tagName.toLowerCase();
      const encrypted = Boolean(media.mediaKeys);
      add(media.currentSrc || media.getAttribute("src"), kind, "", "Player", encrypted);
      for (const source of media.querySelectorAll("source[src]")) add(source.src, kind, source.type, "Player", encrypted);
      for (const track of media.querySelectorAll("track[src]")) add(track.src, "subtitle", "text/vtt", "Track");
    }
    for (const link of root.querySelectorAll("a[href]")) {
      if (/\.(?:mp4|m4v|mov|webm|ogv|mkv|m4a|mp3|aac|wav|ogg|opus|flac|vtt|srt|m3u8|mpd)(?:[?#]|$)/i.test(link.href)) {
        add(link.href, "", "", "Link");
      }
      if (entries.length >= 100) break;
    }
    if (roots.length >= 16) continue;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let scanned = 0;
    for (let element = walker.nextNode(); element && scanned < 1500; element = walker.nextNode(), scanned++) {
      if (element.shadowRoot) roots.push(element.shadowRoot);
      if (roots.length >= 16) break;
    }
  }

  for (const entry of performance.getEntriesByType("resource").reverse()) {
    if (!/\.(?:mp4|m4v|mov|webm|ogv|mkv|m4a|mp3|aac|wav|ogg|opus|flac|vtt|srt|m3u8|mpd)(?:[?#]|$)/i.test(entry.name)) continue;
    add(entry.name, "", "", "Resource");
    if (entries.length >= 100) break;
  }
  return entries;
}

function makeButton(label, run, primary = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (primary) button.className = "primary";
  button.addEventListener("click", () => {
    button.disabled = true;
    Promise.resolve().then(run).catch(error => setStatus(error?.message || "This action could not finish.", "error"))
      .finally(() => { button.disabled = false; });
  });
  return button;
}

function displayName(item) {
  if (item.kind === "blob") return "Page-created media";
  if (["hls", "dash"].includes(item.kind)) {
    const url = allowedHttpUrl(item.url);
    try {
      return safeName(decodeURIComponent(url.pathname.split("/").filter(Boolean).pop()), "Playlist");
    } catch {
      return "Playlist";
    }
  }
  return fileNameFor(item, currentTab?.title);
}

function normalDownloadName(value, item) {
  const extension = fileExtension(item.kind, item.url, item.contentType);
  const name = safeName(value, displayName(item));
  return name.toLowerCase().endsWith(`.${extension}`) ? name : `${name}.${extension}`;
}

function itemHost(item) {
  if (item.kind === "blob") return pageUrl.hostname;
  return allowedHttpUrl(item.url)?.hostname || "";
}

function render() {
  const encrypted = new Set(scannedItems.filter(item => item.encrypted).map(item => item.url));
  const combined = new Map();
  for (const item of [...scannedItems, ...latestWatchItems]) {
    if (!item.kind || encrypted.has(item.url)) continue;
    const prior = combined.get(item.url);
    combined.set(item.url, {
      ...prior, ...item,
      source: prior?.source || item.source,
      contentType: item.contentType || prior?.contentType || ""
    });
  }
  results.replaceChildren();
  byId("save-setting").hidden = !Array.from(combined.values()).some(item => ["video", "audio", "subtitle"].includes(item.kind));
  for (const item of Array.from(combined.values()).slice(0, 80)) {
    const article = document.createElement("article");
    article.className = "card result";
    const title = document.createElement("strong");
    title.textContent = displayName(item);
    const description = document.createElement("div");
    description.className = "metadata";
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = item.kind === "subtitle" ? "SUBTITLE" : item.kind.toUpperCase();
    description.append(tag, document.createTextNode(`${item.source} · ${itemHost(item)}`));
    const actions = document.createElement("div");
    actions.className = "actions";
    const name = document.createElement("input");
    name.type = "text";
    name.maxLength = 128;
    const draft = nameDrafts.get(item.url) || {
      value: item.kind === "blob" ? safeName(currentTab.title, "videoblob") : displayName(item),
      hidden: true
    };
    name.value = draft.value;
    name.setAttribute("aria-label", "File name");
    name.hidden = draft.hidden;
    name.addEventListener("input", () => {
      draft.value = name.value;
      nameDrafts.set(item.url, draft);
    });

    const isStream = ["hls", "dash"].includes(item.kind);
    actions.appendChild(makeButton(isStream ? "Open stream" : "Save", () => saveItem(item, name.value), true));
    if (["video", "audio"].includes(item.kind)) actions.appendChild(makeButton("Preview", () => showPreview(item)));
    if (item.kind === "video" && ["mp4", "webm"].includes(fileExtension(item.kind, item.url, item.contentType))) {
      actions.appendChild(makeButton("Save audio", () => openInternal("record", {
        tabId: currentTab.id, title: displayName(item), url: item.url, mode: "audio"
      })));
    }
    if (!isStream) actions.appendChild(makeButton("Name", () => {
      name.hidden = !name.hidden;
      draft.hidden = name.hidden;
      nameDrafts.set(item.url, draft);
      if (!name.hidden) { name.focus(); name.select(); }
    }));
    article.append(title, description, actions, name);
    results.appendChild(article);
  }
}

async function scan() {
  if (!pageUrl) return;
  setStatus("Looking for media…");
  byId("scan").disabled = true;
  try {
    const target = { tabId: currentTab.id, allFrames: true };
    const frames = await chrome.scripting.executeScript({ target, func: scanPage })
      .catch(() => chrome.scripting.executeScript({ target: { tabId: currentTab.id }, func: scanPage }));
    scannedItems = frames.flatMap(frame => (frame.result || [])
      .map(item => ({ ...item, frameId: frame.frameId, kind: mediaKind(item.url, item.contentType, item.hint) }))
      .filter(item => item.encrypted || item.kind && (item.kind !== "blob" || allowedHttpUrl(item.url.slice(5)))));
    if (mediaKind(pageUrl.href)) {
      scannedItems.unshift({ url: pageUrl.href, kind: mediaKind(pageUrl.href), source: "Page" });
    }
    await refreshWatch();
    const count = results.childElementCount;
    if (count) {
      setStatus(`${count} media ${count === 1 ? "source" : "sources"} found`);
    } else if (scannedItems.some(item => item.encrypted)) {
      setStatus("The player uses protected media.", "error");
    } else {
      setStatus("Play the media and scan again, or start Network watch.");
    }
  } catch {
    setStatus("Chrome did not allow VideoBLOB to read this page.", "error");
  } finally {
    byId("scan").disabled = false;
  }
}

async function showPreview(item) {
  const element = document.createElement(item.kind === "audio" ? "audio" : "video");
  element.controls = true;
  element.preload = "metadata";
  element.src = item.url;
  element.addEventListener("error", () => {
    byId("preview-status").textContent = "Chrome could not play a preview from this address.";
  });
  byId("preview-status").textContent = "";
  byId("preview-media").replaceChildren(element);
  preview.showModal();
}

function closePreview() {
  const media = byId("preview-media").firstElementChild;
  if (media) { media.pause(); media.removeAttribute("src"); media.load(); media.remove(); }
}

async function openInternal(type, details) {
  const id = crypto.randomUUID();
  await chrome.storage.session.set({ [`${type}:${id}`]: { ...details, createdAt: Date.now() } });
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL(`${type}.html#${id}`) });
  } catch (error) {
    await chrome.storage.session.remove(`${type}:${id}`);
    throw error;
  }
}

async function downloadPageBlob(url, name) {
  try {
    if (!url.startsWith(`blob:${location.origin}/`)) return "This Blob belongs to another page.";
    const response = await fetch(url);
    if (!response.ok) return "The page has already released this Blob.";
    await response.body?.cancel();
    const mime = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
    const extensions = {
      "video/mp4": "mp4", "video/webm": "webm", "video/ogg": "ogv", "video/quicktime": "mov",
      "audio/mp4": "m4a", "audio/webm": "weba", "audio/mpeg": "mp3", "audio/wav": "wav",
      "audio/ogg": "ogg", "audio/aac": "aac", "audio/flac": "flac", "text/vtt": "vtt"
    };
    const extension = extensions[mime] || "bin";
    const filename = name.toLowerCase().endsWith(`.${extension}`) ? name : `${name}.${extension}`;
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.documentElement.appendChild(link);
    link.click();
    link.remove();
    return "";
  } catch {
    return "This address is a MediaSource stream or its Blob was released. Look for its HLS or DASH playlist.";
  }
}

async function saveItem(item, name) {
  if (["hls", "dash"].includes(item.kind)) {
    await openInternal("job", { kind: item.kind, url: item.url, title: currentTab.title, tabId: currentTab.id });
    return;
  }
  if (item.kind === "blob") {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id, frameIds: [item.frameId] },
      world: "MAIN",
      func: downloadPageBlob,
      args: [item.url, safeName(name)]
    });
    if (result?.result) throw new Error(result.result);
    setStatus("Download requested. Check Chrome’s downloads.", "success");
    return;
  }
  const filename = normalDownloadName(name, item);
  const id = await chrome.downloads.download({
    url: item.url, filename, saveAs: byId("direct-save-as").checked, conflictAction: "uniquify"
  });
  downloadIds.set(id, filename);
  if (!downloadPoll) {
    downloadPoll = setInterval(() => {
      for (const id of downloadIds.keys()) void showDownload({ id }).catch(() => {});
    }, 600);
  }
  setStatus(`Saving ${filename}…`, "success");
  await showDownload({ id });
}

async function showDownload(change) {
  const filename = downloadIds.get(change.id);
  if (!filename) return;
  const [download] = await chrome.downloads.search({ id: change.id });
  if (!download || !downloadIds.has(change.id)) return;
  if (download.state === "complete") {
    setStatus(`Saved ${filename}`, "success");
    downloadIds.delete(change.id);
  } else if (download.state === "interrupted") {
    setStatus("Chrome interrupted the download. Check the downloads panel.", "error");
    downloadIds.delete(change.id);
  } else if (download.totalBytes > 0) {
    setStatus(`Saving ${filename} · ${Math.floor(100 * download.bytesReceived / download.totalBytes)}%`);
  }
  if (!downloadIds.size) {
    clearInterval(downloadPoll);
    downloadPoll = null;
  }
}

async function refreshWatch() {
  if (!currentTab) return;
  const key = `watch:${currentTab.id}`;
  const { [key]: watch } = await chrome.storage.session.get(key);
  const active = watch && watch.origin === pageUrl.origin && watch.expires > Date.now();
  if (watch && watch.expires <= Date.now()) await chrome.storage.session.remove(key);
  latestWatchItems = active ? watch.items : [];
  byId("watch-configure").hidden = Boolean(active);
  byId("watch-stop").hidden = !active;
  if (active) watchStatus.textContent = `Watching · ${latestWatchItems.length} network sources. Play the media or reload this tab.`;
  if (!active && watchStatus.textContent.startsWith("Watching")) watchStatus.textContent = "";
  render();
}

async function init() {
  [currentTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  pageUrl = allowedHttpUrl(currentTab?.url);
  if (currentTab?.id === undefined || !pageUrl) {
    byId("scan").disabled = true;
    byId("network").hidden = true;
    setStatus("Open a supported HTTP or HTTPS media page.");
    return;
  }
  byId("record").disabled = false;
  await refreshWatch();
  if (latestWatchItems.length) {
    byId("network").open = true;
    setStatus(`${latestWatchItems.length} media ${latestWatchItems.length === 1 ? "source" : "sources"} found by Network watch`);
  } else {
    setStatus("Select Scan this tab to find media.");
  }
}

byId("scan").addEventListener("click", scan);
byId("record").addEventListener("click", () => {
  openInternal("record", { tabId: currentTab.id, title: currentTab.title, url: pageUrl.href })
    .catch(() => setStatus("Could not open the recording controls.", "error"));
});
byId("watch-configure").addEventListener("click", () => {
  openInternal("watch", { tabId: currentTab.id, url: pageUrl.origin })
    .catch(() => setStatus("Could not open the network watch settings.", "error"));
});
byId("watch-stop").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "watch:stop", tabId: currentTab.id });
  watchStatus.textContent = "";
  await refreshWatch();
});
byId("dismiss-preview").addEventListener("click", () => preview.close());
preview.addEventListener("close", closePreview);
chrome.downloads.onChanged.addListener(change => void showDownload(change).catch(() => {}));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && pageUrl && changes[`watch:${currentTab.id}`]) void refreshWatch();
});
void init().catch(() => setStatus("Could not open VideoBLOB.", "error"));
