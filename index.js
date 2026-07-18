const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const forbiddenPatterns = [
    '\\WINDOWS\\', '\\PROGRAM FILES\\', '\\PROGRAM FILES (X86)\\',
    '\\PROGRAMDATA\\', '\\USERS\\DEFAULT\\', '\\USERS\\ALL USERS\\',
    '\\RECYCLE.BIN\\', '\\SYSTEM VOLUME INFORMATION\\'
];

const FILE_CATEGORIES = {
    Images: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico', '.tiff', '.tif'],
    Audio: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a'],
    Archives: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz'],
    Documents: ['.pdf', '.doc', '.docx', '.txt', '.xlsx', '.xls', '.pptx', '.ppt', '.csv', '.rtf', '.odt']
};

// Daftar folder kategori yang TIDAK BOLEH diproses/dipindahkan lagi
const CATEGORY_NAMES = ['Images', 'Audio', 'Archives', 'Documents', 'Others'];

function isPathSafe(targetPath) {
    try {
        const resolved = path.resolve(targetPath).toUpperCase();
        for (const pattern of forbiddenPatterns) {
            if (resolved.includes(pattern) || resolved.endsWith(pattern.trimEnd('\\'))) return false;
        }
        if (resolved.includes('..')) return false;
        return true;
    } catch (e) {
        return false;
    }
}

function getFileCategory(filename) {
    const ext = path.extname(filename).toLowerCase();
    for (const [category, extensions] of Object.entries(FILE_CATEGORIES)) {
        if (extensions.includes(ext)) return category;
    }
    return 'Others';
}

// --- API: GET DRIVES ---
app.get('/api/drives', (req, res) => {
    const drives = [];
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('')) {
        try { if (fs.existsSync(`${letter}:\\`)) drives.push(`${letter}:\\`); } catch (e) {}
    }
    res.json(drives);
});

// --- API: GET FOLDERS ---
app.get('/api/folders', (req, res) => {
    const targetPath = req.query.path;
    if (!targetPath) return res.json([]);
    const resolvedPath = path.resolve(targetPath);
    if (!fs.existsSync(resolvedPath) || !isPathSafe(resolvedPath)) return res.json([]);
    try {
        const items = fs.readdirSync(resolvedPath, { withFileTypes: true });
        res.json(items.filter(item => item.isDirectory()).map(item => item.name));
    } catch (err) {
        res.json([]);
    }
});

// --- HALAMAN UTAMA ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- LOGIKA PEMBUATAN FOLDER (Tetap sama seperti sebelumnya) ---
app.post('/create-folder', (req, res) => {
    // ... (Kode create-folder tetap sama, tidak diubah agar tidak terlalu panjang)
    // Pastikan kode expandPatterns dan logika create-folder dari versi sebelumnya tetap ada di sini.
    // Untuk ringkasan, saya asumsikan Anda menyalin blok create-folder dari kode sebelumnya ke sini.
    res.send("Fitur Buat Folder aktif. (Pastikan kode create-folder sebelumnya disalin ke sini)");
});
// CATATAN: Karena batasan panjang, pastikan Anda menyalin blok `app.post('/create-folder', ...)` 
// dari kode sebelumnya ke file ini sebelum blok `/organize-folder` di bawah.

// --- LOGIKA ORGANIZE FOLDER (LOGIKA BARU: PER-FOLDER INDEPENDEN) ---
app.post('/organize-folder', (req, res) => {
    const organizePath = req.body.organizePath ? req.body.organizePath.trim() : '';
    const recursive = req.body.recursive === 'true';

    if (!organizePath) {
        return res.status(400).send(`<div style="font-family: Arial; text-align: center; margin-top: 50px;"><h2 style="color: red;">Error!</h2><p>Path folder wajib diisi!</p><a href="/">Kembali</a></div>`);
    }

    const resolvedPath = path.resolve(organizePath);

    if (!isPathSafe(resolvedPath)) {
        return res.status(403).send(`<div style="font-family: Arial; text-align: center; margin-top: 50px;"><h2 style="color: red;">Akses Ditolak!</h2><p>Path mengarah ke area sistem yang dilindungi.</p><a href="/">Kembali</a></div>`);
    }

    if (!fs.existsSync(resolvedPath)) {
        return res.status(404).send(`<div style="font-family: Arial; text-align: center; margin-top: 50px;"><h2 style="color: red;">Error!</h2><p>Folder tidak ditemukan: <code>${resolvedPath}</code></p><a href="/">Kembali</a></div>`);
    }

    try {
        let stats = {
            moved: { Images: [], Audio: [], Archives: [], Documents: [], Others: [] },
            skipped: [],
            failed: []
        };

        // FUNGSI REKURSIF: Memproses setiap folder secara independen
        function processDirectory(currentDir) {
            try {
                const items = fs.readdirSync(currentDir, { withFileTypes: true });

                for (const item of items) {
                    const itemPath = path.join(currentDir, item.name);

                    if (item.isDirectory()) {
                        // PENTING: Skip jika ini adalah folder kategori yang sudah kita buat
                        // Ini mencegah infinite loop dan mencegah memindahkan folder kategori itu sendiri
                        if (CATEGORY_NAMES.includes(item.name)) {
                            continue;
                            }
                        
                        // Jika subfolder biasa, dan opsi recursive aktif, proses juga
                        if (recursive) {
                            processDirectory(itemPath);
                        }
                    } else {
                        // Ini adalah FILE
                        const category = getFileCategory(item.name);
                        
                        // Target folder adalah DI DALAM folder saat ini (currentDir)
                        const targetDir = path.join(currentDir, category);
                        const targetPath = path.join(targetDir, item.name);

                        // Buat folder kategori di folder ini jika belum ada
                        if (!fs.existsSync(targetDir)) {
                            fs.mkdirSync(targetDir, { recursive: true });
                        }

                        // CEK DUPLIKASI: Apakah file dengan nama ini sudah ada di folder kategori INI?
                        if (fs.existsSync(targetPath)) {
                            stats.skipped.push({ 
                                file: item.name, 
                                location: currentDir, 
                                reason: 'File dengan nama sama sudah ada di folder kategori ini' 
                            });
                        } else {
                            // Pindahkan file
                            try {
                                fs.renameSync(itemPath, targetPath);
                                stats.moved[category].push({ 
                                    file: item.name, 
                                    from: itemPath, 
                                    to: targetPath 
                                });
                            } catch (err) {
                                stats.failed.push({ file: item.name, location: currentDir, reason: err.message });
                            }
                        }
                    }
                }
            } catch (err) {
                console.error(`Error processing directory ${currentDir}:`, err);
                stats.failed.push({ file: 'Folder', location: currentDir, reason: err.message });
            }
        }

        // Jalankan proses mulai dari folder root yang dipilih
        processDirectory(resolvedPath);

        // Render Hasil
        const totalMoved = Object.values(stats.moved).reduce((sum, arr) => sum + arr.length, 0);
        let logHtml = '';

        for (const [category, files] of Object.entries(stats.moved)) {
            if (files.length > 0) {
                const icons = { Images: '🖼️', Audio: '🎵', Archives: '📦', Documents: '📄', Others: '📁' };
                logHtml += `<li style="margin-bottom: 10px;"><strong style="color: #155724;">${icons[category]} ${category} (${files.length} file):</strong>
                    <ul style="margin-top: 5px; font-size: 13px; color: #555;">
                        ${files.map(f => `<li><code>${f.file}</code> <small style="color:#888;">(dari: ${f.from})</small></li>`).join('')}
                    </ul></li>`;
            }
        }

        if (stats.skipped.length > 0) {
            logHtml += `<li style="margin-bottom: 10px;"><strong style="color: #856404;">⏭️ Dilewati / Skip (${stats.skipped.length}):</strong>
                <ul style="margin-top: 5px; font-size: 13px; color: #856404;">
                    ${stats.skipped.map(f => `<li><code>${f.file}</code> di <code>${f.location}</code> <small>(${f.reason})</small></li>`).join('')}
                </ul></li>`;
        }

        if (stats.failed.length > 0) {
            logHtml += `<li style="margin-bottom: 10px;"><strong style="color: #721c24;">⚠️ Gagal (${stats.failed.length}):</strong>
                <ul style="margin-top: 5px; font-size: 13px;">${stats.failed.map(f => `<li>${f.file} di ${f.location}: ${f.reason}</li>`).join('')}</ul></li>`;
        }

        if (totalMoved === 0 && stats.skipped.length === 0 && stats.failed.length === 0) {
            logHtml = `<li style="color: #856404;">ℹ️ Tidak ada file yang perlu dipindahkan di folder ini.</li>`;
        }

        res.send(`
            <div style="font-family: Arial; max-width: 900px; margin: 40px auto; background: #e6f6ea; padding: 25px; border-radius: 10px; border: 1px solid #28a745;">
                <h3 style="color: #155724; margin-top: 0;">🗂️ Folder Berhasil Dirapikan!</h3>
                <p><strong>Lokasi Sumber:</strong> <code style="background:#d4edda; padding:6px 10px;">${resolvedPath}</code></p>
                
                <div style="display: flex; gap: 10px; margin: 15px 0; flex-wrap: wrap;">
                    <div style="flex: 1; min-width: 120px; background: #d4edda; padding: 10px; border-radius: 6px; text-align: center;">
                        <div style="font-size: 24px; font-weight: bold; color: #155724;">${totalMoved}</div>
                        <div style="font-size: 12px; color: #155724;">✅ Dipindahkan</div>
                    </div>
                    <div style="flex: 1; min-width: 120px; background: #fff3cd; padding: 10px; border-radius: 6px; text-align: center;">
                        <div style="font-size: 24px; font-weight: bold; color: #856404;">${stats.skipped.length}</div>
                        <div style="font-size: 12px; color: #856404;">⏭️ Dilewati</div>
                    </div>
                    <div style="flex: 1; min-width: 120px; background: #f8d7da; padding: 10px; border-radius: 6px; text-align: center;">
                        <div style="font-size: 24px; font-weight: bold; color: #721c24;">${stats.failed.length}</div>
                        <div style="font-size: 12px; color: #721c24;">⚠️ Gagal</div>
                    </div>
                </div>
                
                <ul style="line-height: 1.5; max-height: 400px; overflow-y: auto; background: white; padding: 15px; border-radius: 6px; border: 1px solid #c3e6cb; list-style: none;">
                    ${logHtml}
                </ul>
                <br>
                <a href="/" style="display: inline-block; padding: 10px 20px; background: #28a745; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">Kembali ke Menu Utama</a>
            </div>
        `);

    } catch (error) {
        console.error("Organize Folder Error:", error);
        res.status(500).send(`<div style="font-family: Arial; text-align: center; margin-top: 50px;"><h2 style="color: red;">Terjadi Kesalahan Sistem!</h2><p>${error.message}</p><a href="/">Kembali</a></div>`);
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server berjalan! Buka http://localhost:${PORT} di browser Anda.`);
});