"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUpRightIcon, MenuIcon, XIcon } from "lucide-react";
import { LogoMark } from "@/components/brand/LogoMark";

const links = [
  { label: "Docs", href: "https://docs.aplt.ai/docs" },
  { label: "Changelog", href: "https://docs.aplt.ai/changelog" },
  { label: "Legal", href: "https://legal.aplt.ai" },
];
function subscribeToScroll(callback: () => void) {
  window.addEventListener("scroll", callback, { passive: true });
  return () => window.removeEventListener("scroll", callback);
}
function getScrollSnapshot() { return window.scrollY > 8; }
function getServerScrollSnapshot() { return false; }

// Adapted from the documentation header, keeping the status page in light mode.
export function DocsNav() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const isScrolled = useSyncExternalStore(subscribeToScroll, getScrollSnapshot, getServerScrollSnapshot);
  useEffect(() => {
    if (!isMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeMenu = () => {
      setIsMenuOpen(false);
      menuButton.current?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onResize = () => { if (desktop.matches) closeMenu(); };
    window.addEventListener("keydown", onKeyDown);
    desktop.addEventListener("change", onResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      desktop.removeEventListener("change", onResize);
    };
  }, [isMenuOpen]);
  return (
    <header className={`docs-topbar${isScrolled ? " is-scrolled" : ""}`}>
      <div className="docs-topbar-inner">
        <a href="https://docs.aplt.ai/docs" className="docs-brand-link">
          <span className="docs-brand-mark"><LogoMark className="size-4" /></span>
          <span className="docs-brand-text">Autopilot</span>
        </a>
        <nav className="docs-topbar-nav" aria-label="Primary navigation">
          {links.map((link) => <a key={link.label} href={link.href} className="docs-topbar-link">{link.label}</a>)}
        </nav>
        <div className="docs-topbar-actions">
          <a href="https://app.aplt.ai" className="docs-open-app-link">
            <span>Open app</span><ArrowUpRightIcon className="size-3.5" aria-hidden="true" />
          </a>
          <button ref={menuButton} type="button" className="docs-mobile-menu-button"
            aria-label={isMenuOpen ? "Close menu" : "Open menu"} aria-controls="docs-mobile-menu"
            aria-expanded={isMenuOpen} onClick={() => setIsMenuOpen((open) => !open)}>
            {isMenuOpen ? <XIcon className="size-4" aria-hidden="true" /> : <MenuIcon className="size-4" aria-hidden="true" />}
          </button>
        </div>
      </div>
      <div id="docs-mobile-menu" className={`docs-mobile-menu${isMenuOpen ? " is-open" : ""}`}>
        <div className="docs-mobile-menu-inner">
          <nav className="docs-mobile-menu-primary" aria-label="Mobile navigation">
            {links.map((link) => <a key={link.label} href={link.href} className="docs-mobile-menu-pill" onClick={() => setIsMenuOpen(false)}>{link.label}</a>)}
          </nav>
          <a href="https://app.aplt.ai" className="docs-mobile-open-app">Open app <ArrowUpRightIcon className="size-3.5" aria-hidden="true" /></a>
        </div>
      </div>
    </header>
  );
}
