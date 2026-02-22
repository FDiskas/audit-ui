import { OpenAI } from "openai";

// translationAvailable will be false when the environment variable is missing.
// Components use this to disable or hide translate controls, and the helper
// functions become no-ops so the app continues working without an API key.
const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
export const translationAvailable = Boolean(apiKey);

const getClient = () => {
  if (!apiKey) {
    // Should never be called when translationAvailable is false, but guard anyway.
    throw new Error(
      "VITE_OPENAI_API_KEY environment variable is not set. Add it to your .env file.",
    );
  }
  return new OpenAI({
    apiKey,
    dangerouslyAllowBrowser: true,
  });
};

export const translateText = async (
  text: string,
  targetLanguage: string,
): Promise<string> => {
  // If the API key is not provided we simply return the original text and
  // avoid invoking the OpenAI client. The UI should be disabled/hide controls
  // when `translationAvailable` is false, but this makes the helper safe to
  // call from other code paths (e.g. unit tests).
  if (!translationAvailable) {
    return text;
  }

  if (!text || !text.trim()) {
    return text;
  }
  if (!targetLanguage || !targetLanguage.trim()) {
    throw new Error("Target language is required");
  }

  const client = getClient();

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a professional translator.
Translate the provided text into ${targetLanguage}.

Strict Constraints:
1. Output ONLY the translated text — no explanations, apologies, or commentary.
2. Preserve all URLs exactly as they are.
3. Preserve markdown formatting (bullet points, bold, italic, links, headings).
4. Preserve placeholders (e.g., {{count}}) and do not translate code identifiers, variable names, function names, class names, or file paths.
5. Preserve line breaks and list structure.
6. If the text is already in ${targetLanguage}, return it unchanged.`,
        },
        {
          role: "user",
          content: text,
        },
      ],
      temperature: 0,
      max_completion_tokens: Math.max(1024, text.length * 2),
    });

    const translatedText = response.choices[0]?.message?.content?.trim() || "";

    if (!translatedText) {
      throw new Error("No translation received from OpenAI");
    }

    return translatedText;
  } catch (error: any) {
    console.error("Translation error:", error);
    throw error;
  }
};
