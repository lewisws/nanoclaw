/**
 * L2 Logs Management
 * 日志层：完整对话记录和归档
 */

import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

import { logger } from '../logger.js';
import { getMemoryDir, updateL0Stats } from './l0-index.js';
import {
  L2_LOGS_DIR,
  L2_ARCHIVE_DIR,
  TTL_DAYS,
} from './constants.js';
import type { LogEntry, DailyLog, Priority } from './types.js';

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 获取日志目录路径
 */
function getLogsDir(groupFolder: string): string {
  return path.join(getMemoryDir(groupFolder), L2_LOGS_DIR);
}

/**
 * 获取归档目录路径
 */
function getArchiveDir(groupFolder: string): string {
  return path.join(getMemoryDir(groupFolder), L2_ARCHIVE_DIR);
}

/**
 * 获取日志文件路径
 */
function getLogFile(groupFolder: string, date?: string): string {
  const targetDate = date || new Date().toISOString().split('T')[0];
  return path.join(getLogsDir(groupFolder), `${targetDate}.md`);
}

/**
 * 解析日志文件
 */
function parseLogFile(content: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const blocks = content.split(/^## /m).filter((b: string) => b.trim());
  
  for (const block of blocks) {
    try {
      const lines = block.split('\n');
      const headerLine = lines[0]?.trim();
      if (!headerLine) continue;
      
      // 解析 header: [P2] user - 2025-03-08T10:00:00Z
      const headerMatch = headerLine.match(/\[(P[012])\]\s+(\w+)\s+-\s+(.+)/);
      if (!headerMatch) continue;
      
      const [, priority, role, timestamp] = headerMatch;
      
      // 提取内容和元数据
      const contentLines: string[] = [];
      let id = '';
      let hasMemoryRequest = false;
      let extractedToL1 = false;
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('- id: ')) {
          id = line.replace('- id: ', '').trim();
        } else if (line.startsWith('- memory_request: ')) {
          hasMemoryRequest = line.includes('true');
        } else if (line.startsWith('- extracted: ')) {
          extractedToL1 = line.includes('true');
        } else if (line.trim() && !line.startsWith('-')) {
          contentLines.push(line);
        }
      }
      
      entries.push({
        id: id || generateId(),
        timestamp: timestamp.trim(),
        priority: priority as Priority,
        role: role as 'user' | 'assistant',
        content: contentLines.join('\n').trim(),
        metadata: {
          has_memory_request: hasMemoryRequest || undefined,
          extracted_to_l1: extractedToL1 || undefined,
        },
      });
    } catch {
      // 忽略解析错误的块
    }
  }
  
  return entries;
}

/**
 * 格式化日志条目为 Markdown
 */
function formatLogEntryToMarkdown(entry: LogEntry): string {
  const lines = [
    `## [${entry.priority}] ${entry.role} - ${entry.timestamp}`,
    `- id: ${entry.id}`,
  ];
  
  if (entry.metadata?.has_memory_request) {
    lines.push(`- memory_request: true`);
  }
  if (entry.metadata?.extracted_to_l1) {
    lines.push(`- extracted: true`);
  }
  
  lines.push('');
  lines.push(entry.content);
  lines.push('');
  
  return lines.join('\n');
}

/**
 * 追加日志条目
 */
export function appendLog(
  groupFolder: string, 
  entry: Omit<LogEntry, 'id' | 'timestamp' | 'priority'>,
  priority: Priority = 'P2'
): LogEntry {
  const fullEntry: LogEntry = {
    ...entry,
    id: generateId(),
    timestamp: new Date().toISOString(),
    priority,
  };
  
  const logsDir = getLogsDir(groupFolder);
  
  // 确保目录存在
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  
  const filePath = getLogFile(groupFolder);
  const markdownContent = formatLogEntryToMarkdown(fullEntry);
  
  // 追加到文件
  if (fs.existsSync(filePath)) {
    fs.appendFileSync(filePath, markdownContent, 'utf-8');
  } else {
    // 创建新文件，添加头部
    const date = new Date().toISOString().split('T')[0];
    const header = `# Daily Log - ${date}\n\n`;
    fs.writeFileSync(filePath, header + markdownContent, 'utf-8');
  }
  
  // 更新 L0 统计
  updateL0Stats(groupFolder);
  
  logger.debug({ groupFolder, logId: fullEntry.id }, 'Log entry appended');
  
  return fullEntry;
}

/**
 * 获取指定日期的日志
 */
export function getDayLogs(groupFolder: string, date?: string): LogEntry[] {
  const filePath = getLogFile(groupFolder, date);
  
  if (!fs.existsSync(filePath)) {
    return [];
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return parseLogFile(content);
  } catch (err) {
    logger.error({ err, groupFolder, date }, 'Failed to read day logs');
    return [];
  }
}

/**
 * 获取今日日志
 */
export function getTodayLog(groupFolder: string): LogEntry[] {
  return getDayLogs(groupFolder);
}

/**
 * 获取日期范围内的日志
 */
export function getLogsInRange(
  groupFolder: string, 
  startDate: Date, 
  endDate: Date
): LogEntry[] {
  const logsDir = getLogsDir(groupFolder);
  
  if (!fs.existsSync(logsDir)) {
    return [];
  }
  
  const allLogs: LogEntry[] = [];
  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];
  
  const files = fs.readdirSync(logsDir)
    .filter((f: string) => f.endsWith('.md') && !f.startsWith('.'))
    .sort();
  
  for (const file of files) {
    const fileDate = file.replace('.md', '');
    if (fileDate >= startStr && fileDate <= endStr) {
      const entries = getDayLogs(groupFolder, fileDate);
      allLogs.push(...entries);
    }
  }
  
  return allLogs;
}

/**
 * 获取最近 N 天的日志
 */
export function getRecentLogs(groupFolder: string, days: number = 3): LogEntry[] {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days + 1);
  
  return getLogsInRange(groupFolder, startDate, endDate);
}

/**
 * 搜索日志
 */
export function searchLogs(groupFolder: string, query: string): LogEntry[] {
  const logsDir = getLogsDir(groupFolder);
  
  if (!fs.existsSync(logsDir)) {
    return [];
  }
  
  const lowerQuery = query.toLowerCase();
  const matchedLogs: LogEntry[] = [];
  
  const files = fs.readdirSync(logsDir)
    .filter((f: string) => f.endsWith('.md') && !f.startsWith('.'))
    .sort()
    .reverse()
    .slice(0, 30); // 只搜索最近 30 天
  
  for (const file of files) {
    const fileDate = file.replace('.md', '');
    const entries = getDayLogs(groupFolder, fileDate);
    
    for (const entry of entries) {
      if (entry.content.toLowerCase().includes(lowerQuery)) {
        matchedLogs.push(entry);
      }
    }
  }
  
  return matchedLogs;
}

/**
 * 归档过期日志
 */
export function archiveExpiredLogs(groupFolder: string): number {
  const logsDir = getLogsDir(groupFolder);
  const archiveDir = getArchiveDir(groupFolder);
  
  if (!fs.existsSync(logsDir)) {
    return 0;
  }
  
  // 确保归档目录存在
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }
  
  const now = new Date();
  let archivedCount = 0;
  
  const files = fs.readdirSync(logsDir)
    .filter((f: string) => f.endsWith('.md') && !f.startsWith('.'));
  
  for (const file of files) {
    const fileDate = file.replace('.md', '');
    const logDate = new Date(fileDate);
    const daysDiff = Math.floor((now.getTime() - logDate.getTime()) / (1000 * 60 * 60 * 24));
    
    // 读取文件检查最高优先级
    const filePath = path.join(logsDir, file);
    const entries = getDayLogs(groupFolder, fileDate);
    
    // 找到最高优先级（P0 > P1 > P2）
    let highestPriority: Priority = 'P2';
    for (const entry of entries) {
      if (entry.priority === 'P0') {
        highestPriority = 'P0';
        break;
      } else if (entry.priority === 'P1' && highestPriority === 'P2') {
        highestPriority = 'P1';
      }
    }
    
    // 根据优先级判断是否归档
    const ttlDays = TTL_DAYS[highestPriority];
    if (ttlDays !== null && daysDiff > ttlDays) {
      // 移动到归档目录
      const archivePath = path.join(archiveDir, file);
      fs.renameSync(filePath, archivePath);
      archivedCount++;
      
      logger.debug({ groupFolder, file, daysDiff, priority: highestPriority }, 'Log archived');
    }
  }
  
  if (archivedCount > 0) {
    updateL0Stats(groupFolder);
  }
  
  return archivedCount;
}

/**
 * 获取日志统计信息
 */
export function getLogsStats(groupFolder: string): {
  active_logs: number;
  archived_logs: number;
  total_entries: number;
  recent_dates: string[];
} {
  const logsDir = getLogsDir(groupFolder);
  const archiveDir = getArchiveDir(groupFolder);
  
  let activeLogs = 0;
  let archivedLogs = 0;
  let totalEntries = 0;
  const recentDates: string[] = [];
  
  if (fs.existsSync(logsDir)) {
    const files = fs.readdirSync(logsDir)
      .filter((f: string) => f.endsWith('.md') && !f.startsWith('.'))
      .sort()
      .reverse();
    
    activeLogs = files.length;
    recentDates.push(...files.slice(0, 5).map((f: string) => f.replace('.md', '')));
    
    // 计算总条目数（仅统计最近 7 天）
    for (const file of files.slice(0, 7)) {
      const entries = getDayLogs(groupFolder, file.replace('.md', ''));
      totalEntries += entries.length;
    }
  }
  
  if (fs.existsSync(archiveDir)) {
    archivedLogs = fs.readdirSync(archiveDir)
      .filter((f: string) => f.endsWith('.md') && !f.startsWith('.'))
      .length;
  }
  
  return {
    active_logs: activeLogs,
    archived_logs: archivedLogs,
    total_entries: totalEntries,
    recent_dates: recentDates,
  };
}

/**
 * 标记日志条目为已提炼
 */
export function markLogAsExtracted(groupFolder: string, date: string, logId: string): boolean {
  const filePath = getLogFile(groupFolder, date);
  
  if (!fs.existsSync(filePath)) {
    return false;
  }
  
  const entries = getDayLogs(groupFolder, date);
  let found = false;
  
  for (const entry of entries) {
    if (entry.id === logId) {
      entry.metadata = entry.metadata || {};
      entry.metadata.extracted_to_l1 = true;
      found = true;
      break;
    }
  }
  
  if (!found) {
    return false;
  }
  
  // 重写文件
  const header = `# Daily Log - ${date}\n\n`;
  const content = header + entries.map(formatLogEntryToMarkdown).join('');
  fs.writeFileSync(filePath, content, 'utf-8');
  
  return true;
}
