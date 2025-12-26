/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { AspectRatio, ComplexityLevel, VisualStyle, ResearchResult, AIResponse, Language } from "../types";

// Helper function to handle API requests to our own backend
const apiRequest = async (endpoint: string, body: any, token: string): Promise<any> => {
  const response = await fetch(`/api/gemini/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || `API request failed with status ${response.status}`);
  }
  return response.json();
};

// --- Existing Functionality ---

export const researchTopicForPrompt = async (
  topic: string,
  level: ComplexityLevel,
  style: VisualStyle,
  language: Language,
  aspectRatio: AspectRatio,
  token: string
): Promise<ResearchResult> => {
  return apiRequest('research', { topic, level, style, language, aspectRatio }, token);
};

export const generateInfographicImage = async (prompt: string, aspectRatio: AspectRatio, token: string): Promise<AIResponse> => {
  return apiRequest('generate-image', { prompt, aspectRatio }, token);
};

export const editInfographicImage = async (currentImageInput: string, editInstruction: string, token: string): Promise<AIResponse> => {
  // The backend will handle base64 conversion if needed, but we ensure it's a data URL for consistency.
  return apiRequest('edit-image', { currentImageInput, editInstruction }, token);
};

// --- New Features ---

export const generateSimpleImage = async (prompt: string, images: string[], token: string): Promise<AIResponse> => {
  return apiRequest('generate-simple-image', { prompt, images }, token);
};

export const chatWithGemini = async (
    history: { role: string, content: string }[],
    newMessage: string,
    modelName: string,
    token: string,
    attachments?: { mimeType: string, data: string }[]
): Promise<AIResponse> => {
    return apiRequest('chat', { history, newMessage, modelName, attachments }, token);
};

export const generateTitleForText = async (text: string, token: string): Promise<string> => {
    const result = await apiRequest('generate-title', { text }, token);
    return result.title;
};
