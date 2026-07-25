import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import * as dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase payload limit to accept base64 video
  app.use(express.json({ limit: "500mb" }));
  app.use(express.urlencoded({ limit: "500mb", extended: true }));

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

  app.post("/api/transcribe", async (req, res) => {
    try {
      const { videoBase64, mimeType, language, script } = req.body;

      if (!videoBase64) {
        return res.status(400).json({ error: "Missing video data." });
      }

      let systemInstruction = "You are a professional video transcription AI. Your task is to accurately transcribe the spoken audio in the provided video and generate timestamps for subtitles.";
      
      let languageHint = "";
      if (language === "Darija (Moroccan)") {
        languageHint = "The spoken language is Moroccan Darija. Transcribe it naturally as actually spoken, keeping French and Spanish loanwords as they are said (e.g. 'cinéma', 'portable') rather than converting everything into formal Modern Standard Arabic. ";
      } else if (language === "Modern Standard Arabic") {
        languageHint = "The spoken language is Modern Standard Arabic. ";
      } else if (language === "Other Arabic dialect") {
        languageHint = "The spoken language is an Arabic dialect. Transcribe it as spoken natively. ";
      } else if (language !== "Auto-detect") {
        languageHint = `The spoken language is ${language}. `;
      }

      let scriptHint = "";
      if (script === "Arabizi") {
        scriptHint = "Output the transcription using Arabizi (Latin letters with numbers like 3, 7, 9 representing Arabic letters). ";
      } else if (script === "Arabic script") {
        scriptHint = "Output the transcription using the Arabic script. Ensure right-to-left consistency. ";
      }

      const promptText = `Please transcribe the speech in the attached video. ${languageHint}${scriptHint}`;

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: [
          {
            inlineData: {
              mimeType: mimeType || "video/mp4",
              data: videoBase64,
            },
          },
          promptText,
        ],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            description: "List of subtitle segments.",
            items: {
              type: Type.OBJECT,
              properties: {
                text: {
                  type: Type.STRING,
                  description: "The spoken text in the segment.",
                },
                start: {
                  type: Type.NUMBER,
                  description: "Start time of the segment in seconds.",
                },
                end: {
                  type: Type.NUMBER,
                  description: "End time of the segment in seconds.",
                },
              },
              required: ["text", "start", "end"],
            },
          },
        },
      });

      if (!response.text) {
        return res.status(500).json({ error: "No response text received from model." });
      }

      const subtitles = JSON.parse(response.text);
      res.json({ subtitles });
    } catch (error: any) {
      console.error("Transcription error:", error);
      let errorMessage = "Failed to transcribe video.";
      if (error.message) {
        try {
          // Sometimes the SDK throws a stringified JSON in the message
          const parsed = JSON.parse(error.message);
          if (parsed.error && parsed.error.message) {
            errorMessage = parsed.error.message;
          } else {
            errorMessage = error.message;
          }
        } catch {
          // If the message starts with JSON string, try to parse substring
          if (error.message.includes("{")) {
             try {
                const jsonStr = error.message.substring(error.message.indexOf("{"));
                const parsed = JSON.parse(jsonStr);
                if (parsed.error && parsed.error.message) errorMessage = parsed.error.message;
                else errorMessage = error.message;
             } catch {
                errorMessage = error.message;
             }
          } else {
             errorMessage = error.message;
          }
        }
      }
      if (error.status === 429) {
         errorMessage = "You have exceeded your API quota. Please try again later or check your Gemini API plan.";
      }
      res.status(error.status || 500).json({ error: errorMessage });
    }
  });

  app.post("/api/translate", async (req, res) => {
    try {
      const { subtitles, targetLanguage, styleHint } = req.body;

      if (!subtitles || !targetLanguage) {
        return res.status(400).json({ error: "Missing subtitles or target language." });
      }

      const promptText = `Translate these subtitle segments into ${targetLanguage}. ${styleHint || ""}\n\nKeep the original timestamps exactly as they are.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: [
          JSON.stringify(subtitles),
          promptText,
        ],
        config: {
          systemInstruction: "You are a professional subtitle translator.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            description: "List of translated subtitle segments.",
            items: {
              type: Type.OBJECT,
              properties: {
                text: {
                  type: Type.STRING,
                  description: "The translated text.",
                },
                start: {
                  type: Type.NUMBER,
                  description: "Start time of the segment in seconds.",
                },
                end: {
                  type: Type.NUMBER,
                  description: "End time of the segment in seconds.",
                },
              },
              required: ["text", "start", "end"],
            },
          },
        },
      });

      if (!response.text) {
        return res.status(500).json({ error: "No response text received from model." });
      }

      const translatedSubtitles = JSON.parse(response.text);
      res.json({ subtitles: translatedSubtitles });
    } catch (error: any) {
      console.error("Translation error:", error);
      let errorMessage = "Failed to translate subtitles.";
      if (error.message) {
        try {
          const parsed = JSON.parse(error.message);
          if (parsed.error && parsed.error.message) errorMessage = parsed.error.message;
          else errorMessage = error.message;
        } catch {
          if (error.message.includes("{")) {
             try {
                const jsonStr = error.message.substring(error.message.indexOf("{"));
                const parsed = JSON.parse(jsonStr);
                if (parsed.error && parsed.error.message) errorMessage = parsed.error.message;
                else errorMessage = error.message;
             } catch {
                errorMessage = error.message;
             }
          } else {
             errorMessage = error.message;
          }
        }
      }
      if (error.status === 429) {
         errorMessage = "You have exceeded your API quota. Please try again later or check your Gemini API plan.";
      }
      res.status(error.status || 500).json({ error: errorMessage });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
