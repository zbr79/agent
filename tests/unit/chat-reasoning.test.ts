import { describe, expect, it } from "vitest";
import { chooseChatReasoning } from "@/lib/chatReasoning";
import type { ChatMessage } from "@/lib/types";

function user(text: string): ChatMessage {
  return { role: "user", text };
}

describe("chooseChatReasoning", () => {
  it("disables reasoning for simple plan prompts", () => {
    expect(chooseChatReasoning([user("123")], "plan", false)).toBe("none");
  });

  it("uses max reasoning for complex plan prompts", () => {
    expect(chooseChatReasoning([user("Explain how to debug this API")], "plan", false)).toBe(
      "max"
    );
  });

  it("keeps build prompts deliberate", () => {
    expect(chooseChatReasoning([user("123")], "build", false)).toBe("max");
  });

  it("turns reasoning off for image requests", () => {
    expect(chooseChatReasoning([user("Explain this")], "build", true)).toBe("none");
  });
});
