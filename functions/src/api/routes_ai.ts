import { Router, Response } from "express";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { authRequired, AuthenticatedRequest } from "../api_middleware";
import { aiKnowledgeFilesCol, aiKnowledgeDoc } from "../paths";
import { knowledgeState, recompile } from "../lib/knowledge-store";
import { MAX_MANUAL } from "../lib/knowledge";
import { OPENROUTER_URL } from "../lib/openrouter";

export const aiRouter = Router();

aiRouter.get("/knowledge", authRequired({ perm: "settings.agente" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    return res.json(await knowledgeState(user.uid));
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

aiRouter.delete("/knowledge", authRequired({ perm: "settings.agente" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const id = req.query.fileId as string;
    if (!id) return res.status(400).json({ error: "Falta fileId" });
    const db = getFirestore();
    await db.collection(aiKnowledgeFilesCol(user.uid)).doc(id).delete();
    await recompile(user.uid);
    return res.json(await knowledgeState(user.uid));
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

aiRouter.post("/knowledge/manual", authRequired({ perm: "settings.agente" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    await recompile(user.uid);
    return res.json(await knowledgeState(user.uid));
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

aiRouter.put("/knowledge/manual", authRequired({ perm: "settings.agente" }), async (req, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    const { manual } = req.body || {};
    if (typeof manual !== "string") return res.status(400).json({ error: "Falta manual" });
    if (manual.length > MAX_MANUAL) return res.status(400).json({ error: `El manual supera ${MAX_MANUAL / 1000}k caracteres` });
    const db = getFirestore();
    await db.doc(aiKnowledgeDoc(user.uid)).set(
      { manual: manual.trim(), manualSource: "edited", manualUpdatedAt: FieldValue.serverTimestamp(), stale: false },
      { merge: true },
    );
    return res.json(await knowledgeState(user.uid));
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

aiRouter.get("/models", authRequired(), async (_req, res: Response) => {
  try {
    const response = await fetch(`${OPENROUTER_URL}/models`);
    if (!response.ok) return res.status(502).json({ error: "No se pudo leer la lista de modelos" });
    const { data } = (await response.json()) as { data: any[] };

    const perMillion = (v?: string) => (v ? Math.round(Number(v) * 1e6 * 100) / 100 : null);
    const models = data
      .filter((m) => m.id.startsWith("openai/") && !m.id.endsWith(":batch") && (m.architecture?.output_modalities ?? ["text"]).join() === "text")
      .map((m) => ({
        id: m.id,
        name: m.name,
        context: m.context_length ?? null,
        prompt: perMillion(m.pricing?.prompt),
        completion: perMillion(m.pricing?.completion),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return res.json({ models });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Error interno" });
  }
});

