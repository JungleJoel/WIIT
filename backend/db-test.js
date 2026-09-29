const sql = require('mssql');

const config = {
    user: 'sa',
    password: 'Wiit_Dev_2026!',
    server: '127.0.0.1',
    port: 1433,
    database: 'master',
    options: { encrypt: false, trustServerCertificate: true },
};

async function main() {
    try {
        const pool = await sql.connect(config);
        await pool.request().query("IF DB_ID('wiit') IS NULL CREATE DATABASE wiit");
        const res = await pool.request().query('SELECT GETDATE() AS now');
        console.log('Connected! Server time:', res.recordset[0].now);
        await pool.close();
    } catch (err) {
        console.error('Connection failed:', err.message);
    }
}

main();