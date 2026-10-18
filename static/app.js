const $ = (id) => document.getElementById(id);
const state = {
  mode: 'demo', currentAudioFile: null, currentFeatures: null, currentAudioUrl: null,
  selectedPet: 'cat', selectedStyle: 'auto', duration: 15, mediaRecorder: null,
  recordStream: null, recordChunks: [], recordStartedAt: 0, timerInterval: null,
  currentResult: null, toastTimer: null, generating: false,
};

const PETS = {
  bird: { label: '小鸟', emoji: '🐦' }, rabbit: { label: '兔兔', emoji: '🐰' },
  cat: { label: '猫咪', emoji: '🐱' }, dog: { label: '狗狗', emoji: '🐶' }, other: { label: '其他伙伴', emoji: '🐾' },
};
const STYLES = { auto: '智能匹配', healing: '治愈轻柔', cheerful: '欢快活泼', mysterious: '神秘氛围' };

function toast(message, duration = 2800) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

async function requestJSON(url, options = {}) {
  const response = await fetch(url, options);
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) throw new Error(payload.detail || `请求失败（${response.status}）`);
  return payload;
}

function setPage(pageId) {
  const targetPageId = pageId === 'stylePage' ? 'studioPage' : pageId;
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active-page', p.id === targetPageId));
  document.querySelectorAll('.nav-link').forEach((b) => b.classList.toggle('active', b.dataset.page === pageId));
  if (pageId === 'libraryPage') loadHistory();
  if (pageId === 'communityPage') loadCommunity();
  if (pageId === 'stylePage') {
    window.setTimeout(() => $('composePanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

document.querySelectorAll('.nav-link').forEach((button) => button.addEventListener('click', () => setPage(button.dataset.page)));
document.querySelectorAll('[data-go-studio]').forEach((button) => button.addEventListener('click', () => setPage('studioPage')));

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function choosePet(pet) {
  state.selectedPet = pet;
  $('petType').value = pet;
  document.querySelectorAll('.pet-option').forEach((b) => b.classList.toggle('active', b.dataset.pet === pet));
  updateComposeSummary();
}
function chooseStyle(style) {
  state.selectedStyle = style;
  $('musicStyle').value = style;
  document.querySelectorAll('.style-option').forEach((b) => b.classList.toggle('active', b.dataset.style === style));
  updateComposeSummary();
}
function chooseDuration(duration) {
  state.duration = Number(duration);
  document.querySelectorAll('.duration-options button').forEach((b) => b.classList.toggle('active', Number(b.dataset.duration) === state.duration));
  updateComposeSummary();
}
document.querySelectorAll('.pet-option').forEach((b) => b.addEventListener('click', () => choosePet(b.dataset.pet)));
document.querySelectorAll('.style-option').forEach((b) => b.addEventListener('click', () => chooseStyle(b.dataset.style)));
document.querySelectorAll('.duration-options button').forEach((b) => b.addEventListener('click', () => chooseDuration(b.dataset.duration)));

function updateComposeSummary() {
  const pet = PETS[state.selectedPet];
  $('summaryTitle').textContent = `${pet.label}的声音，准备好变成旋律了吗？`;
  if (!state.currentFeatures) {
    $('summaryText').textContent = '先录制或上传一段声音，分析完成后即可创作。';
  } else {
    const energy = { low: '低能量', medium: '中等能量', high: '高能量' }[state.currentFeatures.energy_level];
    const rhythm = { sparse: '稀疏节奏', moderate: '中等节奏', dense: '密集节奏' }[state.currentFeatures.rhythm_level];
    $('summaryText').textContent = `${energy} · ${rhythm} · ${STYLES[state.selectedStyle]} · ${state.duration} 秒`;
  }
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast('当前浏览器不支持网页录音，请上传音频文件。');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    state.recordStream = stream;
    state.recordChunks = [];
    const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    const mimeType = mimeCandidates.find((type) => MediaRecorder.isTypeSupported(type));
    state.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    state.mediaRecorder.addEventListener('dataavailable', (event) => { if (event.data?.size) state.recordChunks.push(event.data); });
    state.mediaRecorder.addEventListener('stop', async () => {
      clearInterval(state.timerInterval);
      stream.getTracks().forEach((track) => track.stop());
      state.recordStream = null;
      $('recordArea').classList.remove('recording');
      $('recordButton').disabled = false;
      $('stopButton').disabled = true;
      $('recordTitle').textContent = '录音已完成';
      $('recordSubtitle').textContent = '正在整理音频并提取声音特征…';
      try {
        const blob = new Blob(state.recordChunks, { type: state.mediaRecorder.mimeType || 'audio/webm' });
        await processAudioFile(new File([blob], `宠物录音-${Date.now()}`, { type: blob.type }));
      } catch (error) {
        toast(`无法处理这段录音：${error.message}`);
        $('recordSubtitle').textContent = '请再试一次，或改为上传音频文件。';
      }
    });
    state.mediaRecorder.start(250);
    state.recordStartedAt = Date.now();
    $('recordArea').classList.add('recording');
    $('recordButton').disabled = true;
    $('stopButton').disabled = false;
    $('recordTitle').textContent = '正在收录声音…';
    $('recordSubtitle').textContent = '尽量保持环境安静；最长录制 60 秒。';
    $('recordTimer').textContent = '00:00';
    state.timerInterval = setInterval(() => {
      const seconds = (Date.now() - state.recordStartedAt) / 1000;
      $('recordTimer').textContent = formatTime(seconds);
      if (seconds >= 60 && state.mediaRecorder?.state === 'recording') stopRecording();
    }, 250);
  } catch (error) {
    toast(error.name === 'NotAllowedError' ? '麦克风权限未开启，请允许浏览器访问麦克风。' : `无法启动录音：${error.message}`);
  }
}
function stopRecording() {
  if (state.mediaRecorder?.state === 'recording') state.mediaRecorder.stop();
}
$('recordButton').addEventListener('click', startRecording);
$('stopButton').addEventListener('click', stopRecording);

$('audioFileInput').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (file) {
    try { await processAudioFile(file); }
    catch (error) { toast(`无法读取音频：${error.message}`); }
  }
  event.target.value = '';
});
const uploadZone = $('uploadZone');
['dragenter', 'dragover'].forEach((name) => uploadZone.addEventListener(name, (event) => { event.preventDefault(); uploadZone.classList.add('dragover'); }));
['dragleave', 'drop'].forEach((name) => uploadZone.addEventListener(name, (event) => { event.preventDefault(); uploadZone.classList.remove('dragover'); }));
uploadZone.addEventListener('drop', async (event) => {
  const file = [...(event.dataTransfer?.files || [])].find((f) => f.type.startsWith('audio/') || /\.(wav|mp3|m4a|ogg|flac|aac)$/i.test(f.name));
  if (!file) return toast('请拖入音频文件。');
  try { await processAudioFile(file); } catch (error) { toast(`无法读取音频：${error.message}`); }
});
$('clearAudioButton').addEventListener('click', clearCurrentAudio);

function encodeWav(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const frames = audioBuffer.length;
  const bytesPerSample = 2;
  const dataSize = frames * channels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  writeString(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); writeString(8, 'WAVE');
  writeString(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true); view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true); writeString(36, 'data'); view.setUint32(40, dataSize, true);
  const channelData = Array.from({ length: channels }, (_, channel) => audioBuffer.getChannelData(channel));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let channel = 0; channel < channels; channel++) {
      let sample = Math.max(-1, Math.min(1, channelData[channel][i]));
      view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function autocorrelationPitch(samples, sampleRate) {
  const frameSize = 4096;
  const minLag = Math.max(2, Math.floor(sampleRate / 2200));
  const maxLag = Math.min(Math.floor(sampleRate / 70), frameSize - 1);
  if (samples.length < frameSize) return 0;
  const frequencies = [];
  const hop = 8192;
  for (let start = 0; start + frameSize < samples.length; start += hop) {
    const frame = samples.subarray(start, start + frameSize);
    let energy = 0;
    for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
    if (energy / frame.length < 0.000015) continue;
    let bestLag = 0;
    let bestCorr = -Infinity;
    const compareCount = frameSize - maxLag;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      for (let i = 0; i < compareCount; i += 2) corr += frame[i] * frame[i + lag];
      if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
    }
    if (bestLag) {
      const hz = sampleRate / bestLag;
      if (hz >= 70 && hz <= 2200) frequencies.push(hz);
    }
    if (frequencies.length >= 16) break;
  }
  if (!frequencies.length) return 0;
  frequencies.sort((a, b) => a - b);
  return Math.round(frequencies[Math.floor(frequencies.length / 2)]);
}

function analyzeAudio(audioBuffer) {
  const sampleRate = audioBuffer.sampleRate;
  const samples = audioBuffer.getChannelData(0);
  const duration = audioBuffer.duration;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
  const rms = Math.sqrt(sumSq / Math.max(1, samples.length));
  const rmsDbfs = Math.max(-90, 20 * Math.log10(rms + 1e-9));
  const energyLevel = rmsDbfs >= -18 ? 'high' : rmsDbfs >= -32 ? 'medium' : 'low';

  const frameSize = Math.max(256, Math.round(sampleRate * 0.02));
  const frameEnergy = [];
  for (let start = 0; start < samples.length; start += frameSize) {
    const end = Math.min(samples.length, start + frameSize);
    let local = 0;
    for (let i = start; i < end; i++) local += samples[i] * samples[i];
    frameEnergy.push(Math.sqrt(local / Math.max(1, end - start)));
  }
  const averageFrameEnergy = frameEnergy.reduce((a, b) => a + b, 0) / Math.max(1, frameEnergy.length);
  const threshold = Math.max(averageFrameEnergy * 1.55, 0.009);
  const peaks = [];
  let lastPeak = -10;
  for (let i = 1; i < frameEnergy.length - 1; i++) {
    const value = frameEnergy[i];
    if (value > threshold && value >= frameEnergy[i - 1] && value > frameEnergy[i + 1] && i - lastPeak >= 6) {
      peaks.push(i); lastPeak = i;
    }
  }
  const rhythmPerSec = peaks.length / Math.max(duration, 0.1);
  const rhythmLevel = rhythmPerSec >= 3.5 ? 'dense' : rhythmPerSec >= 1.2 ? 'moderate' : 'sparse';
  const dominantHz = autocorrelationPitch(samples, sampleRate);
  const pitchLevel = dominantHz === 0 ? 'mid' : dominantHz < 250 ? 'low' : dominantHz < 800 ? 'mid' : 'high';
  return {
    duration_sec: Number(duration.toFixed(2)), sample_rate: sampleRate,
    rms: Number(rms.toFixed(5)), rms_dbfs: Number(rmsDbfs.toFixed(1)),
    energy_level: energyLevel, dominant_hz: dominantHz,
    pitch_level: pitchLevel, rhythm_per_sec: Number(rhythmPerSec.toFixed(2)), rhythm_level: rhythmLevel,
    detected_onsets: peaks.length,
  };
}

async function processAudioFile(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error('文件超过 20 MB，请裁剪后重试。');
  if (!file.type.startsWith('audio/') && !/\.(wav|mp3|m4a|ogg|flac|aac|webm)$/i.test(file.name)) throw new Error('请选择常见格式的音频文件。');
  $('recordTitle').textContent = '正在分析声音…';
  $('recordSubtitle').textContent = '将音频转换为 44.1 kHz WAV，并提取四项基础参数。';
  $('analysisState').textContent = '分析中…';
  $('analysisState').classList.remove('ready');
  $('generateButton').disabled = true;
  let audioContext;
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const inputBuffer = await audioContext.decodeAudioData(await file.arrayBuffer());
    if (inputBuffer.duration > 60) throw new Error('音频最长支持 60 秒，请先裁剪文件。');
    if (inputBuffer.duration < 0.15) throw new Error('音频太短，请提供至少 0.15 秒的声音。');
    const targetRate = 44100;
    const offline = new OfflineAudioContext(1, Math.ceil(inputBuffer.duration * targetRate), targetRate);
    const source = offline.createBufferSource();
    source.buffer = inputBuffer;
    source.connect(offline.destination);
    source.start(0);
    const normalizedBuffer = await offline.startRendering();
    const wavBlob = encodeWav(normalizedBuffer);
    state.currentAudioFile = new File([wavBlob], `petsound-${Date.now()}.wav`, { type: 'audio/wav' });
    state.currentFeatures = analyzeAudio(normalizedBuffer);
    if (state.currentAudioUrl) URL.revokeObjectURL(state.currentAudioUrl);
    state.currentAudioUrl = URL.createObjectURL(wavBlob);
    $('sourceAudio').src = state.currentAudioUrl;
    $('audioFileName').textContent = file.name || '宠物录音.wav';
    $('audioFileMeta').textContent = `${state.currentFeatures.duration_sec.toFixed(1)} 秒 · 44.1 kHz WAV · ${(wavBlob.size / 1024).toFixed(0)} KB`;
    $('audioPreviewWrap').hidden = false;
    $('recordTitle').textContent = '声音已准备好';
    $('recordSubtitle').textContent = '你可以试听原始录音，然后开始创作。';
    $('recordTimer').textContent = formatTime(state.currentFeatures.duration_sec);
    $('analysisState').textContent = '分析完成';
    $('analysisState').classList.add('ready');
    renderFeatures(state.currentFeatures, normalizedBuffer);
    $('generateButton').disabled = false;
    updateComposeSummary();
    toast('声音特征已提取，可以开始创作了。');
  } finally {
    if (audioContext && audioContext.state !== 'closed') await audioContext.close();
  }
}

function renderFeatures(features, audioBuffer) {
  $('durationValue').innerHTML = `${features.duration_sec.toFixed(1)}<small> sec</small>`;
  $('volumeValue').innerHTML = `${features.rms_dbfs.toFixed(1)}<small> dBFS</small>`;
  $('pitchValue').innerHTML = `${features.dominant_hz || '—'}<small> Hz</small>`;
  $('rhythmValue').innerHTML = `${features.rhythm_per_sec.toFixed(1)}<small> 次/秒</small>`;
  $('energyLabel').textContent = { low: '低能量区间', medium: '中等能量区间', high: '高能量区间' }[features.energy_level];
  $('pitchLabel').textContent = { low: '偏低频', mid: '中频 / 未检出明显基频', high: '偏高频' }[features.pitch_level];
  $('rhythmLabel').textContent = { sparse: '稀疏节奏', moderate: '中等节奏', dense: '密集节奏' }[features.rhythm_level];
  const durationPercent = Math.min(100, features.duration_sec / 60 * 100);
  const volumePercent = Math.min(100, Math.max(0, (features.rms_dbfs + 60) / 60 * 100));
  const pitchPercent = Math.min(100, (features.dominant_hz || 0) / 2200 * 100);
  const rhythmPercent = Math.min(100, features.rhythm_per_sec / 8 * 100);
  const percentages = [durationPercent, volumePercent, pitchPercent, rhythmPercent];
  document.querySelectorAll('.feature-card .mini-meter span').forEach((el, i) => { el.style.width = `${percentages[i]}%`; });
  drawWaveform(audioBuffer);
}

function drawWaveform(audioBuffer) {
  const canvas = $('waveCanvas');
  const ctx = canvas.getContext('2d');
  const data = audioBuffer.getChannelData(0);
  const width = canvas.width, height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = '#58afe7'; ctx.lineWidth = 1.8; ctx.beginPath();
  const step = Math.max(1, Math.floor(data.length / width));
  for (let x = 0; x < width; x++) {
    let min = 1, max = -1;
    const start = x * step;
    for (let i = start; i < Math.min(data.length, start + step); i++) { min = Math.min(min, data[i]); max = Math.max(max, data[i]); }
    const y1 = (1 + min) * height / 2;
    const y2 = (1 + max) * height / 2;
    ctx.moveTo(x, y1); ctx.lineTo(x, y2);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(176, 218, 240, .75)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke();
  canvas.hidden = false;
  canvas.previousElementSibling.hidden = true;
}

function clearCurrentAudio() {
  if (state.currentAudioUrl) URL.revokeObjectURL(state.currentAudioUrl);
  state.currentAudioUrl = null; state.currentAudioFile = null; state.currentFeatures = null;
  $('audioPreviewWrap').hidden = true;
  $('sourceAudio').removeAttribute('src'); $('sourceAudio').load();
  $('recordTitle').textContent = '录下此刻的声音';
  $('recordSubtitle').textContent = '建议录制 3–15 秒，尽量靠近声源并减少背景噪音';
  $('recordTimer').textContent = '00:00';
  $('analysisState').textContent = '等待音频'; $('analysisState').classList.remove('ready');
  $('durationValue').innerHTML = '—<small> sec</small>';
  $('volumeValue').innerHTML = '—<small> dBFS</small>';
  $('pitchValue').innerHTML = '—<small> Hz</small>';
  $('rhythmValue').innerHTML = '—<small> 次/秒</small>';
  $('energyLabel').textContent = '能量待分析'; $('pitchLabel').textContent = '音高待分析'; $('rhythmLabel').textContent = '节奏待分析';
  document.querySelectorAll('.feature-card .mini-meter span').forEach((el) => el.style.width = '0%');
  $('waveCanvas').hidden = true; $('waveCanvas').previousElementSibling.hidden = false;
  $('generateButton').disabled = true;
  updateComposeSummary();
}

$('generateButton').addEventListener('click', () => generateMusic());
async function generateMusic() {
  if (!state.currentAudioFile || !state.currentFeatures || state.generating) return;
  state.generating = true;
  $('generateButton').disabled = true;
  $('generationProgress').hidden = false;
  $('progressTitle').textContent = state.mode === 'demo' ? '正在生成演示音乐…' : 'MusicGen 正在为声音编曲…';
  $('progressPercent').textContent = '处理中';
  $('progressHint').textContent = state.mode === 'demo' ? '当前未配置 API token，将生成一段本地合成示例音频。' : '正在上传声音特征并调用音乐生成模型，通常需要等待一段时间。';
  const form = new FormData();
  form.append('audio', state.currentAudioFile, state.currentAudioFile.name);
  form.append('pet_type', state.selectedPet);
  form.append('style', state.selectedStyle);
  form.append('duration', String(state.duration));
  form.append('features_json', JSON.stringify(state.currentFeatures));
  try {
    const result = await requestJSON('/api/generate', { method: 'POST', body: form });
    state.currentResult = result;
    showResult(result);
    $('resultSection').hidden = false;
    toast(result.mode === 'demo' ? '演示作品已生成。配置 Replicate API 后可调用真实 MusicGen。' : '音乐生成完成！');
    $('resultSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    toast(error.message || '生成失败，请稍后重试。', 4200);
  } finally {
    state.generating = false;
    $('generateButton').disabled = !state.currentAudioFile;
    $('generationProgress').hidden = true;
  }
}

function showResult(result) {
  const pet = PETS[result.pet_type] || PETS.other;
  $('resultPetEmoji').textContent = pet.emoji;
  $('resultPetTag').textContent = result.pet_label || pet.label;
  $('resultStyleTag').textContent = result.style_label || STYLES[result.style] || '智能匹配';
  $('resultModeTag').textContent = result.mode === 'musicgen' ? 'MusicGen 生成' : '本地演示音频';
  $('resultTitle').textContent = `${pet.label}的声音 · ${result.duration} 秒音乐片段`;
  $('resultDescription').textContent = `基于 ${result.features?.duration_sec ?? '—'} 秒原始录音的声学特征创作，音乐长度 ${result.duration} 秒。`;
  $('resultCaption').textContent = result.caption || '每一种声音，都有自己的节奏。';
  $('resultAudio').src = result.audio_url;
  $('resultAudio').load();
  $('resultPrompt').textContent = result.prompt || '本次使用音频特征与风格选项生成音乐。';
  $('resultCreated').textContent = new Date(result.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  $('publishButton').disabled = !!result.public;
  $('publishButton').innerHTML = result.public ? '<span>✓</span> 已发布到社区' : '<span>✦</span> 发布到社区';
  $('publishButton').title = result.public ? '这条作品已公开发布' : '公开分享生成的音乐和弹幕，不公开原始录音';
}

$('downloadButton').addEventListener('click', () => {
  if (!state.currentResult) return;
  const a = document.createElement('a');
  a.href = state.currentResult.audio_url;
  a.download = `PetSound-${state.currentResult.pet_label}-${state.currentResult.id}.${state.currentResult.mode === 'musicgen' ? 'mp3' : 'wav'}`;
  document.body.appendChild(a); a.click(); a.remove();
  toast('已开始保存音乐文件。');
});
$('shareButton').addEventListener('click', async () => {
  if (!state.currentResult) return;
  try {
    const response = await fetch(state.currentResult.audio_url);
    const blob = await response.blob();
    const file = new File([blob], `PetSound-${state.currentResult.id}.${state.currentResult.mode === 'musicgen' ? 'mp3' : 'wav'}`, { type: blob.type || 'audio/mpeg' });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title: 'PetSound 宠物声音音乐', text: state.currentResult.caption, files: [file] });
    } else {
      const shareUrl = new URL(state.currentResult.audio_url, window.location.href).href;
      try { await navigator.clipboard.writeText(shareUrl); toast('当前浏览器不支持直接分享文件，已复制音频链接。'); }
      catch { toast('请使用“保存音乐”下载后分享；部署到公网后也可以复制作品链接。'); }
    }
  } catch (error) {
    if (error.name !== 'AbortError') toast('分享失败，请尝试先保存音乐文件。');
  }
});
$('regenerateButton').addEventListener('click', async () => {
  if (!state.currentResult || state.generating) return;
  state.generating = true; $('regenerateButton').disabled = true;
  $('progressTitle').textContent = state.mode === 'demo' ? '正在重新创作…' : '正在为同一段声音重新编曲…';
  $('progressHint').textContent = '保留原始声音和特征参数，使用新的随机种子生成不同版本。';
  $('generationProgress').hidden = false;
  try {
    const result = await requestJSON(`/api/regenerate/${state.currentResult.id}`, { method: 'POST' });
    state.currentResult = result; showResult(result); await loadHistory();
    toast('新版本已经生成。');
  } catch (error) { toast(error.message || '重新生成失败。', 4000); }
  finally { state.generating = false; $('regenerateButton').disabled = false; $('generationProgress').hidden = true; }
});
$('publishButton').addEventListener('click', async () => {
  if (!state.currentResult || state.currentResult.public) return;
  $('publishButton').disabled = true;
  try {
    const result = await requestJSON(`/api/publish/${state.currentResult.id}`, { method: 'POST' });
    state.currentResult = result; showResult(result); toast('已发布到声音社区。');
  } catch (error) { toast(error.message || '发布失败。'); $('publishButton').disabled = false; }
});

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function resultCardHTML(item, community = false) {
  const pet = PETS[item.pet_type] || PETS.other;
  const date = item.created_at ? new Date(item.created_at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '';
  const mode = item.mode === 'musicgen' ? 'MusicGen' : '演示音频';
  return `<article class="work-card" data-result-id="${escapeHTML(item.id)}">
    <div class="work-card-top"><div class="work-card-emoji">${pet.emoji}</div><div class="work-card-title"><strong>${escapeHTML(item.pet_label || pet.label)}的声音 · ${Number(item.duration) || 15} 秒</strong><small>${escapeHTML(date)} · ${escapeHTML(item.style_label || '智能匹配')} · ${mode}</small></div>${item.public ? '<span class="tag tag-green">公开</span>' : ''}</div>
    <audio controls preload="none" src="${escapeHTML(item.audio_url)}"></audio>
    <div class="caption-line">✦ ${escapeHTML(item.caption || '每一种声音，都有自己的节奏。')}</div>
    <div class="work-card-actions"><button data-action="download" data-id="${escapeHTML(item.id)}">↓ 保存</button><button data-action="regenerate" data-id="${escapeHTML(item.id)}">⟳ 再生成</button>${community ? '' : `<button data-action="${item.public ? 'published' : 'publish'}" data-id="${escapeHTML(item.id)}">${item.public ? '✓ 已发布' : '✦ 发布'}</button><button data-action="delete" data-id="${escapeHTML(item.id)}">删除</button>`}</div>
  </article>`;
}
async function loadHistory() {
  const grid = $('historyGrid');
  try {
    const items = await requestJSON('/api/history');
    $('historyCount').textContent = items.length;
    $('historyPetCount').textContent = new Set(items.map((x) => x.pet_type)).size;
    $('historyPublicCount').textContent = items.filter((x) => x.public).length;
    grid.innerHTML = items.length ? items.map((item) => resultCardHTML(item, false)).join('') : `<div class="empty-state"><div class="empty-illustration">♫</div><h3>你的第一首作品还在路上</h3><p>录制一段声音，让它成为一首专属音乐。</p><button class="button button-primary" data-go-studio>去创作</button></div>`;
    bindCardActions(grid);
    grid.querySelectorAll('[data-go-studio]').forEach((b) => b.addEventListener('click', () => setPage('studioPage')));
  } catch (error) { grid.innerHTML = `<div class="empty-state"><h3>暂时无法读取作品库</h3><p>${escapeHTML(error.message)}</p></div>`; }
}
async function loadCommunity() {
  const grid = $('communityGrid');
  try {
    const items = await requestJSON('/api/community');
    $('communityCount').textContent = items.length;
    grid.innerHTML = items.length ? items.map((item) => resultCardHTML(item, true)).join('') : `<div class="empty-state"><div class="empty-illustration">♡</div><h3>社区还很安静</h3><p>创作并主动发布第一段作品，让这里响起音乐。</p><button class="button button-primary" data-go-studio>去创作</button></div>`;
    bindCardActions(grid);
    grid.querySelectorAll('[data-go-studio]').forEach((b) => b.addEventListener('click', () => setPage('studioPage')));
  } catch (error) { grid.innerHTML = `<div class="empty-state"><h3>暂时无法读取社区</h3><p>${escapeHTML(error.message)}</p></div>`; }
}
function bindCardActions(container) {
  container.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', async () => {
    const id = button.dataset.id;
    const action = button.dataset.action;
    try {
      if (action === 'download') {
        const a = document.createElement('a'); a.href = `/media/${id}`; a.download = `PetSound-${id}`; document.body.appendChild(a); a.click(); a.remove();
      } else if (action === 'regenerate') {
        button.disabled = true; button.textContent = '生成中…';
        const result = await requestJSON(`/api/regenerate/${id}`, { method: 'POST' });
        state.currentResult = result; showResult(result); $('resultSection').hidden = false; setPage('studioPage'); $('resultSection').scrollIntoView({ behavior: 'smooth' });
        toast('已从历史作品重新生成一个版本。');
      } else if (action === 'publish') {
        await requestJSON(`/api/publish/${id}`, { method: 'POST' });
        await loadHistory(); toast('作品已发布到社区。');
      } else if (action === 'delete') {
        if (!confirm('确定删除这条作品吗？生成音频会从当前服务器删除。')) return;
        await requestJSON(`/api/history/${id}`, { method: 'DELETE' }); await loadHistory(); await loadCommunity(); toast('作品已删除。');
      }
    } catch (error) { toast(error.message || '操作失败。', 4000); }
    finally { button.disabled = false; }
  }));
}

async function init() {
  try {
    const config = await requestJSON('/api/config');
    state.mode = config.mode;
    const pill = $('modePill');
    if (state.mode === 'musicgen') {
      pill.innerHTML = '<span class="status-dot"></span>MusicGen 已连接';
      pill.title = '使用 Replicate 上的 Meta MusicGen 模型';
    } else {
      pill.innerHTML = '<span class="status-dot" style="background:#e5b36d;box-shadow:0 0 0 4px #fff1d8"></span>本地演示模式';
      pill.title = '设置 REPLICATE_API_TOKEN 后即可调用真实音乐生成模型';
    }
  } catch { $('modePill').textContent = '离线模式'; }
  updateComposeSummary();
}
init();
