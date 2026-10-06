// Storage Keys
//const SESSIONS_KEY = "dothey_rag_sessions_v2";
//const SETTINGS_KEY = "dothey_rag_settings_v2";

// State
//let sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]");
//let activeSessionId = null;
//let stagedFiles = []; // Berkas yang sedang diantrekan sebelum kirim

const SETTINGS_KEY = "dothey_rag_settings_v2";

// Inisialisasi IndexedDB (Kapasitas hingga Gigabyte)
const DB_NAME = "AgentDotheyDB";
const DB_VERSION = 1;
const STORE_NAME = "chat_sessions";

let sessions = []; // Diisi otomatis secara asinkron dari IndexedDB
let activeSessionId = null;
let stagedFiles = [];

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

//async function bulkSaveSessionsToDB(newSessions) {
//  const db = await openDB();
//  const tx = db.transaction(STORE_NAME, "readwrite");
//  const store = tx.objectStore(STORE_NAME);
//  newSessions.forEach(s => store.put(s));
//}
async function bulkSaveSessionsToDB(newSessions) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);

  newSessions.forEach((s, idx) => {
    // Pastikan 'id' selalu ada agar tidak ditolak IndexedDB
    if (!s.id) {
      s.id = "session_" + Date.now() + "_" + idx + "_" + Math.random().toString(36).substring(2, 7);
    }
    store.put(s);
  });

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteSessionFromDB(id) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).delete(id);
}


let gdriveToken = null;
let tokenClient = null;

let settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || JSON.stringify({
  apiKey: "",
  model: "gemini-1.5-pro",
  clientId: "",
  systemInstruction: "Anda adalah Agent AI Dothey, asisten analitik tingkat lanjut yang mampu meneliti dokumen RAG, mengekstrak data dari berkas yang diunggah, dan memberikan jawaban terstruktur dengan akurasi tinggi."
}));

// DOM Elements
const sidebar = document.getElementById("sidebar");
const toggleSidebarBtn = document.getElementById("toggleSidebar");
const historyList = document.getElementById("historyList");
const searchHistoryInput = document.getElementById("searchHistoryInput");
const newChatBtn = document.getElementById("newChatBtn");
const currentChatTitle = document.getElementById("currentChatTitle");
const chatMessages = document.getElementById("chatMessages");
const welcomeMessage = document.getElementById("welcomeMessage");
const promptInput = document.getElementById("promptInput");
const chatForm = document.getElementById("chatForm");
const sendBtn = document.getElementById("sendBtn");

// File Attachment Elements
const attachBtn = document.getElementById("attachBtn");
const fileAttachmentInput = document.getElementById("fileAttachmentInput");
const stagedFilesContainer = document.getElementById("stagedFilesContainer");

// Settings Modal Elements
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

// Drive Sync Elements
const gdriveSyncBtn = document.getElementById("gdriveSyncBtn");
const syncStatusText = document.getElementById("syncStatusText");
const syncBadge = document.getElementById("syncBadge");
const syncCloudIcon = document.getElementById("syncCloudIcon");

// Export & Import
const importBtn = document.getElementById("importBtn");
const importFileInput = document.getElementById("importFileInput");
const exportAllBtn = document.getElementById("exportAllBtn");
const exportSingleMdBtn = document.getElementById("exportSingleMdBtn");
const clearChatBtn = document.getElementById("clearChatBtn");

// Inisialisasi
//function init() {
//  lucide.createIcons();
//  apiKeyInput.value = settings.apiKey || "";
//  modelSelect.value = settings.model || "gemini-1.5-pro";
//  clientIdInput.value = settings.clientId || "";
//  systemInstructionInput.value = settings.systemInstruction || "";
//  modelIndicatorBadge.textContent = settings.model.replace("gemini-", "");

//  if (sessions.length === 0) {
//    createNewSession();
//  } else {
//    loadSession(sessions[0].id);
//  }
//  renderHistory();
//}
async function init() {
  lucide.createIcons();
  apiKeyInput.value = settings.apiKey || "";
  modelSelect.value = settings.model || "gemini-1.5-pro";
  clientIdInput.value = settings.clientId || "";
  systemInstructionInput.value = settings.systemInstruction || "";
  modelIndicatorBadge.textContent = settings.model.replace("gemini-", "");

  // Ambil data chat dari IndexedDB
  sessions = await getAllSessionsFromDB();
  sessions.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

  if (sessions.length === 0) {
    createNewSession();
  } else {
    loadSession(sessions[0].id);
  }
  renderHistory();
}



// Session Management
function createNewSession() {
  const newSession = {
    id: "dothey_" + Date.now(),
    title: "Percakapan Baru",
    timestamp: new Date().toISOString(),
    messages: []
  };
  sessions.unshift(newSession);
  saveSessions();
  loadSession(newSession.id);
  renderHistory();
}

function loadSession(id) {
  activeSessionId = id;
  const session = sessions.find(s => s.id === id);
  if (!session) return;

  currentChatTitle.textContent = session.title;
  renderMessages(session.messages);
  renderHistory();
}

//function saveSessions() {
//  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
//  pushToDrive();
//}

//function deleteSession(id) {
//  sessions = sessions.filter(s => s.id !== id);
//  saveSessions();
//  if (sessions.length === 0) {
//    createNewSession();
//  } else if (activeSessionId === id) {
//    loadSession(sessions[0].id);
//  } else {
//    renderHistory();
//  }
//}

async function saveSessions() {
  // Simpan sesi aktif ke IndexedDB bukan localStorage
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
}


// Render Riwayat di Sidebar
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
      <div class="flex items-center gap-2.5 truncate flex-1 mr-2">
        <i data-lucide="${isActive ? 'message-square-text' : 'message-square'}" class="w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-teal-400' : 'text-slate-500'}"></i>
        <span class="truncate">${session.title}</span>
      </div>
      <button class="delete-btn opacity-0 group-hover:opacity-100 p-1 hover:text-rose-400 text-slate-500 transition" title="Hapus">
        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
      </button>
    `;

    item.addEventListener("click", (e) => {
      if (e.target.closest(".delete-btn")) {
        deleteSession(session.id);
      } else {
        loadSession(session.id);
      }
    });

    historyList.appendChild(item);
  });

  lucide.createIcons();
}

// Tampilan Chat Feed
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

  wrapper.className = `flex gap-3 text-sm ${isUser ? "justify-end" : "justify-start"}`;

  const messageBox = document.createElement("div");
  messageBox.className = isUser
    ? "bg-gradient-to-r from-teal-950/70 to-emerald-950/60 border border-teal-800/40 rounded-2xl px-4 py-2.5 max-w-[85%] text-slate-100 shadow-md"
    : "prose-custom max-w-[92%] text-slate-200 bg-transparent py-1 w-full";

  // Jika ada file terlampir, render chip dokumen di dalam chat bubble
  if (files && files.length > 0) {
    const fileContainer = document.createElement("div");
    fileContainer.className = "flex flex-wrap gap-2 mb-2 pb-2 border-b border-teal-800/30";
    files.forEach(f => {
      const chip = document.createElement("div");
      chip.className = "flex items-center gap-1.5 px-2.5 py-1 bg-slate-900/80 border border-slate-700/60 rounded-lg text-xs text-teal-300";
      chip.innerHTML = `<i data-lucide="file-text" class="w-3.5 h-3.5"></i> <span class="truncate max-w-[150px]">${f.name}</span>`;
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
  lucide.createIcons();
  return textNode;
}

// Markdown & Code Blocks
function renderMarkdownWithCodeBlocks(markdownText) {
  const rawHtml = marked.parse(markdownText || "");
  const temp = document.createElement("div");
  temp.innerHTML = rawHtml;

  temp.querySelectorAll("pre code").forEach((block) => {
    hljs.highlightElement(block);
    const pre = block.parentElement;
    const lang = block.className.match(/language-(\w+)/)?.[1] || "code";

    const container = document.createElement("div");
    container.className = "code-container";
    container.innerHTML = `
      <div class="code-header">
        <span>${lang}</span>
        <button class="copy-code-btn hover:text-white transition flex items-center gap-1">
          <i data-lucide="copy" class="w-3 h-3"></i> Salin
        </button>
      </div>
    `;
    pre.parentNode.insertBefore(container, pre);
    container.appendChild(pre);
  });

  return temp.innerHTML;
}

function setupCopyCodeButtons(container) {
  container.querySelectorAll(".copy-code-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.closest(".code-container").querySelector("pre code").innerText;
      navigator.clipboard.writeText(code);
      btn.innerHTML = `<i data-lucide="check" class="w-3 h-3 text-teal-400"></i> Disalin!`;
      lucide.createIcons();
      setTimeout(() => {
        btn.innerHTML = `<i data-lucide="copy" class="w-3 h-3"></i> Salin`;
        lucide.createIcons();
      }, 2000);
    });
  });
  lucide.createIcons();
}

// -------------------------------------------------------------
// LOGIKA RAG & MULTIMODAL FILE UPLOAD (Client-Side)
// -------------------------------------------------------------
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
      // PDF atau Gambar (Base64)
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
      <span class="truncate max-w-[140px]">${file.name}</span>
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
  lucide.createIcons();
}

// -------------------------------------------------------------
// PENGIRIMAN PROMPT & DOKUMEN KE GEMINI PRO API
// -------------------------------------------------------------
async function sendToGemini(historyMessages) {
  if (!settings.apiKey) {
    throw new Error("API Key belum dipasang. Klik Pengaturan untuk memasukkan Google Gemini API Key.");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${settings.model}:generateContent?key=${settings.apiKey}`;

  // Membangun payload multimodal / RAG
  const contents = historyMessages.map(m => {
    const parts = [];

    // Jika pesan memiliki berkas terlampir (RAG)
    if (m.files && m.files.length > 0) {
      m.files.forEach(f => {
        if (f.isText) {
          parts.push({
            text: `[DOKUMEN TERLAMPIR: ${f.name}]\n\`\`\`\n${f.content}\n\`\`\`\n`
          });
        } else {
          parts.push({
            inlineData: {
              mimeType: f.type,
              data: f.base64
            }
          });
        }
      });
    }

    if (m.content) {
      parts.push({ text: m.content });
    }

    return {
      role: m.role === "user" ? "user" : "model",
      parts: parts
    };
  });

  const payload = { contents };

  if (settings.systemInstruction && settings.systemInstruction.trim()) {
    payload.systemInstruction = {
      parts: [{ text: settings.systemInstruction }]
    };
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errData = await res.json();
    throw new Error(errData.error?.message || `HTTP ${res.status}: Gagal menghubungi Gemini API`);
  }

  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}

// Handle Form Submit
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
  const assistantBubble = appendMessageUI("model", "*Agent AI Dothey sedang membaca dokumen & menganalisis...*");

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

// Auto-expand Textarea
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

// -------------------------------------------------------------
// SINKRONISASI GOOGLE DRIVE (OTOMATIS HP & LAPTOP)
// -------------------------------------------------------------
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
      const localIds = new Set(sessions.map(s => s.id));
      let updated = false;

      cloudSessions.forEach(cs => {
        if (!localIds.has(cs.id)) {
          sessions.push(cs);
          updated = true;
        } else {
          const lIdx = sessions.findIndex(s => s.id === cs.id);
          if (cs.messages.length > sessions[lIdx].messages.length) {
            sessions[lIdx] = cs;
            updated = true;
          }
        }
      });

      if (updated) {
        sessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        //localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
        await bulkSaveSessionsToDB(sessions);
        renderHistory();
        if (activeSessionId) loadSession(activeSessionId);
      }
    }
    updateSyncStatus("Tersinkron", "bg-emerald-500", "text-emerald-400");
  } catch (err) {
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

// -------------------------------------------------------------
// PENGATURAN & EXPORT/IMPORT
// -------------------------------------------------------------
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
//importFileInput.addEventListener("change", (e) => {
//  const file = e.target.files[0];
//  if (!file) return;

//  const reader = new FileReader();
//  reader.onload = (event) => {
//    try {
//      const data = JSON.parse(event.target.result);
//      if (Array.isArray(data)) {
//        sessions = [...data, ...sessions];
//      } else if (data.messages) {
//        sessions.unshift(data);
//      }
//      saveSessions();
//      loadSession(sessions[0].id);
//      renderHistory();
//      alert("Riwayat berhasil diimpor!");
//    } catch (err) {
//      alert("Format JSON tidak valid: " + err.message);
//    }
//  };
//  reader.readAsText(file);
//});
// GANTI BLOK importFileInput.addEventListener LAMA DENGAN INI:
importFileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      let rawData = JSON.parse(event.target.result);
      let rawList = Array.isArray(rawData) ? rawData : (rawData.conversations || [rawData]);

      if (rawList.length === 0) {
        throw new Error("Berkas JSON kosong.");
      }

      const formattedSessions = rawList.map((item, idx) => {
        const uniqueId = item.id || `imported_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`;

        // KASUS 1: Format standar chat (sudah memiliki array messages)
        if (item.messages && Array.isArray(item.messages)) {
          return {
            id: uniqueId,
            title: item.title || "Percakapan Impor",
            timestamp: item.timestamp || new Date().toISOString(),
            messages: item.messages
          };
        }

        // KASUS 2: Format mentah Google Takeout (MyActivity.json)
        // 1. Ekstrak pertanyaan pengguna (User Prompt)
        let promptText = (item.title || item.name || "")
          .replace(/^(Prompted|Prompt:|Asked|Berinteraksi dengan Gemini)\s*/i, "")
          .trim();

        // 2. Ekstrak jawaban Gemini (Model Response) dari berbagai lokasi Takeout
        let responseText = "";

        if (item.subtitles && Array.isArray(item.subtitles) && item.subtitles.length > 0) {
          // Google Takeout sering menyimpan jawaban di dalam subtitles[].name
          responseText = item.subtitles.map(s => s.name || "").join("\n\n");
        } else if (item.description) {
          responseText = item.description;
        } else if (item.details && Array.isArray(item.details)) {
          responseText = item.details.map(d => d.name || "").join("\n\n");
        } else if (item.response || item.answer || item.output) {
          responseText = item.response || item.answer || item.output;
        }

        // Bersihkan formatting HTML jika jawaban Google memuat tag tautan
        if (responseText) {
          const tempEl = document.createElement("div");
          tempEl.innerHTML = responseText;
          responseText = tempEl.textContent || tempEl.innerText || responseText;
        }

        const fallbackResponse = responseText.trim() 
          ? responseText.trim() 
          : "*(Google Takeout tidak menyertakan teks respons untuk entri aktivitas ini)*";

        return {
          id: uniqueId,
          title: promptText ? (promptText.slice(0, 36) + (promptText.length > 36 ? "..." : "")) : `Percakapan #${idx + 1}`,
          timestamp: item.time || new Date().toISOString(),
          messages: [
            {
              role: "user",
              content: promptText || "Pertanyaan tanpa teks"
            },
            {
              role: "model",
              content: fallbackResponse
            }
          ]
        };
      });

      // Simpan langsung ke IndexedDB
      await bulkSaveSessionsToDB(formattedSessions);

      // Muat ulang daftar sesi ke UI
      sessions = await getAllSessionsFromDB();
      sessions.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

      if (sessions.length > 0) {
        loadSession(sessions[0].id);
      }
      renderHistory();
      alert(`Berhasil mengimpor dan memproses ${formattedSessions.length} percakapan!`);
    } catch (err) {
      alert("Gagal memproses berkas JSON: " + err.message);
    } finally {
      importFileInput.value = "";
    }
  };
  reader.readAsText(file);
});


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
toggleSidebarBtn.addEventListener("click", () => sidebar.classList.toggle("-ml-80"));

window.addEventListener("DOMContentLoaded", () => {
  init();
  setTimeout(initGoogleAuth, 1200);
});
