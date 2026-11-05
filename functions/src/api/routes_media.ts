import { Router, Response } from "express";
import { authRequired, AuthenticatedRequest } from "../api_middleware";
import { zernio } from "../lib/zernio";

export const mediaRouter = Router();

const MAX_SIZE = 5 * 1024 ** 3; // 5 GB

mediaRouter.post("/presign", authRequired(), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const { filename, contentType, size } = (req.body || {}) as {
      filename?: string;
      contentType?: string;
      size?: number;
    };
    if (!filename || !contentType) return res.status(400).json({ error: "Faltan filename o contentType" });
    if (size && size > MAX_SIZE) return res.status(400).json({ error: "El archivo supera 5 GB" });

    const data = await zernio<{ uploadUrl: string; publicUrl: string }>(user.uid, "/media/presign", {
      method: "POST",
      body: { filename, contentType, size },
    });
    return res.json({ uploadUrl: data.uploadUrl, publicUrl: data.publicUrl });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

