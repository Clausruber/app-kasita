import express from "express";
import cors from "cors";
import { onRequest } from "firebase-functions/v2/https";

import { meRouter } from "./routes_me";
import { clientsRouter } from "./routes_clients";
import { propertiesRouter } from "./routes_properties";
import { dealsRouter } from "./routes_deals";
import { tasksRouter } from "./routes_tasks";
import { agendasRouter } from "./routes_agendas";
import { quotesRouter, publicQuotesRouter } from "./routes_quotes";
import { teamRouter, invitesRouter } from "./routes_team";
import { settingsRouter } from "./routes_settings";
import { accountsRouter } from "./routes_accounts";
import { postsRouter } from "./routes_posts";
import { adminRouter } from "./routes_admin";
import { mediaRouter } from "./routes_media";
import { inboxRouter } from "./routes_inbox";
import { aiRouter } from "./routes_ai";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "15mb" }));

const router = express.Router();

router.use("/me", meRouter);
router.use("/clients", clientsRouter);
router.use("/properties", propertiesRouter);
router.use("/deals", dealsRouter);
router.use("/tasks", tasksRouter);
router.use("/agendas", agendasRouter);
router.use("/quotes", quotesRouter);
router.use("/public/quotes", publicQuotesRouter);
router.use("/team", teamRouter);
router.use("/invites", invitesRouter);
router.use("/settings", settingsRouter);
router.use("/accounts", accountsRouter);
router.use("/posts", postsRouter);
router.use("/admin", adminRouter);
router.use("/media", mediaRouter);
router.use("/inbox", inboxRouter);
router.use("/ai", aiRouter);

app.use("/api", router);
app.use("/", router);

export const api = onRequest(
  {
    region: "us-central1",
    maxInstances: 10,
    secrets: ["DF_AI_ENCRYPTION_KEY"],
  },
  app,
);

