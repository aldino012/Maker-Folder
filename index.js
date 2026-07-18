const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Daftar pola folder sistem Windows yang mutlak DILARANG
const forbiddenPatterns = [
    '\\WINDOWS\\',
    '\\PROGRAM FILES\\',
    '\\PROGRAM FILES (X86)\\',
    '\\PROGRAMDATA\\',
    '\\USERS\\DEFAULT\\',
    '\\USERS\\ALL USERS\\',
    '\\RECYCLE.BIN\\',
    '\\SYSTEM VOLUME INFORMATION\\'
];

function isPathSafe(targetPath) {
    try {
        const resolved = path.resolve(targetPath).toUpperCase();
        
        for (const pattern of forbiddenPatterns) {
            if (resolved.includes(pattern) || resolved.endsWith(pattern.trimEnd('\\'))) {
                return false;
            }
        }
        
        if (resolved.includes('..')) {
            return false;
        }

        return true;
    } catch (e) {
        return false;
    }
}

// ===== RANGE EXPANDER (Server-side) =====
// Mengubah "Pertemuan-{1:16}" menjadi array ["Pertemuan-1", "Pertemuan-2", ..., "Pertemuan-16"]
function expandPatterns(entries) {
    const result = [];
    // Regex: prefix{start:end}suffix  atau  prefix[start:end]suffix
    const patternRegex = /^(.*)[\{\[](-?\d+):(-?\d+)[\}\}](.*)$/;
    
    for (const entry of entries) {
        const match = entry.match(patternRegex);
        if (match) {
            const prefix = match[1];
            const suffix = match[4];
            const start = parseInt(match[2]);
            const end = parseInt(match[3]);
            // Auto padding: jika user tulis "01", maka hasil akan "01", "02", dst
            const padLength = Math.max(match[2].length, match[3].length);
            
            if (start > end) {
                result.push({ name: entry, error: 'Range terbalik' });
                continue;
            }
            
            // Batasi maksimal 200 item per range untuk keamanan
            const total = end - start + 1;
            const limit = Math.min(total, 200);
            
            for (let i = 0; i < limit; i++) {
                const num = start + i;
                const padded = String(num).padStart(padLength, '0');
                result.push({ name: prefix + padded + suffix, error: null });
            }
            
            if (total > 200) {
                result.push({ name: `[Dibatasi 200 item dari ${total}]`, error: 'limit' });
            }
        } else {
            result.push({ name: entry, error: null });
        }
    }
    return result;
}

// --- API ---

app.get('/api/drives', (req, res) => {
    const drives = [];
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    
    for (const letter of letters) {
        const drivePath = `${letter}:\\`;
        try {
            if (fs.existsSync(drivePath)) {
                drives.push(drivePath);
            }
        } catch (e) {
            // Abaikan drive yang tidak siap
        }
    }
    res.json(drives);
});

app.get('/api/folders', (req, res) => {
    const targetPath = req.query.path;
    if (!targetPath) return res.json([]);

    const resolvedPath = path.resolve(targetPath);

    if (!fs.existsSync(resolvedPath) || !isPathSafe(resolvedPath)) {
        return res.json([]); 
    }

    try {
        const items = fs.readdirSync(resolvedPath, { withFileTypes: true });
        const folders = items
            .filter(item => item.isDirectory())
            .map(item => item.name);
        res.json(folders);
    } catch (err) {
        res.json([]); 
    }
});

// --- HALAMAN UTAMA ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- LOGIKA PEMBUATAN FOLDER ---
app.post('/create-folder', (req, res) => {
    const basePath = req.body.basePath ? req.body.basePath.trim() : '';
    const folderListRaw = req.body.folderList ? req.body.folderList.trim() : '';

    if (!basePath || !folderListRaw) {
        return res.status(400).send(`
            <div style="font-family: Arial; text-align: center; margin-top: 50px;">
                <h2 style="color: red;">Error!</h2>
                <p>Lokasi Tujuan dan Daftar Folder wajib diisi!</p>
                <a href="/">Kembali</a>
            </div>
        `);
    }

    const resolvedBasePath = path.resolve(basePath);

    if (!isPathSafe(resolvedBasePath)) {
        return res.status(403).send(`
            <div style="font-family: Arial; text-align: center; margin-top: 50px;">
                <h2 style="color: red;">Akses Ditolak!</h2>
                <p>Lokasi tujuan mengarah ke area sistem yang dilindungi.</p>
                <a href="/">Kembali</a>
            </div>
        `);
    }

    try {
        let createdLog = [];
        
        // 1. Split input berdasarkan koma atau baris baru
        const rawEntries = folderListRaw.split(/[,\n\r]+/)
            .map(entry => entry.trim())
            .filter(entry => entry !== '');

        if (rawEntries.length === 0) {
            throw new Error("Tidak ada nama folder yang valid ditemukan.");
        }

        // 2. EXPAND semua pattern range (misal: Pertemuan-{1:16} → 16 folder)
        const expandedEntries = expandPatterns(rawEntries);

        // 3. Batasi total folder yang bisa dibuat sekaligus (maks 500)
        const limitedEntries = expandedEntries.slice(0, 500);

        for (const entry of limitedEntries) {
            if (entry.error === 'limit') {
                createdLog.push(`⚠️ ${entry.name}`);
                continue;
            }
            if (entry.error) {
                createdLog.push(`❌ ${entry.name} (${entry.error})`);
                continue;
            }

            const targetDir = path.resolve(resolvedBasePath, entry.name);

            if (!isPathSafe(targetDir)) {
                createdLog.push(`❌ Ditolak (tidak aman): <strong>${entry.name}</strong>`);
                continue;
            }

            try {
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                    createdLog.push(`✅ Berhasil: <strong>${targetDir}</strong>`);
                } else {
                    createdLog.push(`ℹ️ Sudah ada: <strong>${targetDir}</strong>`);
                }
            } catch (err) {
                createdLog.push(`❌ Gagal <strong>${entry.name}</strong>: ${err.message}`);
            }
        }

        res.send(`
            <div style="font-family: Arial; max-width: 850px; margin: 40px auto; background: #e6f6ea; padding: 25px; border-radius: 10px; border: 1px solid #28a745;">
                <h3 style="color: #155724; margin-top: 0;">✅ Proses Selesai!</h3>
                <p>Total <strong>${limitedEntries.length}</strong> folder diproses di dalam:<br>
                <code style="background:#d4edda; padding:6px 10px; display:inline-block; margin-top:5px;">${resolvedBasePath}</code></p>
                <ul style="line-height: 1.6; max-height: 450px; overflow-y: auto; background: white; padding: 15px; border-radius: 6px; border: 1px solid #c3e6cb;">
                    ${createdLog.map(log => `<li style="margin-bottom: 6px;">${log}</li>`).join('')}
                </ul>
                <br>
                <a href="/" style="display: inline-block; padding: 10px 20px; background: #28a745; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">Buat Folder Lainnya</a>
            </div>
        `);

    } catch (error) {
        console.error("Folder Creation Error:", error);
        res.status(500).send(`
            <div style="font-family: Arial; text-align: center; margin-top: 50px;">
                <h2 style="color: red;">Terjadi Kesalahan Sistem!</h2>
                <p>${error.message}</p>
                <a href="/">Kembali</a>
            </div>
        `);
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server berjalan! Buka http://localhost:${PORT} di browser Anda.`);
});