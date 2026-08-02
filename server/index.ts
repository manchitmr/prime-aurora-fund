import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import { router } from "./routes.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_DIR = path.join(__dirname, "..", "dashboard");
const PORT = Number(process.env.PORT) || 8888;

const app = express();
app.disable("x-powered-by");

app.use((_req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
  });
  next();
});

app.use(express.json());
app.use(cookieParser());

app.use("/api/admin", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

app.use(router);

// The editor page must never be cached by a shared cache — it renders
// household names for signed-in editors.
app.get("/editor", (_req, res) => {
  res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
  res.sendFile(path.join(DASHBOARD_DIR, "editor.html"));
});

app.use(express.static(DASHBOARD_DIR));

app.listen(PORT, () => {
  console.log(`Prime Aurora Fund dashboard listening on http://localhost:${PORT}`);
});
