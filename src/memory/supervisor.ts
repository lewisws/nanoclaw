/**
 * Supervisor - Memory Task Monitor
 * 监管 Janitor 和 Compounding 的执行，处理失败重试
 */

import {
  createMemoryTaskLog,
  updateMemoryTaskLog,
  getFailedMemoryTasks,
  getMemoryTaskAlerts,
  type MemoryTaskLogRow,
} from '../db.js';
import { logger } from '../logger.js';
import { runJanitor, runJanitorForAllGroups } from './janitor.js';
import { runCompounding, runCompoundingForAllGroups } from './compounding.js';
import type { MemoryTaskType, MemoryTaskAlert, JanitorResult, CompoundingResult } from './types.js';

const MAX_RETRIES = 3;

/**
 * 记录任务开始
 */
export function logTaskStart(taskType: MemoryTaskType, groupFolder: string): number {
  return createMemoryTaskLog({
    task_type: taskType,
    group_folder: groupFolder,
  });
}

/**
 * 记录任务完成
 */
export function logTaskComplete(
  id: number,
  status: 'success' | 'failed',
  details?: string,
  errorMessage?: string,
): void {
  updateMemoryTaskLog(id, {
    status,
    details,
    error_message: errorMessage,
  });
}

/**
 * 执行带监管的 Janitor
 */
export function runJanitorWithSupervisor(groupFolder: string): JanitorResult {
  const taskId = logTaskStart('janitor', groupFolder);
  
  try {
    const result = runJanitor(groupFolder);
    
    if (result.errors.length > 0) {
      logTaskComplete(taskId, 'failed', JSON.stringify(result), result.errors.join('; '));
    } else {
      logTaskComplete(taskId, 'success', JSON.stringify(result));
    }
    
    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logTaskComplete(taskId, 'failed', undefined, errorMessage);
    throw err;
  }
}

/**
 * 执行带监管的 Compounding
 */
export async function runCompoundingWithSupervisor(groupFolder: string): Promise<CompoundingResult> {
  const taskId = logTaskStart('compounding', groupFolder);
  
  try {
    const result = await runCompounding(groupFolder);
    
    if (result.errors.length > 0) {
      logTaskComplete(taskId, 'failed', JSON.stringify(result), result.errors.join('; '));
    } else {
      logTaskComplete(taskId, 'success', JSON.stringify(result));
    }
    
    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logTaskComplete(taskId, 'failed', undefined, errorMessage);
    throw err;
  }
}

/**
 * 执行所有组的 Janitor 带监管
 */
export function runJanitorForAllGroupsWithSupervisor(): JanitorResult[] {
  const results: JanitorResult[] = [];
  
  // 使用原始函数获取组列表并逐个执行
  const allResults = runJanitorForAllGroups();
  
  for (const result of allResults) {
    results.push(result);
  }
  
  return results;
}

/**
 * 执行所有组的 Compounding 带监管
 */
export async function runCompoundingForAllGroupsWithSupervisor(): Promise<CompoundingResult[]> {
  const results: CompoundingResult[] = [];
  
  // 使用原始函数获取组列表并逐个执行
  const allResults = await runCompoundingForAllGroups();
  
  for (const result of allResults) {
    results.push(result);
  }
  
  return results;
}

/**
 * 重试失败的任务
 */
export async function retryFailedTasks(): Promise<{
  janitor: JanitorResult[];
  compounding: CompoundingResult[];
}> {
  const failedTasks = getFailedMemoryTasks();
  const janitorResults: JanitorResult[] = [];
  const compoundingResults: CompoundingResult[] = [];
  
  for (const task of failedTasks) {
    if (task.retry_count >= MAX_RETRIES) {
      logger.warn({ taskId: task.id, taskType: task.task_type }, 'Max retries reached, skipping');
      continue;
    }
    
    // 更新重试计数
    updateMemoryTaskLog(task.id, { retry_count: task.retry_count + 1 });
    
    logger.info({
      taskId: task.id,
      taskType: task.task_type,
      groupFolder: task.group_folder,
      retryCount: task.retry_count + 1,
    }, 'Retrying failed task');
    
    try {
      if (task.task_type === 'janitor') {
        const result = runJanitorWithSupervisor(task.group_folder);
        janitorResults.push(result);
      } else if (task.task_type === 'compounding') {
        const result = await runCompoundingWithSupervisor(task.group_folder);
        compoundingResults.push(result);
      }
    } catch (err) {
      logger.error({ err, taskId: task.id }, 'Retry failed');
    }
  }
  
  return { janitor: janitorResults, compounding: compoundingResults };
}

/**
 * 获取需要告警的失败任务
 */
export function getPendingAlerts(): MemoryTaskAlert[] {
  const alertTasks = getMemoryTaskAlerts();
  
  return alertTasks.map((task: MemoryTaskLogRow) => ({
    task_log: {
      id: task.id,
      task_type: task.task_type as MemoryTaskType,
      group_folder: task.group_folder,
      started_at: task.started_at,
      completed_at: task.completed_at,
      status: task.status as 'running' | 'success' | 'failed',
      details: task.details,
      error_message: task.error_message,
      retry_count: task.retry_count,
    },
    message: `Memory task "${task.task_type}" for group "${task.group_folder}" failed after ${task.retry_count} retries. Error: ${task.error_message || 'Unknown'}`,
  }));
}
