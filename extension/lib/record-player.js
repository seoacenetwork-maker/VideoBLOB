// Chrome serializes this function when it runs in the source tab's isolated world.
export function recordPlayer(command, id, mediaUrl, filename) {
  const slot = '__videoBlobPlayerCapture';
  const current = globalThis[slot];
  if (command !== 'start') {
    if (!current || current.id !== id) return { state: 'inactive' };
    if (command === 'pulse') current.lastPulse = Date.now();
    if (command === 'save') current.finish(filename);
    if (command === 'discard') current.discard();
    return { state: current.state, startedAt: current.startedAt, message: current.message };
  }
  if (current?.state === 'recording') throw new Error('A recording is already running in this tab.');
  const candidates = [...document.querySelectorAll('video')].filter(video => video.readyState >= 2);
  const video = mediaUrl
    ? candidates.find(candidate => candidate.currentSrc === mediaUrl || candidate.src === mediaUrl)
    : candidates.find(candidate => !candidate.paused) || candidates[0];
  if (!video || video.paused || video.ended) throw new Error('Play the video in the source tab first.');
  if (video.mediaKeys) throw new Error('Recording protected playback is unavailable.');
  if (typeof video.captureStream !== 'function') throw new Error('Player capture is unavailable.');
  let stream;
  let recorder;
  const type = ['video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find(item => MediaRecorder.isTypeSupported(item));
  try {
    stream = video.captureStream();
    if (!type || !stream.getVideoTracks().some(track => track.readyState === 'live')) {
      throw new Error('This player does not expose a recordable video track.');
    }
    recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 2_500_000 });
  } catch (error) {
    stream?.getTracks().forEach(track => track.stop());
    throw error;
  }
  const source = video.currentSrc;
  const chunks = [];
  let bytes = 0;
  let saveAs = '';
  const saveRecording = name => {
    const mimeType = recorder.mimeType || type;
    const suffix = mimeType.startsWith('video/mp4') ? '.mp4' : '.webm';
    const url = URL.createObjectURL(new Blob(chunks, { type: mimeType }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name + suffix;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    chunks.length = 0;
    state.state = 'completed';
  };
  const state = {
    id, state: 'recording', message: '', startedAt: Date.now(), lastPulse: Date.now(),
    finish(name) {
      if (this.state === 'ready' && chunks.length) {
        saveRecording(name);
        return;
      }
      if (recorder.state === 'inactive' || this.state !== 'recording') return;
      saveAs = name;
      this.state = 'saving';
      recorder.stop();
    },
    discard(message = '') {
      saveAs = '';
      chunks.length = 0;
      this.message = typeof message === 'string' ? message : '';
      this.state = this.message ? 'error' : 'discarded';
      if (recorder.state !== 'inactive') recorder.stop();
    },
  };
  globalThis[slot] = state;
  const guard = () => {
    if (video.mediaKeys) state.discard('Protected playback detected. Recording discarded.');
    if (video.currentSrc !== source) state.discard('The player source changed. Start a new recording.');
  };
  const encrypted = () => state.discard('Protected playback detected. Recording discarded.');
  video.addEventListener('encrypted', encrypted);
  video.addEventListener('emptied', guard);
  const abandon = () => state.discard();
  window.addEventListener('pagehide', abandon, { once: true });
  const timer = setInterval(() => {
    guard();
    if (Date.now() - state.lastPulse > 10_000) state.discard('The controls were disconnected.');
    if (recorder.state !== 'inactive' && Date.now() - state.startedAt > 15 * 60_000) recorder.stop();
  }, 1_000);
  recorder.ondataavailable = event => {
    if (!['recording', 'saving'].includes(state.state) || !event.data.size) return;
    bytes += event.data.size;
    if (bytes > 256 * 1024 * 1024) {
      state.discard('The recording reached the 256 MiB memory limit.');
      return;
    }
    chunks.push(event.data);
  };
  recorder.onerror = () => state.discard('The browser could not record this player.');
  recorder.onstop = () => {
    clearInterval(timer);
    video.removeEventListener('encrypted', encrypted);
    video.removeEventListener('emptied', guard);
    window.removeEventListener('pagehide', abandon);
    stream.getTracks().forEach(track => track.stop());
    if (saveAs && chunks.length && state.state === 'saving') {
      saveRecording(saveAs);
    } else if (state.state === 'recording' && chunks.length) {
      state.state = 'ready';
      setTimeout(() => { if (state.state === 'ready') state.discard('The recording expired.'); }, 60_000);
    } else if (['saving', 'recording'].includes(state.state)) {
      state.state = 'error';
      state.message = 'The player produced no data.';
    }
    if (state.state !== 'ready') chunks.length = 0;
  };
  try {
    recorder.start(1_000);
  } catch (error) {
    state.discard();
    recorder.onstop();
    throw error;
  }
  return { state: state.state, startedAt: state.startedAt };
}
