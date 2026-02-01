import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

const db = new Database(dbPath);

try {
    console.log('🔄 Starting migration: add branding settings...');
    
    // Check if table exists
    const tableExists = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='branding_settings'
    `).get();

    if (!tableExists) {
        console.log('➕ Creating branding_settings table...');
        
        db.exec(`
            CREATE TABLE branding_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT NOT NULL UNIQUE,
                value TEXT,
                description TEXT,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_by INTEGER,
                FOREIGN KEY (updated_by) REFERENCES users(id)
            )
        `);
        
        console.log('✅ branding_settings table created');
        
        // Insert default branding values
        console.log('➕ Inserting default branding values...');
        
        const defaultBranding = [
            ['company_name', 'RAF NET', 'Nama perusahaan/organisasi'],
            ['company_tagline', 'CCTV Bojonegoro Online', 'Tagline perusahaan'],
            ['company_description', 'RAF NET melayani pemasangan WiFi dan CCTV di wilayah Bojonegoro. Pantau CCTV publik secara gratis melalui website ini.', 'Deskripsi perusahaan'],
            ['city_name', 'Bojonegoro', 'Nama kota/wilayah'],
            ['province_name', 'Jawa Timur', 'Nama provinsi'],
            ['hero_title', 'Pantau CCTV Bojonegoro Secara Real-Time', 'Judul hero section'],
            ['hero_subtitle', 'Pantau keamanan wilayah Bojonegoro secara real-time dengan sistem CCTV RAF NET. Akses gratis 24 jam untuk memantau berbagai lokasi di Bojonegoro, Jawa Timur.', 'Subtitle hero section'],
            ['footer_text', 'Layanan pemantauan CCTV publik oleh RAF NET untuk keamanan dan kenyamanan warga Bojonegoro', 'Teks footer'],
            ['copyright_text', 'Penyedia Internet & CCTV Bojonegoro', 'Teks copyright'],
            ['meta_title', 'CCTV Bojonegoro Online - RAF NET | Pantau Keamanan Kota Bojonegoro Live', 'Meta title untuk SEO'],
            ['meta_description', 'Pantau CCTV Bojonegoro secara online dan live streaming 24 jam. RAF NET menyediakan akses publik untuk memantau keamanan kota Bojonegoro, Jawa Timur. Gratis tanpa login.', 'Meta description untuk SEO'],
            ['meta_keywords', 'cctv bojonegoro, cctv bojonegoro online, cctv raf net, pantau cctv bojonegoro, live streaming cctv bojonegoro, keamanan bojonegoro, cctv jawa timur, raf net bojonegoro, cctv kota bojonegoro, monitoring bojonegoro', 'Meta keywords untuk SEO'],
            ['logo_text', 'R', 'Teks logo (1 huruf)'],
            ['primary_color', '#0ea5e9', 'Warna primary (hex)'],
            ['show_powered_by', 'true', 'Tampilkan "Powered by" badge'],
            ['whatsapp_number', '6289685645956', 'Nomor WhatsApp (format: 628xxx)'],
        ];
        
        const stmt = db.prepare(`
            INSERT INTO branding_settings (key, value, description) 
            VALUES (?, ?, ?)
        `);
        
        for (const [key, value, description] of defaultBranding) {
            stmt.run(key, value, description);
        }
        
        console.log(`✅ Inserted ${defaultBranding.length} default branding values`);
    } else {
        console.log('✓ branding_settings table already exists');
    }
    
    console.log('✅ Migration completed');
} catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
