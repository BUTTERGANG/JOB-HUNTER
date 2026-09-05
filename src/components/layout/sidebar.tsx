"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Briefcase,
  PlusCircle,
  BarChart3,
  Search,
  FileSearch,
  Landmark,
  PieChart,
  Upload,
  Settings,
  Sun,
  Moon,
  type LucideIcon,
} from "lucide-react";

const navGroups: { label: string; items: { href: string; label: string; icon: LucideIcon }[] }[] = [
  {
    label: "Workspace",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/jobs", label: "Jobs", icon: Briefcase },
      { href: "/jobs/new", label: "Add Job", icon: PlusCircle },
      { href: "/jobs/compare", label: "Compare", icon: BarChart3 },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/scrape", label: "Scrape", icon: Search },
      { href: "/analyze", label: "Analyze Job", icon: FileSearch },
      { href: "/government-postings", label: "Government Postings", icon: Landmark },
      { href: "/analysis", label: "Market Analysis", icon: PieChart },
      { href: "/import", label: "Import CSV", icon: Upload },
    ],
  },
  {
    label: "System",
    items: [{ href: "/settings", label: "Settings", icon: Settings }],
  },
];

const mobileNav: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/jobs/new", label: "Add", icon: PlusCircle },
  { href: "/government-postings", label: "Gov Jobs", icon: Landmark },
  { href: "/analysis", label: "Market", icon: PieChart },
  { href: "/analyze", label: "Analyze", icon: FileSearch },
  { href: "/scrape", label: "Scrape", icon: Search },
  { href: "/settings", label: "Settings", icon: Settings },
];

// Shared theme store. Both Sidebar and MobileNav subscribe to the SAME source
// of truth via useSyncExternalStore, so toggling in one instantly re-renders
// the other — previously each held its own useState and could drift out of sync.
const themeListeners = new Set<() => void>();

function isDark(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

function subscribe(cb: () => void) {
  themeListeners.add(cb);
  return () => themeListeners.delete(cb);
}

function toggleTheme() {
  const next = !isDark();
  if (next) {
    document.documentElement.classList.add("dark");
    localStorage.setItem("theme", "dark");
  } else {
    document.documentElement.classList.remove("dark");
    localStorage.setItem("theme", "light");
  }
  themeListeners.forEach((cb) => cb());
}

function useTheme() {
  // Server snapshot is always false; the class is applied on the client before
  // hydration by the inline theme script, and useSyncExternalStore reconciles.
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  return { dark, toggle: toggleTheme };
}

export function Sidebar() {
  const pathname = usePathname();
  const { dark, toggle } = useTheme();

  return (
    <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between h-20 px-5 border-b border-sidebar-border">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-9 h-9 rounded-xl bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center">
              <span className="font-black text-xs tracking-tight">JH</span>
            </div>
            <div>
              <span className="block font-semibold tracking-tight text-sidebar-foreground">JobHunt</span>
              <span className="block text-[0.65rem] uppercase tracking-[0.18em] text-sidebar-foreground/55">Job tracker</span>
            </div>
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-5 space-y-6">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="px-3 mb-2 text-[0.65rem] uppercase tracking-[0.2em] text-sidebar-foreground/45">{group.label}</p>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all focus-visible:ring-sidebar-primary",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                          : "text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
                      )}
                    >
                      {isActive && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-sidebar-primary" />}
                      <Icon className={cn("h-4 w-4", isActive ? "text-sidebar-primary" : "text-sidebar-foreground/50")} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-sidebar-border">
          <div className="px-3 pb-3 text-[0.7rem] text-sidebar-foreground/45">One application closer.</div>
          <button
            onClick={toggle}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors w-full focus-visible:ring-sidebar-primary"
            aria-label="Toggle dark mode"
          >
            {dark ? <Sun className="h-4 w-4 text-sidebar-primary" /> : <Moon className="h-4 w-4" />}
            {dark ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const { dark, toggle } = useTheme();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-border/80 bg-card/95 backdrop-blur-lg z-50 shadow-[0_-8px_24px_color-mix(in_oklch,var(--foreground)_8%,transparent)]">
      <div className="flex items-stretch gap-1 overflow-x-auto px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {mobileNav.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex min-w-[4.25rem] shrink-0 flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-[0.65rem] font-medium transition-colors focus-visible:ring-ring",
                isActive ? "bg-accent/60 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {isActive && <span className="absolute left-1/2 top-0 h-0.5 w-5 -translate-x-1/2 rounded-full bg-primary" />}
              <Icon className={cn("h-5 w-5", isActive && "text-primary")} />
              {item.label}
            </Link>
          );
        })}
        <button
          onClick={toggle}
          className="relative flex min-w-[4.25rem] shrink-0 flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-[0.65rem] font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring"
          aria-label="Toggle dark mode"
        >
          {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          {dark ? "Light" : "Dark"}
        </button>
      </div>
    </nav>
  );
}
