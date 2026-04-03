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
    fileSize: 20 * 1024 * 1024,
  },
});

app.get("/health", (req, res) => {
  res.json({ ok: true, message: "Server is running" });
});

try {
  if (!req.file) {
    return res.status(400).json({ error: "No PDF file uploaded" });
  }

  // 🔥 Extract text from PDF
  const data = await pdf(req.file.buffer);

  if (!data.text || data.text.trim() === "") {
    return res.status(500).json({
      error: "Failed to extract text from PDF"
    });
  }

  // 🔥 Create Word document
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: data.text.split("\n").map(line =>
          new Paragraph({
            children: [new TextRun(line)]
          })
        )
      }
    ]
  });

  const buffer = await Packer.toBuffer(doc);

  res.setHeader(
    "Content-Disposition",
    "attachment; filename=converted.docx"
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );

  res.send(buffer);

} catch (error) {
  console.error("Conversion error:", error);
  res.status(500).json({ error: "Conversion failed" });
}
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

    const lines = extractedText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const paragraphs = lines.map(
      (line) =>
        new Paragraph({
          children: [new TextRun(line)],
          spacing: { after: 200 },
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
    const fileName = req.file.originalname.replace(/\.pdf$/i, "") + ".docx";

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    res.send(buffer);
  } catch (error) {
    console.error("Conversion error:", error);
    res.status(500).json({
      error: "Failed to convert PDF to Word.",
      details: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
