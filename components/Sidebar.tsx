"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Menu, X, Plus, Search, PanelLeft, Pin, PinOff, Settings, User, MoreHorizontal, Pencil, Trash2, ChevronRight, ChevronDown, Languages, Gauge, LogOut, ImageDown, RotateCw, Folder, FolderPlus, Check } from "lucide-react";
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
const WORKSPACE_ORDER_KEY = "inschat_workspace_order";
const SESSION_INDICATORS_KEY = "inschat_session_indicators";
const DEFAULT_WORKSPACE_ORDER: WorkspaceId[] = ["agent", "profile", "inschat", "rencipe"];
type SessionIndicator = "read" | "unread" | "responding";

function orderWorkspaces(items: WorkspaceInfo[], order: WorkspaceId[]): WorkspaceInfo[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...items].sort(
    (a, b) => (rank.get(a.id) ?? order.length) - (rank.get(b.id) ?? order.length)
  );
}

function moveByDropPosition<T>(
  items: T[],
  fromId: string,
  targetId: string,
  before: boolean,
  getId: (item: T) => string
): T[] {
  const from = items.findIndex((item) => getId(item) === fromId);
  const target = items.findIndex((item) => getId(item) === targetId);
  if (from < 0 || target < 0 || from === target) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  let insertAt = target;
  if (from < target) insertAt -= 1;
  if (!before) insertAt += 1;
  next.splice(Math.max(0, Math.min(insertAt, next.length)), 0, moved);
  return next;
}

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
  const [sessionIndicators, setSessionIndicators] = useState<
    Record<string, SessionIndicator>
  >({});
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [workspaceTreeOpen, setWorkspaceTreeOpen] = useState(true);
  const [openWorkspaceIds, setOpenWorkspaceIds] = useState<Set<WorkspaceId>>(
    () => new Set(DEFAULT_WORKSPACE_ORDER)
  );
  const [dragWorkspaceId, setDragWorkspaceId] = useState<WorkspaceId | null>(null);
  const [workspaceDropTarget, setWorkspaceDropTarget] = useState<{
    id: WorkspaceId;
    before: boolean;
  } | null>(null);
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

  useEffect(() => {
    try {
      const stored = JSON.parse(
        window.localStorage.getItem(SESSION_INDICATORS_KEY) ?? "{}"
      );
      if (stored && typeof stored === "object") {
        setSessionIndicators(stored as Record<string, SessionIndicator>);
      }
    } catch {}
  }, []);

  const setSessionIndicator = useCallback(
    (id: string, status: SessionIndicator) => {
      const nextStatus =
        id === currentSession && status !== "responding" ? "read" : status;
      setSessionIndicators((current) => {
        if (current[id] === nextStatus) return current;
        const next = { ...current, [id]: nextStatus };
        try {
          window.localStorage.setItem(SESSION_INDICATORS_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    [currentSession]
  );

  useEffect(() => {
    const onSessionIndicator = (event: Event) => {
      const detail = (
        event as CustomEvent<{ sessionId?: unknown; status?: unknown }>
      ).detail;
      if (
        typeof detail?.sessionId !== "string" ||
        (detail.status !== "read" &&
          detail.status !== "unread" &&
          detail.status !== "responding")
      ) {
        return;
      }
      setSessionIndicator(detail.sessionId, detail.status);
    };
    window.addEventListener("inschat-session-indicator", onSessionIndicator);
    return () =>
      window.removeEventListener("inschat-session-indicator", onSessionIndicator);
  }, [setSessionIndicator]);

  useEffect(() => {
    if (currentSession) setSessionIndicator(currentSession, "read");
  }, [currentSession, setSessionIndicator]);

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
        if (!Array.isArray(body.workspaces)) return;
        if (user) {
          setWorkspaces(body.workspaces);
          return;
        }
        try {
          const stored = JSON.parse(
            window.localStorage.getItem(WORKSPACE_ORDER_KEY) ?? "[]"
          );
          const order = Array.isArray(stored)
            ? stored.filter((id): id is WorkspaceId => DEFAULT_WORKSPACE_ORDER.includes(id))
            : [];
          setWorkspaces(orderWorkspaces(body.workspaces, order));
        } catch {
          setWorkspaces(body.workspaces);
        }
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
    setWorkspaceTreeOpen(true);
    setOpenWorkspaceIds((current) => new Set(current).add(id));
    setMenuOpen(false);
    router.push(`/?workspace=${encodeURIComponent(id)}`);
  };

  const toggleWorkspaceOpen = (id: WorkspaceId) => {
    setOpenWorkspaceIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const ownerList = [...(sessions ?? [])].sort(
    (a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false)
  );
  const guestList = [...guestSessions].sort(
    (a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false)
  );

  const persistWorkspaceOrder = (next: WorkspaceInfo[]) => {
    setWorkspaces(next);
    const order = next.map((item) => item.id);
    if (user) {
      fetch("/api/workspaces/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      }).catch(() => {});
    } else {
      try {
        window.localStorage.setItem(WORKSPACE_ORDER_KEY, JSON.stringify(order));
      } catch {}
    }
  };

  const handleWorkspaceDrop = (targetId: WorkspaceId) => {
    if (!dragWorkspaceId || dragWorkspaceId === targetId) return;
    const next = moveByDropPosition(
      workspaces,
      dragWorkspaceId,
      targetId,
      workspaceDropTarget?.id === targetId ? workspaceDropTarget.before : true,
      (item) => item.id
    );
    persistWorkspaceOrder(next);
    setDragWorkspaceId(null);
    setWorkspaceDropTarget(null);
  };

  const renderSessionRow = (
    id: string,
    title: string,
    pinned: boolean,
    workspaceId: WorkspaceId = "agent"
  ) => (
    <div
      key={id}
      className={`session-row${pinned ? " pinned" : ""}${
        id === currentSession ? " active" : ""
      }`}
    >
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
          className="session-link"
          title={title}
          onClick={() => setMenuOpen(false)}
        >
          <span
            className={`session-placeholder-dot session-status-${
              sessionIndicators[id] ?? "read"
            }`}
            role="img"
            aria-label={
              sessionIndicators[id] === "responding"
                ? "Responding"
                : sessionIndicators[id] === "unread"
                  ? "Unread response"
                  : "Read"
            }
          />
          <FitTitle title={title} />
        </Link>
      )}
      <button
        type="button"
        className="session-delete"
        aria-label={t["nav.delete"]}
        title={t["nav.delete"]}
        disabled={deleting !== null}
        onClick={() => remove(id)}
      >
        <Trash2 size={14} />
      </button>
      <span className="session-time" aria-hidden="true">
        4m
      </span>
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
                onClick={() => setWorkspaceTreeOpen((open) => !open)}
                aria-expanded={workspaceTreeOpen}
              >
                <span className="workspace-root-label">{t["workspace.root"]}</span>
                <ChevronDown
                  size={16}
                  className={workspaceTreeOpen ? "workspace-chevron-open" : ""}
                />
              </button>
              <button
                type="button"
                className="workspace-add-button"
                onClick={() => setWorkspaceOpen(true)}
                aria-label={t["workspace.add"]}
                title={t["workspace.add"]}
              >
                <FolderPlus size={16} />
              </button>
            </div>
            {workspaceTreeOpen && (
              <div
                className="workspace-tree-children"
                onDragOver={(event) => {
                  if (!dragWorkspaceId) return;
                  event.preventDefault();
                  const element =
                    event.target instanceof HTMLElement ? event.target : null;
                  const folder = element?.closest<HTMLElement>(".workspace-folder");
                  const targetId = folder?.dataset.workspaceId as WorkspaceId | undefined;
                  if (!folder || !targetId || targetId === dragWorkspaceId) {
                    const firstRow = event.currentTarget.querySelector(".workspace-child-row");
                    const firstWorkspace = workspaces[0];
                    if (
                      firstRow instanceof HTMLElement &&
                      firstWorkspace &&
                      event.clientY < firstRow.getBoundingClientRect().top
                    ) {
                      setWorkspaceDropTarget({ id: firstWorkspace.id, before: true });
                    }
                    return;
                  }
                  const row = folder.querySelector(".workspace-child-row");
                  if (!(row instanceof HTMLElement)) return;
                  const rect = row.getBoundingClientRect();
                  setWorkspaceDropTarget({
                    id: targetId,
                    before: event.clientY < rect.top + rect.height / 2,
                  });
                }}
                onDrop={(event) => {
                  if (!workspaceDropTarget) return;
                  event.preventDefault();
                  handleWorkspaceDrop(workspaceDropTarget.id);
                }}
              >
                {workspaces.length === 0 ? (
                  <p className="session-hint">{t["nav.loading"]}</p>
                ) : (
                  workspaces.map((item) => {
                    const itemOwnerList = ownerList.filter(
                      (session) => session.workspaceId === item.id
                    );
                    const itemGuestList = guestList.filter(
                      (session) => session.workspaceId === item.id
                    );
                    const isOpen = openWorkspaceIds.has(item.id);
                    const hasChats =
                      user ? sessions === null || itemOwnerList.length > 0 : itemGuestList.length > 0;
                    return (
                      <div
                        key={item.id}
                        data-workspace-id={item.id}
                        className="workspace-folder"
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          setDragWorkspaceId(item.id);
                        }}
                        onDragEnd={() => {
                          setDragWorkspaceId(null);
                          setWorkspaceDropTarget(null);
                        }}
                      >
                        {workspaceDropTarget?.id === item.id &&
                          workspaceDropTarget.before && (
                            <div
                              className="workspace-drop-indicator before"
                              aria-hidden="true"
                            />
                          )}
                        <div className="workspace-child-row">
                          <button
                            type="button"
                            className="workspace-child-button"
                            onClick={() => {
                              if (hasChats) toggleWorkspaceOpen(item.id);
                            }}
                            aria-expanded={hasChats ? isOpen : undefined}
                            disabled={!hasChats}
                          >
                            <span className="workspace-folder-icon" aria-hidden="true">
                              <Folder size={14} className="workspace-folder-glyph" />
                              {hasChats && (
                                <ChevronRight
                                  size={14}
                                  className={`workspace-folder-chevron${
                                    isOpen ? " workspace-folder-chevron-open" : ""
                                  }`}
                                />
                              )}
                            </span>
                            <span>{item.label}</span>
                          </button>
                          <button
                            type="button"
                            className="workspace-child-new"
                            onClick={() => {
                              setMenuOpen(false);
                              router.push(`/?workspace=${encodeURIComponent(item.id)}`);
                            }}
                            aria-label={t["nav.newChat"]}
                            title={t["nav.newChat"]}
                          >
                            <Plus size={15} />
                          </button>
                        </div>
                        {workspaceDropTarget?.id === item.id &&
                          !workspaceDropTarget.before && (
                            <div
                              className="workspace-drop-indicator after"
                              aria-hidden="true"
                            />
                          )}
                        {authChecked && isOpen && hasChats && (
                          <div className="workspace-child-sessions">
                            {user
                              ? itemOwnerList.map((session) =>
                                  renderSessionRow(
                                    session._id,
                                    session.title,
                                    Boolean(session.pinned),
                                    session.workspaceId
                                  )
                                )
                              : itemGuestList.map((session) =>
                                  renderSessionRow(
                                    session.id,
                                    session.title,
                                    Boolean(session.pinned),
                                    session.workspaceId
                                  )
                                )}
                            {user && sessions === null && (
                              <p className="session-hint">{t["nav.loading"]}</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
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
