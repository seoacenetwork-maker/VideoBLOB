import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const chromePath = process.env.VIDEOBLOB_CHROME;
const usePregrant = process.argv.includes("--watch-pregranted");
const acceptNativePrompt = process.argv.includes("--watch-native");
if (!chromePath || usePregrant && acceptNativePrompt) {
  throw new Error("Set VIDEOBLOB_CHROME to Chrome for Testing. Choose at most one of --watch-pregranted and --watch-native.");
}

const repo = fileURLToPath(new URL("../", import.meta.url));
const media = join(repo, "test-site/dist/media");
const mp4 = await readFile(join(media, "sample.mp4"));
const webm = await readFile(join(media, "sample.webm"));
const vtt = await readFile(join(media, "napisy-pl.vtt"));
const assets = {
  "/sample.mp4": [mp4, "video/mp4"],
  "/sample.webm": [webm, "video/webm"],
  "/captions.vtt": [vtt, "text/vtt"],
  "/opaque-asset": [mp4, "video/mp4"],
  "/opaque-text": [Buffer.from("hello"), "text/plain"]
};
const fixture = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  const asset = assets[url.pathname];
  if (!asset) {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html><meta charset="utf-8"><title>Popup QA</title>
    <video id="normal" controls src="/sample.mp4"><track src="/captions.vtt" kind="captions" srclang="pl" default></video>
    <video id="blob" controls></video><a href="/sample.webm">WebM</a>`);
    return;
  }
  const [buffer, mime] = asset;
  response.setHeader("content-type", mime);
  response.setHeader("accept-ranges", "bytes");
  const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range || "");
  const first = range ? Number(range[1]) : 0;
  const last = range && range[2] ? Math.min(Number(range[2]), buffer.length - 1) : buffer.length - 1;
  if (range) {
    response.statusCode = 206;
    response.setHeader("content-range", `bytes ${first}-${last}/${buffer.length}`);
  }
  response.setHeader("content-length", last - first + 1);
  response.end(buffer.subarray(first, last+1));
});
await new Promise((resolve, reject) => fixture.listen(0, "127.0.0.1", resolve).once("error", reject));
const origin = `http://127.0.0.1:${fixture.address().port}`;

const working = await mkdtemp(resolve(tmpdir(), "videoblob-popup-"));
const profile = join(working, "profile");
const settings = join(profile, "Default");
await mkdir(settings, { recursive: true });
await writeFile(join(settings, "Preferences"), JSON.stringify({
  download: { default_directory: working, prompt_for_download: false },
  savefile: { default_directory: working }
}));
let extension = resolve(repo, "extension");
if (usePregrant) {
  const original = extension;
  extension = resolve(working, "test-extension");
  await cp(original, extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, "manifest.json"), "utf8"));
  manifest.permissions.push("webRequest");
  manifest.host_permissions = ["http://127.0.0.1/*"];
  delete manifest.optional_permissions;
  await writeFile(join(extension, "manifest.json"), JSON.stringify(manifest), "utf8");
}
const chrome = spawn(chromePath, [
  ...(acceptNativePrompt ? [] : ["--headless=new"]),
  "--remote-debugging-pipe", "--enable-unsafe-extension-debugging",
  `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
  ...(process.env.VIDEOBLOB_QA_NO_SANDBOX === "1"
    ? ["--no-sandbox", "--disable-gpu", "--disable-features=NetworkServiceSandbox"] : []),
  "about:blank"
], { windowsHide: !acceptNativePrompt, stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });

let nextId = 0;
let buffer = "";
const pending = new Map();
chrome.stderr.on("data", data => {
  if (process.env.VIDEOBLOB_QA_VERBOSE) process.stderr.write(data);
});
chrome.stdio[4].setEncoding("utf8");
chrome.stdio[4].on("data", chunk => {
  buffer += chunk;
  while (buffer.includes("\0")) {
    const end = buffer.indexOf("\0");
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    const callback = pending.get(message.id);
    if (!callback) continue;
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(message.error.message));
    else callback.resolve(message.result);
  }
});
function send(method, params = {}, sessionId) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0", error => {
      if (error) {
        pending.delete(id);
        reject(error);
      }
    });
  });
}
chrome.once("exit", code => {
  for (const { reject } of pending.values()) reject(new Error(`Chrome exited (${code})`));
  pending.clear();
});
async function waitFor(check, label, timeout = 6000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const state = await check();
    if (state) return state;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function attach(targetId) {
  return (await send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
}
async function evaluate(sessionId, expression) {
  const output = await send("Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
  if (output.exceptionDetails) throw new Error(output.exceptionDetails.exception?.description || output.exceptionDetails.text);
  return output.result?.value;
}
async function matchesDownload(name, bytes) {
  return waitFor(async () => {
    const entries = await readdir(working);
    if (!entries.includes(name)) return false;
    return (await readFile(join(working, name))).equals(bytes);
  }, name);
}
const timer = setTimeout(() => chrome.kill(), acceptNativePrompt ? 90_000 : 45_000);
try {
  const { id } = await send("Extensions.loadUnpacked", { path: extension });
  console.log("Loaded MV3", id);
  const { targetId } = await send("Target.createTarget", { url: origin });
  await send("Target.activateTarget", { targetId });
  const source = await attach(targetId);
  await waitFor(() => evaluate(source, '!!document.querySelector("#normal")'), "media page");
  console.log("Media tab loaded", targetId);
  const popupTargetInfo = async () => (await send("Target.getTargets")).targetInfos.find(target =>
    target.url === `chrome-extension://${id}/popup.html`);
  const showPopup = async () => {
    const { targetInfos } = await send("Target.getTargets", { filter: [{ type: "tab", exclude: false }] });
    const browserTab = targetInfos.find(target => target.url.startsWith(origin));
    assert.ok(browserTab, JSON.stringify(targetInfos));
    await send("Extensions.triggerAction", { id, targetId: browserTab.targetId });
    console.log("Toolbar action triggered");
    const popupTarget = await waitFor(popupTargetInfo, "toolbar popup");
    const popup = await attach(popupTarget.targetId);
    await waitFor(() => evaluate(popup, 'document.querySelector("#status")?.textContent'), "popup initialized");
    return popup;
  };
  let popup = await showPopup();
  assert.equal(await evaluate(popup, 'document.querySelector("#results").children.length'), 0);
  await evaluate(popup, 'document.querySelector("#scan").click()');
  await waitFor(() => evaluate(popup, 'document.querySelector("#results").children.length >= 3'), "direct media scan");
  const clickResult = (name, action) => evaluate(popup, `
    [...document.querySelectorAll("#results article")].find(card => card.querySelector("strong").textContent === ${JSON.stringify(name)})
      .querySelector("button:nth-of-type(${action})").click()
  `);
  await clickResult("sample.mp4", 2);
  await waitFor(() => evaluate(popup, 'document.querySelector("#preview video")?.readyState > 0'), "MP4 preview metadata");
  await evaluate(popup, 'document.querySelector("#dismiss-preview").click()');
  await clickResult("sample.mp4", 1);
  await matchesDownload("sample.mp4", mp4);
  await clickResult("sample.webm", 4);
  await evaluate(popup, `
    (() => {
      const field = [...document.querySelectorAll("#results article")]
        .find(card => card.querySelector("strong").textContent === "sample.webm").querySelector("input");
      field.value = "named-video.webm";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    })()
  `);
  await clickResult("sample.webm", 1);
  await matchesDownload("named-video.webm", webm);
  await clickResult("captions.vtt", 1);
  await matchesDownload("captions.vtt", vtt);
  console.log("Direct MP4, renamed WebM, VTT and MP4 preview verified");

  await evaluate(source, `(async () => {
    const blob = await (await fetch("/sample.mp4")).blob();
    document.querySelector("#blob").src = URL.createObjectURL(blob);
  })()`);
  await evaluate(popup, 'document.querySelector("#scan").click()');
  await waitFor(() => evaluate(popup, 'document.querySelector("#results").textContent.includes("Page-created media")'), "Blob detection");
  await clickResult("Page-created media", 1);
  await matchesDownload("Popup QA.mp4", mp4);
  console.log("Ordinary page-owned Blob verified");

  await evaluate(popup, 'document.querySelector("#network").open = true; document.querySelector("#watch-configure").click()');
  const configTarget = await waitFor(async () => (await send("Target.getTargets")).targetInfos.find(target =>
    target.url.startsWith(`chrome-extension://${id}/watch.html`)), "standalone network watch configuration");
  const config = await attach(configTarget.targetId);
  await waitFor(() => evaluate(config, 'document.querySelector("#watch-start")?.disabled === false'), "watch start ready");
  console.log("Standalone network watch controls verified");
  if (usePregrant || acceptNativePrompt) {
    await evaluate(config, 'document.querySelector("#watch-start").click()');
    if (acceptNativePrompt) console.log("Allow the Chrome optional permission prompt in the testing window.");
    await waitFor(() => evaluate(config, 'document.querySelector("#watch-status").textContent.includes("Watching")'),
      "network permissions", acceptNativePrompt ? 60_000 : 6000);
    await evaluate(source, 'Promise.all([fetch("/opaque-asset"), fetch("/opaque-text")]).then(async responses => await Promise.all(responses.map(r => r.blob())))');
    const unrelatedTarget = await send("Target.createTarget", { url: origin + "/other-tab" });
    const unrelated = await attach(unrelatedTarget.targetId);
    await waitFor(() => evaluate(unrelated, '!!document.querySelector("#normal")'), "separate tab");
    await evaluate(unrelated, 'fetch("/opaque-asset?from=other-tab").then(response => response.blob())');
    await send("Target.closeTarget", { targetId: unrelatedTarget.targetId });
    await evaluate(config, 'document.querySelector("#watch-back").click()');
    popup = await showPopup();
    await waitFor(() => evaluate(popup, 'document.querySelector("#watch-status").textContent.includes("1 network")'), "MIME watch");
    assert.equal(await evaluate(popup, '[...document.querySelectorAll("#results article")].filter(card => card.textContent.includes("Network")).length'), 1);
    await evaluate(popup, 'document.querySelector("#watch-stop").click()');
    await waitFor(() => evaluate(popup, 'document.querySelector("#watch-configure").hidden === false'), "network watch stop");
    console.log(`MIME-only watch scoped to its tab and Stop verified (${usePregrant ? "localhost pregranted in test copy" : "native optional prompt accepted"})`);
  }
  console.log("Artifacts and browser profile directory", working);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  await Promise.race([send("Browser.close").catch(() => {}), delay(1000)]);
  chrome.kill();
  fixture.closeAllConnections();
  fixture.close();
}
