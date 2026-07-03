import { completionBudget, requestOpenAiRaw, temperatureParams } from "./request";
import { asRecord, extractModelText, parseJsonFromText, safeString } from "./parse";
import { secureRandomIndex } from "./concept-seeds";
import { loadRecentSubjects, rememberSubject, subjectsOverlap } from "../lib/recent-subjects";
import type { ApiSettings, SquiggleCommitment } from "../types";

// Small models can't hold a soft instruction like "use a seed word only if it fits" —
// they either obsess over the word or ignore it. So diversity is restructured into two
// steps the model IS good at: (1) one cheap high-temperature text call that lists
// several things THIS squiggle (described in plain language) could become, then
// (2) code — not the model — picks one at random, avoiding recently drawn subjects.
// The drawing loop then gets exactly one concrete job: "finish it as X".

const IDEA_COUNT = 5;

// Small models sometimes echo the JSON example back verbatim; exact echoes are
// dropped in parseIdeas (broad word-overlap filtering would ban snails forever).
const EXAMPLE_SUBJECT = "a sleepy snail";

export async function chooseSquiggleSubject(
  settings: ApiSettings,
  gestalt: string,
  signal?: AbortSignal,
): Promise<SquiggleCommitment | null> {
  const avoid = loadRecentSubjects();
  // This runs against small local models only, so a tight budget is safe and keeps
  // the extra call cheap even when the user's token slider is high.
  const ideationSettings: ApiSettings = {
    ...settings,
    maxCompletionTokens: Math.min(settings.maxCompletionTokens, 800),
  };

  const response = await requestOpenAiRaw(
    settings,
    {
      model: settings.model.trim(),
      ...temperatureParams(ideationSettings, 0.95),
      ...completionBudget(ideationSettings, 800),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You brainstorm what a half-drawn squiggle could become. Return valid JSON only.",
        },
        { role: "user", content: ideationPrompt(gestalt, avoid) },
      ],
    },
    signal,
  );

  const ideas = parseIdeas(response).filter(
    (idea) => !avoid.some((recent) => subjectsOverlap(recent, idea.subject)),
  );
  if (!ideas.length) return null;

  const chosen = ideas[secureRandomIndex(ideas.length)];
  rememberSubject(chosen.subject);
  return chosen;
}

export function ideationPrompt(gestalt: string, avoid: string[]): string {
  return [
    `A person drew a squiggle. ${gestalt}`,
    `List ${IDEA_COUNT} different fun things this squiggle could become once a few marks are added.`,
    "Each idea must reuse the person's line as a visible part of the finished drawing, matching its position and shape.",
    "Make the ideas as different from each other as possible: mix animals, objects, food, vehicles, plants, characters.",
    ...(avoid.length ? [`Do not suggest anything similar to these recent drawings: ${avoid.join(", ")}.`] : []),
    `Return JSON only: {"ideas": [{"subject": "${EXAMPLE_SUBJECT}", "part": "shell"}, ...]}.`,
    "subject is 2-4 words. part names which part of the subject the person's line becomes. Do not repeat the example.",
  ].join("\n");
}

export function parseIdeas(response: unknown): SquiggleCommitment[] {
  let parsed: unknown;
  try {
    parsed = parseJsonFromText(extractModelText(response));
  } catch {
    return [];
  }

  const record = asRecord(parsed);
  const rawIdeas = Array.isArray(record?.ideas) ? record.ideas : Array.isArray(parsed) ? parsed : [];

  return rawIdeas
    .map((rawIdea): SquiggleCommitment | null => {
      const idea = asRecord(rawIdea);
      const subject = safeString(idea?.subject, "", 60);
      if (!subject || !/[a-z]/i.test(subject)) return null;
      if (subject.toLowerCase() === EXAMPLE_SUBJECT) return null;
      return { subject, part: safeString(idea?.part, "body", 40) };
    })
    .filter((idea): idea is SquiggleCommitment => Boolean(idea));
}
