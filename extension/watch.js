import { allowedHttpUrl, hostPattern } from "./lib/media.js";

const byId = id => document.getElementById(id);
const extraHosts = new Map();
const start = byId("watch-start");
const status = byId("watch-status");
let pageUrl;
let tabId;

function renderHosts() {
  const hostList = byId("watch-hosts");
  hostList.replaceChildren();
  for (const origin of extraHosts.keys()) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `Remove ${origin}`;
    button.addEventListener("click", () => { extraHosts.delete(origin); renderHosts(); });
    hostList.appendChild(button);
  }
}

function addHost(event) {
  event.preventDefault();
  const input = byId("watch-host");
  const value = input.value.trim();
  if (!value || !pageUrl) return;
  const url = allowedHttpUrl(value.includes("://") ? value : `${pageUrl.protocol}//${value}`);
  if (!url || extraHosts.size >= 15) {
    status.textContent = "Enter an HTTP or HTTPS media hostname. You can add up to 15.";
    return;
  }
  if (url.origin !== pageUrl.origin) extraHosts.set(url.origin, hostPattern(url.href));
  input.value = "";
  status.textContent = "";
  renderHosts();
}

async function startWatch() {
  const origins = [...new Set([hostPattern(pageUrl.href), ...extraHosts.values()])];
  start.disabled = true;
  try {
    const granted = await chrome.permissions.request({ permissions: ["webRequest"], origins });
    if (!granted) {
      status.textContent = "Chrome did not grant access to the selected hosts.";
      return;
    }
    const response = await chrome.runtime.sendMessage({
      type: "watch:start", tabId, origin: pageUrl.origin, origins: [...extraHosts.keys()]
    });
    if (!response?.ok) throw new Error("The media tab no longer matches this site.");
    byId("add-host").hidden = true;
    byId("watch-hosts").hidden = true;
    byId("watch-back").hidden = false;
    start.hidden = true;
    status.textContent = "Watching. Play the media or reload the tab and open VideoBLOB to see its sources.";
    status.dataset.kind = "success";
  } catch (error) {
    status.textContent = error?.message || "Could not start the network watch.";
  } finally {
    start.disabled = false;
  }
}

async function init() {
  const identifier = location.hash.slice(1);
  const message = "Open Network watch from the VideoBLOB popup.";
  if (!/^[\da-f-]{36}$/i.test(identifier)) throw new Error(message);
  const key = `watch:${identifier}`;
  const { [key]: request } = await chrome.storage.session.get(key);
  await chrome.storage.session.remove(key);
  history.replaceState(null, "", location.pathname);
  pageUrl = allowedHttpUrl(request?.url);
  tabId = request?.tabId;
  if (!pageUrl || !Number.isInteger(tabId) || Date.now() - request.createdAt > 60_000) throw new Error(message);
  byId("watch-site").textContent = pageUrl.host;
  start.disabled = false;
}

byId("add-host").addEventListener("submit", addHost);
start.addEventListener("click", startWatch);
byId("watch-back").addEventListener("click", async () => {
  try {
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    status.textContent = "The media tab has been closed.";
    status.dataset.kind = "error";
  }
});
void init().catch(error => { status.textContent = error.message; });
