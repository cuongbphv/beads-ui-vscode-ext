/** Types for demo-project.mjs — the fixture behind the screenshots and the GIF. */

/** One line of the JSONL `bd import` reads. Mirrors what `bd export` emits. */
export interface DemoIssueRecord {
  id: string;
  title: string;
  issue_type: string;
  status: string;
  priority: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  description?: string;
  design?: string;
  acceptance_criteria?: string;
  assignee?: string;
  labels?: string[];
  started_at?: string;
  closed_at?: string;
  close_reason?: string;
  due_at?: string;
  defer_until?: string;
  estimated_minutes?: number;
  dependencies?: { issue_id: string; depends_on_id: string; type: string }[];
}

export interface DemoSummary {
  total: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  byAssignee: Record<string, number>;
  /** Days between the first and the last close — the burn-up's horizontal span. */
  closedSpanDays: number;
}

export function buildDemoIssues(seedDate?: Date): DemoIssueRecord[];
export function buildDemoJsonl(seedDate?: Date): string;
export function demoSummary(seedDate?: Date): DemoSummary;
export const DEMO_PREFIX: string;
export const DEMO_ACTOR: string;
