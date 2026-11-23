const MAX_XML_BYTES = 2 * 1024 * 1024;
const MAX_SEGMENTS = 10_000;
const MAX_REPRESENTATIONS = 128;

function children(element, name) {
  return Array.from(element.children).filter(child => child.localName === name);
}

function first(element, name) {
  return children(element, name)[0];
}

function integer(value, fallback, minimum = 0) {
  if (value === null || value === undefined) return fallback;
  if (!/^-?\d+$/.test(value)) throw new Error('Invalid DASH integer.');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error('DASH integer out of range.');
  return parsed;
}

function seconds(value) {
  if (!value) return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/.exec(value);
  if (!match || !match.slice(1).some(Boolean)) throw new Error('Unsupported DASH duration.');
  const [, days = 0, hours = 0, minutes = 0, remainder = '0'] = match;
  const duration = Number(days) * 86400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(remainder.replace(',', '.'));
  if (!Number.isFinite(duration)) throw new Error('Invalid DASH duration.');
  return duration;
}

function resolve(value, base) {
  if (!value) throw new Error('Missing DASH resource URL.');
  const url = new URL(value, base);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('DASH resource must use HTTP or HTTPS without credentials.');
  }
  return url.href;
}

function inheritedBase(elements, documentUrl) {
  return elements.reduce((base, element) => {
    const value = first(element, 'BaseURL')?.textContent.trim();
    return value ? resolve(value, base) : base;
  }, resolve(documentUrl));
}

function inheritedAttribute(elements, attribute) {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const value = elements[index].getAttribute(attribute);
    if (value !== null) return value;
  }
  return null;
}

function fillTemplate(template, values) {
  const token = /\$\$|\$(RepresentationID|Number|Bandwidth|Time)(?:%0(\d{1,2})d)?\$/y;
  let output = '';
  let offset = 0;
  while (offset < template.length) {
    const next = template.indexOf('$', offset);
    if (next < 0) return output + template.slice(offset);
    output += template.slice(offset, next);
    token.lastIndex = next;
    const match = token.exec(template);
    if (!match) throw new Error('Unsupported DASH template expression.');
    const [placeholder, key, padding] = match;
    const value = values[key];
    if (placeholder === '$$') output += '$';
    else {
      if (value === undefined || value === null || (padding && key === 'RepresentationID')) {
        throw new Error('Missing DASH template value.');
      }
      output += String(value).padStart(Number(padding || 0), '0');
    }
    offset = token.lastIndex;
  }
  return output;
}

function timelineEntries(timeline, durationUnits, offset, startNumber, endNumber) {
  const entries = children(timeline, 'S');
  const segments = [];
  let previousEnd = 0;
  let number = startNumber;
  for (const [index, entry] of entries.entries()) {
    if (entry.hasAttribute('n')) throw new Error('DASH timeline with per-entry numbering is unsupported.');
    const start = integer(entry.getAttribute('t'), previousEnd);
    const duration = integer(entry.getAttribute('d'), 0, 1);
    if (!duration || start < previousEnd) throw new Error('Invalid DASH segment timeline.');
    const repeat = integer(entry.getAttribute('r'), 0, -1);
    let count = repeat + 1;
    if (repeat === -1) {
      const next = entries[index + 1];
      const limit = next
        ? integer(next.getAttribute('t'), null)
        : durationUnits === null ? null : durationUnits + offset;
      if (limit === null || limit <= start) throw new Error('Unbounded DASH segment timeline.');
      count = Math.ceil((limit - start) / duration);
    }
    if (endNumber !== null) count = Math.min(count, endNumber - number + 1);
    if (count < 1) break;
    previousEnd = start + count * duration;
    if (segments.length + count > MAX_SEGMENTS || !Number.isSafeInteger(previousEnd) ||
        !Number.isSafeInteger(number + count)) throw new Error('DASH segment limit exceeded.');
    for (let index = 0; index < count; index += 1) {
      segments.push({ Time: start + index * duration, Number: number + index });
    }
    number += count;
  }
  return segments;
}

function templateTrack(templates, base, durationSeconds, values) {
  const read = attribute => inheritedAttribute(templates, attribute);
  const initialization = read('initialization');
  const media = read('media');
  if (!initialization || !media || !/\$(?:Number|Time)(?:%0\d{1,2}d)?\$/.test(media)) {
    throw new Error('Unsupported DASH segment template.');
  }
  const timescale = integer(read('timescale'), 1, 1);
  const offset = integer(read('presentationTimeOffset'), 0);
  const start = integer(read('startNumber'), 1);
  const end = integer(read('endNumber'), null);
  const durationUnits = durationSeconds === null ? null : Math.round(durationSeconds * timescale);
  if (durationUnits !== null && !Number.isSafeInteger(durationUnits)) throw new Error('DASH duration out of range.');
  const timeline = templates.map(element => first(element, 'SegmentTimeline')).filter(Boolean).at(-1);
  let segments;
  if (timeline) {
    segments = timelineEntries(timeline, durationUnits, offset, start, end);
  } else {
    const duration = integer(read('duration'), 0, 1);
    if (read('eptDelta') !== null) throw new Error('DASH simple addressing with eptDelta is unsupported.');
    if (!duration || (durationUnits === null && end === null)) throw new Error('Unbounded DASH segment template.');
    let count = durationUnits === null ? end - start + 1 : Math.ceil(durationUnits / duration);
    if (end !== null) count = Math.min(count, end - start + 1);
    if (count > MAX_SEGMENTS || !Number.isSafeInteger(start + count) ||
      !Number.isSafeInteger(count * duration)) throw new Error('DASH segment limit exceeded.');
    segments = Array.from({ length: Math.max(0, count) }, (_, index) => ({
      Number: start + index,
      Time: index * duration,
    }));
  }
  return {
    initUrl: resolve(fillTemplate(initialization, { ...values, Number: start, Time: segments[0]?.Time }), base),
    segmentUrls: segments.map(segment => resolve(fillTemplate(media, { ...values, ...segment }), base)),
  };
}

function listTrack(lists, base) {
  const initialization = lists.map(element => first(element, 'Initialization')).filter(Boolean).at(-1);
  const segments = lists.map(element => children(element, 'SegmentURL')).filter(items => items.length).at(-1) || [];
  if (!initialization || initialization.hasAttribute('range') || segments.some(segment => (
    segment.hasAttribute('mediaRange') || segment.hasAttribute('indexRange')
  ))) {
    throw new Error('DASH byte-range segments are unsupported.');
  }
  if (segments.length > MAX_SEGMENTS) throw new Error('DASH segment limit exceeded.');
  return {
    initUrl: resolve(initialization.getAttribute('sourceURL'), base),
    segmentUrls: segments.map(segment => resolve(segment.getAttribute('media'), base)),
  };
}

function representationTrack(elements, documentUrl, duration, representationIndex) {
  const attr = name => inheritedAttribute(elements, name);
  const id = elements.at(-1).getAttribute('id');
  const contentType = attr('contentType');
  const mimeType = attr('mimeType') || (['audio', 'video'].includes(contentType) ? `${contentType}/mp4` : '');
  if (!/^(?:audio|video)\/mp4$/.test(mimeType)) return null;
  const bandwidth = integer(attr('bandwidth'), 0);
  const width = integer(attr('width'), 0);
  const height = integer(attr('height'), 0);
  const base = inheritedBase(elements, documentUrl);
  const scheme = elements.flatMap(node => [...node.children].filter(element => (
    ['SegmentTemplate', 'SegmentList', 'SegmentBase'].includes(element.localName)
  ))).at(-1)?.localName;
  if (scheme !== 'SegmentTemplate' && scheme !== 'SegmentList') {
    throw new Error('DASH representation needs explicit HTTP segment URLs.');
  }
  const configs = elements.map(node => first(node, scheme)).filter(Boolean);
  const track = scheme === 'SegmentTemplate'
    ? templateTrack(configs, base, duration, { RepresentationID: id, Bandwidth: bandwidth })
    : listTrack(configs, base);
  if (!track.segmentUrls.length) throw new Error('DASH representation has no media segments.');
  const language = attr('lang');
  const rate = bandwidth ? `${Math.round(bandwidth / 1000)} kb/s` : '';
  const label = [
    mimeType.startsWith('audio/') ? 'Audio' : height ? `${height}p` : (id || 'Video'),
    language,
    rate,
  ].filter(Boolean).join(' · ');
  return { id: id || String(representationIndex), label, width, height, bandwidth, mimeType, ...track };
}

export function parseDash(xml, documentUrl) {
  if (typeof xml !== 'string' || !xml || xml.length > MAX_XML_BYTES || /<!DOCTYPE|<!ENTITY/.test(xml)) {
    throw new Error('Invalid or oversized DASH playlist.');
  }
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const mpd = doc.documentElement;
  if (mpd.localName !== 'MPD' || doc.getElementsByTagName('parsererror').length) {
    throw new Error('Invalid DASH MPD playlist.');
  }
  if ([...doc.getElementsByTagNameNS('*', 'ContentProtection')].length) {
    throw new Error('Encrypted or DRM-protected DASH is unsupported.');
  }
  if (doc.getElementsByTagNameNS('http://www.w3.org/1999/xlink', '*').length ||
      [...doc.getElementsByTagNameNS('*', '*')].some(element => (
        element.hasAttributeNS('http://www.w3.org/1999/xlink', 'href')
      ))) throw new Error('External DASH playlist references are unsupported.');
  if ((mpd.getAttribute('type') || 'static') !== 'static') throw new Error('Only DASH on-demand playlists are supported.');
  const periods = children(mpd, 'Period');
  if (periods.length !== 1) throw new Error('DASH playlists must contain one period.');
  const [period] = periods;
  const presentationDuration = seconds(mpd.getAttribute('mediaPresentationDuration'));
  const start = seconds(period.getAttribute('start')) ?? 0;
  const duration = seconds(period.getAttribute('duration')) ?? (
    presentationDuration === null ? null : presentationDuration - start
  );
  if (duration !== null && duration <= 0) throw new Error('Invalid DASH period length.');
  const tracks = [];
  let count = 0;
  let failure;
  for (const adaptation of children(period, 'AdaptationSet')) {
    for (const representation of children(adaptation, 'Representation')) {
      count += 1;
      if (count > MAX_REPRESENTATIONS) throw new Error('DASH representation limit exceeded.');
      try {
        const track = representationTrack([mpd, period, adaptation, representation], documentUrl, duration, count);
        if (track) tracks.push(track);
      } catch (error) {
        failure = error;
      }
    }
  }
  if (!tracks.length) throw failure || new Error('No supported fragmented MP4 DASH tracks were found.');
  const audio = tracks.filter(track => track.mimeType.startsWith('audio/')).sort((a, b) => b.bandwidth - a.bandwidth);
  const video = tracks.filter(track => track.mimeType.startsWith('video/')).sort((a, b) => (
    b.height - a.height || b.bandwidth - a.bandwidth
  ));
  return { variants: [
    ...video.map(track => ({ ...track, audio: audio[0] })),
    ...audio,
  ] };
}
