
import { GoogleGenAI, Type } from "@google/genai";
import { AccelerationData, GeminiAnalysis, SessionStats } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });

export const analyzeMotionSession = async (data: AccelerationData[], stats: SessionStats): Promise<GeminiAnalysis> => {
  const sampledData = data.filter((_, i) => i % 10 === 0).slice(-200);
  
  const prompt = `
    Analyse d'inspection technique de voie.
    Contexte : Voie ${stats.track}, PK de départ ${stats.startPK} en sens ${stats.direction}.
    Seuils configurés (m/s²) pour les accélérations transversales Y : LA=${stats.thresholdLA}, LI=${stats.thresholdLI}, LAI=${stats.thresholdLAI}.
    Statistiques enregistrées : Max Vert=${stats.maxVertical}, Max Trans=${stats.maxTransversal}.
    Nombre de dépassements sur l'axe Y : LA=${stats.countLA}, LI=${stats.countLI}, LAI=${stats.countLAI}.

    Analyse les données d'accélération (X/Y transversales, Z verticale) :
    ${JSON.stringify(sampledData)}

    Détermine le type d'activité, le niveau de conformité, et donne des recommandations précises basées sur les dépassements de seuils constatés sur la voie ${stats.track}.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            activityType: { type: Type.STRING },
            intensityScore: { type: Type.NUMBER },
            observations: { 
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            recommendations: { type: Type.STRING },
            complianceLevel: { 
              type: Type.STRING,
              enum: ["Conforme", "Surveillance", "Critique"]
            }
          },
          required: ["activityType", "intensityScore", "observations", "recommendations", "complianceLevel"]
        }
      }
    });

    return JSON.parse(response.text || "{}") as GeminiAnalysis;
  } catch (error) {
    console.error("Gemini analysis error:", error);
    throw error;
  }
};
