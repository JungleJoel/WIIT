require('dotenv').config();

module.exports = {
    development: {
        client: 'mssql',
        connection: {
            server: process.env.DB_HOST,
            port: Number(process.env.DB_PORT),
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            options: {
                encrypt: false,
                trustServerCertificate: true,
            },
        },
        migrations: { directory: './migrations' },
        seeds: { directory: './seeds' },
    },
};