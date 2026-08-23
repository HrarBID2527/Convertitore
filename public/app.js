import { fetchFile, toBlobURL } from "https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js";

const { FFmpeg } = window.FFmpegWASM;

const CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
const WORKER_URL = "https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/814.ffmpeg.js";
const ACCEPTED_EXT = [".mp4", ".mov"];
const MAX_SIZE_BYTES = 500 * 1024 * 1024; // 500MB soft limit
const YT_URL_RE = /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{6,}/i;

// ---------- DOM refs: shell ----------
const modeVideoBtn = document.getElementById("modeVideoBtn");
const modeYtBtn = document.getElementById("modeYtBtn");
const modeToggle = document.querySelector(".mode-toggle");
const videoSection = document.getElementById("videoSection");
const ytSection = document.getElementById("ytSection");

// ---------- DOM refs: video panel ----------
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const browseBtn = document.getElementById("browseBtn");

const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
const removeFileBtn = document.getElementById("removeFileBtn");
const qualitySelect = document.getElementById("qualitySelect");
const channelsSelect = document.getElementById("channelsSelect");
const convertBtn = document.getElementById("convertBtn");

const progressBlock = document.getElementById("progressBlock");
const progressStatus = document.getElementById("progressStatus");
const progressPercent = document.getElementById("progressPercent");
const progressFill = document.getElementById("progressFill");

const doneBlock = document.getElementById("doneBlock");
const doneSub = document.getElementById("doneSub");
const downloadAgainBtn = document.getElementById("downloadAgainBtn");
const convertAnotherBtn = document.getElementById("convertAnotherBtn");

const errorBlock = document.getElementById("errorBlock");
const errorMessage = document.getElementById("errorMessage");
const errorRetryBtn = document.getElementById("errorRetryBtn");

// ---------- DOM refs: YouTube panel ----------
const ytUrlInput = document.getElementById("ytUrlInput");
const ytQualitySelect = document.getElementById("ytQualitySelect");
const ytChannelsSelect = document.getElementById("ytChannelsSelect");
const ytConvertBtn = document.getElementById("ytConvertBtn");

const ytProgressBlock = document.getElementById("ytProgressBlock");
const ytProgressStatus = document.getElementById("ytProgressStatus");
const ytProgressPercent = document.getElementById("ytProgressPercent");
const ytProgressFill = document.getElementById("ytProgressFill");

const ytDoneBlock = document.getElementById("ytDoneBlock");
const ytDoneSub = document.getElementById("ytDoneSub");
const ytDownloadAgainBtn = document.getElementById("ytDownloadAgainBtn");
const ytConvertAnotherBtn = document.getElementById("ytConvertAnotherBtn");

const ytErrorBlock = document.getElementById("ytErrorBlock");
const ytErrorMessage = document.getElementById("ytErrorMessage");
const ytErrorRetryBtn = document.getElementById("ytErrorRetryBtn");

// ---------- State ----------
let selectedFile = null;
let ffmpeg = null;
let ffmpegLoadingPromise = null;
let lastDownloadUrl = null;
let lastDownloadName = null;
let ytLastDownloadUrl = null;
let ytLastDownloadName = null;

// ================= Mode toggle =================
function setMode(mode) {
  const isYt = mode === "yt";
  modeToggle.classList.toggle("yt-active", isYt);
  modeVideoBtn.classList.toggle("active", !isYt);
  modeYtBtn.classList.toggle("active", isYt);
  modeVideoBtn.setAttribute("aria-selected", String(!isYt));
  modeYtBtn.setAttribute("aria-selected", String(isYt));
  videoSection.classList.toggle("hidden", isYt);
  ytSection.classList.toggle("hidden", !isYt);
}
modeVideoBtn.addEventListener("click", () => setMode("video"));
modeYtBtn.addEventListener("click", () => setMode("yt"));

// ================= Helpers =================
function extensionOf(name) {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx).toLowerCase();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let val = bytes;
  let i = -1;
  do {
    val /= 1024;
    i++;
  } while (val >= 1024 && i < units.length - 1);
  return `${val.toFixed(1)} ${units[i]}`;
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 120) || "audio";
}

function triggerDownload(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ================= FFmpeg loading (shared) =================
async function ensureFFmpegLoaded(onStatus) {
  if (ffmpeg) return ffmpeg;
  if (ffmpegLoadingPromise) return ffmpegLoadingPromise;

  ffmpegLoadingPromise = (async () => {
    onStatus("Caricamento motore di conversione…");
    const instance = new FFmpeg();
    instance.on("log", ({ message }) => {
      console.debug("[ffmpeg]", message);
    });

    const coreURL = await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript");
    const wasmURL = await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm");
    const classWorkerURL = await toBlobURL(WORKER_URL, "text/javascript");

    await instance.load({ coreURL, wasmURL, classWorkerURL });
    ffmpeg = instance;
    return instance;
  })();

  return ffmpegLoadingPromise;
}

// ================= Shared conversion core =================
// Converts any audio/video File/Blob to an MP3 Blob using ffmpeg.wasm.
async function convertToMp3(file, { bitrate, channels, onProgress, onStatus }) {
  const engine = await ensureFFmpegLoaded((msg) => onStatus(msg));

  const progressHandler = ({ progress }) => {
    const pct = Math.min(99, Math.max(0, Math.round(progress * 100)));
    onProgress(pct);
  };
  engine.on("progress", progressHandler);

  const ext = extensionOf(file.name) || ".dat";
  const inputName = `input${ext}`;
  const outputName = "output.mp3";

  try {
    onStatus("Lettura file…");
    await engine.writeFile(inputName, await fetchFile(file));

    onStatus("Conversione in corso…");
    await engine.exec([
      "-i", inputName,
      "-vn",
      "-ac", channels,
      "-c:a", "libmp3lame",
      "-b:a", `${bitrate}k`,
      outputName,
    ]);

    const data = await engine.readFile(outputName);
    const blob = new Blob([data.buffer], { type: "audio/mpeg" });

    await engine.deleteFile(inputName).catch(() => {});
    await engine.deleteFile(outputName).catch(() => {});

    return blob;
  } finally {
    engine.off("progress", progressHandler);
  }
}

// ================= Video panel =================
browseBtn.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("click", (e) => {
  if (e.target === browseBtn) return;
  fileInput.click();
});

fileInput.addEventListener("change", () => {
  if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
});

["dragenter", "dragover"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
});
["dragleave", "drop"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  });
});
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) handleFile(file);
});

function handleFile(file) {
  const ext = extensionOf(file.name);
  if (!ACCEPTED_EXT.includes(ext)) {
    showError("Formato non supportato. Carica un file MP4 o MOV.");
    return;
  }
  if (file.size > MAX_SIZE_BYTES) {
    showError(
      `Il file è di ${formatBytes(file.size)}. Per file oltre 500 MB la conversione nel browser può essere lenta o non riuscire: prova un file più corto oppure usa un desktop con più memoria.`
    );
    return;
  }

  selectedFile = file;
  fileName.textContent = file.name;
  fileMeta.textContent = `${formatBytes(file.size)} · ${ext.replace(".", "").toUpperCase()}`;

  resetBlocks();
  fileInfo.classList.remove("hidden");
}

removeFileBtn.addEventListener("click", () => {
  selectedFile = null;
  fileInput.value = "";
  fileInfo.classList.add("hidden");
  resetBlocks();
});

function resetBlocks() {
  progressBlock.classList.add("hidden");
  doneBlock.classList.add("hidden");
  errorBlock.classList.add("hidden");
}

convertBtn.addEventListener("click", () => {
  if (!selectedFile) return;
  runVideoConversion(selectedFile).catch((err) => {
    console.error(err);
    showError(
      err && err.message
        ? `Errore durante la conversione: ${err.message}`
        : "Errore imprevisto durante la conversione. Riprova con un file più corto o riduci la qualità."
    );
  });
});

async function runVideoConversion(file) {
  resetBlocks();
  progressBlock.classList.remove("hidden");
  setProgress(0, "Preparazione…");

  const blob = await convertToMp3(file, {
    bitrate: qualitySelect.value,
    channels: channelsSelect.value,
    onProgress: (pct) => setProgress(pct, "Conversione in corso…"),
    onStatus: (msg) => setProgress(0, msg),
  });

  setProgress(100, "Finalizzazione…");
  const url = URL.createObjectURL(blob);
  const baseName = file.name.replace(/\.[^/.]+$/, "");
  const outName = `${baseName}.mp3`;

  if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);
  lastDownloadUrl = url;
  lastDownloadName = outName;

  triggerDownload(url, outName);

  progressBlock.classList.add("hidden");
  doneBlock.classList.remove("hidden");
  doneSub.textContent = `"${outName}" — il download è partito automaticamente.`;
}

function setProgress(pct, label) {
  progressFill.style.width = `${pct}%`;
  progressPercent.textContent = `${pct}%`;
  progressStatus.textContent = label;
}

function showError(message) {
  resetBlocks();
  errorMessage.textContent = message;
  errorBlock.classList.remove("hidden");
}

downloadAgainBtn.addEventListener("click", () => {
  if (lastDownloadUrl && lastDownloadName) triggerDownload(lastDownloadUrl, lastDownloadName);
});

convertAnotherBtn.addEventListener("click", () => {
  selectedFile = null;
  fileInput.value = "";
  fileInfo.classList.add("hidden");
  resetBlocks();
});

errorRetryBtn.addEventListener("click", () => resetBlocks());

// ================= YouTube panel =================
function ytResetBlocks() {
  ytProgressBlock.classList.add("hidden");
  ytDoneBlock.classList.add("hidden");
  ytErrorBlock.classList.add("hidden");
}

function ytSetProgress(pct, label) {
  ytProgressFill.style.width = `${pct}%`;
  ytProgressPercent.textContent = `${pct}%`;
  ytProgressStatus.textContent = label;
}

function ytShowError(message) {
  ytResetBlocks();
  ytErrorMessage.textContent = message;
  ytErrorBlock.classList.remove("hidden");
}

ytConvertBtn.addEventListener("click", () => {
  const url = ytUrlInput.value.trim();
  if (!YT_URL_RE.test(url)) {
    ytShowError("Inserisci un link YouTube valido (youtube.com o youtu.be).");
    return;
  }
  runYtConversion(url).catch((err) => {
    console.error(err);
    ytShowError(
      err && err.message ? err.message : "Errore imprevisto durante la conversione."
    );
  });
});

async function runYtConversion(url) {
  ytResetBlocks();
  ytProgressBlock.classList.remove("hidden");
  ytSetProgress(0, "Scaricamento audio da YouTube…");

  const res = await fetch("/api/yt-audio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    let message = "Impossibile scaricare l'audio da questo link.";
    try {
      const data = await res.json();
      if (data && data.error) message = data.error;
    } catch (_) {
      // ignore parse errors, use default message
    }
    throw new Error(message);
  }

  const title = decodeURIComponent(res.headers.get("X-Video-Title") || "audio");
  const ext = res.headers.get("X-Audio-Ext") || "mp4";
  const sourceBlob = await res.blob();
  const sourceFile = new File([sourceBlob], `source.${ext}`, { type: sourceBlob.type });

  ytSetProgress(20, "Audio scaricato. Conversione in corso…");

  const mp3Blob = await convertToMp3(sourceFile, {
    bitrate: ytQualitySelect.value,
    channels: ytChannelsSelect.value,
    onProgress: (pct) => ytSetProgress(20 + Math.round(pct * 0.8), "Conversione in corso…"),
    onStatus: (msg) => ytSetProgress(20, msg),
  });

  ytSetProgress(100, "Finalizzazione…");
  const outUrl = URL.createObjectURL(mp3Blob);
  const outName = `${sanitizeFilename(title)}.mp3`;

  if (ytLastDownloadUrl) URL.revokeObjectURL(ytLastDownloadUrl);
  ytLastDownloadUrl = outUrl;
  ytLastDownloadName = outName;

  triggerDownload(outUrl, outName);

  ytProgressBlock.classList.add("hidden");
  ytDoneBlock.classList.remove("hidden");
  ytDoneSub.textContent = `"${outName}" — il download è partito automaticamente.`;
}

ytDownloadAgainBtn.addEventListener("click", () => {
  if (ytLastDownloadUrl && ytLastDownloadName) triggerDownload(ytLastDownloadUrl, ytLastDownloadName);
});

ytConvertAnotherBtn.addEventListener("click", () => {
  ytUrlInput.value = "";
  ytResetBlocks();
});

ytErrorRetryBtn.addEventListener("click", () => ytResetBlocks());
