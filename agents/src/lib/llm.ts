import OpenAI from "openai";
import { config } from "./config.js";
import type { VerificationResult, CarbonData } from "../types.js";

let openai: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openai) {
    openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  }
  return openai;
}

const VERIFICATION_PROMPT = `You are a carbon credit verification AI. Analyze the following carbon offset project and produce a structured assessment.

Project Data:
{project_data}

Score the following dimensions (0-100):
1. Methodology Quality — Is the methodology scientifically sound and widely accepted?
2. Additionality — Would these emission reductions happen without the project?
3. Permanence — Are the reductions permanent or reversible?
4. Leakage — Does the project cause emissions increases elsewhere?
5. Third-Party Verification — Has an accredited third party verified the claims?

Output ONLY valid JSON with these fields:
{
  "score": <0-100 overall score>,
  "reasoning": "<detailed analysis>",
  "confidence": "<low|medium|high>",
  "suggested_supply": <estimated annual credit supply in tonnes>
}`;

export async function verifyCarbonProject(
  projectData: CarbonData,
): Promise<VerificationResult> {
  const client = getClient();
  const prompt = VERIFICATION_PROMPT.replace("{project_data}", JSON.stringify(projectData, null, 2));

  const response = await client.chat.completions.create({
    model: config.OPENAI_MODEL,
    messages: [
      {
        role: "system",
        content: "You are a rigorous carbon credit verification expert. You analyze projects and output structured JSON only.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty response");
  }

  const result = JSON.parse(content) as VerificationResult;
  return result;
}

export async function detectFraudSignals(
  projectName: string,
): Promise<{ is_fraudulent: boolean; confidence: number; evidence: string[] }> {
  const client = getClient();

  const response = await client.chat.completions.create({
    model: config.OPENAI_MODEL,
    messages: [
      {
        role: "system",
        content: "You are a carbon market compliance expert. Analyze carbon credit projects for known fraud signals, greenwashing, double-counting, and credibility issues based on your knowledge. Output JSON only.",
      },
      {
        role: "user",
        content: `Analyze the carbon credit project named "${projectName}" for fraud signals, greenwashing, or credibility issues. Consider known issues in the voluntary carbon market.

Output ONLY valid JSON:
{ "is_fraudulent": bool, "confidence": 0-100, "evidence": [string] }`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty response for fraud detection");
  }

  return JSON.parse(content);
}
