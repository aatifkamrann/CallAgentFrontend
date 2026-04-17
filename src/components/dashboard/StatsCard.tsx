import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: ReactNode;
  trend?: { value: number; positive: boolean };
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'destructive';
}

const variantStyles = {
  default: 'border-border',
  primary: 'border-primary/30 glow-primary',
  success: 'border-success/30',
  warning: 'border-warning/30',
  destructive: 'border-destructive/30',
};

export function StatsCard({ title, value, subtitle, icon, trend, variant = 'default' }: StatsCardProps) {
  return (
    <div className={cn(
      "bg-card rounded-lg border p-5 card-hover",
      variantStyles[variant]
    )}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold mt-1 text-card-foreground">{value}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          {trend && (
            <p className={cn("text-xs font-medium mt-1", trend.positive ? "text-success" : "text-destructive")}>
              {trend.positive ? '↑' : '↓'} {Math.abs(trend.value)}% vs last week
            </p>
          )}
        </div>
        <div className="p-2 rounded-md bg-muted text-muted-foreground">
          {icon}
        </div>
      </div>
    </div>
  );
}
