/**
 * L0 Index Management
 * 热索引层：目录概览 + 快速导航
 */

import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

import { GROUPS_DIR } from '../config.js';
import { logger } from '../logger.js';
import {
  MEMORY_DIR,
  L0_INDEX_FILE,
  L1_INSIGHTS_DIR,
  L1_LESSONS_DIR,
  L1_LESSONS_FILE,
  L2_LOGS_DIR,
  L2_ARCHIVE_DIR,
  L0_INDEX_VERSION,
} from './constants.js';
import type { L0Index } from './types.js';

/**
 * 获取组的记忆目录路径
 */
export function getMemoryDir(groupFolder: string): string {
  return path.join(GROUPS_DIR, groupFolder, MEMORY_DIR);
}

/**
 * 获取 L0 索引文件路径
 */
function getL0IndexPath(groupFolder: string): string {
  return path.join(getMemoryDir(groupFolder), L0_INDEX_FILE);
}

/**
 * 初始化记忆目录结构
 */
export function initializeMemoryDir(groupFolder: string): void {
  const memoryDir = getMemoryDir(groupFolder);
  
  // 创建主目录
  fs.mkdirSync(memoryDir, { recursive: true });
  
  // 创建子目录
  fs.mkdirSync(path.join(memoryDir, L1_INSIGHTS_DIR), { recursive: true });
  fs.mkdirSync(path.join(memoryDir, L1_LESSONS_DIR), { recursive: true });
  fs.mkdirSync(path.join(memoryDir, L2_LOGS_DIR), { recursive: true });
  fs.mkdirSync(path.join(memoryDir, L2_ARCHIVE_DIR), { recursive: true });
  
  // 创建初始 L0 索引
  const indexPath = getL0IndexPath(groupFolder);
  if (!fs.existsSync(indexPath)) {
    const initialIndex: L0Index = {
      meta: {
        last_updated: new Date().toISOString(),
        version: L0_INDEX_VERSION,
      },
      stats: {
        total_insights: 0,
        total_lessons: 0,
        active_logs: 0,
        archived_logs: 0,
      },
      recent: {
        latest_insight: null,
        latest_lesson: null,
        today_log: null,
      },
      summary: [],
    };
    writeL0Index(groupFolder, initialIndex);
  }
  
  logger.debug({ groupFolder }, 'Memory directory initialized');
}

/**
 * 读取 L0 索引
 */
export function readL0Index(groupFolder: string): L0Index {
  const indexPath = getL0IndexPath(groupFolder);
  
  if (!fs.existsSync(indexPath)) {
    // 如果索引不存在，初始化目录并返回新索引
    initializeMemoryDir(groupFolder);
    return readL0Index(groupFolder);
  }
  
  try {
    const content = fs.readFileSync(indexPath, 'utf-8');
    return YAML.parse(content) as L0Index;
  } catch (err) {
    logger.error({ err, groupFolder }, 'Failed to read L0 index');
    // 返回默认索引
    return {
      meta: {
        last_updated: new Date().toISOString(),
        version: L0_INDEX_VERSION,
      },
      stats: {
        total_insights: 0,
        total_lessons: 0,
        active_logs: 0,
        archived_logs: 0,
      },
      recent: {
        latest_insight: null,
        latest_lesson: null,
        today_log: null,
      },
      summary: [],
    };
  }
}

/**
 * 写入 L0 索引
 */
export function writeL0Index(groupFolder: string, index: L0Index): void {
  const memoryDir = getMemoryDir(groupFolder);
  
  // 确保目录存在
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }
  
  const indexPath = getL0IndexPath(groupFolder);
  
  // 更新时间戳
  index.meta.last_updated = new Date().toISOString();
  
  // 添加注释头
  const header = `# L0 Memory Index - Auto-generated, do not edit manually\n`;
  const content = header + YAML.stringify(index);
  
  // 原子写入
  const tempPath = `${indexPath}.tmp`;
  fs.writeFileSync(tempPath, content, 'utf-8');
  fs.renameSync(tempPath, indexPath);
  
  logger.debug({ groupFolder }, 'L0 index updated');
}

/**
 * 更新 L0 统计信息
 */
export function updateL0Stats(groupFolder: string): void {
  const memoryDir = getMemoryDir(groupFolder);
  const index = readL0Index(groupFolder);
  
  // 统计洞察数量
  const insightsDir = path.join(memoryDir, L1_INSIGHTS_DIR);
  let totalInsights = 0;
  let latestInsight: string | null = null;
  
  if (fs.existsSync(insightsDir)) {
    const insightFiles = fs.readdirSync(insightsDir)
      .filter((f: string) => f.endsWith('.md') && !f.startsWith('.'))
      .sort()
      .reverse();
    
    if (insightFiles.length > 0) {
      latestInsight = insightFiles[0].replace('.md', '');
    }
    
    // 简单统计：每个文件算一个月的洞察
    totalInsights = insightFiles.length;
  }
  
  // 统计教训数量
  const lessonsFile = path.join(memoryDir, L1_LESSONS_DIR, L1_LESSONS_FILE);
  let totalLessons = 0;
  let latestLesson: string | null = null;
  
  if (fs.existsSync(lessonsFile)) {
    const content = fs.readFileSync(lessonsFile, 'utf-8');
    const lines = content.trim().split('\n').filter((l: string) => l.trim());
    totalLessons = lines.length;
    
    if (lines.length > 0) {
      try {
        const lastLine = JSON.parse(lines[lines.length - 1]);
        latestLesson = lastLine.timestamp?.split('T')[0] || null;
      } catch {
        // 忽略解析错误
      }
    }
  }
  
  // 统计活跃日志数量
  const logsDir = path.join(memoryDir, L2_LOGS_DIR);
  let activeLogs = 0;
  let todayLog: string | null = null;
  const today = new Date().toISOString().split('T')[0];
  
  if (fs.existsSync(logsDir)) {
    const logFiles = fs.readdirSync(logsDir)
      .filter((f: string) => f.endsWith('.md') && !f.startsWith('.'))
      .sort()
      .reverse();
    
    activeLogs = logFiles.length;
    
    if (logFiles.some((f: string) => f === `${today}.md`)) {
      todayLog = today;
    }
  }
  
  // 统计归档日志数量
  const archiveDir = path.join(memoryDir, L2_ARCHIVE_DIR);
  let archivedLogs = 0;
  
  if (fs.existsSync(archiveDir)) {
    archivedLogs = fs.readdirSync(archiveDir)
      .filter((f: string) => f.endsWith('.md') && !f.startsWith('.'))
      .length;
  }
  
  // 更新索引
  index.stats = {
    total_insights: totalInsights,
    total_lessons: totalLessons,
    active_logs: activeLogs,
    archived_logs: archivedLogs,
  };
  
  index.recent = {
    latest_insight: latestInsight,
    latest_lesson: latestLesson,
    today_log: todayLog,
  };
  
  writeL0Index(groupFolder, index);
}

/**
 * 更新 L0 摘要（需要外部提供摘要内容）
 */
export function updateL0Summary(groupFolder: string, summary: string[]): void {
  const index = readL0Index(groupFolder);
  index.summary = summary;
  writeL0Index(groupFolder, index);
}

/**
 * 格式化 L0 索引为 prompt 注入内容
 */
export function formatL0ForPrompt(groupFolder: string): string {
  const index = readL0Index(groupFolder);
  
  const lines = [
    `[记忆系统状态]`,
    `- 洞察: ${index.stats.total_insights} 条`,
    `- 教训: ${index.stats.total_lessons} 条`,
    `- 活跃日志: ${index.stats.active_logs} 个`,
  ];
  
  if (index.summary.length > 0) {
    lines.push(`\n[核心记忆摘要]`);
    index.summary.forEach(s => lines.push(`- ${s}`));
  }
  
  lines.push(`\n使用 memory_search 工具查询详细记忆。`);
  
  return lines.join('\n');
}
