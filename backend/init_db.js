require('dotenv').config();
const mysql = require('mysql2/promise');

async function init() {
    try {
        const connection = await mysql.createConnection(process.env.DATABASE_URL);
        console.log('Connected to MySQL successfully.');

        await connection.query(`
            CREATE TABLE IF NOT EXISTS projects (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                description TEXT NOT NULL,
                url VARCHAR(255),
                image_url VARCHAR(255),
                full_width BOOLEAN DEFAULT false
            )
        `);
        console.log('Verified projects table.');

        await connection.query(`
            CREATE TABLE IF NOT EXISTS experience (
                id INT AUTO_INCREMENT PRIMARY KEY,
                company VARCHAR(255) NOT NULL,
                role VARCHAR(255) NOT NULL,
                date_range VARCHAR(255) NOT NULL,
                description TEXT NOT NULL,
                logo_url VARCHAR(255),
                url VARCHAR(255)
            )
        `);
        console.log('Verified experience table.');

        await connection.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL,
                subject VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('Verified messages table.');

        // Insert default data if empty so the site isn't blank
        const [projects] = await connection.query('SELECT COUNT(*) as count FROM projects');
        if (projects[0].count === 0) {
            await connection.query(`
                INSERT INTO projects (title, description, url, image_url, full_width) VALUES 
                ('SimpleCDN', 'A fast, lightweight content delivery network built from scratch. Designed to serve static assets with minimal overhead.', 'https://cdn.discordapp.my.id', 'https://cdn.discordapp.my.id/cdn/7541df.webp', false),
                ('BerAPI', 'A centralized hub of ready-to-use API endpoints designed for rapid prototyping, AI integration, and download utilities.', 'https://berapi.my.id/', 'https://cdn.discordapp.my.id/cdn/secure/1f75f1.webp', false),
                ('Automated Bot Systems', 'Custom automated WhatsApp bots to handle community engagement, moderate chats, and process repetitive tasks.', '', 'https://cdn.discordapp.my.id/cdn/e3dece.webp', true)
            `);
            console.log('Inserted original projects into database.');
        }

        const [exp] = await connection.query('SELECT COUNT(*) as count FROM experience');
        if (exp[0].count === 0) {
            await connection.query(`
                INSERT INTO experience (company, role, date_range, description, logo_url) VALUES 
                ('Arqonara Hosting', 'Manager & Staff', 'Aug 2025 — Present', 'Managing core backend infrastructure, ensuring game server stability under heavy load, and resolving network issues.', 'https://cdn.discordapp.my.id/cdn/df7b8d.webp'),
                ('HeppyCloud', 'Customer Service', 'Mar 2025 — Present', 'Providing direct technical support to clients, executing routine server maintenance, and troubleshooting modpacks.', 'https://cdn.discordapp.my.id/cdn/028eba.webp')
            `);
            console.log('Inserted original experience into database.');
        }

        await connection.end();
        console.log('Database Initialization Complete.');
    } catch (e) {
        console.error('Database Error:', e.message);
    }
}
init();
