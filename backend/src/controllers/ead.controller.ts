import path from "path";
import type { NextFunction, Request, Response } from "express";

import db from "../db/knex";
import { EadParser } from "../ead/eadParser";
import { EadMapper } from "../ead/eadMapper";
import { EadRepository } from "../repositories/ead.repository";
import "multer";

import {
  EadImportService,
  EadImportValidationError,
} from "../services/EAD-Export.Service";

interface HttpError extends Error {
  status?: number;
}

const eadService = new EadImportService(
  new EadParser(),
  new EadMapper(),
  new EadRepository(db)
);

function getUploadedFile(req: Request): Express.Multer.File {
  if (!req.file) {
    const error: HttpError = new Error("Please upload an XML file in the file field.");
    error.status = 400;
    throw error;
  }

  return req.file;
}

function getXmlFromRequest(req: Request): string {
  return getUploadedFile(req).buffer.toString("utf8");
}

export async function getTree(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tree = await new EadRepository(db).getTree(Number(req.params.structureId));
    res.json(tree);
  } catch (e) { next(e); }
}

export async function previewImport(req: Request, res: Response, _next: NextFunction): Promise<void> {
  console.log("[EAD PREVIEW] Request received");
  console.log("[EAD PREVIEW] File exists:", Boolean(req.file));

  try {
    const xml = getXmlFromRequest(req);

    console.log("[EAD PREVIEW] XML length:", xml.length);
    console.log("[EAD PREVIEW] Starting parser and mapper");

    const result = eadService.preview(xml);

    console.log("[EAD PREVIEW] Success");

    res.status(200).json(result);
    return;
  } catch (err) {
    const error = err as HttpError;

    console.error("[EAD PREVIEW] Error name:", error.name);
    console.error("[EAD PREVIEW] Error message:", error.message);
    console.error("[EAD PREVIEW] Error stack:", error.stack);

    if (error.status === 400) {
      res.status(400).json({
        message: error.message,
      });
      return;
    }

    res.status(500).json({
      message: error.message || "Unknown error",
      errorName: error.name,
    });
  }
}

export async function importEad(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const file = getUploadedFile(req);
    const xml = file.buffer.toString("utf8");

    let structureId: number | null = null;

    if (req.body.structureId !== undefined && req.body.structureId !== "") {
      structureId = Number(req.body.structureId);
    }

    const structureName: string =
      typeof req.body.structureName === "string"
        ? req.body.structureName.trim()
        : "";

    if (!structureId && !structureName) {
      res.status(400).json({
        message: "Provide either structureId or structureName.",
      });
      return;
    }

    const result = await eadService.import({
      xml,
      sourceFileName: path.basename(file.originalname),
      structureId: structureId || null,
      structureName: structureName || null,
    });

    res.status(201).json({
      message: "EAD document imported successfully.",
      ...result,
    });
    return;
  } catch (err) {
    console.error("EAD import failed:", (err as Error).stack || err);

    if (err instanceof EadImportValidationError) {
      res.status(400).json({
        message: err.message,
        errors: err.issues,
      });
      return;
    }

    const error = err as HttpError;

    if (error.status && error.status < 500) {
      res.status(error.status).json({
        message: error.message,
      });
      return;
    }

    next(error);
  }
}