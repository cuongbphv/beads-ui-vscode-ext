/** Legend so the faint bars, the hollow epics and the red line are readable. */
import type { ReactNode } from 'react';

export function GanttLegend(): ReactNode {
  return (
    <ul className="text-fg-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
      <li className="flex items-center gap-1">
        <span className="bg-success/60 h-2 w-4 rounded-sm" /> done
      </li>
      <li className="flex items-center gap-1">
        <span className="bg-type-task h-2 w-4 rounded-sm" /> open
      </li>
      <li className="flex items-center gap-1">
        <span className="bg-type-task h-2 w-4 rounded-sm opacity-55" /> no dates
      </li>
      <li className="flex items-center gap-1">
        <span className="ring-danger h-2 w-4 rounded-sm ring-1" /> overdue
      </li>
      <li className="flex items-center gap-1">
        <span className="bg-danger h-3 w-px" /> today
      </li>
    </ul>
  );
}
