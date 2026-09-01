"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Menu, X, Plus, Search, PanelLeft, Pin, PinOff, Settings, User, MoreHorizontal, Pencil, Trash2, Sparkles } from "lucide-react";
import type { ChatSession } from "@/lib/types";
import {
  deleteGuestSession,
  listGuestSessions,
  pinGuestSession,
  renameGuestSession,
} from "@/lib/guestStore";
import { STR, useUiLang, setUiLang } from "@/lib/i18n";
import SearchModal from "./SearchModal";
import { useInsulinMode } from "@/lib/prefs";

const ownerItems = [
  { href: "/", label: "nav.chat" },
  { href: "/records", label: "nav.records" },
  { href: "/usage", label: "nav.usage" },
];

const guestItems = [
  { href: "/", label: "nav.chat" },
  { href: "/records", label: "nav.records" },
  { href: "/usage", label: "nav.usage" },
];

interface MeUser {
  _id: string;
  username: string;
}

const COLLAPSED_KEY = "inschat_sidebar_collapsed";

// DOM-measured truncation: render, then drop whole characters until the
// real element stops overflowing. Never cuts a letter in half.
function FitTitle({ title }: { title: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [text, setText] = useState(title);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = title;
    let trimmed = title;
    while (el.scrollWidth > el.clientWidth && trimmed.length > 1) {
      trimmed = trimmed.slice(0, -1);
      el.textContent = trimmed;
    }
    setText(trimmed);
  }, [title]);
  return (
    <span ref={ref} className="session-title" title={title}>
      {text}
    </span>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const onHome = pathname === "/";
  const currentSession = searchParams.get("session");
  const lang = useUiLang();
  const t = STR[lang];
  const [user, setUser] = useState<MeUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[] | null>(null);
  const [guestSessions, setGuestSessions] = useState<{ id: string; title: string; pinned?: boolean }[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [insulinMode, toggleInsulinMode] = useInsulinMode();
  const [menuFor, setMenuFor] = useState<{
    id: string;
    top: number;
    left: number;
  } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname, currentSession]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && (event.key === "O" || event.key === "o")) {
        event.preventDefault();
        router.push("/");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

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

  const rename = async (id: string) => {
    const title = renameText.trim();
    setMenuFor(null);
    setRenamingId(null);
    if (!title) return;
    try {
      if (user) {
        const response = await fetch(`/api/sessions/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
        if (!response.ok) throw new Error("rename failed");
        setSessions((prev) =>
          prev?.map((session) =>
            session._id === id ? { ...session, title } : session
          ) ?? null
        );
      } else {
        renameGuestSession(id, title);
        setGuestSessions(listGuestSessions());
      }
    } catch {}
  };

  const togglePin = async (id: string, pinned: boolean) => {
    try {
      if (user) {
        const response = await fetch(`/api/sessions/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pinned: !pinned }),
        });
        if (!response.ok) throw new Error("pin failed");
        setSessions((prev) =>
          prev?.map((session) =>
            session._id === id ? { ...session, pinned: !pinned } : session
          ) ?? null
        );
      } else {
        pinGuestSession(id, !pinned);
        setGuestSessions(listGuestSessions());
      }
    } catch {}
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

  const ownerList = (sessions ?? []).sort(
    (a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false)
  );
  const guestList = guestSessions.sort(
    (a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false)
  );

  const renderSessionRow = (
    id: string,
    title: string,
    pinned: boolean
  ) => (
    <div key={id} className={`session-row${pinned ? " pinned" : ""}`}>
      {renamingId === id ? (
        <input
          type="text"
          className="rename-input"
          value={renameText}
          autoFocus
          onFocus={(event) => {
            event.target.setSelectionRange(0, 0);
            event.target.scrollLeft = 0;
          }}
          onChange={(event) => setRenameText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") rename(id);
            if (event.key === "Escape") setRenamingId(null);
          }}
          onBlur={() => rename(id)}
          aria-label={t["nav.rename"]}
        />
      ) : (
        <Link
          href={`/?session=${id}`}
          className={`session-link${id === currentSession ? " active" : ""}`}
          title={title}
          onClick={() => setMenuOpen(false)}
        >
          <FitTitle title={title} />
        </Link>
      )}
      <button
        type="button"
        className="session-more"
        aria-label="More options"
        title="More options"
        onClick={(event) => {
          if (menuFor?.id === id) {
            setMenuFor(null);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          const menuWidth = 150;
          const left =
            rect.right + 6 + menuWidth > window.innerWidth
              ? rect.left - menuWidth - 6
              : rect.right + 6;
          const top = Math.max(
            8,
            Math.min(rect.top, window.innerHeight - 130)
          );
          setMenuFor({ id, top, left });
          setRenamingId(null);
        }}
      >
        <MoreHorizontal size={15} />
      </button>
      {menuFor?.id === id && (
        <>
          <div
            className="row-menu-backdrop"
            onClick={() => setMenuFor(null)}
            aria-hidden="true"
          />
          <div
            className="row-menu"
            style={{ top: menuFor.top, left: menuFor.left }}
          >
            <button
              type="button"
              className="row-menu-item"
              onClick={() => {
                setRenamingId(id);
                setRenameText(title);
                setMenuFor(null);
              }}
            >
              <Pencil size={14} />
              {t["nav.rename"]}
            </button>
            <button
              type="button"
              className="row-menu-item"
              onClick={() => {
                setMenuFor(null);
                togglePin(id, pinned);
              }}
            >
              {pinned ? <PinOff size={14} /> : <Pin size={14} />}
              {pinned ? t["nav.unpin"] : t["nav.pin"]}
            </button>
            <button
              type="button"
              className="row-menu-item danger"
              disabled={deleting !== null}
              onClick={() => {
                setMenuFor(null);
                remove(id);
              }}
            >
              <Trash2 size={14} />
              {t["nav.delete"]}
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      <div className="mobile-bar">
        <button
          type="button"
          className="menu-button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <Link href="/" className="mobile-brand">
          InsChat
        </Link>
      </div>
      {menuOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />
      )}
      {collapsed && (
        <button
          type="button"
          className="sidebar-expand"
          onClick={toggleCollapsed}
          aria-label={t["nav.showSidebar"]}
          title={t["nav.showSidebar"]}
        >
          <PanelLeft size={18} />
        </button>
      )}
      <aside
        className={`sidebar${menuOpen ? " open" : ""}${collapsed ? " collapsed" : ""}`}
      >
        <div className="sidebar-brand-row">
          <span className="brand-mark">
            <Sparkles size={16} />
          </span>
          <span className="brand-name">InsChat</span>
          <button
            type="button"
            className="sidebar-hide"
            onClick={() => setSearchOpen(true)}
            aria-label={t["nav.search"]}
            title={t["nav.search"]}
          >
            <Search size={16} />
          </button>
          <button
            type="button"
            className="sidebar-hide"
            onClick={toggleCollapsed}
            aria-label={t["nav.hideSidebar"]}
            title={t["nav.hideSidebar"]}
          >
            <PanelLeft size={16} />
          </button>
        </div>
        <Link
          href="/"
          className={`sidebar-new${onHome && !currentSession ? " active" : ""}`}
          onClick={() => setMenuOpen(false)}
        >
          <Plus size={16} />
          {t["nav.newChat"]}
        </Link>
        <div className="sidebar-scroll">
        <nav className="sidebar-nav">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-link ${pathname === item.href ? "active" : ""}`}
              onClick={() => setMenuOpen(false)}
            >
              {t[item.label]}
            </Link>
          ))}
        </nav>
      {onHome && authChecked && (
        <div className="session-nav">
          <span className="sidebar-label">{t["nav.chats"]}</span>
          <div className="session-list">
            {user ? (
              <>
                {sessions === null && <p className="session-hint">{t["nav.loading"]}</p>}
                {sessions !== null && ownerList.length === 0 && (
                  <p className="session-hint">{t["nav.noSessions"]}</p>
                )}
                {ownerList.map((session) =>
                  renderSessionRow(session._id, session.title, Boolean(session.pinned))
                )}
              </>
            ) : (
              <>
                {guestList.length === 0 && (
                  <p className="session-hint">{t["nav.guestHint"]}</p>
                )}
                {guestList.map((session) =>
                  renderSessionRow(session.id, session.title, Boolean(session.pinned))
                )}
              </>
            )}
          </div>
        </div>
      )}
        </div>
      <div className="sidebar-foot">
        {user ? (
          <div className="account-row">
            <span className="avatar">{user.username.charAt(0).toUpperCase()}</span>
            <span className="account-name">{user.username}</span>
            <button
              type="button"
              className="account-logout"
              onClick={logout}
              aria-label={t["nav.signOut"]}
              title={t["nav.signOut"]}
            >
              {t["nav.signOut"]}
            </button>
            <button
              type="button"
              className="settings-button"
              onClick={() => setSettingsOpen(true)}
              aria-label={t["nav.settings"]}
              title={t["nav.settings"]}
            >
              <Settings size={16} />
            </button>
          </div>
        ) : (
          <div className="account-row guest">
            <Link
              href="/login"
              className="login-circle"
              aria-label={t["nav.signIn"]}
              title={t["nav.signIn"]}
            >
              <User size={16} />
            </Link>
            <button
              type="button"
              className="settings-button"
              onClick={() => setSettingsOpen(true)}
              aria-label={t["nav.settings"]}
              title={t["nav.settings"]}
            >
              <Settings size={16} />
            </button>
          </div>
        )}
      </div>
    </aside>
    <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} authed={!!user} />
    {settingsOpen && (
      <>
        <div
          className="settings-backdrop"
          onClick={() => setSettingsOpen(false)}
          aria-hidden="true"
        />
        <div className="settings-modal" role="dialog" aria-modal="true">
          <div className="settings-head">
            <span className="settings-title">{t["settings.title"]}</span>
            <button
              type="button"
              className="settings-close"
              onClick={() => setSettingsOpen(false)}
              aria-label={t["actions.cancel"]}
            >
              <X size={16} />
            </button>
          </div>
          <label className="settings-row">
            <span className="settings-label">{t["settings.language"]}</span>
            <select
              className="settings-select"
              value={lang}
              onChange={(event) => setUiLang(event.target.value as "zh" | "en")}
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="settings-row">
            <span className="settings-label">
              {t["settings.insulinMode"]}
              <span className="settings-hint">{t["settings.insulinModeHint"]}</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={insulinMode}
              className={`switch${insulinMode ? " on" : ""}`}
              onClick={() => toggleInsulinMode(!insulinMode)}
              aria-label={t["settings.insulinMode"]}
            >
              <span className="switch-knob" />
            </button>
          </label>
        </div>
      </>
    )}
    </>
  );
}
