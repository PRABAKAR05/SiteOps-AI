import { NavLink, useNavigate } from "react-router-dom";
import {
  AlertTriangle, BarChart3, Boxes, ClipboardList, FolderOpen, LayoutDashboard, ListTodo, LogOut,
  Receipt, Sparkles, Users, X, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles?: string[];
}

const GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Overview",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard },
      { to: "/projects", label: "Projects", icon: FolderOpen },
    ],
  },
  {
    label: "Field operations",
    items: [
      { to: "/reports", label: "Daily reports", icon: ClipboardList },
      { to: "/inventory", label: "Inventory", icon: Boxes },
      { to: "/issues", label: "Issues", icon: AlertTriangle },
      { to: "/tasks", label: "Tasks", icon: ListTodo },
    ],
  },
  {
    label: "Commercial",
    items: [
      { to: "/invoices", label: "Invoices", icon: Receipt, roles: ["project_manager", "storekeeper"] },
      { to: "/documents", label: "Documents", icon: FolderOpen },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { to: "/assistant", label: "Assistant", icon: Sparkles },
      { to: "/analytics", label: "Analytics", icon: BarChart3 },
      { to: "/team", label: "Team", icon: Users, roles: ["project_manager"] },
    ],
  },
];

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
          <path d="M4 18V9.5L12 4l8 5.5V18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8.5 18v-4.5h7V18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
          <path d="M3 18h18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
      {!compact ? (
        <span className="leading-none">
          <span className="block text-[15px] font-semibold tracking-tight text-white">SiteOps AI</span>
          <span className="mt-1 block text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">Field operations</span>
        </span>
      ) : null}
    </div>
  );
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4 no-scrollbar" aria-label="Main navigation">
      {GROUPS.map((group) => {
        const items = group.items.filter((item) => !item.roles || (user && item.roles.includes(user.role)));
        if (!items.length) return null;
        return (
          <div key={group.label}>
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">{group.label}</p>
            <ul className="space-y-0.5">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === "/"}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors",
                        isActive ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive ? <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-brand-300" /> : null}
                        <item.icon className={cn("h-4 w-4 shrink-0", isActive ? "text-brand-300" : "text-white/45")} />
                        {item.label}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function UserFooter() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="border-t border-white/10 px-3 py-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold text-white">
          {initials(user?.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-white">{user?.name}</p>
          <p className="truncate text-[10px] uppercase tracking-wider text-white/40">{user?.role.replace(/_/g, " ")}</p>
        </div>
        <button
          className="rounded-md p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Sign out"
          onClick={async () => {
            await logout();
            navigate("/login");
          }}
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col bg-brand-950 lg:flex">
      <div className="flex h-16 items-center border-b border-white/10 px-5">
        <BrandMark />
      </div>
      <NavItems />
      <UserFooter />
    </aside>
  );
}

export function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-[#0B1512]/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div className="relative flex h-full w-[286px] flex-col bg-brand-950 animate-fade-up" role="dialog" aria-modal="true" aria-label="Navigation">
        <div className="flex h-16 items-center justify-between border-b border-white/10 px-4">
          <BrandMark />
          <button onClick={onClose} className="rounded-md p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close navigation">
            <X className="h-4 w-4" />
          </button>
        </div>
        <NavItems onNavigate={onClose} />
        <UserFooter />
      </div>
    </div>
  );
}
