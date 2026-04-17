import { cn } from '@/lib/utils';

export function PriorityBadge({ score }: { score: number }) {
  const level = score > 500 ? 'high' : score > 200 ? 'medium' : 'low';
  const label = level.charAt(0).toUpperCase() + level.slice(1);

  return (
    <span className={cn(
      "status-badge",
      level === 'high' && "bg-priority-high/15 text-priority-high",
      level === 'medium' && "bg-priority-medium/15 text-priority-medium",
      level === 'low' && "bg-priority-low/15 text-priority-low",
    )}>
      {score} • {label}
    </span>
  );
}
