import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Home, TrendingUp, Calendar, ChevronRight, Pin, PinOff, RefreshCw, CheckSquare, Monitor } from 'lucide-react';
import { toast } from 'sonner';

export function Navigation() {
  const [isOpen, setIsOpen] = useState(true);
  const [isPinned, setIsPinned] = useState(true);
  const location = useLocation();

  const navItems = [
    { path: '/', label: 'Master Data', icon: Home },
    { path: '/forecast', label: 'Forecast', icon: TrendingUp },
    { path: '/calendar-master', label: 'Calendar Master', icon: Calendar },
    { path: '/actual', label: 'Actual', icon: CheckSquare },
    { path: '/monitoring', label: 'Monitoring', icon: Monitor },
  ];

  const handleMouseEnter = () => {
    if (!isPinned) {
      setIsOpen(true);
    }
  };

  const handleMouseLeave = () => {
    if (!isPinned) {
      setIsOpen(false);
    }
  };

  const togglePin = () => {
    setIsPinned(!isPinned);
    if (isPinned) {
      setIsOpen(false);
    } else {
      setIsOpen(true);
    }
  };

  const handleClearCacheAndRestart = () => {
    try {
      // Clear localStorage
      localStorage.clear();
      
      // Clear sessionStorage
      sessionStorage.clear();
      
      // Clear all cookies
      document.cookie.split(";").forEach((c) => {
        document.cookie = c
          .replace(/^ +/, "")
          .replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
      });
      
      // Show success message
      toast.success('Cache cleared! Restarting session...', {
        duration: 2000,
      });
      
      // Reload the page after a short delay
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
    } catch (error) {
      toast.error('Failed to clear cache: ' + (error as Error).message);
    }
  };

  return (
    <>
      <div
        className={cn(
          'fixed left-0 top-0 h-full bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 transition-all duration-300 z-50 flex flex-col',
          isOpen ? 'w-64' : 'w-16'
        )}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          {isOpen ? (
            <>
              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Menu</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={togglePin}
                className="h-8 w-8"
              >
                {isPinned ? (
                  <Pin className="h-4 w-4" />
                ) : (
                  <PinOff className="h-4 w-4" />
                )}
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsOpen(true)}
              className="h-8 w-8 mx-auto"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>

        <nav className="flex-1 p-4">
          <ul className="space-y-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              
              return (
                <li key={item.path}>
                  <Link to={item.path}>
                    <Button
                      variant={isActive ? 'default' : 'ghost'}
                      className={cn(
                        'w-full justify-start gap-3',
                        !isOpen && 'justify-center px-2'
                      )}
                    >
                      <Icon className="h-5 w-5 flex-shrink-0" />
                      {isOpen && <span>{item.label}</span>}
                    </Button>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
          <Button
            variant="destructive"
            onClick={handleClearCacheAndRestart}
            className={cn(
              'w-full gap-2',
              !isOpen && 'justify-center px-2'
            )}
            title="Clear cache and restart session"
          >
            <RefreshCw className="h-4 w-4 flex-shrink-0" />
            {isOpen && <span>Clear Cache & Restart</span>}
          </Button>
          
          {isOpen && (
            <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
              {isPinned ? 'Navigation is pinned' : 'Hover to keep open'}
            </p>
          )}
        </div>
      </div>

      {/* Spacer to prevent content from going under the sidebar */}
      <div className={cn('transition-all duration-300', isOpen ? 'ml-64' : 'ml-16')} />
    </>
  );
}