// src/server.ts
import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import knex from 'knex';
import knexConfig from '../knexfile';
import { createEadExportRouter } from './ead/exportRoute';
import { createEadImportRouter } from './ead/importRoute';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const db = knex(knexConfig.development);

// Tillfällig mock tills SSO/AD finns – loggar in som första användaren i databasen
const requireRole = () => async (req: Request, _res: Response, next: NextFunction) => {
  const user = await db('users').first<{ id: number }>('id');
  req.user = { id: user ? user.id : null };
  next();
};

app.use('/api', createEadExportRouter({ knex: db, requireRole }));
app.use('/api', createEadImportRouter({ knex: db, requireRole }));

app.get('/', (_req: Request, res: Response) => {
  res.send('Servern körs!');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
