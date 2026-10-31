import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import { db, dbRaw } from './config/db';
import { attachUser, requireRole } from './middleware/auth';
import { createUserRouter } from './routers/userRoutes';
import { Index } from './routes';
import { createEadExportRouter } from './ead/exportRoute';
import { createEadImportRouter } from './ead/importRoute';
import { createNodeRouter } from './routers/nodeRoutes';
import { errorHandler } from './middleware/errorHandler';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET ?? 'dev-only-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' },
}));
app.use(attachUser);

new Index(db).setRoutes(app);
app.use('/api/users', createUserRouter(db));
app.use('/api/node', createNodeRouter(db));
app.use('/api', createEadExportRouter({ knex: dbRaw, requireRole }));
app.use('/api', createEadImportRouter({ knex: dbRaw, requireRole }));

app.use(errorHandler);

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
