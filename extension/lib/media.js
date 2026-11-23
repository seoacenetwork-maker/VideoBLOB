const blockedHosts = [
  "youtube.com", "youtu.be", "youtube-nocookie.com", "googlevideo.com",
  "netflix.com", "nflxvideo.net", "disneyplus.com", "hulu.com",
  "primevideo.com", "max.com", "peacocktv.com", "paramountplus.com"
];

const videoExtensions = ["mp4", "m4v", "mov", "webm", "ogv", "avi", "mkv", "wmv", "mpg", "mpeg"];
const audioExtensions = ["m4a", "aac", "mp3", "wav", "opus", "ogg", "oga", "flac", "weba"];
const subtitleExtensions = ["vtt", "srt"];

export function allowedHttpUrl(value, base) {
  try {
    const url = new URL(value, base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (blockedHosts.some(domain => host === domain || host.endsWith(`.${domain}`))) return null;
    return url;
  } catch {
    return null;
  }
}

export function hostPattern(value) {
  const url = allowedHttpUrl(value);
  return url ? `${url.protocol}//${url.hostname}/*` : null;
}

export function mediaKind(value, contentType = "", hint = "") {
  if (typeof value === "string" && value.startsWith("blob:") && hint !== "network") return "blob";
  const url = allowedHttpUrl(value);
  if (!url) return "";
  const path = url.pathname.toLowerCase();
  const ext = path.split(".").pop();
  const mime = contentType.toLowerCase().split(";")[0].trim();
  if (ext === "m3u8" || ext === "m3u" || mime.includes("mpegurl")) return "hls";
  if (ext === "mpd" || mime === "application/dash+xml") return "dash";
  if (["ts", "m4s", "cmfv", "cmfa"].includes(ext) || mime === "video/mp2t") return "";
  if (subtitleExtensions.includes(ext) || mime === "text/vtt" || mime === "application/x-subrip") return "subtitle";
  if (audioExtensions.includes(ext) || mime.startsWith("audio/")) return "audio";
  if (videoExtensions.includes(ext) || mime.startsWith("video/")) return "video";
  return ["video", "audio", "subtitle"].includes(hint) ? hint : "";
}

const defaultExtension = { video: "mp4", audio: "m4a", subtitle: "vtt", hls: "ts", dash: "mp4", blob: "webm" };
const mimeExtension = {
  "video/mp4": "mp4", "video/webm": "webm", "video/ogg": "ogv", "video/x-matroska": "mkv",
  "video/quicktime": "mov", "video/mpeg": "mpeg", "audio/mp4": "m4a", "audio/mpeg": "mp3",
  "audio/aac": "aac", "audio/ogg": "ogg", "audio/wav": "wav", "audio/flac": "flac",
  "audio/webm": "weba", "text/vtt": "vtt", "application/x-subrip": "srt"
};

export function fileExtension(kind, url, contentType = "") {
  const ext = allowedHttpUrl(url)?.pathname.toLowerCase().split(".").pop();
  if (kind === "video" && videoExtensions.includes(ext)) return ext;
  if (kind === "audio" && audioExtensions.includes(ext)) return ext;
  if (kind === "subtitle" && subtitleExtensions.includes(ext)) return ext;
  return mimeExtension[contentType.toLowerCase().split(";")[0].trim()] || defaultExtension[kind] || "bin";
}

export function safeName(value, fallback = "video") {
  const cleaned = String(value ?? "")
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "-")
    .trim().replace(/^\.+|[. ]+$/g, "").slice(0, 128);
  if (!cleaned) return fallback;
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned)) return `video-${cleaned}`;
  return cleaned;
}

export function fileNameFor(item, title = "") {
  const url = allowedHttpUrl(item.url);
  let basename = url?.pathname.split("/").filter(Boolean).pop() || "";
  try { basename = decodeURIComponent(basename); } catch { /* retain encoded basename */ }
  const extension = fileExtension(item.kind, item.url, item.contentType);
  const base = safeName(basename.includes(".") ? basename : (title || basename), `videoblob-${item.kind}`);
  return base.toLowerCase().endsWith(`.${extension}`) ? base : `${base}.${extension}`;
}

export function fileNameWithExtension(value, extension, fallback = "videoblob") {
  const name = safeName(value, fallback);
  const stem = name.replace(/\.(?:m3u8?|mpd|mp4|ts|m4a|webm|aac|mp3|vtt|srt|m4v)$/i, "");
  return `${safeName(stem, fallback)}.${extension}`;
}
