import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  Phone, Users, BarChart3, Settings, FileText,
  Clock, ChevronLeft, ChevronRight, LogOut
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/AuthProvider';

const navItems = [
  { path: '/', label: 'Dashboard', icon: BarChart3 },
  { path: '/customers', label: 'Customers', icon: Users },
  { path: '/calls', label: 'Call Center', icon: Phone },
  { path: '/call-logs', label: 'Call Logs', icon: FileText },
  { path: '/schedule', label: 'Schedule', icon: Clock },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export function DashboardLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const { session, signOut } = useAuth();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className={cn(
        "flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300",
        collapsed ? "w-16" : "w-60"
      )}>
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 h-16 border-b border-sidebar-border">
          <img src="/favicon.png" alt="SmartVoice AI" className="w-8 h-8 rounded-lg shrink-0" />
          {!collapsed && (
            <span className="font-bold text-sidebar-primary-foreground tracking-tight text-sm">SmartAIVoiceAgent</span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2 space-y-1">
          {navItems.map(item => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                  active 
                    ? "bg-sidebar-accent text-sidebar-primary" 
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-2">
          {!collapsed && (
            <div className="px-2 pb-2 text-xs text-sidebar-foreground/70">
              {session?.user?.email || 'Authenticated operator'}
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            className={cn(
              'w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              collapsed && 'justify-center px-0'
            )}
            onClick={() => { void signOut(); }}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Sign out</span>}
          </Button>
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center h-12 border-t border-sidebar-border text-sidebar-foreground hover:text-sidebar-accent-foreground transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
