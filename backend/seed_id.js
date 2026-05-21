require('dotenv').config();
const mysql = require('mysql2/promise');

async function seedId() {
    try {
        const connection = await mysql.createConnection(process.env.DATABASE_URL);
        console.log('Connected to MySQL successfully.');

        // Seed Projects
        await connection.query(`UPDATE projects SET title_id = 'SimpleCDN', description_id = 'Saya membangun CDN yang ringan dan cepat ini dari nol untuk menyajikan file statis tanpa beban tambahan.' WHERE title = 'SimpleCDN'`);
        await connection.query(`UPDATE projects SET title_id = 'BerAPI', description_id = 'Kumpulan endpoint API yang saya buat untuk mempermudah prototyping cepat, integrasi AI, dan fitur unduh.' WHERE title = 'BerAPI'`);
        await connection.query(`UPDATE projects SET title_id = 'Sistem Bot Otomatis', description_id = 'Bot WhatsApp yang saya tulis untuk mengelola komunitas, memoderasi obrolan, dan mengotomatiskan hal-hal yang membosankan.' WHERE title = 'Automated Bot Systems'`);
        console.log('Updated projects with ID translations.');

        // Seed Experience
        await connection.query(`UPDATE experience SET role_id = 'Manajer & Staf', description_id = 'Saya mengelola infrastruktur backend, menjaga agar server game tetap stabil saat pemain sedang ramai, dan memperbaiki masalah jaringan.' WHERE company = 'Arqonara Hosting'`);
        await connection.query(`UPDATE experience SET role_id = 'Layanan Pelanggan', description_id = 'Saya membantu klien menangani masalah teknis secara langsung, melakukan pemeliharaan server rutin, dan memperbaiki masalah pada modpack.' WHERE company = 'HeppyCloud'`);
        console.log('Updated experience with ID translations.');

        await connection.end();
        console.log('Seed Complete.');
    } catch (e) {
        console.error('Database Error:', e.message);
    }
}
seedId();
