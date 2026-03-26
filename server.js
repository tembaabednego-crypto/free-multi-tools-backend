const express = require("express");
const cors = require("cors");
const multer = require("multer");
const dotenv = require("dotenv");
const sharp = require("sharp");
const pdfParse = require("pdf-parse");
const { PDFDocument } = require("pdf-lib");
const { Document, Packer, Paragraph } = require("docx");
const fs = require("fs");
const path = require("path");
const os = require("os");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

app.disable("x-powered-by");

// CORS: allow all by default, or allow a comma-separated list of origins.
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (CORS_ORIGIN === "*") return callback(null, true);
      const allowed = CORS_ORIGIN.split(",").map((s) => s.trim());
      return allowed.includes(origin) ? callback(null, true) : callback(null, false);
    },
    credentials: false
  })
);

app.use(express.json({ limit: "2mb" }));

// Multer: store uploads in memory; we write to temp files only for ffmpeg.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

app.get("/", (req, res) => {
  res.send("Free Multi-Tools backend is running");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

function toNumber(val, fallback) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

async function writeTempFile(buffer, filename) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "freemulti-"));
  const filePath = path.join(dir, filename);
  await fs.promises.writeFile(filePath, buffer);
  return { dir, filePath };
}

async function cleanupTemp(dir) {
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch (_) {}
}

async function compressImageJpeg(buffer, quality) {
  const q = Math.max(10, Math.min(95, Math.round(quality)));
  return sharp(buffer).jpeg({ quality: q, mozjpeg: true }).toBuffer();
}

async function pdfToDocxFromText(pdfBuffer) {
  // Extract text from PDF (best-effort; formatting may not be perfect).
  const data = await pdfParse(pdfBuffer);
  const text = (data && data.text) || "";

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const paragraphs = lines.slice(0, 300).map((line) => new Paragraph(line));
  if (paragraphs.length === 0) paragraphs.push(new Paragraph("No extractable text found in PDF."));

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph("Converted from PDF"),
          ...paragraphs
        ]
      }
    ]
  });

  return Packer.toBuffer(doc);
}

async function cutAudioMp3(audioBuffer, startSec, endSec, inputExt) {
  const start = Math.max(0, startSec);
  const end = Math.max(start, endSec);
  const duration = Math.max(0.01, end - start);

  const safeExt = inputExt && inputExt.startsWith(".") ? inputExt : ".input";
  const { dir, filePath: inputPath } = await writeTempFile(audioBuffer, `input${safeExt}`);
  const outputPath = path.join(dir, "output.mp3");

  try {
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .inputOptions(["-hide_banner"])
        .setStartTime(start)
        .setDuration(duration)
        .audioCodec("libmp3lame")
        .format("mp3")
        .on("end", resolve)
        .on("error", reject)
        .save(outputPath);
    });

    return await fs.promises.readFile(outputPath);
  } finally {
    await cleanupTemp(dir);
  }
}

// ========== Required endpoints ==========
app.post("/compress-image", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Missing file" });
    const quality = toNumber(req.body.quality || 75, 75);
    const out = await compressImageJpeg(req.file.buffer, quality);

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Disposition", `attachment; filename="compressed.jpg"`);
    res.send(out);
  } catch (err) {
    next(err);
  }
});

app.post("/audio-cutter", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Missing file" });
    const start = toNumber(req.body.start || 0, 0);
    const end = toNumber(req.body.end || 10, start + 10);
    const inputExt = path.extname(req.file.originalname || "") || ".audio";
    const out = await cutAudioMp3(req.file.buffer, start, end, inputExt);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", `attachment; filename="cut.mp3"`);
    res.send(out);
  } catch (err) {
    next(err);
  }
});

app.post("/pdf-to-word", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Missing file" });
    const out = await pdfToDocxFromText(req.file.buffer);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="converted.docx"`);
    res.send(out);
  } catch (err) {
    next(err);
  }
});

app.post("/pdf-to-images", upload.single("file"), async (req, res) => {
  // Rendering PDF pages into PNG/JPG is environment-dependent.
  // A typical approach is poppler (`pdftoppm`) or headless canvas rendering.
  // For now we return a clear message instead of producing empty output.
  res.status(501).json({
    error: "pdf-to-images not configured on this backend yet",
    needs: ["poppler (pdftoppm) OR canvas-based PDF renderer"],
    note: "You can still use PDF->Word, merge, split, and compress."
  });
});

// Resume builder: expects JSON body (name, email, phone, summary, skills[], experience[], education[]).
app.post("/resume-builder", async (req, res, next) => {
  try {
    const data = (req.body && typeof req.body === "object" && req.body) || {};
    const name = data.name || "Your Name";
    const email = data.email || "";
    const phone = data.phone || "";
    const summary = data.summary || "";

    const skills = Array.isArray(data.skills) ? data.skills : [];
    const experience = Array.isArray(data.experience) ? data.experience : [];
    const education = Array.isArray(data.education) ? data.education : [];

    const children = [];
    children.push(new Paragraph(name));
    if (email || phone) children.push(new Paragraph([email, phone].filter(Boolean).join(" | ")));
    if (summary) children.push(new Paragraph(summary));

    if (skills.length) {
      children.push(new Paragraph("Skills"));
      children.push(new Paragraph(skills.join(", ")));
    }

    if (experience.length) {
      children.push(new Paragraph("Experience"));
      experience.slice(0, 5).forEach((job) => {
        const title = job.title || "";
        const company = job.company || "";
        const range = job.range || "";
        const points = Array.isArray(job.points) ? job.points : [];

        children.push(new Paragraph([title, company].filter(Boolean).join(" - ")));
        if (range) children.push(new Paragraph(range));
        points.slice(0, 5).forEach((p) => children.push(new Paragraph(`• ${p}`)));
      });
    }

    if (education.length) {
      children.push(new Paragraph("Education"));
      education.slice(0, 5).forEach((ed) => {
        const school = ed.school || "";
        const degree = ed.degree || "";
        const range = ed.range || "";
        children.push(new Paragraph([degree, school].filter(Boolean).join(" - ")));
        if (range) children.push(new Paragraph(range));
      });
    }

    const doc = new Document({ sections: [{ children }] });
    const out = await Packer.toBuffer(doc);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="resume.docx"`);
    res.send(out);
  } catch (err) {
    next(err);
  }
});

// ========== Frontend compatibility endpoints ==========
// Frontend uses: POST /api/convert (multipart/form-data: file + tool + quality + start + end)
app.post("/api/convert", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).send("Missing file");
    const tool = (req.body.tool || "").toString();

    if (tool === "image_compress") {
      const quality = toNumber(req.body.quality || 75, 75);
      const out = await compressImageJpeg(req.file.buffer, quality);
      res.setHeader("Content-Type", "image/jpeg");
      return res.send(out);
    }

    if (tool === "pdf_to_word") {
      const out = await pdfToDocxFromText(req.file.buffer);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      return res.send(out);
    }

    if (tool === "audio_cutter") {
      const start = toNumber(req.body.start || 0, 0);
      const end = toNumber(req.body.end || 10, start + 10);
      const inputExt = path.extname(req.file.originalname || "") || ".audio";
      const out = await cutAudioMp3(req.file.buffer, start, end, inputExt);
      res.setHeader("Content-Type", "audio/mpeg");
      return res.send(out);
    }

    return res.status(400).json({ error: "Unknown tool" });
  } catch (err) {
    next(err);
  }
});

app.post("/api/subscribe", (req, res) => {
  res.json({ status: "ok", received: req.body || {} });
});

app.post("/api/track", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/client-error", (req, res) => {
  res.json({ status: "ok" });
});

// ========== Extra PDF endpoints (merge/split/compress) ==========
app.post("/pdf-merge", upload.array("files", 10), async (req, res, next) => {
  try {
    const files = req.files || [];
    if (files.length < 2) return res.status(400).json({ error: "Select at least 2 PDFs." });

    const merged = await PDFDocument.create();
    for (const f of files) {
      const doc = await PDFDocument.load(f.buffer);
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    }

    const outBytes = await merged.save({ useObjectStreams: true });
    res.setHeader("Content-Type", "application/pdf");
    return res.send(Buffer.from(outBytes));
  } catch (err) {
    next(err);
  }
});

app.post("/pdf-split", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Missing file" });
    const fromPage = Math.max(1, Math.floor(toNumber(req.body.fromPage || 1, 1)));
    const toPage = Math.max(fromPage, Math.floor(toNumber(req.body.toPage || fromPage, fromPage)));

    const doc = await PDFDocument.load(req.file.buffer);
    const total = doc.getPageCount();
    if (fromPage > total) return res.status(400).json({ error: "fromPage out of range" });

    const newDoc = await PDFDocument.create();
    const startIdx = fromPage - 1;
    const endIdx = Math.min(toPage, total) - 1;
    const indices = Array.from({ length: endIdx - startIdx + 1 }, (_, i) => startIdx + i);

    const pages = await newDoc.copyPages(doc, indices);
    pages.forEach((p) => newDoc.addPage(p));

    const outBytes = await newDoc.save({ useObjectStreams: true });
    res.setHeader("Content-Type", "application/pdf");
    return res.send(Buffer.from(outBytes));
  } catch (err) {
    next(err);
  }
});

app.post("/compress-pdf", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Missing file" });
    const doc = await PDFDocument.load(req.file.buffer);
    const outBytes = await doc.save({ useObjectStreams: true });
    res.setHeader("Content-Type", "application/pdf");
    return res.send(Buffer.from(outBytes));
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Server error", detail: err?.message || String(err) });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
