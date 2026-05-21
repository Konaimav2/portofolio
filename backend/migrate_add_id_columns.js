/**
 * migrate_add_id_columns.js
 * Compatible with MySQL 5.7+ and MariaDB.
 * Run ONCE on the VPS: node migrate_add_id_columns.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const COLUMNS = [
    { table: 'projects',    column: 'title_id',       def: 'VARCHAR(255) NULL DEFAULT NULL AFTER description' },
    { table: 'projects',    column: 'description_id',  def: 'TEXT NULL DEFAULT NULL AFTER title_id' },
    { table: 'experience',  column: 'role_id',         def: 'VARCHAR(255) NULL DEFAULT NULL AFTER description' },
    { table: 'experience',  column: 'description_id',  def: 'TEXT NULL DEFAULT NULL AFTER role_id' },
];

(async () => {
    const conn = await mysql.createConnection(process.env.DATABASE_URL);
    const [[{ db }]] = await conn.query('SELECT DATABASE() AS db');
    console.log(`Connected to database: ${db}\nRunning migration...\n`);

    for (const { table, column, def } of COLUMNS) {
        const [rows] = await conn.query(
            `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
            [db, table, column]
        );
        if (rows.length > 0) {
            console.log(`⚠  ${table}.${column} — already exists, skipping.`);
        } else {
            await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${def}`);
            console.log(`✅  ${table}.${column} — added.`);
        }
    }

    await conn.end();
    console.log('\nMigration complete. Restart portback with: pm2 restart portback');
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
