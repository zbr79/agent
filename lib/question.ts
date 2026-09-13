export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionItem {
  header: string;
  question: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

export interface PendingQuestion {
  requestId: string;
  opencodeSessionId: string;
  questions: QuestionItem[];
}

export const MAX_QUESTIONS = 6;
export const MAX_OPTIONS = 8;
export const MAX_HEADER = 80;
export const MAX_QUESTION_TEXT = 500;
export const MAX_LABEL = 40;
export const MAX_DESCRIPTION = 160;
export const MAX_CUSTOM_ANSWER = 500;
export const MAX_REQUEST_ID = 80;

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function sanitizeOption(raw: unknown): QuestionOption | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const label = typeof rec.label === "string" ? clip(rec.label, MAX_LABEL) : "";
  if (!label) return null;
  const description =
    typeof rec.description === "string" ? clip(rec.description, MAX_DESCRIPTION) : "";
  return description ? { label, description } : { label };
}

function sanitizeItem(raw: unknown): QuestionItem | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const question =
    typeof rec.question === "string"
      ? clip(rec.question, MAX_QUESTION_TEXT)
      : typeof rec.text === "string"
        ? clip(rec.text, MAX_QUESTION_TEXT)
        : "";
  if (!question) return null;
  const header =
    typeof rec.header === "string" && rec.header.trim()
      ? clip(rec.header, MAX_HEADER)
      : clip(question, MAX_HEADER);
  const options = Array.isArray(rec.options)
    ? rec.options.map(sanitizeOption).filter((option): option is QuestionOption => Boolean(option))
    : [];
  if (options.length === 0 || options.length > MAX_OPTIONS) return null;
  const item: QuestionItem = { header, question, options };
  if (rec.multiple === true) item.multiple = true;
  if (rec.custom === false) item.custom = false;
  return item;
}

export function sanitizeQuestionPayload(
  raw: unknown,
  opencodeSessionId: string
): PendingQuestion | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const requestId =
    typeof rec.requestId === "string"
      ? rec.requestId.trim()
      : typeof rec.id === "string"
        ? rec.id.trim()
        : typeof rec.requestID === "string"
          ? rec.requestID.trim()
          : "";
  if (!requestId || requestId.length > MAX_REQUEST_ID) return null;
  if (requestId.includes("\0") || requestId.includes("/")) return null;
  const session =
    typeof rec.opencodeSessionId === "string" && rec.opencodeSessionId.trim()
      ? rec.opencodeSessionId.trim()
      : opencodeSessionId;
  if (!session || session.length > 64) return null;
  const list = Array.isArray(rec.questions) ? rec.questions : [];
  const questions = list
    .slice(0, MAX_QUESTIONS)
    .map(sanitizeItem)
    .filter((item): item is QuestionItem => Boolean(item));
  if (questions.length === 0) return null;
  return { requestId, opencodeSessionId: session, questions };
}

export function parseQuestionEvent(
  eventType: string,
  properties: Record<string, unknown> | undefined,
  opencodeSessionId: string
): PendingQuestion | null {
  const type = eventType.toLowerCase();
  if (!type.includes("question") || !type.includes("asked")) return null;
  return sanitizeQuestionPayload(properties ?? {}, opencodeSessionId);
}

export function parseQuestionToolInput(
  input: Record<string, unknown> | undefined,
  requestId: string,
  opencodeSessionId: string
): PendingQuestion | null {
  if (!input) return null;
  return sanitizeQuestionPayload(
    {
      requestId,
      opencodeSessionId,
      questions: input.questions ?? [input],
    },
    opencodeSessionId
  );
}

export class QuestionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionValidationError";
  }
}

export function validateQuestionAnswers(
  pending: PendingQuestion,
  answers: unknown
): string[][] {
  if (!Array.isArray(answers) || answers.length !== pending.questions.length) {
    throw new QuestionValidationError("Answer every question before submitting.");
  }
  return pending.questions.map((item, index) => {
    const raw = answers[index];
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new QuestionValidationError(`Question ${index + 1} needs an answer.`);
    }
    if (!item.multiple && raw.length > 1) {
      throw new QuestionValidationError(`Question ${index + 1} allows only one choice.`);
    }
    const labels = new Set(item.options.map((option) => option.label));
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const value of raw) {
      if (typeof value !== "string") {
        throw new QuestionValidationError(`Question ${index + 1} has an invalid answer.`);
      }
      const text = clip(value, MAX_CUSTOM_ANSWER);
      if (!text) continue;
      if (seen.has(text)) continue;
      const known = labels.has(text);
      if (!known && item.custom === false) {
        throw new QuestionValidationError(`Question ${index + 1} does not allow a custom answer.`);
      }
      seen.add(text);
      cleaned.push(text);
    }
    if (cleaned.length === 0) {
      throw new QuestionValidationError(`Question ${index + 1} needs an answer.`);
    }
    return cleaned;
  });
}
