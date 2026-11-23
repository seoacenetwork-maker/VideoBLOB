import {
  BlobSource, BufferTarget, Conversion, Input, MP4, MPEG_TS, Mp4OutputFormat, Output, WEBM,
} from '../vendor/mediabunny.mjs';

async function convert(inputs, options, { signal, onProgress } = {}) {
  signal?.throwIfAborted();
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const sources = inputs.map(({ blob, formats }) => new Input({ source: new BlobSource(blob), formats }));
  const composable = inputs.length > 1;
  const conversions = [];
  const progress = inputs.map(() => 0);
  const cancelConversions = () => Promise.allSettled(conversions.map(conversion => conversion.cancel()));
  const onAbort = () => { void cancelConversions(); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for (let index = 0; index < sources.length; index += 1) {
      const { required, ...conversionOptions } = options[index];
      const conversion = await Conversion.init({
        input: sources[index],
        output,
        composable,
        tracks: 'primary',
        ...(composable ? {} : { tags: {} }),
        ...conversionOptions,
      });
      conversions.push(conversion);
      signal?.throwIfAborted();
      if (!conversion.isValid || !conversion.utilizedTracks.length) {
        throw new Error(inputs[index].error);
      }
      if (required && !conversion.utilizedTracks.some(track => track.type === required)) {
        throw new Error(inputs[index].error);
      }
      if (onProgress) {
        conversion.onProgress = value => {
          progress[index] = value;
          onProgress(progress.reduce((sum, current) => sum + current, 0) / progress.length);
        };
      }
    }
    if (composable) await output.start();
    await Promise.all(conversions.map(conversion => conversion.execute()));
    if (composable) await output.finalize();
    signal?.throwIfAborted();
    if (!target.buffer?.byteLength) throw new Error('Media conversion produced an empty file.');
    return target.buffer;
  } catch (error) {
    await cancelConversions();
    if (composable) await output.cancel().catch(() => {});
    if (signal?.aborted) throw signal.reason;
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    for (const input of sources) input.dispose();
  }
}

const preservePackets = { mode: 'forced', shiftTolerance: Infinity };

export async function combineDash(videoBlob, audioBlob, controls) {
  const buffer = await convert([
    { blob: videoBlob, formats: [MP4], error: 'The DASH video track could not be read.' },
    { blob: audioBlob, formats: [MP4], error: 'The DASH audio track could not be read.' },
  ], [
    { audio: { discard: true }, required: 'video', copy: preservePackets, trim: { start: 0 } },
    { video: { discard: true }, required: 'audio', copy: preservePackets, trim: { start: 0 } },
  ], controls);
  return new Blob([buffer], { type: 'video/mp4' });
}

export async function remuxToMp4(inputBlob, controls) {
  const buffer = await convert([
    { blob: inputBlob, formats: [MPEG_TS, MP4], error: 'The stream could not be combined into an MP4 file.' },
  ], [{ required: 'video', copy: preservePackets }], controls);
  return new Blob([buffer], { type: 'video/mp4' });
}

export async function extractAudio(inputBlob, controls) {
  const buffer = await convert([
    { blob: inputBlob, formats: [MP4, WEBM, MPEG_TS], error: 'No readable track or compatible AAC encoder found.' },
  ], [{ video: { discard: true }, audio: { codec: 'aac' }, required: 'audio' }], controls);
  return new Blob([buffer], { type: 'audio/mp4' });
}
