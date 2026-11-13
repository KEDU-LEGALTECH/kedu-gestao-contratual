import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import multer from "multer";
import { takeUpload } from "./processing-files.js";

/** Storage path of a file the browser sent directly (see POST /api/uploads); the user decides the folder,
 * so a request can only take the user's own upload. */
export const uploadPath = (userId: string, id: string) =>
  `uploads/${createHash("sha256").update(userId).digest("hex").slice(0, 24)}/${id}`;
const uploadId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Wraps multer: a form may carry upload_id instead of the file when the file went to Storage
 * (requests on Vercel stop at 4.5 MB). The route receives the same req.file and the same size limit. */
export function acceptStored(instance: multer.Multer, limit: number) {
  return {
    single(field: string): RequestHandler {
      const parse = instance.single(field);
      return (req: any, res, next) => parse(req, res, async (error?: unknown) => {
        if (error || req.file || !req.body?.upload_id) return next(error);
        try {
          if (!uploadId.test(String(req.body.upload_id)) || !req.user?.id) throw Object.assign(Error("Envio inválido. Envie o arquivo novamente."), { status: 400 });
          const buffer = await takeUpload(uploadPath(req.user.id, String(req.body.upload_id)));
          if (buffer.length > limit) throw new multer.MulterError("LIMIT_FILE_SIZE", field);
          req.file = {
            fieldname: field, originalname: String(req.body.upload_name || "arquivo").slice(0, 255),
            mimetype: String(req.body.upload_type || "application/octet-stream"), encoding: "7bit", size: buffer.length, buffer,
          };
          next();
        } catch (failure) { next(failure); }
      });
    },
  };
}
