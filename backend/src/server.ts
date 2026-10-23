import express from 'express';
import dotenv from 'dotenv';
import knex from 'knex';
import config from './knexfile';
import { createUserRouter } from './routers/userRoutes'; // Match your file name
import { createIndexRouter } from './routers/indexRoutes';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

const db = knex(config.development);

const requireRole = () => async (req: any, _res: any, next: any) => {
  const user = await db('users').first<{ id: number }>('id');
  req.user = { id: user ? user.id : null };
  next();
};

app.use('/', createIndexRouter());

app.use('/mau-arkiv/users', createUserRouter(db));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
