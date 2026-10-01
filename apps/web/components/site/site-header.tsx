"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "./logo";
import { ThemeToggle } from "../theme-provider";

const links = [
  { href: "#scenarios", label: "解决方案" },
  { href: "#guide", label: "场景推荐" },
  { href: "#stages", label: "产品架构" },
  { href: "#approach", label: "产品原则" }
];

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 18);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`site-header ${scrolled ? "scrolled" : ""}`}>
      <div className="wrap wrap-wide site-header-inner">
        <Link href="/" aria-label="FF 首页">
          <Logo />
        </Link>
        <nav className="site-nav">
          {links.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
        </nav>
        <div className="site-header-actions">
          <Link href="/app" className="btn btn-primary btn-sm">
            Agent 工作台
          </Link>
          <Link href="/admin" className="btn btn-ghost btn-sm hide-sm">
            Agent 运营后台
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
