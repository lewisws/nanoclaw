/**
 * Memory System Entry Point
 * L0/L1/L2 三层记忆架构主入口
 */

// 导出类型
export * from './types.js';

// 导出常量
export * from './constants.js';

// 导出 L0 索引管理
export {
  readL0Index,
  writeL0Index,
  updateL0Stats,
  updateL0Summary,
  initializeMemoryDir,
  getMemoryDir,
  formatL0ForPrompt,
} from './l0-index.js';

// 导出 L1 洞察管理
export {
  saveInsight,
  getInsights,
  getAllInsights,
  searchInsights,
  getInsightsByType,
  getInsightsByPriority,
  getRecentInsights,
} from './l1-insights.js';

// 导出 L1 教训管理
export {
  saveLesson,
  getLessons,
  searchLessons,
  getLessonsByType,
  getLessonsByPriority,
  getRecentLessons,
  deleteLesson,
  saveLessons,
  getLessonsCount,
  getLessonsStats,
} from './l1-lessons.js';

// 导出 L2 日志管理
export {
  appendLog,
  getTodayLog,
  getDayLogs,
  getLogsInRange,
  getRecentLogs,
  searchLogs,
  archiveExpiredLogs,
  getLogsStats,
  markLogAsExtracted,
} from './l2-logs.js';

// 导出 Janitor
export {
  runJanitor,
  runJanitorForAllGroups,
} from './janitor.js';

// 导出 Compounding
export {
  runCompounding,
  runCompoundingForAllGroups,
} from './compounding.js';

// 导出监管机制
export {
  logTaskStart,
  logTaskComplete,
  retryFailedTasks,
  getPendingAlerts,
  runJanitorWithSupervisor,
  runCompoundingWithSupervisor,
} from './supervisor.js';

// 导出迁移工具
export {
  migrateClaudeMd,
  migrateAllGroups,
} from './migration.js';
