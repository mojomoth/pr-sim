import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
const t0 = Date.now();
try { const r = await ai.models.generateContent({ model: "gemini-3.8-flash", contents: "say OK" }); console.log("gemini ok", Date.now() - t0, r.text?.slice(0, 20)); } catch (e) { console.log("gemini err", String(e.message).slice(0, 200)); }
