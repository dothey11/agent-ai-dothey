# Agent AI Dothey 🛡️

**Agent AI Dothey** adalah web client pribadi berbasis antarmuka modern yang menghubungkan browser Anda langsung ke **Google Gemini Pro API**. Dibuat dengan arsitektur murni *Client-Side* untuk menjamin keamanan privasi data obrolan Anda tanpa penyimpanan server pihak ketiga.

## Fitur Utama

- **Native In-Context RAG (Upload Dokumen)**: Unggah file **PDF, CSV, TXT, JSON, MD, dan Gambar**. Dokumen dibaca secara lokal di browser dan dianalisis langsung oleh Gemini Pro (memanfaatkan kapasitas *context window* 1 juta hingga 2 juta token).
- **100% Privacy-First**: API Key dan dokumen Anda diproses langsung dari browser ke API Google tanpa perantara server database pihak ketiga.
- **Sinkronisasi Otomatis PC & HP**: Terhubung ke Google Drive AppData Folder pribadi via Google Identity Service.
- **Manajemen Riwayat & Dokumen**:
  - Simpan percakapan ke format Dokumen Markdown (`.md`).
  - Ekspor/Impor format JSON lengkap.
  - Pencarian riwayat chat seketika (*instant search*).
- **Code Block Highlighting**: Tampilan kode rapi lengkap dengan tombol *1-Click Copy*.
- **Tanpa Setup Server**: Cukup buka `index.html` atau pasang di GitHub Pages.

---

## Panduan Instalasi & Deploy ke GitHub

1. Buat repositori baru di GitHub dengan nama `agent-ai-dothey`.
2. Buka terminal pada folder proyek Anda lalu jalankan:
   ```bash
   git init
   git add .
   git commit -m "feat: inisialisasi Agent AI Dothey dengan RAG engine"
   git branch -M main
   git remote add origin [https://github.com/](https://github.com/)<username-anda>/agent-ai-dothey.git
   git push -u origin main