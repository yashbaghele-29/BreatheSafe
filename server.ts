import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import type { Request, Response } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please add your API key in the Secrets panel.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function describeSmog(level: string): string {
  switch (level) {
    case 'moderate':
      return 'Moderate winter haze (AQI 101-150)';
    case 'unhealthy':
      return 'Unhealthy winter smog (AQI 151-250)';
    case 'severe':
      return 'Severe winter smog / thermal inversion (AQI 251-400+)';
    default:
      return 'Estimate typical winter smog severity for the specified location';
  }
}

function describeHousehold(household: string): string {
  switch (household) {
    case 'family_kids':
      return 'Family with school-age children or toddlers';
    case 'elderly_asthma':
      return 'Household with elderly relatives or asthma/respiratory sensitivity';
    case 'community_school':
      return 'Neighborhood group, apartment association, or local school coordinator';
    default:
      return 'Apartment household or solo resident';
  }
}

function describeLifestyle(lifestyle: string): string {
  switch (lifestyle) {
    case 'car_gas_heat':
      return 'Daily car commute and gas/wood/solid-fuel home heating';
    case 'transit_electric':
      return 'Public transit commute and electric home heating/cooking';
    case 'walk_two_wheeler':
      return 'Walking, cycling, or two-wheeler commute';
    default:
      return 'Mostly working or studying from home';
  }
}

function extractGeminiError(err: unknown): { status: number; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const statusProp =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: unknown }).status)
      : undefined;

  if (msg.includes('GEMINI_API_KEY')) {
    return { status: 500, message: msg };
  }
  if (
    statusProp === 403 ||
    msg.includes('403') ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('API_KEY_INVALID')
  ) {
    return {
      status: 403,
      message:
        'The Gemini API key appears invalid or lacks permission. Please verify it in Settings > Secrets.',
    };
  }
  if (statusProp === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message: 'API rate limit reached. Please wait a moment and try again.',
    };
  }
  if (statusProp === 503 || msg.includes('503') || msg.includes('UNAVAILABLE')) {
    return {
      status: 503,
      message:
        'The assistant is temporarily experiencing high demand. Please click again in a few seconds.',
    };
  }
  if (statusProp === 404 || msg.includes('NOT_FOUND')) {
    return {
      status: 404,
      message: 'Requested AI model was not found. Please check the model configuration.',
    };
  }
  if (statusProp === 400 || msg.includes('INVALID_ARGUMENT')) {
    return {
      status: 400,
      message: 'The request could not be processed. Please adjust your inputs and try again.',
    };
  }
  return {
    status: 502,
    message: 'Could not reach the air quality assistant right now. Please try again shortly.',
  };
}

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const statusProp =
        typeof err === 'object' && err !== null && 'status' in err
          ? Number((err as { status?: unknown }).status)
          : undefined;
      const isTransient =
        statusProp === 503 ||
        statusProp === 500 ||
        msg.includes('503') ||
        msg.includes('UNAVAILABLE');
      if (!isTransient || attempt === maxRetries) {
        throw err;
      }
      const delayMs = 600 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

const planResponseSchema = {
  type: Type.OBJECT,
  properties: {
    locationSummary: {
      type: Type.OBJECT,
      properties: {
        cityLabel: { type: Type.STRING, description: 'Clean city/neighborhood display name' },
        estimatedAqi: { type: Type.INTEGER, description: 'Realistic winter AQI number between 60 and 450' },
        aqiCategory: {
          type: Type.STRING,
          description: 'One of: Moderate, Unhealthy, Very Unhealthy, Severe',
        },
        inversionTip: {
          type: Type.STRING,
          description: 'Short 1-sentence local winter smog pattern note (e.g. cold morning inversion traps smoke).',
        },
        bestVentilationWindow: {
          type: Type.STRING,
          description: 'Short time window when outdoor air is clearest, e.g. "1:30 PM – 3:30 PM"',
        },
      },
      required: ['cityLabel', 'estimatedAqi', 'aqiCategory', 'inversionTip', 'bestVentilationWindow'],
    },
    dailyRoutine: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          timeOfDay: { type: Type.STRING, description: 'Morning, Afternoon, or Evening' },
          title: { type: Type.STRING, description: 'Clear 4-7 word action title' },
          action: { type: Type.STRING, description: 'Simple 1-2 sentence instruction anyone can follow' },
          whyItHelps: { type: Type.STRING, description: 'Plain-language explanation of the direct health or emission impact' },
          indoorExposureDropPercent: { type: Type.INTEGER, description: 'Estimated % reduction in PM2.5 exposure (3 to 35)' },
          communityEmissionSavedGrams: { type: Type.INTEGER, description: 'Estimated daily grams of PM2.5/pollutants or CO2e avoided (10 to 800)' },
          difficulty: { type: Type.STRING, description: 'Easy, Quick Swap, or Daily Habit' },
        },
        required: [
          'id',
          'timeOfDay',
          'title',
          'action',
          'whyItHelps',
          'indoorExposureDropPercent',
          'communityEmissionSavedGrams',
          'difficulty',
        ],
      },
    },
    indoorHacks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          title: { type: Type.STRING, description: 'Practical indoor air hack title' },
          room: { type: Type.STRING, description: 'Room or area e.g. Kitchen, Living Room, Windows' },
          cost: { type: Type.STRING, description: 'Free, Low Cost, or Moderate' },
          timeRequired: { type: Type.STRING, description: 'e.g. 5 mins, 15 mins' },
          steps: { type: Type.STRING, description: 'Clear 1-2 sentence practical how-to' },
          scienceNote: { type: Type.STRING, description: 'Simple 1-sentence reason why this lowers indoor PM2.5 or VOCs' },
        },
        required: ['id', 'title', 'room', 'cost', 'timeRequired', 'steps', 'scienceNote'],
      },
    },
    sustainableSwaps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          oldHabit: { type: Type.STRING, description: 'Common higher-emission winter habit' },
          sustainableAlternative: { type: Type.STRING, description: 'Practical low-emission alternative' },
          familyLungBenefit: { type: Type.STRING, description: 'Direct benefit for family indoor/personal breathing air' },
          communitySkyImpact: { type: Type.STRING, description: 'Direct impact on neighborhood winter smog' },
          weeklyCo2SavedKg: { type: Type.NUMBER, description: 'Realistic weekly kg CO2 avoided (0.5 to 25)' },
        },
        required: ['id', 'oldHabit', 'sustainableAlternative', 'familyLungBenefit', 'communitySkyImpact', 'weeklyCo2SavedKg'],
      },
    },
    communityNote: {
      type: Type.STRING,
      description: 'A friendly 2-sentence actionable message the user can share with neighbors or a local community group.',
    },
  },
  required: ['locationSummary', 'dailyRoutine', 'indoorHacks', 'sustainableSwaps', 'communityNote'],
};

const qaResponseSchema = {
  type: Type.OBJECT,
  properties: {
    answer: {
      type: Type.STRING,
      description: 'Warm, plain-language answer (3-5 short sentences) tailored to the family location and smog level.',
    },
    quickAction: {
      type: Type.STRING,
      description: 'One immediate 1-sentence action they can take today.',
    },
    impactSummary: {
      type: Type.STRING,
      description: 'One clear sentence explaining the direct health or emission impact of following this advice.',
    },
  },
  required: ['answer', 'quickAction', 'impactSummary'],
};

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.post('/api/plan', async (req: Request, res: Response) => {
    try {
      const body = req.body as {
        location?: string;
        smogLevel?: string;
        household?: string;
        lifestyle?: string;
      };

      const location = (body.location || '').trim().slice(0, 120);
      if (!location) {
        res.status(400).json({ error: 'Please enter a city, town, or neighborhood.' });
        return;
      }

      const smogDesc = describeSmog(body.smogLevel || 'auto');
      const householdDesc = describeHousehold(body.household || 'family_kids');
      const lifestyleDesc = describeLifestyle(body.lifestyle || 'car_gas_heat');

      const ai = getAiClient();
      const prompt = `Create a practical, easy-to-follow winter smog & urban air quality plan for:
- Location: ${location}
- Smog Severity: ${smogDesc}
- Household: ${householdDesc}
- Daily Commute & Home Routine: ${lifestyleDesc}

Provide:
- 6 daily routine steps (2 Morning, 2 Afternoon, 2 Evening) mixing exposure protection and low-emission habits.
- 6 low-cost, everyday indoor air quality hacks (e.g., wet dusting, kitchen exhaust, window draft sealing, DIY box-fan filter, avoiding incense/candles, safe ventilation timing).
- 4 sustainable swaps tailored to their commute/heating/community that clearly explain both the family's lung benefit and the community's winter air impact.
- 1 friendly 2-sentence community sharing note.`;

      const response = await callWithRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            systemInstruction:
              'You are BreatheSafe, a calm, practical environmental health assistant for everyday families and communities dealing with severe winter smog and urban air pollution. Write in simple, warm, non-technical language that anyone can immediately act on. Be realistic about numbers and avoid exaggeration or jargon.',
            responseMimeType: 'application/json',
            responseSchema: planResponseSchema,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        })
      );

      const rawText = (response.text || '{}').trim();
      const parsed = JSON.parse(rawText);
      res.json(parsed);
    } catch (err) {
      console.error('Error in /api/plan:', err);
      const { status, message } = extractGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/ask', async (req: Request, res: Response) => {
    try {
      const body = req.body as {
        question?: string;
        context?: {
          location?: string;
          smogLevel?: string;
          household?: string;
          lifestyle?: string;
        };
      };

      const question = (body.question || '').trim().slice(0, 400);
      if (!question) {
        res.status(400).json({ error: 'Please type a question first.' });
        return;
      }

      const ctx = body.context || {};
      const location = (ctx.location || 'an urban winter city').trim().slice(0, 120);
      const smogDesc = describeSmog(ctx.smogLevel || 'unhealthy');
      const householdDesc = describeHousehold(ctx.household || 'family_kids');
      const lifestyleDesc = describeLifestyle(ctx.lifestyle || 'car_gas_heat');

      const ai = getAiClient();
      const prompt = `User Context:
- Location: ${location}
- Smog Level: ${smogDesc}
- Household: ${householdDesc}
- Routine: ${lifestyleDesc}

Family/Community Question: "${question}"

Give a clear, compassionate, practical answer that avoids medical jargon, offers one concrete immediate step, and clearly explains the direct impact of that choice on their indoor air or neighborhood smog.`;

      const response = await callWithRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            systemInstruction:
              'You are BreatheSafe, a friendly winter air quality guide for families and communities. Keep advice safe, practical, accessible for all budgets, and grounded in environmental health best practices.',
            responseMimeType: 'application/json',
            responseSchema: qaResponseSchema,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        })
      );

      const rawText = (response.text || '{}').trim();
      const parsed = JSON.parse(rawText);
      res.json(parsed);
    } catch (err) {
      console.error('Error in /api/ask:', err);
      const { status, message } = extractGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BreatheSafe server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start BreatheSafe server:', err);
  process.exit(1);
});
