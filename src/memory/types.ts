/**
 * Memory System Type Definitions
 * L0/L1/L2 三层记忆架构类型定义
 */

/** 记忆优先级 */
export type Priority = 'P0' | 'P1' | 'P2';

/** 洞察类型 */
export type InsightType = 'long_term' | 'phase' | 'behavior';

/** 教训类型 */
export type LessonType = 'mistake' | 'success' | 'pattern';

/** L0 索引结构 */
export interface L0Index {
  meta: {
    last_updated: string;
    version: number;
  };
  stats: {
    total_insights: number;
    total_lessons: number;
    active_logs: number;
    archived_logs: number;
  };
  recent: {
    latest_insight: string | null;
    latest_lesson: string | null;
    today_log: string | null;
  };
  summary: string[];
}

/** L1 洞察条目 */
export interface Insight {
  id: string;
  timestamp: string;
  priority: Priority;
  type: InsightType;
  content: string;
  context?: string; // 上下文信息
  source?: string; // 来源说明
  confidence?: number;
  expires_at?: string; // P1 类型需要过期时间
  source_logs?: string[]; // 来源日志日期
}

/** L1 教训条目 */
export interface Lesson {
  id: string;
  timestamp: string;
  priority: Priority;
  type: LessonType;
  lesson: string;
  context?: string;
  source_logs?: string[];
}

/** L2 日志条目 */
export interface LogEntry {
  id: string;
  timestamp: string;
  priority: Priority;
  role: 'user' | 'assistant';
  content: string;
  metadata?: {
    has_memory_request?: boolean; // 是否包含"记住"请求
    extracted_to_l1?: boolean; // 是否已提炼到 L1
  };
}

/** 日志文件结构 */
export interface DailyLog {
  date: string;
  entries: LogEntry[];
}

/** Janitor 执行结果 */
export interface JanitorResult {
  group_folder: string;
  executed_at: string;
  logs_scanned: number;
  logs_archived: number;
  entries_archived: number;
  errors: string[];
}

/** Compounding 执行结果 */
export interface CompoundingResult {
  group_folder: string;
  executed_at: string;
  logs_analyzed: number;
  insights_generated: number;
  lessons_generated: number;
  errors: string[];
}

/** 监管任务类型 */
export type MemoryTaskType = 'janitor' | 'compounding';

/** 监管任务状态 */
export type MemoryTaskStatus = 'running' | 'success' | 'failed';

/** 监管任务日志 */
export interface MemoryTaskLog {
  id: number;
  task_type: MemoryTaskType;
  group_folder: string;
  started_at: string;
  completed_at: string | null;
  status: MemoryTaskStatus;
  details: string | null;
  error_message: string | null;
  retry_count: number;
}

/** 告警信息 */
export interface MemoryTaskAlert {
  task_log: MemoryTaskLog;
  message: string;
}

/** 迁移结果 */
export interface MigrationResult {
  group_folder: string;
  executed_at: string;
  source_file: string;
  backup_file: string;
  insights_created: number;
  lessons_created: number;
  logs_created: number;
  errors: string[];
}

/** 记忆搜索选项 */
export interface MemorySearchOptions {
  query: string;
  scope?: 'all' | 'insights' | 'lessons' | 'logs';
  limit?: number;
}

/** 记忆搜索结果 */
export interface MemorySearchResult {
  insights: Insight[];
  lessons: Lesson[];
  logs: LogEntry[];
}

/** 记忆保存选项 */
export interface MemorySaveOptions {
  content: string;
  type: 'insight' | 'lesson';
  priority?: Priority;
}
