import { allowedHttpUrl } from "./media.js";

function attributes(text) {
  const result = new Map();
  const matcher = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  for (const [, key, raw] of text.matchAll(matcher)) result.set(key, raw.replace(/^"|"$/g, ""));
  return result;
}

function playlistUrl(value, baseUrl) {
  const parsed = allowedHttpUrl(value, baseUrl);
  if (!value || !parsed) throw new Error("The playlist contains an unsupported address.");
  return parsed.href;
}

function rangeFrom(value, previous, url) {
  if (!value) return null;
  const match = /^(\d+)(?:@(\d+))?$/.exec(value);
  if (!match) throw new Error("The playlist contains an invalid byte range.");
  const length = Number(match[1]);
  const offset = match[2] === undefined && previous?.url === url
    ? previous.range?.end + 1
    : Number(match[2]);
  const end = offset + length - 1;
  if (![offset, length, end].every(Number.isSafeInteger) || offset < 0 || length < 1) {
    throw new Error("The playlist contains an invalid byte range.");
  }
  return { start: offset, end };
}

function assertClear(lines) {
  const keys = lines.filter(line => /^#EXT-X-(?:SESSION-)?KEY:/.test(line));
  if (keys.some(line => attributes(line.slice(line.indexOf(":") + 1)).get("METHOD") !== "NONE")) {
    throw new Error("This playlist uses encryption or DRM. Select a clear stream you have permission to save.");
  }
}

function parseMaster(lines, baseUrl) {
  const variants = [];
  const audio = new Map();
  for (const [index, line] of lines.entries()) {
    if (line.startsWith("#EXT-X-MEDIA:")) {
      const props = attributes(line.slice(13));
      const group = props.get("GROUP-ID");
      if (props.get("TYPE") === "AUDIO" && group) {
        const renditions = audio.get(group) || [];
        renditions.push({
          label: props.get("NAME") || props.get("LANGUAGE") || "Audio",
          url: props.has("URI") ? playlistUrl(props.get("URI"), baseUrl) : "",
          default: props.get("DEFAULT") === "YES"
        });
        audio.set(group, renditions);
      }
    }
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;
    const props = attributes(line.slice(18));
    const [width, height] = (props.get("RESOLUTION") || "").split("x").map(Number);
    const bandwidth = Number(props.get("AVERAGE-BANDWIDTH") || props.get("BANDWIDTH")) || 0;
    variants.push({
      id: String(index),
      url: playlistUrl(lines[index + 1]?.startsWith("#") ? "" : lines[index + 1], baseUrl),
      label: [
        Number.isFinite(height) && height > 0 ? `${width}×${height}` : "Stream",
        bandwidth > 0 ? `${(bandwidth / 1_000_000).toFixed(2)} Mb/s` : "",
        props.get("CODECS") || ""
      ].filter(Boolean).join(" · "),
      bandwidth,
      audioGroup: props.get("AUDIO") || ""
    });
  }
  return {
    type: "master",
    variants: variants
      .sort((left, right) => right.bandwidth - left.bandwidth)
      .map(variant => ({ ...variant, audio: audio.get(variant.audioGroup) || [] }))
  };
}

function parseSegments(lines, baseUrl) {
  const segments = [];
  let sequence = 0;
  let targetDuration = 6;
  let duration = 0;
  let previousMap = null;
  let range = "";
  let discontinuity = false;

  for (const line of lines) {
    const colon = line.indexOf(":");
    const tag = colon === -1 ? line : line.slice(0, colon);
    const detail = line.slice(colon + 1);
    switch (tag) {
      case "#EXT-X-MEDIA-SEQUENCE":
        sequence = Number(detail);
        if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("Invalid HLS sequence.");
        break;
      case "#EXT-X-TARGETDURATION":
        targetDuration = Number(detail);
        if (!Number.isFinite(targetDuration) || targetDuration <= 0) throw new Error("Invalid HLS target duration.");
        break;
      case "#EXT-X-MAP": {
        const props = attributes(detail);
        const url = playlistUrl(props.get("URI"), baseUrl);
        previousMap = { url, range: rangeFrom(props.get("BYTERANGE"), previousMap, url) };
        break;
      }
      case "#EXTINF":
        duration = Number(detail.split(",")[0]);
        if (!Number.isFinite(duration) || duration < 0) throw new Error("Invalid HLS segment duration.");
        break;
      case "#EXT-X-BYTERANGE":
        range = detail;
        break;
      case "#EXT-X-DISCONTINUITY":
        discontinuity = true;
        break;
      case "#EXT-X-GAP":
        throw new Error("This playlist declares a missing segment.");
      default:
        if (line.startsWith("#")) break;
        const url = playlistUrl(line, baseUrl);
        segments.push({
          sequence: sequence + segments.length,
          url, duration, range: rangeFrom(range, segments.at(-1), url), map: previousMap, discontinuity
        });
        range = "";
        duration = 0;
        discontinuity = false;
    }
  }

  return {
    type: "media",
    endList: lines.includes("#EXT-X-ENDLIST"),
    targetDuration,
    segments
  };
}

export function parseHls(text, baseUrl) {
  const lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines[0] !== "#EXTM3U") throw new Error("This address did not return an HLS playlist.");
  assertClear(lines);
  if (lines.some(line => line.startsWith("#EXT-X-STREAM-INF:"))) return parseMaster(lines, baseUrl);
  const playlist = parseSegments(lines, baseUrl);
  if (!playlist.segments.length) throw new Error("This playlist has no complete segments.");
  return playlist;
}

export function hlsOutput(track, isAudio = false) {
  const segment = track.segments[0];
  if (segment.map) return isAudio
    ? { extension: "m4a", mimeType: "audio/mp4" }
    : { extension: "mp4", mimeType: "video/mp4" };
  const ext = new URL(segment.url).pathname.toLowerCase().split(".").pop();
  if (ext === "aac") return { extension: "aac", mimeType: "audio/aac" };
  if (ext === "mp3") return { extension: "mp3", mimeType: "audio/mpeg" };
  if (["m4s", "mp4", "cmfv", "cmfa"].includes(ext)) throw new Error("Fragmented HLS needs an initialization segment.");
  return { extension: "ts", mimeType: "video/mp2t" };
}
