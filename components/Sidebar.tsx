"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Chat" },
  { href: "/usage", label: "Usage" },
];

export default function Sidebar() {
  const pathname = usePathname();
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
      <div className="sidebar-foot">
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
