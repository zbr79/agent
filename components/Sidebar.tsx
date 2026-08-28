"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ChatSession } from "@/lib/types";
import { deleteGuestSession, listGuestSessions } from "@/lib/guestStore";

const ownerItems = [
  { href: "/", label: "Chat" },
  { href: "/records", label: "Records" },
  { href: "/calls", label: "Calls" },
  { href: "/models", label: "Models" },
  { href: "/usage", label: "Usage" },
];

const guestItems = [
  { href: "/", label: "Chat" },
  { href: "/records", label: "Records" },
];

interface MeUser {
  _id: string;
  username: string;
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const onHome = pathname === "/";
  const currentSession = searchParams.get("session");
  const [user, setUser] = useState<MeUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[] | null>(null);
  const [guestSessions, setGuestSessions] = useState<{ id: string; title: string }[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then((response) => (response.status === 401 ? null : response.json()))
      .then((body: { user?: MeUser } | null) => {
        if (!alive) return;
        setUser(body?.user ?? null);
        setAuthChecked(true);
      })
      .catch(() => {
        if (alive) setAuthChecked(true);
      });
    return () => {
      alive = false;
    };
  }, [pathname]);

  const load = useCallback(() => {
    if (!onHome || !authChecked) return;
    if (user) {
      fetch("/api/sessions")
        .then((response) => response.json())
        .then((body: { sessions: ChatSession[] }) => setSessions(body.sessions))
        .catch(() => {});
    } else {
      setGuestSessions(listGuestSessions());
    }
  }, [onHome, authChecked, user]);

  useEffect(() => {
    load();
  }, [load, currentSession]);

  const remove = async (id: string) => {
    if (deleting) return;
    setDeleting(id);
    try {
      if (user) {
        const response = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
        if (!response.ok) throw new Error("delete failed");
        setSessions((prev) => prev?.filter((session) => session._id !== id) ?? null);
      } else {
        deleteGuestSession(id);
        setGuestSessions(listGuestSessions());
      }
      if (currentSession === id) router.replace("/");
    } catch {} finally {
      setDeleting(null);
    }
  };

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {} finally {
      setUser(null);
      router.replace("/");
    }
  };

  const items = user ? ownerItems : guestItems;

  return (
    <aside className="sidebar">
      <Link href="/" className="sidebar-brand">
        InsChat
      </Link>
      <nav className="sidebar-nav">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`sidebar-link ${pathname === item.href ? "active" : ""}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {onHome && authChecked && (
        <div className="session-nav">
          <Link href="/" className="session-new">
            + New chat
          </Link>
          <div className="session-list">
            {user ? (
              <>
                {sessions === null && <p className="session-hint">Loading…</p>}
                {sessions !== null && sessions.length === 0 && (
                  <p className="session-hint">No saved chats yet.</p>
                )}
                {sessions?.map((session) => (
                  <div key={session._id} className="session-row">
                    <Link
                      href={`/?session=${session._id}`}
                      className="session-link"
                      title={session.title}
                    >
                      {session.title}
                    </Link>
                    <button
                      type="button"
                      className="session-delete"
                      aria-label={`Delete ${session.title}`}
                      disabled={deleting !== null}
                      onClick={() => remove(session._id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </>
            ) : (
              <>
                {guestSessions.length === 0 && (
                  <p className="session-hint">
                    Guest chats save on this device.
                  </p>
                )}
                {guestSessions.map((session) => (
                  <div key={session.id} className="session-row">
                    <Link
                      href={`/?session=${session.id}`}
                      className="session-link"
                      title={session.title}
                    >
                      {session.title}
                    </Link>
                    <button
                      type="button"
                      className="session-delete"
                      aria-label={`Delete ${session.title}`}
                      disabled={deleting !== null}
                      onClick={() => remove(session.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
      <div className="sidebar-foot">
        {user ? (
          <div className="sidebar-user">
            <span className="user-name">{user.username}</span>
            <button type="button" className="logout-button" onClick={logout}>
              Sign out
            </button>
          </div>
        ) : (
          <Link href="/login" className="login-link">
            Sign in
          </Link>
        )}
        <a
          href="https://github.com/zbr79/inschat"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
      </div>
    </aside>
  );
}
