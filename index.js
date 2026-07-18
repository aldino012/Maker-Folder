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

// ===== RANGE EXPANDER =====
function expandPatterns(entries) {
    const result = [];
    const patternRegex = /^(.*)[\{\[](-?\d+):(-?\d+)[\}\}](.*)$/;
    
    for (const entry of entries) {
        const match = entry.match(patternRegex);
        if (match) {
            const prefix = match[1];
            const suffix = match[4];
            const start = parseInt(match[2]);
            const end = parseInt(match[3]);
            const padLength = Math.max(match[2].length, match[3].length);
            
            if (start > end) {
                result.push({ name: entry, error: 'Range terbalik' });
                continue;
            }
            
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

// --- API: GET DRIVES ---
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

// --- API: GET FOLDERS ---
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

// --- API: CHECK EXISTING FOLDERS (NEW!) ---
app.post('/api/check-existing', (req, res) => {
    const { basePath, folders } = req.body;
    
    if (!basePath || !Array.isArray(folders)) {
        return res.status(400).json({ error: 'Invalid request' });
    }
    
    // Batasi jumlah folder yang bisa dicek
    const limitedFolders = folders.slice(0, 500);
    const resolvedBasePath = path.resolve(basePath);
    
    const existing = [];
    const unsafe = [];
    
    // Cek apakah basePath aman
    if (!isPathSafe(resolvedBasePath)) {
        return res.json({ existing: [], unsafe: limitedFolders, error: 'Base path tidak aman' });
    }
    
    // Cek apakah basePath ada
    if (!fs.existsSync(resolvedBasePath)) {
        return res.json({ existing: [], unsafe: [], basePathExists: false });
    }
    
    for (const folder of limitedFolders) {
        const fullPath = path.resolve(resolvedBasePath, folder);
        
        // Cek keamanan
        if (!isPathSafe(fullPath)) {
            unsafe.push(folder);
            continue;
        }
        
        // Cek apakah sudah ada
        try {
            if (fs.existsSync(fullPath)) {
                existing.push(folder);
            }
        } catch (err) {
            // Abaikan error
        }
    }
    
    res.json({ 
        existing, 
        unsafe, 
        basePathExists: true,
        totalChecked: limitedFolders.length
    });
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
        // Tracking stats
        let stats = {
            created: [],
            skipped: [],    // Sudah ada (skip)
            rejected: [],   // Tidak aman
            failed: []      // Error saat membuat
        };
        
        // 1. Split input
        const rawEntries = folderListRaw.split(/[,\n\r]+/)
            .map(entry => entry.trim())
            .filter(entry => entry !== '');

        if (rawEntries.length === 0) {
            throw new Error("Tidak ada nama folder yang valid ditemukan.");
        }

        // 2. EXPAND pattern range
        const expandedEntries = expandPatterns(rawEntries);

        // 3. Batasi total
        const limitedEntries = expandedEntries.slice(0, 500);

        for (const entry of limitedEntries) {
            if (entry.error === 'limit') {
                stats.rejected.push({ name: entry.name, reason: 'Melebihi batas 200 item per range' });
                continue;
            }
            if (entry.error) {
                stats.rejected.push({ name: entry.name, reason: entry.error });
                continue;
            }

            const targetDir = path.resolve(resolvedBasePath, entry.name);

            // Cek keamanan
            if (!isPathSafe(targetDir)) {
                stats.rejected.push({ name: entry.name, reason: 'Path tidak aman (area sistem)' });
                continue;
            }

            try {
                // CEK DUPLIKASI: jika sudah ada, SKIP (bukan error)
                if (fs.existsSync(targetDir)) {
                    stats.skipped.push({ name: entry.name, path: targetDir });
                    continue;
                }
                
                // Buat folder baru
                fs.mkdirSync(targetDir, { recursive: true });
                stats.created.push({ name: entry.name, path: targetDir });
            } catch (err) {
                stats.failed.push({ name: entry.name, reason: err.message });
            }
        }

        // Render hasil dengan detail
        const totalProcessed = stats.created.length + stats.skipped.length + stats.rejected.length + stats.failed.length;
        
        let logHtml = '';
        
        if (stats.created.length > 0) {
            logHtml += `<li style="margin-bottom: 10px;"><strong style="color: #155724;">✅ Berhasil Dibuat (${stats.created.length}):</strong>
                <ul style="margin-top: 5px;">${stats.created.map(f => `<li>${f.path}</li>`).join('')}</ul></li>`;
        }
        
        if (stats.skipped.length > 0) {
            logHtml += `<li style="margin-bottom: 10px;"><strong style="color: #856404;">⏭️ Dilewati - Sudah Ada (${stats.skipped.length}):</strong>
                <ul style="margin-top: 5px;">${stats.skipped.map(f => `<li>${f.path}</li>`).join('')}</ul></li>`;
        }
        
        if (stats.rejected.length > 0) {
            logHtml += `<li style="margin-bottom: 10px;"><strong style="color: #721c24;">❌ Ditolak (${stats.rejected.length}):</strong>
                <ul style="margin-top: 5px;">${stats.rejected.map(f => `<li>${f.name} <em>(${f.reason})</em></li>`).join('')}</ul></li>`;
        }
        
        if (stats.failed.length > 0) {
            logHtml += `<li style="margin-bottom: 10px;"><strong style="color: #721c24;">⚠️ Gagal (${stats.failed.length}):</strong>
                <ul style="margin-top: 5px;">${stats.failed.map(f => `<li>${f.name}: ${f.reason}</li>`).join('')}</ul></li>`;
        }

        // Pesan status
        let statusMsg = '';
        if (stats.created.length === 0 && stats.skipped.length > 0) {
            statusMsg = `<p style="color: #856404; font-weight: bold;">⚠️ Semua folder sudah ada di lokasi tujuan. Tidak ada folder baru yang dibuat.</p>`;
        } else if (stats.created.length > 0 && stats.skipped.length > 0) {
            statusMsg = `<p style="color: #0c5460;">ℹ️ Sebagian folder sudah ada dan dilewati. Folder baru tetap dibuat.</p>`;
        }

        res.send(`
            <div style="font-family: Arial; max-width: 900px; margin: 40px auto; background: #e6f6ea; padding: 25px; border-radius: 10px; border: 1px solid #28a745;">
                <h3 style="color: #155724; margin-top: 0;">✅ Proses Selesai!</h3>
                <p><strong>Lokasi:</strong> <code style="background:#d4edda; padding:6px 10px;">${resolvedBasePath}</code></p>
                
                <div style="display: flex; gap: 10px; margin: 15px 0; flex-wrap: wrap;">
                    <div style="flex: 1; min-width: 120px; background: #d4edda; padding: 10px; border-radius: 6px; text-align: center;">
                        <div style="font-size: 24px; font-weight: bold; color: #155724;">${stats.created.length}</div>
                        <div style="font-size: 12px; color: #155724;">✅ Dibuat</div>
                    </div>
                    <div style="flex: 1; min-width: 120px; background: #fff3cd; padding: 10px; border-radius: 6px; text-align: center;">
                        <div style="font-size: 24px; font-weight: bold; color: #856404;">${stats.skipped.length}</div>
                        <div style="font-size: 12px; color: #856404;">⏭️ Dilewati</div>
                    </div>
                    <div style="flex: 1; min-width: 120px; background: #f8d7da; padding: 10px; border-radius: 6px; text-align: center;">
                        <div style="font-size: 24px; font-weight: bold; color: #721c24;">${stats.rejected.length + stats.failed.length}</div>
                        <div style="font-size: 12px; color: #721c24;">❌ Ditolak/Gagal</div>
                    </div>
                </div>
                
                ${statusMsg}
                
                <ul style="line-height: 1.5; max-height: 400px; overflow-y: auto; background: white; padding: 15px; border-radius: 6px; border: 1px solid #c3e6cb; list-style: none;">
                    ${logHtml}
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