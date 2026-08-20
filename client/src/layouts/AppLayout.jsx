import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity,
  Bell,
  Gauge,
  Globe2,
  History,
  LayoutDashboard,
  LogOut,
  Settings as SettingsIcon,
  Sparkles,
  Users
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import NotificationBell from '../components/NotificationBell.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import ToastStack from '../components/Toast.jsx';

const navGroups = [
  [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  [
    { to: '/websites', label: 'Websites', icon: Globe2 },
    { to: '/leads', label: 'Leads', icon: Users },
    { to: '/non-leads', label: 'Non-leads', icon: Sparkles }
  ],
  [
    { to: '/updates', label: 'Updates', icon: Activity }
  ],
  [
    { to: '/notifications', label: 'Notifications', icon: Bell },
    { to: '/history', label: 'History', icon: History },
    { to: '/settings', label: 'Settings', icon: SettingsIcon }
  ]
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { monitoring, stats } = useData();
  const { connected } = useSocket();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-ink-950 lg:flex">
      <aside className="border-b border-slate-200 bg-white text-slate-700 dark:border-slate-800 dark:bg-ink-950 dark:text-slate-300 lg:flex lg:min-h-screen lg:w-56 lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500 text-white">
            <Gauge size={16} />
          </div>
          <p className="text-sm font-medium text-slate-900 dark:text-white">WP Monitor</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-3 lg:block lg:flex-1 lg:space-y-4 lg:overflow-visible">
          {navGroups.map((group, index) => (
            <div key={index} className="flex gap-1 lg:space-y-0.5 lg:block">
              {group.map((item) => {
                const Icon = item.icon;
                const extra = item.to === '/notifications' && stats.unreadNotifications ? stats.unreadNotifications : 0;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm whitespace-nowrap ${
                        isActive
                          ? 'bg-slate-100 text-slate-900 dark:bg-white/10 dark:text-white'
                          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white'
                      }`
                    }
                  >
                    <Icon size={15} />
                    <span className="flex-1">{item.label}</span>
                    {extra > 0 && (
                      <span className="rounded-md bg-rose-500/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        {extra}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="hidden border-t border-slate-100 px-3 py-3 dark:border-white/10 lg:block">
          <p className="mb-2 px-1 text-[11px] text-slate-400">
            <span className={connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
              {connected ? 'Live' : 'Reconnecting'}
            </span>
            <span className="mx-1.5 text-slate-300 dark:text-slate-600">·</span>
            {monitoring.running ? 'Scanning' : 'Idle'}
          </p>
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-ink-900 md:px-8">
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">{pageTitle(location.pathname)}</h1>
          <div className="flex items-center gap-2">
            <div className="hidden text-right text-sm md:block">
              <p className="font-medium text-slate-800 dark:text-slate-200">{user?.username}</p>
              <p className="text-xs capitalize text-slate-400">{user?.role}</p>
            </div>
            <ThemeToggle />
            <NotificationBell />
          </div>
        </header>
        <main className="px-4 py-6 md:px-8">
          <Outlet />
        </main>
      </div>
      <ToastStack />
    </div>
  );
}

function pageTitle(pathname) {
  if (pathname.startsWith('/websites/') && pathname !== '/websites') return 'Website Details';
  const map = {
    '/': 'Dashboard',
    '/websites': 'All Websites',
    '/leads': 'Lead Websites',
    '/non-leads': 'Non-Lead Websites',
    '/updates': 'Updates',
    '/notifications': 'Notifications',
    '/history': 'Monitoring History',
    '/settings': 'Settings'
  };
  return map[pathname] || 'Monitoring';
}
