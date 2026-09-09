import { Converter } from "opencc-js/t2cn";

/**
 * OpenCC t2s: generic Traditional Chinese -> mainland Simplified (cn).
 * Non-CJK text (English) is a no-op. Already-simplified characters stay readable.
 */
const toSimplifiedCn = Converter({ from: "t", to: "cn" });

const CJK = /[\u3400-\u9FFF\uF900-\uFAFF]/;

export function traditionalToSimplified(text: string): string {
  if (!text || !CJK.test(text)) return text;
  return toSimplifiedCn(text);
}
