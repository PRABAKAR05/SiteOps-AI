import { NavLink } from "react-router-dom";
import { AlertTriangle, Boxes, ClipboardList, LayoutDashboard, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

const items = [
  { to: "/", label: "Home", icon: LayoutDashboard },
  { to: "/reports", label: "Reports", icon: ClipboardList },
  { to: "/inventory", label: "Stock", icon: Boxes },
  { to: "/issues", label: "Issues", icon: AlertTriangle },
  { to: "/assistant", label: "Assistant", icon: Sparkles },
];

export function MobileNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 backdrop-blur-md safe-bottom lg:hidden"
      aria-label="Primary mobile navigation"
    >
      <ul className="grid grid-cols-5">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 pt-2 text-[10px] font-medium transition-colors",
                  isActive ? "text-brand-700" : "text-ink-faint",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className={cn("h-5 w-5", isActive ? "text-brand-700" : "text-ink-faint")} />
                  {item.label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
