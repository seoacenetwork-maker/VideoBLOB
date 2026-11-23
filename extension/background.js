import { allowedHttpUrl, mediaKind } from "./lib/media.js";

const watchTtl = 10 * 60 * 1000;
const queues = new Map();

function inOrder(tabId, run) {
  const pending = (queues.get(tabId) || Promise.resolve()).catch(() => {}).then(run);
  queues.set(tabId, pending);
  pending.finally(() => {
    if (queues.get(tabId) === pending) queues.delete(tabId);
  }).catch(() => {});
  return pending;
}

function capture(details) {
  if (details.tabId < 0 || ![200, 206].includes(details.statusCode)) return;
  void inOrder(details.tabId, async () => {
    const key = `watch:${details.tabId}`;
    const { [key]: watch } = await chrome.storage.session.get(key);
    if (!watch) return;
    if (Date.now() >= watch.expires) {
      await chrome.storage.session.remove(key);
      return;
    }
    const url = allowedHttpUrl(details.url);
    if (!url || !watch.origins.includes(url.origin) || (details.initiator && !allowedHttpUrl(details.initiator))) return;
    const contentType = details.responseHeaders?.find(header => header.name.toLowerCase() === "content-type")?.value || "";
    const kind = mediaKind(url.href, contentType, "network");
    if (!kind || mimeIsHtml(contentType)) return;
    if (watch.items.some(item => item.url === url.href)) return;
    watch.items.unshift({ url: url.href, kind, contentType, source: "Network" });
    watch.items.length = Math.min(watch.items.length, 80);
    await chrome.storage.session.set({ [key]: watch });
  }).catch(() => {});
}

function mimeIsHtml(value) {
  return /^(?:text\/html|application\/xhtml\+xml)(?:[;\s]|$)/i.test(value);
}

function attach() {
  const event = chrome.webRequest?.onHeadersReceived;
  if (!event || event.hasListener(capture)) return;
  event.addListener(capture, {
    urls: ["http://*/*", "https://*/*"],
    types: ["media", "xmlhttprequest", "other"]
  }, ["responseHeaders"]);
}

attach();
chrome.permissions.onAdded.addListener(attach);

chrome.tabs.onRemoved.addListener(tabId => {
  void inOrder(tabId, () => chrome.storage.session.remove(`watch:${tabId}`)).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status !== "loading" && !change.url) return;
  void inOrder(tabId, async () => {
    const key = `watch:${tabId}`;
    const { [key]: watch } = await chrome.storage.session.get(key);
    if (!watch) return;
    const url = allowedHttpUrl(change.url || tab.url);
    if (url?.origin !== watch.origin || Date.now() >= watch.expires) {
      await chrome.storage.session.remove(key);
    }
  }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) return false;
  if (!Number.isInteger(message?.tabId) || !["watch:start", "watch:stop"].includes(message.type)) return false;
  const key = `watch:${message.tabId}`;
  void inOrder(message.tabId, async () => {
    if (message.type === "watch:stop") {
      await chrome.storage.session.remove(key);
      return { ok: true };
    }
    const tab = await chrome.tabs.get(message.tabId);
    const url = allowedHttpUrl(tab.url);
    if (!url || url.origin !== message.origin) return { ok: false };
    const origins = [...new Set([url.origin, ...message.origins])].slice(0, 20);
    await chrome.storage.session.set({
      [key]: { origin: url.origin, origins, expires: Date.now() + watchTtl, items: [] }
    });
    return { ok: true };
  }).then(sendResponse, () => sendResponse({ ok: false }));
  return true;
});
