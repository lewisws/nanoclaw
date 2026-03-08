/**
 * Memory System Constants
 * L0/L1/L2 三层记忆架构常量配置
 */

import type { Priority } from './types.js';

/** TTL 配置（天数，null 表示永久） */
export const TTL_DAYS: Record<Priority, number | null> = {
  P0: null, // 永久保留
  P1: 30,   // 30天后归档
  P2: 7,    // 7天后归档
};

/** 记忆目录名称 */
export const MEMORY_DIR = 'memory';

/** L0 索引文件名 */
export const L0_INDEX_FILE = '.abstract';

/** L1 洞察目录 */
export const L1_INSIGHTS_DIR = 'insights';

/** L1 教训目录 */
export const L1_LESSONS_DIR = 'lessons';

/** L1 教训文件名 */
export const L1_LESSONS_FILE = 'lessons.jsonl';

/** L2 日志目录 */
export const L2_LOGS_DIR = 'logs';

/** L2 归档目录 */
export const L2_ARCHIVE_DIR = 'archive';

/** Janitor 执行时间（cron 表达式：每日 00:00） */
export const JANITOR_CRON = '0 0 * * *';

/** Compounding 执行时间（cron 表达式：每 3 天 08:00） */
export const COMPOUNDING_CRON = '0 8 */3 * *';

/** Compounding 分析的日志天数 */
export const COMPOUNDING_DAYS = 3;

/** 任务失败最大重试次数 */
export const MAX_RETRY_COUNT = 3;

/** 任务重试间隔（毫秒） */
export const RETRY_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟

/** 记忆关键词（用于检测用户是否要求记忆） */
export const MEMORY_KEYWORDS = [
  '记住',
  '记下',
  '永远记住',
  '请记住',
  '帮我记住',
  'remember',
  'remember this',
  'keep in mind',
];

/** L0 摘要最大条目数 */
export const L0_SUMMARY_MAX_ITEMS = 5;

/** L0 索引初始版本 */
export const L0_INDEX_VERSION = 1;

/** 搜索结果默认限制 */
export const DEFAULT_SEARCH_LIMIT = 5;

/** 日志文件日期格式 */
export const LOG_DATE_FORMAT = 'YYYY-MM-DD';

/** 洞察文件月份格式 */
export const INSIGHT_MONTH_FORMAT = 'YYYY-MM';
