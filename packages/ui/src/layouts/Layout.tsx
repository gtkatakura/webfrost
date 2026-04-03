import { Link, Outlet, useLocation } from "react-router-dom";

const NAV_ITEMS = [
  { label: "Dashboard", to: "/" },
  { label: "Snapshots", to: "/snapshots" },
  { label: "Tags", to: "/tags" },
  { label: "Schedules", to: "/schedules" },
  { label: "Import", to: "/import" },
  { label: "Settings", to: "/settings" },
];

export function Layout() {
  const location = useLocation();

  function isActive(to: string): boolean {
    if (to === "/") return location.pathname === "/";
    return location.pathname === to || location.pathname.startsWith(`${to}/`);
  }

  return (
    <div className="flex min-h-screen">
      <nav className="w-52 shrink-0 bg-gray-900 text-gray-100 flex flex-col py-6 px-4 gap-1">
        <span className="text-sm font-bold text-gray-400 uppercase tracking-widest px-2 mb-3">
          WebFrost
        </span>
        {NAV_ITEMS.map(({ label, to }) => (
          <Link
            key={to}
            to={to}
            className={`px-2 py-1.5 rounded text-sm no-underline transition-colors ${
              isActive(to)
                ? "bg-gray-700 text-white font-semibold"
                : "text-gray-300 hover:text-white hover:bg-gray-800"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
