import { ChildProcess } from 'child_process';
import { CronExpressionParser } from 'cron-parser';
import fs from 'fs';

import { ASSISTANT_NAME, SCHEDULER_POLL_INTERVAL, TIMEZONE } from './config.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  getAllTasks,
  getDueTasks,
  getTaskById,
  logTaskRun,
  updateTask,
  updateTaskAfterRun,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { logger } from './logger.js';
import { RegisteredGroup, ScheduledTask } from './types.js';
import {
  JANITOR_CRON,
  COMPOUNDING_CRON,
} from './memory/constants.js';
import {
  runJanitorForAllGroups,
} from './memory/janitor.js';
import {
  runCompoundingForAllGroups,
} from './memory/compounding.js';
import {
  retryFailedTasks,
} from './memory/supervisor.js';

/**
 * Compute the next run time for a recurring task, anchored to the
 * task's scheduled time rather than Date.now() to prevent cumulative
 * drift on interval-based tasks.
 *
 * Co-authored-by: @community-pr-601
 */
export function computeNextRun(task: ScheduledTask): string | null {
  if (task.schedule_type === 'once') return null;

  const now = Date.now();

  if (task.schedule_type === 'cron') {
    const interval = CronExpressionParser.parse(task.schedule_value, {
      tz: TIMEZONE,
    });
    return interval.next().toISOString();
  }

  if (task.schedule_type === 'interval') {
    const ms = parseInt(task.schedule_value, 10);
    if (!ms || ms <= 0) {
      // Guard against malformed interval that would cause an infinite loop
      logger.warn(
        { taskId: task.id, value: task.schedule_value },
        'Invalid interval value',
      );
      return new Date(now + 60_000).toISOString();
    }
    // Anchor to the scheduled time, not now, to prevent drift.
    // Skip past any missed intervals so we always land in the future.
    let next = new Date(task.next_run!).getTime() + ms;
    while (next <= now) {
      next += ms;
    }
    return new Date(next).toISOString();
  }

  return null;
}

export interface SchedulerDependencies {
  registeredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
  queue: GroupQueue;
  onProcess: (
    groupJid: string,
    proc: ChildProcess,
    containerName: string,
    groupFolder: string,
  ) => void;
  sendMessage: (jid: string, text: string) => Promise<void>;
}

async function runTask(
  task: ScheduledTask,
  deps: SchedulerDependencies,
): Promise<void> {
  const startTime = Date.now();
  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(task.group_folder);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // Stop retry churn for malformed legacy rows.
    updateTask(task.id, { status: 'paused' });
    logger.error(
      { taskId: task.id, groupFolder: task.group_folder, error },
      'Task has invalid group folder',
    );
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error,
    });
    return;
  }
  fs.mkdirSync(groupDir, { recursive: true });

  logger.info(
    { taskId: task.id, group: task.group_folder },
    'Running scheduled task',
  );

  const groups = deps.registeredGroups();
  const group = Object.values(groups).find(
    (g) => g.folder === task.group_folder,
  );

  if (!group) {
    logger.error(
      { taskId: task.id, groupFolder: task.group_folder },
      'Group not found for task',
    );
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error: `Group not found: ${task.group_folder}`,
    });
    return;
  }

  // Update tasks snapshot for container to read (filtered by group)
  const isMain = group.isMain === true;
  const tasks = getAllTasks();
  writeTasksSnapshot(
    task.group_folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  let result: string | null = null;
  let error: string | null = null;

  // For group context mode, use the group's current session
  const sessions = deps.getSessions();
  const sessionId =
    task.context_mode === 'group' ? sessions[task.group_folder] : undefined;

  // After the task produces a result, close the container promptly.
  // Tasks are single-turn — no need to wait IDLE_TIMEOUT (30 min) for the
  // query loop to time out. A short delay handles any final MCP calls.
  const TASK_CLOSE_DELAY_MS = 10000;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleClose = () => {
    if (closeTimer) return; // already scheduled
    closeTimer = setTimeout(() => {
      logger.debug({ taskId: task.id }, 'Closing task container after result');
      deps.queue.closeStdin(task.chat_jid);
    }, TASK_CLOSE_DELAY_MS);
  };

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt: task.prompt,
        sessionId,
        groupFolder: task.group_folder,
        chatJid: task.chat_jid,
        isMain,
        isScheduledTask: true,
        assistantName: ASSISTANT_NAME,
      },
      (proc, containerName) =>
        deps.onProcess(task.chat_jid, proc, containerName, task.group_folder),
      async (streamedOutput: ContainerOutput) => {
        if (streamedOutput.result) {
          result = streamedOutput.result;
          // Forward result to user (sendMessage handles formatting)
          await deps.sendMessage(task.chat_jid, streamedOutput.result);
          scheduleClose();
        }
        if (streamedOutput.status === 'success') {
          deps.queue.notifyIdle(task.chat_jid);
        }
        if (streamedOutput.status === 'error') {
          error = streamedOutput.error || 'Unknown error';
        }
      },
    );

    if (closeTimer) clearTimeout(closeTimer);

    if (output.status === 'error') {
      error = output.error || 'Unknown error';
    } else if (output.result) {
      // Result was already forwarded to the user via the streaming callback above
      result = output.result;
    }

    logger.info(
      { taskId: task.id, durationMs: Date.now() - startTime },
      'Task completed',
    );
  } catch (err) {
    if (closeTimer) clearTimeout(closeTimer);
    error = err instanceof Error ? err.message : String(err);
    logger.error({ taskId: task.id, error }, 'Task failed');
  }

  const durationMs = Date.now() - startTime;

  logTaskRun({
    task_id: task.id,
    run_at: new Date().toISOString(),
    duration_ms: durationMs,
    status: error ? 'error' : 'success',
    result,
    error,
  });

  const nextRun = computeNextRun(task);
  const resultSummary = error
    ? `Error: ${error}`
    : result
      ? result.slice(0, 200)
      : 'Completed';
  updateTaskAfterRun(task.id, nextRun, resultSummary);
}

let schedulerRunning = false;
let memoryTasksInitialized = false;
let nextJanitorRun: Date | null = null;
let nextCompoundingRun: Date | null = null;

export function startSchedulerLoop(deps: SchedulerDependencies): void {
  if (schedulerRunning) {
    logger.debug('Scheduler loop already running, skipping duplicate start');
    return;
  }
  schedulerRunning = true;
  logger.info('Scheduler loop started');

  // 初始化记忆系统定时任务
  initializeMemoryTasks();

  const loop = async () => {
    try {
      // 检查并执行记忆系统任务
      await checkAndRunMemoryTasks();

      const dueTasks = getDueTasks();
      if (dueTasks.length > 0) {
        logger.info({ count: dueTasks.length }, 'Found due tasks');
      }

      for (const task of dueTasks) {
        // Re-check task status in case it was paused/cancelled
        const currentTask = getTaskById(task.id);
        if (!currentTask || currentTask.status !== 'active') {
          continue;
        }

        deps.queue.enqueueTask(currentTask.chat_jid, currentTask.id, () =>
          runTask(currentTask, deps),
        );
      }
    } catch (err) {
      logger.error({ err }, 'Error in scheduler loop');
    }

    setTimeout(loop, SCHEDULER_POLL_INTERVAL);
  };

  loop();
}

/** @internal - for tests only. */
export function _resetSchedulerLoopForTests(): void {
  schedulerRunning = false;
  memoryTasksInitialized = false;
  nextJanitorRun = null;
  nextCompoundingRun = null;
}

/**
 * 初始化记忆系统定时任务
 */
function initializeMemoryTasks(): void {
  if (memoryTasksInitialized) return;
  memoryTasksInitialized = true;

  try {
    // Janitor: 每日 00:00
    const janitorInterval = CronExpressionParser.parse(JANITOR_CRON, { tz: TIMEZONE });
    nextJanitorRun = janitorInterval.next().toDate();
    if (nextJanitorRun) {
      logger.info({ nextRun: nextJanitorRun.toISOString() }, 'Janitor task scheduled');
    }

    // Compounding: 每 3 天 08:00
    const compoundingInterval = CronExpressionParser.parse(COMPOUNDING_CRON, { tz: TIMEZONE });
    nextCompoundingRun = compoundingInterval.next().toDate();
    if (nextCompoundingRun) {
      logger.info({ nextRun: nextCompoundingRun.toISOString() }, 'Compounding task scheduled');
    }
  } catch (err) {
    logger.error({ err }, 'Failed to initialize memory tasks');
  }
}

/**
 * 检查并执行记忆系统任务
 */
async function checkAndRunMemoryTasks(): Promise<void> {
  const now = new Date();

  // 检查 Janitor
  if (nextJanitorRun && now >= nextJanitorRun) {
    logger.info('Running scheduled Janitor task');
    try {
      const results = runJanitorForAllGroups();
      const totalArchived = results.reduce((sum, r) => sum + r.logs_archived, 0);
      logger.info({ totalArchived }, 'Janitor task completed');
    } catch (err) {
      logger.error({ err }, 'Janitor task failed');
    }

    // 计算下次运行时间
    const janitorInterval = CronExpressionParser.parse(JANITOR_CRON, { tz: TIMEZONE });
    nextJanitorRun = janitorInterval.next().toDate();
    if (nextJanitorRun) {
      logger.debug({ nextRun: nextJanitorRun.toISOString() }, 'Next Janitor run scheduled');
    }
  }

  // 检查 Compounding
  if (nextCompoundingRun && now >= nextCompoundingRun) {
    logger.info('Running scheduled Compounding task');
    try {
      const results = await runCompoundingForAllGroups();
      const totalInsights = results.reduce((sum, r) => sum + r.insights_generated, 0);
      const totalLessons = results.reduce((sum, r) => sum + r.lessons_generated, 0);
      logger.info({ totalInsights, totalLessons }, 'Compounding task completed');
    } catch (err) {
      logger.error({ err }, 'Compounding task failed');
    }

    // 计算下次运行时间
    const compoundingInterval = CronExpressionParser.parse(COMPOUNDING_CRON, { tz: TIMEZONE });
    nextCompoundingRun = compoundingInterval.next().toDate();
    if (nextCompoundingRun) {
      logger.debug({ nextRun: nextCompoundingRun.toISOString() }, 'Next Compounding run scheduled');
    }
  }

  // 每次循环都尝试重试失败的任务
  try {
    await retryFailedTasks();
  } catch (err) {
    logger.error({ err }, 'Failed to retry memory tasks');
  }
}
