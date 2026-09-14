"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Menu, X, SquarePen, Search, PanelLeft, Pin, PinOff, Settings, User, MoreHorizontal, Pencil, Trash2, ChevronRight, Languages, Gauge, LogOut, ImageDown, RotateCw, Folder, Check, Plus, AppWindow } from "lucide-react";
import type { ChatSession, WorkspaceId, WorkspaceInfo } from "@/lib/types";
import { deleteGuestSession, clearGuestSessions, listGuestSessions, pinGuestSession, renameGuestSession, type GuestSession } from "@/lib/guestStore";
import { STR, useUiLang, setUiLang } from "@/lib/i18n";
import SearchModal from "./SearchModal";
import AuthModal from "./AuthModal";
import { useCompressImages } from "@/lib/prefs";

interface MeUser {
  _id: string;
  username: string;
}

const COLLAPSED_KEY = "inschat_sidebar_collapsed";

// Workspace/folder path chip in the brand area (desktop + mobile).
// Kept behind a flag so it can be hidden without deleting the wiring.
const SHOW_WORKSPACE_PATH: boolean = false;

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

export default function Sidebar({ workspace }: { workspace?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentSession = searchParams.get("session");
  const lang = useUiLang();
  const t = STR[lang];
  const [user, setUser] = useState<MeUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[] | null>(null);
  const [guestSessions, setGuestSessions] = useState<GuestSession[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authNonce, setAuthNonce] = useState(0);
  const [compressImages, setCompressImages] = useCompressImages();
  const [workspaceCopied, setWorkspaceCopied] = useState(false);
  const workspaceBase = workspace
    ? workspace.replace(/\/+$/, "").split("/").filter(Boolean).pop() || workspace
    : "";
  const currentWorkspaceId = (() => {
    const raw = searchParams.get("workspace");
    if (raw === "profile" || raw === "inschat" || raw === "rencipe") return raw;
    const owned = sessions?.find((session) => session._id === currentSession)?.workspaceId;
    const guest = guestSessions.find((session) => session.id === currentSession)?.workspaceId;
    return (owned ?? guest ?? "agent") as WorkspaceId;
  })();
  const currentWorkspace = workspaces.find((item) => item.id === currentWorkspaceId) ?? {
    id: currentWorkspaceId,
    label: currentWorkspaceId === "agent" ? "Agent" : currentWorkspaceId,
  };
  const copyWorkspace = async () => {
    if (!workspace) return;
    try {
      await navigator.clipboard.writeText(workspace);
      setWorkspaceCopied(true);
      window.setTimeout(() => setWorkspaceCopied(false), 1600);
    } catch {}
  };
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

  const refreshApp = () => {
    setMenuOpen(false);
    window.location.reload();
  };

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

  // Escape closes the mobile drawer (and any open row menu).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setMenuFor(null);
      setRenamingId(null);
      setWorkspaceOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
  }, [pathname, authNonce]);

  useEffect(() => {
    if (!authChecked) return;
    fetch("/api/workspaces")
      .then((response) => response.json())
      .then((body: { workspaces?: WorkspaceInfo[] }) => {
        if (Array.isArray(body.workspaces)) setWorkspaces(body.workspaces);
      })
      .catch(() => {});
  }, [authChecked, user]);

  // Deep link /?auth=1 (redirect target of the old /login page) opens the
  // auth modal automatically.
  useEffect(() => {
    if (searchParams.get("auth") === "1") {
      setAuthOpen(true);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("auth");
      router.replace(`/?${params.toString()}`);
    }
  }, [searchParams, router]);

  const load = useCallback(() => {
    if (!authChecked) return;
    if (user) {
      fetch("/api/sessions")
        .then((response) => response.json())
        .then((body: { sessions: ChatSession[] }) => setSessions(body.sessions))
        .catch(() => {});
    } else {
      setGuestSessions(listGuestSessions());
    }
  }, [authChecked, user]);

  useEffect(() => {
    load();
  }, [load, currentSession]);

  // ChatApp finished auto-summarizing a new chat's title — re-read the list.
  useEffect(() => {
    const onTitles = () => load();
    window.addEventListener("inschat-titles", onTitles);
    return () => window.removeEventListener("inschat-titles", onTitles);
  }, [load]);

  useEffect(() => {
    const onRequireAuth = () => setAuthOpen(true);
    window.addEventListener("inschat-open-auth", onRequireAuth);
    return () => window.removeEventListener("inschat-open-auth", onRequireAuth);
  }, []);


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
        // Dispose of the bound opencode thread for the deleted guest chat.
        fetch(`/api/guest-runs/${id}`, { method: "DELETE" }).catch(() => {});
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
      window.dispatchEvent(new CustomEvent("inschat-auth"));
      router.replace("/");
    }
  };

  const selectWorkspace = (id: WorkspaceId) => {
    setWorkspaceOpen(false);
    setMenuOpen(false);
    router.push(`/?workspace=${encodeURIComponent(id)}`);
  };

  const ownerList = (sessions ?? []).sort(
    (a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false)
  );
  const guestList = guestSessions.sort(
    (a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false)
  );
  const activeOwnerList = ownerList.filter(
    (session) => session.workspaceId === currentWorkspaceId
  );
  const activeGuestList = guestList.filter(
    (session) => session.workspaceId === currentWorkspaceId
  );

  const renderSessionRow = (
    id: string,
    title: string,
    pinned: boolean,
    workspaceId: WorkspaceId = "agent"
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
          href={`/?session=${id}&workspace=${encodeURIComponent(workspaceId)}`}
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
        aria-label={t["nav.more"]}
        title={t["nav.more"]}
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
          aria-label={t["nav.openMenu"]}
          title={t["nav.openMenu"]}
        >
          <Menu size={20} />
        </button>
        <Link href="/" className="mobile-brand" title={workspace ? t["nav.workspace"] : undefined}>
          Agent
          {SHOW_WORKSPACE_PATH && workspace && (
            <span className="mobile-brand-ws">{workspaceBase}</span>
          )}
        </Link>
        <button
          type="button"
          className="menu-button mobile-refresh"
          onClick={refreshApp}
          aria-label={t["nav.refresh"]}
          title={t["nav.refresh"]}
        >
          <RotateCw size={18} />
        </button>
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
            <img src="/icon.svg" width={28} height={28} alt="" />
          </span>
          <span className="brand-text">
            <span className="brand-name">Agent</span>
            {SHOW_WORKSPACE_PATH && workspace && (
              <button
                type="button"
                className={`brand-workspace${workspaceCopied ? " copied" : ""}`}
                onClick={copyWorkspace}
                title={workspace}
                aria-label={`${t["nav.workspace"]}: ${workspace}`}
              >
                {workspaceCopied ? <Check size={12} /> : <Folder size={12} />}
                <span className="brand-workspace-path">{workspace}</span>
              </button>
            )}
          </span>
          <button
            type="button"
            className="sidebar-hide"
            onClick={refreshApp}
            aria-label={t["nav.refresh"]}
            title={t["nav.refresh"]}
          >
            <RotateCw size={16} />
          </button>
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
        <div className="sidebar-scroll">
          <div className="workspace-tree">
            <div className="workspace-root-row">
              <button
                type="button"
                className="workspace-root-button"
                onClick={() => setWorkspaceOpen(true)}
                aria-expanded={workspaceOpen}
                aria-haspopup="dialog"
              >
                <Folder size={16} />
                <span>{t["workspace.root"]}</span>
                <img src="/icon.svg" width={17} height={17} alt="" className="workspace-app-icon" />
              </button>
              <button
                type="button"
                className="workspace-add-button"
                onClick={() => setWorkspaceOpen(true)}
                aria-label={t["workspace.add"]}
                title={t["workspace.add"]}
              >
                <Plus size={15} />
              </button>
            </div>
            <div className="workspace-child">
              <div className="workspace-child-row">
                <button
                  type="button"
                  className="workspace-child-button"
                  onClick={() => setWorkspaceOpen(true)}
                  aria-haspopup="dialog"
                >
                  <AppWindow size={14} />
                  <span>{currentWorkspace.label}</span>
                </button>
                <button
                  type="button"
                  className="workspace-child-new"
                  onClick={() => {
                    setMenuOpen(false);
                    router.push(`/?workspace=${encodeURIComponent(currentWorkspaceId)}`);
                  }}
                  aria-label={t["nav.newChat"]}
                  title={t["nav.newChat"]}
                >
                  <SquarePen size={13} />
                </button>
              </div>
              {authChecked && (
                <div className="workspace-child-sessions">
                  {user ? (
                    <>
                      {sessions === null && <p className="session-hint">{t["nav.loading"]}</p>}
                      {sessions !== null && activeOwnerList.length === 0 && (
                        <p className="session-hint">{t["nav.noSessions"]}</p>
                      )}
                      {activeOwnerList.map((session) =>
                        renderSessionRow(
                          session._id,
                          session.title,
                          Boolean(session.pinned),
                          session.workspaceId
                        )
                      )}
                    </>
                  ) : (
                    <>
                      {activeGuestList.length === 0 && (
                        <p className="session-hint">{t["nav.guestHint"]}</p>
                      )}
                      {activeGuestList.map((session) =>
                        renderSessionRow(
                          session.id,
                          session.title,
                          Boolean(session.pinned),
                          session.workspaceId
                        )
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      <div className="sidebar-foot">
        {user ? (
          <div className="account-row">
            <span className="avatar">{user.username.charAt(0).toUpperCase()}</span>
            <span className="account-name">{user.username}</span>
            <button
              type="button"
              className="settings-button"
              onClick={() => setSettingsOpen(true)}
              aria-label={t["nav.settings"]}
              title={t["nav.settings"]}
            >
              <Settings size={20} />
            </button>
          </div>
        ) : (
          <div className="account-row guest">
            <div className="guest-identity">
              <button
                type="button"
                className="login-circle"
                onClick={() => setAuthOpen(true)}
                aria-label={t["nav.signIn"]}
                title={t["nav.signIn"]}
              >
                <User size={20} />
              </button>
              <span className="guest-name">{t["nav.guest"]}</span>
            </div>
            <button
              type="button"
              className="settings-button"
              onClick={() => setSettingsOpen(true)}
              aria-label={t["nav.settings"]}
              title={t["nav.settings"]}
            >
              <Settings size={20} />
            </button>
          </div>
        )}
      </div>
    </aside>
    {workspaceOpen && (
      <>
        <div
          className="workspace-modal-backdrop"
          onClick={() => setWorkspaceOpen(false)}
          aria-hidden="true"
        />
        <div className="workspace-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-modal-title">
          <div className="workspace-modal-head">
            <div>
              <span className="workspace-modal-kicker">{t["workspace.root"]}</span>
              <h2 id="workspace-modal-title">{t["workspace.selectFolder"]}</h2>
            </div>
            <button
              type="button"
              className="workspace-modal-close"
              onClick={() => setWorkspaceOpen(false)}
              aria-label={t["actions.cancel"]}
            >
              <X size={17} />
            </button>
          </div>
          <div className="workspace-modal-list">
            {workspaces.length === 0 ? (
              <p className="session-hint">{t["nav.loading"]}</p>
            ) : (
              workspaces.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`workspace-modal-option${item.id === currentWorkspaceId ? " active" : ""}`}
                  onClick={() => selectWorkspace(item.id)}
                >
                  <span className="workspace-modal-option-icon">
                    <Folder size={18} />
                  </span>
                  <span className="workspace-modal-option-copy">
                    <strong>{item.label}</strong>
                    <small>{t["workspace.approvedProject"]}</small>
                  </span>
                  {item.id === currentWorkspaceId && <Check size={16} />}
                </button>
              ))
            )}
          </div>
        </div>
      </>
    )}
    <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} authed={!!user} />
    <AuthModal
      open={authOpen}
      onClose={() => setAuthOpen(false)}
      onAuthed={() => {
        setAuthNonce((value) => value + 1);
        setMenuOpen(false);
        window.dispatchEvent(new CustomEvent("inschat-auth"));
        router.replace("/");
      }}
    />
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
            <span className="settings-row-icon">
              <Languages size={16} />
            </span>
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
            <span className="settings-row-icon">
              <ImageDown size={16} />
            </span>
            <span className="settings-label">{t["settings.compressImages"]}</span>
            <button
              type="button"
              role="switch"
              aria-checked={compressImages}
              className={`switch${compressImages ? " on" : ""}`}
              onClick={() => setCompressImages(!compressImages)}
              aria-label={t["settings.compressImages"]}
            >
              <span className="switch-knob" />
            </button>
          </label>
          <button
            type="button"
            className="settings-row settings-link"
            onClick={() => {
              setSettingsOpen(false);
              setMenuOpen(false);
              router.push("/usage");
            }}
          >
            <span className="settings-row-icon">
              <Gauge size={16} />
            </span>
            <span className="settings-label">{t["nav.usage"]}</span>
            <ChevronRight size={16} />
          </button>
          {user && (
            <button
              type="button"
              className="settings-row settings-link settings-signout"
              onClick={() => {
                setSettingsOpen(false);
                void logout();
              }}
              aria-label={t["nav.signOut"]}
            >
              <span className="settings-row-icon settings-danger-icon">
                <LogOut size={16} />
              </span>
              <span className="settings-label">{t["nav.signOut"]}</span>
            </button>
          )}
          {!user && (
            <div className="settings-row settings-danger">
              <span className="settings-row-icon settings-danger-icon">
                <Trash2 size={16} />
              </span>
              <span className="settings-danger-text">
                <span className="settings-label">{t["settings.deleteHistory"]}</span>
                <span className="settings-hint">{t["settings.deleteHistoryHint"]}</span>
              </span>
              <button
                type="button"
                className={`settings-danger-button${deleteArmed ? " armed" : ""}`}
                onClick={() => {
                  if (!deleteArmed) {
                    setDeleteArmed(true);
                    window.setTimeout(() => setDeleteArmed(false), 3000);
                    return;
                  }
                  clearGuestSessions();
                  setGuestSessions([]);
                  setDeleteArmed(false);
                  setSettingsOpen(false);
                  if (currentSession) router.replace("/");
                }}
              >
                {deleteArmed ? t["settings.deleteConfirm"] : t["settings.delete"]}
              </button>
            </div>
          )}
        </div>
      </>
    )}
    </>
  );
}
