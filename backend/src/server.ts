// src/server.ts
import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import knex from 'knex';
import knexConfig from '../knexfile';
import eadRoutes from "../src/routes/ead.routes";
import { createEadExportRouter } from './ead/exportRoute';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const db = knex(knexConfig.development);

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number | null;
      };
    }
  }
}

// Tillfällig mock tills SSO/AD finns – loggar in som första användaren i databasen

const requireRole = () => async (req: Request, _res: Response, next: NextFunction) => {
  const user = await db('users').first<{ id: number }>('id');
  req.user = { id: user ? user.id : null };
  next();
}

app.use('/api', createEadExportRouter({ knex: db, requireRole }));

app.get('/', (_req: Request, res: Response) => {
  res.send('Servern körs!');
});

app.post("/api/ead/test", (req: Request, res: Response) => {
  console.log("[TEST] Endpoint reached");

  res.status(200).json({
    message: "EAD route is working",
  });
});

app.use("/api/ead", eadRoutes);
//app.use("/api", createEadExportRouter({ knex, requireRole }));

app.get("/", (req: Request, res: Response) => {
  res.send("Servern körs!");
});


interface CustomError extends Error {
  status?: number;
  statusCode?: number;
  code?: string;
}

app.use((error: CustomError, req: Request, res: Response, next: NextFunction) => {
  console.error("\n========== EAD ERROR ==========");
  console.error("Method:", req.method);
  console.error("URL:", req.originalUrl);
  console.error("Name:", error.name);
  console.error("Message:", error.message);
  console.error("Stack:", error.stack);
  console.error("================================\n");

  if (res.headersSent) {
    return next(error);
  }

  let status = error.status || error.statusCode || 500;

  // Multer errors, such as file-size or file-count limits
  if (error.name === "MulterError") {
    status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
  }

  res.status(status).json({
    message: error.message || "Unknown server error.",
    errorName: error.name,
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
