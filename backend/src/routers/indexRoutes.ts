import { Router } from "express";

export function createIndexRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.send('Servern körs!');
  });

  return router;
}
