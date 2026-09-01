// Sentinel markers embedded in the plain-text chat stream so the client
// can show which model is answering. They use U+2400 (SYMBOL FOR NULL)
// as a delimiter because real assistant text never contains it.
const MARK = "\u2400";
const MODEL_PREFIX = `${MARK}MODEL:`;
const TRYING_PREFIX = `${MARK}TRYING:`;
const LIMIT_PREFIX = `${MARK}LIMIT:`;

export function encodeModelMarker(model: string): string {
  return `${MODEL_PREFIX}${model}${MARK}`;
}

export function encodeTryingMarker(model: string): string {
  return `${TRYING_PREFIX}${model}${MARK}`;
}

export function encodeLimitMarker(resetAt: string): string {
  return `${LIMIT_PREFIX}${resetAt}${MARK}`;
}

interface Parsed {
  text: string;
  model?: string;
  trying?: string;
  limit?: string;
}

function markerValue(inner: string): { model?: string; trying?: string; limit?: string } {
  if (inner.startsWith("MODEL:")) return { model: inner.slice(6) };
  if (inner.startsWith("TRYING:")) return { trying: inner.slice(7) };
  if (inner.startsWith("LIMIT:")) return { limit: inner.slice(6) };
  return {};
}

// Incremental parser that strips markers from arbitrarily split chunks.
export class ModelMarkerParser {
  private buffer = "";
  private inMarker = false;

  push(chunk: string): Parsed {
    this.buffer += chunk;
    let text = "";
    let model: string | undefined;
    let trying: string | undefined;
    let limit: string | undefined;

    while (this.buffer) {
      if (this.inMarker) {
        const close = this.buffer.indexOf(MARK, 1);
        if (close === -1) return { text, model, trying, limit };
        const inner = this.buffer.slice(1, close);
        this.buffer = this.buffer.slice(close + 1);
        this.inMarker = false;
        const parsed = markerValue(inner);
        if (parsed.model) model = parsed.model;
        if (parsed.trying) trying = parsed.trying;
        if (parsed.limit !== undefined) limit = parsed.limit;
        continue;
      }
      const start = this.buffer.indexOf(MARK);
      if (start === -1) {
        text += this.buffer;
        this.buffer = "";
        return { text, model, trying, limit };
      }
      text += this.buffer.slice(0, start);
      const tail = this.buffer.slice(start);
      if (
        tail.startsWith(MODEL_PREFIX) ||
        tail.startsWith(TRYING_PREFIX) ||
        tail.startsWith(LIMIT_PREFIX)
      ) {
        const close = tail.indexOf(MARK, 1);
        if (close === -1) {
          this.buffer = tail;
          this.inMarker = true;
          return { text, model, trying, limit };
        }
        const inner = tail.slice(1, close);
        this.buffer = tail.slice(close + 1);
        const parsed = markerValue(inner);
        if (parsed.model) model = parsed.model;
        if (parsed.trying) trying = parsed.trying;
        if (parsed.limit !== undefined) limit = parsed.limit;
        continue;
      }
      if (
        MODEL_PREFIX.startsWith(tail) ||
        TRYING_PREFIX.startsWith(tail) ||
        LIMIT_PREFIX.startsWith(tail)
      ) {
        // Partial marker start split across chunks — wait for more.
        this.buffer = tail;
        this.inMarker = true;
        return { text, model, trying, limit };
      }
      // Unknown marker — drop the delimiter, keep the rest.
      this.buffer = tail.slice(1);
    }
    return { text, model, trying, limit };
  }

  flush(): string {
    const text = this.buffer;
    this.buffer = "";
    this.inMarker = false;
    return text;
  }
}
