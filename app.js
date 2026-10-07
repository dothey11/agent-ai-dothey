/**
 * Agent AI Dothey - Private Workspace Client
 * Engine: Google Gemini API (Dynamic Discovery & Auto-Fallback) via Client-Side In-Context RAG
 * Storage: Local IndexedDB (Kapasitas Besar) & Cloud Sync (Google Drive AppData)
 * Layout: Responsive Off-Canvas Drawer (Optimal Mobile & Desktop)
 */

// =========================================================================
// 1. INISIALISASI DATABASE LOKAL (IndexedDB)
// =========================================================================
const DB_NAME = "AgentDotheyDB";
const DB_VERSION = 1;
const STORE_NAME = "chat_sessions";
const SETTINGS_KEY = "dothey_rag_settings_v2";

let sessions = [];
let activeSessionId = null;
let stagedFiles = [];
let gdriveToken = null;
let tokenClient = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllSessionsFromDB() {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function saveSessionToDB(session) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).put(session);
}

async function bulkSaveSessionsToDB(newSessions) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    newSessions.forEach((s, idx) => {
      if (!s.id) {
        s.id = "session_" + Date.now() + "_" + idx + "_" + Math.random().toString(36).substring(2, 7);
      }
      store.put(s);
    });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteSessionFromDB(id) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).delete(id);
}

async function clearAllSessionsFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || JSON.stringify({
  apiKey: "",
  model: "gemini-2.5-flash",
  clientId: "",
  systemInstruction: "Anda adalah Agent AI Dothey, asisten analitik tingkat lanjut yang mampu meneliti dokumen RAG, mengekstrak data dari berkas yang diunggah, dan memberikan jawaban terstruktur dengan akurasi tinggi."
}));

// =========================================================================
// 2. REFERENSI ELEMEN DOM
// =========================================================================
const sidebar = document.getElementById("sidebar");
const toggleSidebarBtn = document.getElementById("toggleSidebar");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
const closeSidebarMobileBtn = document.getElementById("closeSidebarMobileBtn");

const historyList = document.getElementById("historyList");
const searchHistoryInput = document.getElementById("searchHistoryInput");
const newChatBtn = document.getElementById("newChatBtn");
const currentChatTitle = document.getElementById("currentChatTitle");
const chatMessages = document.getElementById("chatMessages");
const welcomeMessage = document.getElementById("welcomeMessage");
const promptInput = document.getElementById("promptInput");
const chatForm = document.getElementById("chatForm");
const sendBtn = document.getElementById("sendBtn");

const attachBtn = document.getElementById("attachBtn");
const fileAttachmentInput = document.getElementById("fileAttachmentInput");
const stagedFilesContainer = document.getElementById("stagedFilesContainer");

const openSettingsBtn = document.getElementById("openSettingsBtn");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const settingsModal = document.getElementById("settingsModal");
const apiKeyInput = document.getElementById("apiKeyInput");
const toggleApiKeyVis = document.getElementById("toggleApiKeyVis");
const modelSelect = document.getElementById("modelSelect");
const clientIdInput = document.getElementById("clientIdInput");
const systemInstructionInput = document.getElementById("systemInstructionInput");
const modelIndicatorBadge = document.getElementById("modelIndicatorBadge");

const gdriveSyncBtn = document.getElementById("gdriveSyncBtn");
const syncStatusText = document.getElementById("syncStatusText");
const syncBadge = document.getElementById("syncBadge");
const syncCloudIcon = document.getElementById("syncCloudIcon");

const importBtn = document.getElementById("importBtn");
const importFileInput = document.getElementById("importFileInput");
const exportAllBtn = document.getElementById("exportAllBtn");
const exportSingleMdBtn = document.getElementById("exportSingleMdBtn");
const clearChatBtn = document.getElementById("clearChatBtn");

// =========================================================================
// 3. LOGIKA RESPONSIVE DRAWER SIDEBAR (Mobile & Desktop)
// =========================================================================
function openSidebarMobile() {
  sidebar.classList.remove("-translate-x-full");
  if (sidebarBackdrop) sidebarBackdrop.classList.remove("hidden");
}

function closeSidebarMobile() {
  if (window.innerWidth < 768) {
    sidebar.classList.add("-translate-x-full");
    if (sidebarBackdrop) sidebarBackdrop.classList.add("hidden");
  }
}

toggleSidebarBtn.addEventListener("click", () => {
  if (window.innerWidth < 768) {
    if (sidebar.classList.contains("-translate-x-full")) {
      openSidebarMobile();
    } else {
      closeSidebarMobile();
    }
  } else {
    sidebar.classList.toggle("md:hidden");
  }
});

if (sidebarBackdrop) sidebarBackdrop.addEventListener("click", closeSidebarMobile);
if (closeSidebarMobileBtn) closeSidebarMobileBtn.addEventListener("click", closeSidebarMobile);

// =========================================================================
// 4. INISIALISASI & MANAJEMEN SESI PERCAKAPAN
// =========================================================================
async function init() {
  if (window.lucide) lucide.createIcons();

  // Otomatis bersihkan model lama yang ditutup Google
  const deprecatedModels = ["gemini-1.5-pro", "gemini-2.0-flash", "gemini-2.5-pro"];
  if (!settings.model || deprecatedModels.includes(settings.model)) {
    settings.model = "gemini-3.8-flash";
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  apiKeyInput.value = settings.apiKey || "";
  modelSelect.value = settings.model || "gemini-3.8-flash";
  clientIdInput.value = settings.clientId || "";
  systemInstructionInput.value = settings.systemInstruction || "";
  modelIndicatorBadge.textContent = settings.model.replace("gemini-", "");

  sessions = await getAllSessionsFromDB();
  sessions.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

  if (sessions.length === 0) {
    createNewSession();
  } else {
    loadSession(sessions[0].id);
  }
  renderHistory();
}

function createNewSession() {
  const newSession = {
    id: "dothey_" + Date.now(),
    title: "Percakapan Baru",
    timestamp: new Date().toISOString(),
    messages: []
  };
  sessions.unshift(newSession);
  activeSessionId = newSession.id;
  saveSessions();
  loadSession(newSession.id);
  renderHistory();
  closeSidebarMobile();
}

function loadSession(id) {
  activeSessionId = id;
  const session = sessions.find(s => s.id === id);
  if (!session) return;

  currentChatTitle.textContent = session.title;
  renderMessages(session.messages);
  renderHistory();
  closeSidebarMobile();
}

async function saveSessions() {
  const current = sessions.find(s => s.id === activeSessionId);
  if (current) {
    await saveSessionToDB(current);
  }
  pushToDrive();
}

async function deleteSession(id) {
  await deleteSessionFromDB(id);
  sessions = sessions.filter(s => s.id !== id);
  if (sessions.length === 0) {
    createNewSession();
  } else if (activeSessionId === id) {
    loadSession(sessions[0].id);
  } else {
    renderHistory();
  }
  // Sinkronisasi otomatis ke Google Drive saat sesi dihapus
  await pushToDrive();
}

async function renameSession(id) {
  const session = sessions.find(s => s.id === id);
  if (!session) return;

  const currentTitle = session.title || "Percakapan Baru";
  const newTitle = prompt("Masukkan judul baru untuk percakapan ini:", currentTitle);

  if (newTitle !== null && newTitle.trim() !== "") {
    session.title = newTitle.trim();
    await saveSessionToDB(session);

    if (activeSessionId === id) {
      currentChatTitle.textContent = session.title;
    }

    renderHistory();
    await pushToDrive();
  }
}

function renderHistory(filterText = "") {
  historyList.innerHTML = "";
  const query = filterText.toLowerCase();

  const filtered = sessions.filter(s =>
    s.title.toLowerCase().includes(query) ||
    s.messages.some(m => m.content && m.content.toLowerCase().includes(query))
  );

  if (filtered.length === 0) {
    historyList.innerHTML = `<div class="text-center py-6 text-slate-500 text-xs">Tidak ada riwayat ditemukan.</div>`;
    return;
  }

  filtered.forEach(session => {
    const isActive = session.id === activeSessionId;
    const item = document.createElement("div");
    item.className = `group flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer text-xs transition ${
      isActive ? "bg-slate-800 text-slate-100 font-medium border border-slate-700/60" : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
    }`;

    item.innerHTML = `
      <div class="flex items-center gap-2.5 truncate flex-1 mr-2 min-w-0">
        <i data-lucide="${isActive ? 'message-square-text' : 'message-square'}" class="w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-teal-400' : 'text-slate-500'}"></i>
        <span class="truncate">${session.title}</span>
      </div>
      <div class="flex items-center gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition shrink-0">
        <button class="rename-btn p-1 hover:text-teal-400 text-slate-400 transition" title="Ubah Judul">
          <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
        </button>
        <button class="delete-btn p-1 hover:text-rose-400 text-slate-400 transition" title="Hapus">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    `;

    item.addEventListener("click", (e) => {
      if (e.target.closest(".rename-btn")) {
        renameSession(session.id);
      } else if (e.target.closest(".delete-btn")) {
        deleteSession(session.id);
      } else {
        loadSession(session.id);
      }
    });

    historyList.appendChild(item);
  });

  if (window.lucide) lucide.createIcons();
}

// =========================================================================
// 5. RENDERING TAMPILAN PESAN & MARKDOWN
// =========================================================================
function renderMessages(messages) {
  chatMessages.innerHTML = "";
  if (!messages || messages.length === 0) {
    chatMessages.appendChild(welcomeMessage);
    welcomeMessage.classList.remove("hidden");
    return;
  }
  welcomeMessage.classList.add("hidden");

  messages.forEach(msg => appendMessageUI(msg.role, msg.content, msg.files));
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendMessageUI(role, content, files = []) {
  welcomeMessage.classList.add("hidden");
  const wrapper = document.createElement("div");
  const isUser = role === "user";

  wrapper.className = `flex gap-2.5 sm:gap-3 text-sm ${isUser ? "justify-end" : "justify-start"}`;

  const messageBox = document.createElement("div");
  messageBox.className = isUser
    ? "bg-gradient-to-r from-teal-950/70 to-emerald-950/60 border border-teal-800/40 rounded-2xl px-3.5 py-2.5 max-w-[88%] text-slate-100 shadow-md"
    : "prose-custom max-w-[94%] text-slate-200 bg-transparent py-1 w-full";

  if (files && files.length > 0) {
    const fileContainer = document.createElement("div");
    fileContainer.className = "flex flex-wrap gap-1.5 mb-2 pb-2 border-b border-teal-800/30";
    files.forEach(f => {
      const chip = document.createElement("div");
      chip.className = "flex items-center gap-1.5 px-2 py-0.5 bg-slate-900/80 border border-slate-700/60 rounded-lg text-xs text-teal-300";
      chip.innerHTML = `<i data-lucide="file-text" class="w-3.5 h-3.5"></i> <span class="truncate max-w-[130px]">${f.name}</span>`;
      fileContainer.appendChild(chip);
    });
    messageBox.appendChild(fileContainer);
  }

  const textNode = document.createElement("div");
  if (isUser) {
    textNode.textContent = content;
  } else {
    textNode.innerHTML = renderMarkdownWithCodeBlocks(content);
    setupCopyCodeButtons(textNode);
  }
  messageBox.appendChild(textNode);

  wrapper.appendChild(messageBox);
  chatMessages.appendChild(wrapper);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  if (window.lucide) lucide.createIcons();
  return textNode;
}

function renderMarkdownWithCodeBlocks(markdownText) {
  if (!markdownText) return "";

  let rawHtml = "";
  try {
    rawHtml = (typeof marked !== "undefined" && marked.parse)
      ? marked.parse(markdownText)
      : markdownText;
  } catch (err) {
    rawHtml = markdownText;
  }

  const temp = document.createElement("div");
  temp.innerHTML = rawHtml;

  const preElements = Array.from(temp.querySelectorAll("pre"));
  preElements.forEach((pre) => {
    if (pre.parentElement && pre.parentElement.classList.contains("code-container")) return;

    const parent = pre.parentNode;
    if (!parent) return;

    const codeBlock = pre.querySelector("code");
    if (codeBlock && window.hljs) {
      try {
        hljs.highlightElement(codeBlock);
      } catch (err) {}
    }

    const lang = codeBlock?.className.match(/language-(\w+)/)?.[1] || "code";

    const container = document.createElement("div");
    container.className = "code-container";
    container.innerHTML = `
      <div class="code-header">
        <span>${lang}</span>
        <button type="button" class="copy-code-btn hover:text-white transition flex items-center gap-1">
          <i data-lucide="copy" class="w-3 h-3"></i> Salin
        </button>
      </div>
    `;

    parent.insertBefore(container, pre);
    container.appendChild(pre);
  });

  return temp.innerHTML;
}

function setupCopyCodeButtons(container) {
  container.querySelectorAll(".copy-code-btn").forEach((btn) => {
    btn.onclick = () => {
      const codeEl = btn.closest(".code-container")?.querySelector("pre code");
      if (!codeEl) return;
      navigator.clipboard.writeText(codeEl.innerText).then(() => {
        btn.innerHTML = `<i data-lucide="check" class="w-3 h-3 text-teal-400"></i> Disalin!`;
        if (window.lucide) lucide.createIcons();
        setTimeout(() => {
          btn.innerHTML = `<i data-lucide="copy" class="w-3 h-3"></i> Salin`;
          if (window.lucide) lucide.createIcons();
        }, 2000);
      });
    };
  });
  if (window.lucide) lucide.createIcons();
}

// =========================================================================
// 6. IN-CONTEXT RAG & PENGOLAHAN FILE TERLAMPIR
// =========================================================================
attachBtn.addEventListener("click", () => fileAttachmentInput.click());

fileAttachmentInput.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files);
  for (const file of files) {
    await processSelectedFile(file);
  }
  fileAttachmentInput.value = "";
  renderStagedFiles();
});

async function processSelectedFile(file) {
  const isText = file.type.includes("text") ||
    file.name.endsWith(".txt") ||
    file.name.endsWith(".md") ||
    file.name.endsWith(".csv") ||
    file.name.endsWith(".json");

  return new Promise((resolve) => {
    const reader = new FileReader();
    if (isText) {
      reader.onload = (e) => {
        stagedFiles.push({
          name: file.name,
          type: file.type || "text/plain",
          size: file.size,
          isText: true,
          content: e.target.result
        });
        resolve();
      };
      reader.readAsText(file);
    } else {
      reader.onload = (e) => {
        const base64Data = e.target.result.split(",")[1];
        stagedFiles.push({
          name: file.name,
          type: file.type || (file.name.endsWith(".pdf") ? "application/pdf" : "image/jpeg"),
          size: file.size,
          isText: false,
          base64: base64Data
        });
        resolve();
      };
      reader.readAsDataURL(file);
    }
  });
}

function renderStagedFiles() {
  stagedFilesContainer.innerHTML = "";
  if (stagedFiles.length === 0) {
    stagedFilesContainer.classList.add("hidden");
    return;
  }
  stagedFilesContainer.classList.remove("hidden");

  stagedFiles.forEach((file, index) => {
    const chip = document.createElement("div");
    chip.className = "flex items-center gap-1.5 px-2.5 py-1 bg-slate-900 border border-slate-700/80 rounded-lg text-xs text-slate-200";
    chip.innerHTML = `
      <i data-lucide="${file.isText ? 'file-text' : 'file'}" class="w-3.5 h-3.5 text-teal-400"></i>
      <span class="truncate max-w-[120px]">${file.name}</span>
      <span class="text-[10px] text-slate-500">(${Math.round(file.size / 1024)}KB)</span>
      <button type="button" class="remove-file-btn text-slate-400 hover:text-rose-400 ml-1">
        <i data-lucide="x" class="w-3 h-3"></i>
      </button>
    `;
    chip.querySelector(".remove-file-btn").addEventListener("click", () => {
      stagedFiles.splice(index, 1);
      renderStagedFiles();
    });
    stagedFilesContainer.appendChild(chip);
  });
  if (window.lucide) lucide.createIcons();
}

// =========================================================================
// 7. INTEGRASI GEMINI API (DYNAMIC MODEL DISCOVERY & SMART FALLBACK)
// =========================================================================
async function getActiveGeminiModel(apiKey) {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (res.ok) {
      const data = await res.json();
      const validModels = (data.models || [])
        .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
        .map(m => m.name.replace(/^models\//, ""));

      if (settings.model && validModels.includes(settings.model)) {
        return settings.model;
      }

      const preferred = validModels.find(m => m === "gemini-2.5-flash")
                     || validModels.find(m => m === "gemini-2.5-pro")
                     || validModels.find(m => m.includes("2.5"))
                     || validModels.find(m => m.includes("flash"))
                     || validModels[0];

      if (preferred) {
        settings.model = preferred;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        if (modelIndicatorBadge) {
          modelIndicatorBadge.textContent = preferred.replace("gemini-", "");
        }
        return preferred;
      }
    }
  } catch (err) {
    console.warn("ListModels tidak dapat diakses, beralih ke fallback default:", err);
  }

  return "gemini-2.5-flash";
}

// =========================================================================
// INTEGRASI GEMINI API DENGAN SMART AUTO-RESOLVER & FALLBACK RESMI
// =========================================================================
async function sendToGemini(historyMessages) {
  if (!settings.apiKey) {
    throw new Error("API Key belum dipasang. Buka Pengaturan untuk memasukkan Gemini API Key.");
  }

  // Daftar model aktif terbaru sesuai arahan Google
  const modelsToTry = [
    settings.model || "gemini-3.8-flash",
    "gemini-3.8-flash",
    "gemini-3.1-pro-preview",
    "gemini-2.5-flash"
  ];

  const contents = historyMessages.map(m => {
    const parts = [];
    if (m.files && m.files.length > 0) {
      m.files.forEach(f => {
        if (f.isText) {
          parts.push({ text: `[DOKUMEN TERLAMPIR: ${f.name}]\n\`\`\`\n${f.content}\n\`\`\`\n` });
        } else {
          parts.push({ inlineData: { mimeType: f.type, data: f.base64 } });
        }
      });
    }
    if (m.content) parts.push({ text: m.content });
    return { role: m.role === "user" ? "user" : "model", parts };
  });

  const payload = { contents };
  if (settings.systemInstruction && settings.systemInstruction.trim()) {
    payload.systemInstruction = { parts: [{ text: settings.systemInstruction }] };
  }

  let lastError = null;

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.apiKey}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        if (data.candidates && data.candidates.length > 0 && data.candidates[0].content?.parts?.[0]?.text) {
          // Simpan model yang sukses agar panggilan berikutnya langsung instan
          if (settings.model !== model) {
            settings.model = model;
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
            if (modelIndicatorBadge) {
              modelIndicatorBadge.textContent = model.replace("gemini-", "");
            }
          }
          return data.candidates[0].content.parts[0].text;
        }
        throw new Error("Model tidak memberikan respon atau diblokir filter keamanan.");
      }

      const errData = await res.json();
      const errMsg = errData.error?.message || `HTTP ${res.status}`;
      lastError = new Error(errMsg);

      // OTOMATIS AMBIL NAMA MODEL DARI PESAN ERROR GOOGLE JIKA ADA PERUBAHAN VERSI
      const suggestMatch = errMsg.match(/use models\/([a-zA-Z0-9\.\-_]+)/i);
      if (suggestMatch && suggestMatch[1]) {
        const suggestedModel = suggestMatch[1];
        if (!modelsToTry.includes(suggestedModel)) {
          modelsToTry.splice(i + 1, 0, suggestedModel);
        }
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("Gagal menghubungi server Gemini API.");
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = promptInput.value.trim();
  if (!text && stagedFiles.length === 0) return;

  const session = sessions.find(s => s.id === activeSessionId);
  if (!session) return;

  const currentFiles = [...stagedFiles];
  stagedFiles = [];
  renderStagedFiles();

  session.messages.push({
    role: "user",
    content: text,
    files: currentFiles
  });

  if (session.messages.length === 1) {
    session.title = text ? text.slice(0, 36) + (text.length > 36 ? "..." : "") : (currentFiles[0]?.name || "Percakapan Baru");
    currentChatTitle.textContent = session.title;
  }

  appendMessageUI("user", text, currentFiles);
  promptInput.value = "";
  promptInput.style.height = "auto";
  saveSessions();
  renderHistory();

  sendBtn.disabled = true;
  const assistantBubble = appendMessageUI("model", "*Agent AI Dothey sedang menganalisis...*");

  try {
    const reply = await sendToGemini(session.messages);
    session.messages.push({ role: "model", content: reply });
    assistantBubble.innerHTML = renderMarkdownWithCodeBlocks(reply);
    setupCopyCodeButtons(assistantBubble);
    saveSessions();
  } catch (err) {
    assistantBubble.innerHTML = `<span class="text-rose-400 font-medium">⚠️ Error: ${err.message}</span>`;
  } finally {
    sendBtn.disabled = false;
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
});

promptInput.addEventListener("input", () => {
  promptInput.style.height = "auto";
  promptInput.style.height = promptInput.scrollHeight + "px";
});

promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event("submit"));
  }
});

// =========================================================================
// 8. SINKRONISASI GOOGLE DRIVE
// =========================================================================
function initGoogleAuth() {
  if (!window.google || !settings.clientId) return;

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: settings.clientId,
    scope: "https://www.googleapis.com/auth/drive.appdata",
    callback: async (response) => {
      if (response.error) return console.error("OAuth Error:", response);
      gdriveToken = response.access_token;
      updateSyncStatus("Tersambung", "bg-emerald-500", "text-emerald-400");
      await pullFromDrive();
    },
  });
}

function updateSyncStatus(text, badgeClass, iconClass) {
  syncStatusText.textContent = text;
  syncBadge.className = `w-2 h-2 rounded-full ${badgeClass}`;
  syncCloudIcon.className = `w-4 h-4 ${iconClass}`;
}

gdriveSyncBtn.addEventListener("click", () => {
  if (!settings.clientId) {
    alert("Silakan masukkan Google OAuth Client ID terlebih dahulu di Pengaturan.");
    settingsModal.classList.remove("hidden");
    return;
  }
  if (!tokenClient) initGoogleAuth();
  tokenClient.requestAccessToken({ prompt: "" });
});

async function findDriveBackupFile() {
  const res = await fetch(
    "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='dothey_rag_backup.json'&fields=files(id,name)",
    { headers: { Authorization: `Bearer ${gdriveToken}` } }
  );
  const data = await res.json();
  return data.files && data.files.length > 0 ? data.files[0] : null;
}

async function pullFromDrive() {
  if (!gdriveToken) return;
  updateSyncStatus("Menyinkronkan...", "bg-amber-500", "text-amber-400");

  try {
    const file = await findDriveBackupFile();

    if (file) {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
        { headers: { Authorization: `Bearer ${gdriveToken}` } }
      );
      const cloudSessions = await res.json();

      if (Array.isArray(cloudSessions)) {
        await clearAllSessionsFromDB();

        if (cloudSessions.length > 0) {
          await bulkSaveSessionsToDB(cloudSessions);
          sessions = await getAllSessionsFromDB();
          sessions.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

          if (!sessions.find(s => s.id === activeSessionId)) {
            loadSession(sessions[0].id);
          }
        } else {
          sessions = [];
          createNewSession();
        }

        renderHistory();
      }
    } else {
      if (sessions.some(s => s.messages && s.messages.length > 0)) {
        await pushToDrive();
      }
    }
    updateSyncStatus("Tersinkron", "bg-emerald-500", "text-emerald-400");
  } catch (err) {
    console.error("Gagal sinkron dari Drive:", err);
    updateSyncStatus("Gagal Sync", "bg-rose-500", "text-rose-400");
  }
}

async function pushToDrive() {
  if (!gdriveToken) return;

  try {
    const file = await findDriveBackupFile();
    const boundary = "-------dotheyragboundary";
    const delimiter = "\r\n--" + boundary + "\r\n";
    const closeDelim = "\r\n--" + boundary + "--";

    const metadata = {
      name: "dothey_rag_backup.json",
      mimeType: "application/json",
      parents: ["appDataFolder"]
    };

    const multipartRequestBody =
      delimiter +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(metadata) +
      delimiter +
      "Content-Type: application/json\r\n\r\n" +
      JSON.stringify(sessions) +
      closeDelim;

    let url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
    let method = "POST";

    if (file) {
      url = `https://www.googleapis.com/upload/drive/v3/files/${file.id}?uploadType=multipart`;
      method = "PATCH";
    }

    await fetch(url, {
      method: method,
      headers: {
        Authorization: `Bearer ${gdriveToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body: multipartRequestBody
    });
    updateSyncStatus("Tersinkron", "bg-emerald-500", "text-emerald-400");
  } catch (err) {
    console.error("Gagal unggah ke Drive:", err);
  }
}

// =========================================================================
// 9. PENGATURAN KREDENSIAL & PARSING IMPOR TAKEOUT
// =========================================================================
openSettingsBtn.addEventListener("click", () => settingsModal.classList.remove("hidden"));
closeSettingsBtn.addEventListener("click", () => settingsModal.classList.add("hidden"));

saveSettingsBtn.addEventListener("click", () => {
  settings.apiKey = apiKeyInput.value.trim();
  settings.model = modelSelect.value;
  settings.clientId = clientIdInput.value.trim();
  settings.systemInstruction = systemInstructionInput.value.trim();

  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  modelIndicatorBadge.textContent = settings.model.replace("gemini-", "");
  settingsModal.classList.add("hidden");
  if (settings.clientId) initGoogleAuth();
});

toggleApiKeyVis.addEventListener("click", () => {
  apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
});

searchHistoryInput.addEventListener("input", (e) => renderHistory(e.target.value));

importBtn.addEventListener("click", () => importFileInput.click());

importFileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const rawData = JSON.parse(event.target.result);
      const rawList = Array.isArray(rawData) ? rawData : (rawData.conversations || [rawData]);

      if (rawList.length === 0) throw new Error("Berkas JSON kosong.");

      const validLogs = rawList.filter(item => {
        const title = (item.title || item.name || "").trim().toLowerCase();
        if (title === "cleared previous feedback") return false;

        const hasPrompt = title.startsWith("prompted") || title.length > 0;
        const hasResponse = item.safeHtmlItem && Array.isArray(item.safeHtmlItem) && item.safeHtmlItem.length > 0;
        return hasPrompt || hasResponse;
      });

      validLogs.sort((a, b) => new Date(a.time || 0) - new Date(b.time || 0));

      const threadMap = new Map();

      validLogs.forEach((item, idx) => {
        const rawTitle = (item.title || item.name || "").trim();
        let promptText = rawTitle
          .replace(/^(Prompted|Prompt:|Asked|Berinteraksi dengan Gemini)\s*/i, "")
          .trim();

        if (!promptText && item.messages && item.messages[0]) {
          promptText = item.messages[0].content;
        }

        let responseContent = "";
        if (item.safeHtmlItem && Array.isArray(item.safeHtmlItem) && item.safeHtmlItem.length > 0) {
          responseContent = item.safeHtmlItem.map(s => s.html || "").join("\n\n");
        } else if (item.response || item.answer) {
          responseContent = item.response || item.answer;
        } else if (item.description) {
          responseContent = item.description;
        }

        if (!responseContent.trim()) {
          responseContent = "*(Tidak ada rekaman respon untuk perintah ini)*";
        }

        let targetUrl = item.titleUrl || "";
        if (!targetUrl && item.details && Array.isArray(item.details) && item.details.length > 0) {
          targetUrl = item.details[0].url || item.details[0].name || "";
        }

        let threadId = null;
        const urlMatch = targetUrl.match(/app\/([a-zA-Z0-9]+)/);
        if (urlMatch && urlMatch[1]) {
          threadId = "gemini_session_" + urlMatch[1];
        } else if (item.id) {
          threadId = item.id;
        } else {
          const cleanTitle = promptText.slice(0, 24).toLowerCase().replace(/[^a-z0-9]/g, "_");
          threadId = "session_" + (item.time || "legacy").slice(0, 10) + "_" + cleanTitle;
        }

        if (!threadMap.has(threadId)) {
          const firstTitle = promptText.slice(0, 38) + (promptText.length > 38 ? "..." : "");
          threadMap.set(threadId, {
            id: threadId,
            title: firstTitle || `Percakapan #${idx + 1}`,
            timestamp: item.time || new Date().toISOString(),
            messages: [
              { role: "user", content: promptText || "Pertanyaan Awal" },
              { role: "model", content: responseContent }
            ]
          });
        } else {
          const existingThread = threadMap.get(threadId);
          existingThread.messages.push({ role: "user", content: promptText || "Pertanyaan Lanjutan" });
          existingThread.messages.push({ role: "model", content: responseContent });
          existingThread.timestamp = item.time || existingThread.timestamp;
        }
      });

      const formattedSessions = Array.from(threadMap.values());
      if (formattedSessions.length === 0) {
        throw new Error("Tidak ada data percakapan yang valid untuk diimpor.");
      }

      await clearAllSessionsFromDB();
      await bulkSaveSessionsToDB(formattedSessions);

      sessions = await getAllSessionsFromDB();
      sessions.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

      loadSession(sessions[0].id);
      renderHistory();

      await pushToDrive();

      alert(`Berhasil! ${validLogs.length} aktivitas log telah digabungkan menjadi ${formattedSessions.length} sesi percakapan utuh.`);
    } catch (err) {
      alert("Gagal memproses berkas: " + err.message);
    } finally {
      importFileInput.value = "";
    }
  };
  reader.readAsText(file);
});

// =========================================================================
// 10. EKSPOR DOKUMEN & PEMBERSIHAN
// =========================================================================
exportAllBtn.addEventListener("click", () => {
  const a = document.createElement("a");
  const blob = new Blob([JSON.stringify(sessions, null, 2)], { type: "application/json" });
  a.href = URL.createObjectURL(blob);
  a.download = `agent_ai_dothey_backup_${Date.now()}.json`;
  a.click();
});

exportSingleMdBtn.addEventListener("click", () => {
  const session = sessions.find(s => s.id === activeSessionId);
  if (!session || session.messages.length === 0) return;

  let md = `# ${session.title}\n*Waktu: ${new Date(session.timestamp).toLocaleString("id-ID")}*\n\n---\n\n`;
  session.messages.forEach(m => {
    md += `${m.role === "user" ? "### 👤 Pengguna" : "### 🤖 Agent AI Dothey"}\n\n`;
    if (m.files && m.files.length > 0) {
      md += `*Lampiran: ${m.files.map(f => f.name).join(", ")}*\n\n`;
    }
    md += `${m.content}\n\n---\n\n`;
  });

  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
  a.download = `${session.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
  a.click();
});

clearChatBtn.addEventListener("click", () => {
  const session = sessions.find(s => s.id === activeSessionId);
  if (!session) return;
  if (confirm("Hapus seluruh pesan di obrolan ini?")) {
    session.messages = [];
    saveSessions();
    renderMessages([]);
  }
});

newChatBtn.addEventListener("click", createNewSession);

window.addEventListener("DOMContentLoaded", () => {
  init();
  setTimeout(initGoogleAuth, 1200);
});
