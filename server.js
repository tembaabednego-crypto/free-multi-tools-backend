const express = require("express");
const cors = require("cors");
const multer = require("multer");
const pdf = require("pdf-parse");
const { Document, Packer, Paragraph, TextRun } = require("docx");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB
  },
});

app.get("/health", (req, res) => {
  res.json({ ok: true, message: "Server is running" });
});

app.post("/api/convert/pdf-to-word", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No PDF file uploaded." });
    }

    if (req.file.mimetype !== "application/pdf") {
      return res.status(400).json({ error: "Only PDF files are allowed." });
    }

    const data = await pdf(req.file.buffer);
    const extractedText = (data.text || "").trim();

    if (!extractedText) {
      return res.status(422).json({
        error: "This PDF appears to be scanned or image-based, so text could not be extracted.",
      });
    }

    const paragraphs = extractedText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map(
        (line) =>
          new Paragraph({
            children: [new TextRun(line)],
          })
      );

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: paragraphs,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="converted.docx"'
    );

    return res.send(buffer);
  } catch (error) {
    console.error("Conversion error:", error);
    return res.status(500).json({ error: "Conversion failed." });
  }
});

app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err);
  return res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
