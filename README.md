# 📁 Maker-Folder

Aplikasi web sederhana berbasis **Node.js + Express** untuk membuat banyak folder sekaligus secara otomatis di komputer Windows. Mendukung pembuatan folder bertingkat (multi-level) dan penomoran otomatis (range generator).

![Node.js](https://img.shields.io/badge/Node.js-18+-green?logo=node.js)
![Express](https://img.shields.io/badge/Express-4.x-blue?logo=express)
![License](https://img.shields.io/badge/License-MIT-yellow)

## ✨ Fitur Utama

- 🗂️ **Nested Folder Browser** – Pilih lokasi tujuan lewat dropdown drive & folder bertingkat.
- ✏️ **Editable Path** – Bisa ketik manual path yang dalam (contoh: `E:\Kuliah\Semester-4\Internet Marketing`).
- 🚀 **Multi-Folder Creation** – Buat banyak folder sekaligus dalam satu aksi.
- 🔢 **Range Generator** – Syntax pintar untuk penomoran otomatis:
  - `Pertemuan-{1:16}` → `Pertemuan-1`, `Pertemuan-2`, ..., `Pertemuan-16`
  - `Minggu-{01:12}` → `Minggu-01`, `Minggu-02`, ..., `Minggu-12` (dengan nol depan)
  - `Bab{1:5}\Materi` → `Bab1\Materi`, `Bab2\Materi`, ...
- 🔒 **Path Safety** – Otomatis memblokir akses ke folder sistem Windows (`Windows`, `Program Files`, dll).
- 👁️ **Live Preview** – Lihat daftar folder yang akan dibuat sebelum submit.

## 📸 Screenshot

*(Tambahkan screenshot aplikasi Anda di sini nanti)*

## 🛠️ Teknologi

- [Node.js](https://nodejs.org/)
- [Express](https://expressjs.com/)
- HTML5 + Vanilla JavaScript

## 🚀 Cara Menjalankan

### 1. Clone repository
```bash
git clone https://github.com/username-anda/maker-folder.git
cd maker-folder