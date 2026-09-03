"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X, MessageCircle, ClipboardList } from "lucide-react";
import {
  listGuestSessions,
  listGuestRecords,
  type GuestSession,
} from "@/lib/guestStore";
import { STR, useUiLang } from "@/lib/i18n";

interface ChatHit {
  sessionId: string;
  title: string;
  snippet: string;
  matches: number;
  updatedAt: string;
  messageId?: string;
}

interface RecordHit {
  id: string;
  title: string;
  summary: string;
  savedAt: string;
}

interface RecentChat {
  id: string;
  title: string;
}

function Highlight({ text, q }: { text: string; q: string }) {
  const needle = q.trim();
  if (!needle) return <>{text}</>;
  const lower = text.toLowerCase();
  const needleLower = needle.toLowerCase();
  const parts: React.ReactNode[] = [];
  let pos = 0;
  let key = 0;
  while (true) {
    const idx = lower.indexOf(needleLower, pos);
    if (idx === -1) {
      parts.push(text.slice(pos));
      break;
    }
    if (idx > pos) parts.push(text.slice(pos, idx));
    parts.push(
      <mark key={key++} className="search-mark">
        {text.slice(idx, idx + needle.length)}
      </mark>
    );
    pos = idx + needle.length;
  }
  return <>{parts}</>;
}

function localSnippet(text: string, q: string): string {
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  const start = Math.max(0, idx - 12);
  return (start > 0 ? "…" : "") + text.slice(start, start + 100).replace(/\s+/g, " ");
}

function searchGuest(
  q: string,
  scope: "all" | "chats" | "records"
): { chats: ChatHit[]; records: RecordHit[] } {
  const query = q.trim().toLowerCase();
  if (!query) return { chats: [], records: [] };
  const chats: ChatHit[] = [];
  if (scope === "all" || scope === "chats") {
    const sessions: GuestSession[] = listGuestSessions();
    for (const session of sessions) {
      let matches = 0;
      let snippet = "";
      let messageId: string | undefined;
      for (let i = 0; i < session.messages.length; i++) {
        const message = session.messages[i];
        if (message.text.toLowerCase().includes(query)) {
          matches += 1;
          if (!snippet) snippet = localSnippet(message.text, query);
          if (messageId === undefined) messageId = String(i);
        }
      }
      if (session.title.toLowerCase().includes(query)) {
        matches += 1;
        if (!snippet) snippet = session.title;
      }
      if (matches > 0) {
        chats.push({
          sessionId: session.id,
          title: session.title,
          snippet,
          matches,
          updatedAt: new Date(session.updatedAt).toISOString(),
          messageId,
        });
      }
    }
    chats.sort((a, b) => b.matches - a.matches);
  }
  const records: RecordHit[] = [];
  if (scope === "all" || scope === "records") {
    for (const record of listGuestRecords()) {
      if (
        record.title.toLowerCase().includes(query) ||
        record.summary.toLowerCase().includes(query)
      ) {
        records.push({
          id: record.id,
          title: record.title,
          summary: record.summary,
          savedAt: record.savedAt,
        });
      }
    }
  }
  return { chats, records };
}

export default function SearchModal({
  open,
  onClose,
  authed,
}: {
  open: boolean;
  onClose: () => void;
  authed: boolean;
}) {
  const router = useRouter();
  const lang = useUiLang();
  const t = STR[lang];
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"all" | "chats" | "records">("all");
  const [chats, setChats] = useState<ChatHit[]>([]);
  const [records, setRecords] = useState<RecordHit[]>([]);
  const [recent, setRecent] = useState<RecentChat[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load recent chats for the empty state
  const loadRecent = useCallback(() => {
    if (authed) {
      fetch("/api/sessions")
        .then((response) => response.json())
        .then((body: { sessions?: { _id: string; title: string }[] }) => {
          setRecent((body.sessions ?? []).slice(0, 15).map((s) => ({ id: s._id, title: s.title })));
        })
        .catch(() => setRecent([]));
    } else {
      setRecent(
        listGuestSessions()
          .slice(0, 15)
          .map((s) => ({ id: s.id, title: s.title }))
      );
    }
  }, [authed]);

  useEffect(() => {
    if (open) {
      setQ("");
      setScope("all");
      setChats([]);
      setRecords([]);
      setError(null);
      loadRecent();
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, loadRecent]);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const run = useCallback(
    (query: string, searchScope: "all" | "chats" | "records") => {
      const trimmed = query.trim();
      if (!trimmed) {
        setChats([]);
        setRecords([]);
        setError(null);
        return;
      }
      if (authed) {
        fetch(`/api/search?q=${encodeURIComponent(trimmed)}&scope=${searchScope}`)
          .then((response) => response.json())
          .then((body: { chats?: ChatHit[]; records?: RecordHit[]; error?: string }) => {
            if (body.error) throw new Error(t["common.requestFailed"]);
            setChats(body.chats ?? []);
            setRecords(body.records ?? []);
            setError(null);
          })
          .catch((err) => {
            setError(err instanceof Error ? err.message : t["common.requestFailed"]);
            setChats([]);
            setRecords([]);
          });
      } else {
        const result = searchGuest(trimmed, searchScope);
        setChats(result.chats);
        setRecords(result.records);
        setError(null);
      }
    },
    [authed, lang]
  );

  useEffect(() => {
    if (!open) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => run(q, scope), 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [q, scope, open, run]);

  if (!open) return null;

  const scopes: ("all" | "chats" | "records")[] = ["all", "chats", "records"];
  const nothing = chats.length === 0 && records.length === 0 && q.trim();

  return (
    <>
      <div className="settings-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="search-modal" role="dialog" aria-modal="true">
        <div className="search-input-row">
          <Search size={18} />
          <input
            ref={inputRef}
            type="text"
            value={q}
            placeholder={t["search.placeholder"]}
            onChange={(event) => setQ(event.target.value)}
            aria-label={t["nav.search"]}
          />
          <button
            type="button"
            className="settings-close"
            onClick={onClose}
            aria-label={t["actions.cancel"]}
          >
            <X size={16} />
          </button>
        </div>
        {q.trim() && (
          <div className="search-tabs">
            {scopes.map((item) => (
              <button
                key={item}
                type="button"
                className={`search-tab${scope === item ? " active" : ""}`}
                onClick={() => setScope(item)}
              >
                {t[`search.scope.${item}`]}
              </button>
            ))}
          </div>
        )}
        <div className="search-results">
          {error && <p className="session-hint">{error}</p>}
          {nothing && <p className="session-hint">{t["search.noResults"]}</p>}
          {!q.trim() && (
            <>
              <span className="sidebar-label">{t["search.recent"]}</span>
              {recent.length === 0 && (
                <p className="session-hint">{t["nav.noSessions"]}</p>
              )}
              {recent.map((chat) => (
                <button
                  key={chat.id}
                  type="button"
                  className="search-hit recent"
                  onClick={() => {
                    onClose();
                    router.push(`/?session=${chat.id}`);
                  }}
                >
                  <span className="search-hit-icon">
                    <MessageCircle size={15} />
                  </span>
                  <span className="search-hit-title">{chat.title}</span>
                </button>
              ))}
            </>
          )}
          {chats.map((chat) => (
            <button
              key={chat.sessionId}
              type="button"
              className="search-hit"
              onClick={() => {
                onClose();
                router.push(
                  `/?session=${chat.sessionId}${chat.messageId ? `&msg=${encodeURIComponent(chat.messageId)}` : ""}`
                );
              }}
            >
              <span className="search-hit-icon">
                <MessageCircle size={15} />
              </span>
              <span className="search-hit-body">
                <span className="search-hit-title">
                  <Highlight text={chat.title} q={q} />
                </span>
                <span className="search-hit-snippet">
                  <Highlight text={chat.snippet} q={q} />
                </span>
              </span>
            </button>
          ))}
          {records.map((record) => (
            <button
              key={record.id}
              type="button"
              className="search-hit"
              onClick={() => {
                onClose();
                router.push("/records");
              }}
            >
              <span className="search-hit-icon">
                <ClipboardList size={15} />
              </span>
              <span className="search-hit-body">
                <span className="search-hit-title">{record.title}</span>
                <span className="search-hit-snippet">{record.summary}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
