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
            ['company_name', 'RAF', 'Nama perusahaan/organisasi'],
            ['company_tagline', 'Pemantauan CCTV Publik', 'Tagline perusahaan'],
            ['company_description', 'Platform pemantauan CCTV publik secara real-time. Akses gratis melalui website ini.', 'Deskripsi perusahaan'],
            ['city_name', 'Bojonegoro', 'Nama kota/wilayah'],
            ['province_name', 'Jawa Timur', 'Nama provinsi'],
            ['hero_title', 'Pantau CCTV Publik Secara Real-Time', 'Judul hero section'],
            ['hero_subtitle', 'Pantau berbagai lokasi CCTV publik secara real-time. Akses gratis 24 jam tanpa login.', 'Subtitle hero section'],
            ['footer_text', 'Layanan pemantauan CCTV publik', 'Teks footer'],
            ['copyright_text', 'Pemantauan CCTV Publik', 'Teks copyright'],
            ['meta_title', 'CCTV Publik Online - RAF | Pantau Real-Time', 'Meta title untuk SEO'],
            ['meta_description', 'Pantau CCTV publik secara online dan live streaming 24 jam. Akses publik gratis tanpa login.', 'Meta description untuk SEO'],
            ['meta_keywords', 'cctv online, cctv publik, pantau cctv, live streaming cctv, monitoring cctv, cctv real-time', 'Meta keywords untuk SEO'],
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
