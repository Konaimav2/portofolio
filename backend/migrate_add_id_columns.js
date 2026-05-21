/**
 * migrate_add_id_columns.js
 * Run ONCE on the VPS to add Indonesian translation columns:
 *   node migrate_add_id_columns.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
    const conn = await mysql.createConnection(process.env.DATABASE_URL);
    console.log('Connected. Running migration...\n');

    const migrations = [
        // Projects: title_id (optional Indonesian title), description_id (optional Indonesian description)
        `ALTER TABLE projects ADD COLUMN IF NOT EXISTS title_id VARCHAR(255) NULL DEFAULT NULL AFTER description`,
        `ALTER TABLE projects ADD COLUMN IF NOT EXISTS description_id TEXT NULL DEFAULT NULL AFTER title_id`,

        // Experience: role_id (optional Indonesian role), description_id (optional Indonesian description)
        `ALTER TABLE experience ADD COLUMN IF NOT EXISTS role_id VARCHAR(255) NULL DEFAULT NULL AFTER description`,
        `ALTER TABLE experience ADD COLUMN IF NOT EXISTS description_id TEXT NULL DEFAULT NULL AFTER role_id`,
    ];

    for (const sql of migrations) {
        try {
            await conn.query(sql);
            console.log(`✅ ${sql.slice(0, 60)}...`);
        } catch (e) {
            if (e.code === 'ER_DUP_FIELDNAME') {
                console.log(`⚠  Column already exists, skipping.`);
            } else {
                console.error(`❌ Failed: ${e.message}`);
            }
        }
    }

    await conn.end();
    console.log('\nMigration complete.');
})();
