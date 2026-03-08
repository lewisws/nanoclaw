/**
 * Janitor - Memory Cleaner
 * 每日清理过期记忆，根据 TTL 归档
 */

import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from '../config.js';
import { logger } from '../logger.js';
import { getMemoryDir } from './l0-index.js';
import { archiveExpiredLogs } from './l2-logs.js';
import type { JanitorResult } from './types.js';

/**
 * 获取所有组目录
 */
function getAllGroupFolders(): string[] {
  if (!fs.existsSync(GROUPS_DIR)) {
    return [];
  }
  
  return fs.readdirSync(GROUPS_DIR)
    .filter((f: string) => {
      const fullPath = path.join(GROUPS_DIR, f);
      return fs.statSync(fullPath).isDirectory() && !f.startsWith('.');
    });
}

/**
 * 运行 Janitor 清理单个组
 */
export function runJanitor(groupFolder: string): JanitorResult {
  const result: JanitorResult = {
    group_folder: groupFolder,
    executed_at: new Date().toISOString(),
    logs_scanned: 0,
    logs_archived: 0,
    entries_archived: 0,
    errors: [],
  };
  
  try {
    const memoryDir = getMemoryDir(groupFolder);
    
    if (!fs.existsSync(memoryDir)) {
      logger.debug({ groupFolder }, 'Memory directory does not exist, skipping janitor');
      return result;
    }
    
    // 归档过期日志
    const archivedCount = archiveExpiredLogs(groupFolder);
    result.logs_archived = archivedCount;
    
    logger.info({ groupFolder, archivedCount }, 'Janitor completed');
    
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    result.errors.push(errorMessage);
    logger.error({ err, groupFolder }, 'Janitor failed');
  }
  
  return result;
}

/**
 * 运行 Janitor 清理所有组
 */
export function runJanitorForAllGroups(): JanitorResult[] {
  const results: JanitorResult[] = [];
  const groupFolders = getAllGroupFolders();
  
  logger.info({ groupCount: groupFolders.length }, 'Starting janitor for all groups');
  
  for (const folder of groupFolders) {
    const result = runJanitor(folder);
    results.push(result);
  }
  
  const totalArchived = results.reduce((sum, r) => sum + r.logs_archived, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
  
  logger.info({ groupCount: groupFolders.length, totalArchived, totalErrors }, 'Janitor completed for all groups');
  
  return results;
}
