/**
 * Compounding - Memory Extractor
 * 每3天提炼洞察和教训，使用 Claude Agent 分析
 */

import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { getMemoryDir, updateL0Stats, updateL0Summary } from './l0-index.js';
import { saveInsight } from './l1-insights.js';
import { saveLesson } from './l1-lessons.js';
import { getRecentLogs, markLogAsExtracted } from './l2-logs.js';
import type { CompoundingResult, Priority, InsightType, LessonType, LogEntry } from './types.js';

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
 * Compounding 提示词模板
 */
const COMPOUNDING_PROMPT = `你是一个记忆提炼助手。分析以下对话日志，提取有价值的洞察和教训。

## 输出格式
请以 JSON 格式输出，包含以下结构：
{
  "insights": [
    {
      "type": "long_term" | "phase" | "behavior",
      "priority": "P0" | "P1",
      "content": "洞察内容",
      "context": "相关上下文（可选）"
    }
  ],
  "lessons": [
    {
      "type": "mistake" | "success" | "pattern",
      "priority": "P0" | "P1",
      "lesson": "教训内容",
      "context": "相关上下文（可选）"
    }
  ],
  "summary": ["摘要1", "摘要2", "摘要3"]
}

## 优先级说明
- P0: 永久保留 - 用户的长期特征、核心偏好、重要身份信息
- P1: 30天保留 - 阶段性模式、临时偏好、项目相关信息

## 类型说明
### Insight 类型
- long_term: 用户的长期特征和习惯
- phase: 当前阶段的模式和偏好
- behavior: 行为模式和交互习惯

### Lesson 类型
- mistake: 从错误中学到的教训
- success: 成功经验
- pattern: 发现的模式

## 对话日志
`;

interface CompoundingResponse {
  insights: Array<{
    type: InsightType;
    priority: Priority;
    content: string;
    context?: string;
  }>;
  lessons: Array<{
    type: LessonType;
    priority: Priority;
    lesson: string;
    context?: string;
  }>;
  summary: string[];
}

/**
 * 调用 Claude API 进行提炼
 */
async function callClaudeForCompounding(logs: LogEntry[]): Promise<CompoundingResponse | null> {
  const envConfig = readEnvFile(['ANTHROPIC_API_KEY']);
  const apiKey = process.env.ANTHROPIC_API_KEY || envConfig.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    logger.warn('ANTHROPIC_API_KEY not set, skipping compounding');
    return null;
  }
  
  // 格式化日志为文本
  const logsText = logs.map((log: LogEntry) => {
    const role = log.role === 'user' ? '用户' : '助手';
    return `[${log.timestamp}] ${role}: ${log.content}`;
  }).join('\n\n');
  
  const prompt = COMPOUNDING_PROMPT + logsText;
  
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'Claude API error');
      return null;
    }
    
    const data = await response.json() as {
      content: Array<{ type: string; text: string }>;
    };
    
    // 提取 JSON 响应
    const textContent = data.content.find((c: { type: string }) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return null;
    }
    
    // 尝试解析 JSON
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('No JSON found in Claude response');
      return null;
    }
    
    return JSON.parse(jsonMatch[0]) as CompoundingResponse;
    
  } catch (err) {
    logger.error({ err }, 'Failed to call Claude for compounding');
    return null;
  }
}

/**
 * 运行 Compounding 提炼单个组
 */
export async function runCompounding(groupFolder: string): Promise<CompoundingResult> {
  const result: CompoundingResult = {
    group_folder: groupFolder,
    executed_at: new Date().toISOString(),
    logs_analyzed: 0,
    insights_generated: 0,
    lessons_generated: 0,
    errors: [],
  };
  
  try {
    const memoryDir = getMemoryDir(groupFolder);
    
    if (!fs.existsSync(memoryDir)) {
      logger.debug({ groupFolder }, 'Memory directory does not exist, skipping compounding');
      return result;
    }
    
    // 获取最近 3 天的日志
    const recentLogs = getRecentLogs(groupFolder, 3);
    result.logs_analyzed = recentLogs.length;
    
    if (recentLogs.length === 0) {
      logger.debug({ groupFolder }, 'No recent logs to analyze');
      return result;
    }
    
    // 过滤已提炼的日志
    const unextractedLogs = recentLogs.filter((log: LogEntry) => !log.metadata?.extracted_to_l1);
    
    if (unextractedLogs.length === 0) {
      logger.debug({ groupFolder }, 'All recent logs already extracted');
      return result;
    }
    
    // 调用 Claude 进行提炼
    const compoundingResult = await callClaudeForCompounding(unextractedLogs);
    
    if (!compoundingResult) {
      result.errors.push('Failed to get compounding result from Claude');
      return result;
    }
    
    // 保存洞察
    for (const insight of compoundingResult.insights) {
      saveInsight(groupFolder, {
        priority: insight.priority,
        type: insight.type,
        content: insight.content,
        context: insight.context,
        source: 'compounding',
      });
      result.insights_generated++;
    }
    
    // 保存教训
    for (const lesson of compoundingResult.lessons) {
      saveLesson(groupFolder, {
        priority: lesson.priority,
        type: lesson.type,
        lesson: lesson.lesson,
        context: lesson.context,
      });
      result.lessons_generated++;
    }
    
    // 更新 L0 摘要
    if (compoundingResult.summary.length > 0) {
      updateL0Summary(groupFolder, compoundingResult.summary);
    }
    
    // 标记日志为已提炼
    for (const log of unextractedLogs) {
      const logDate = log.timestamp.split('T')[0];
      markLogAsExtracted(groupFolder, logDate, log.id);
    }
    
    // 更新 L0 统计
    updateL0Stats(groupFolder);
    
    logger.info({
      groupFolder,
      logsAnalyzed: result.logs_analyzed,
      insightsGenerated: result.insights_generated,
      lessonsGenerated: result.lessons_generated,
    }, 'Compounding completed');
    
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    result.errors.push(errorMessage);
    logger.error({ err, groupFolder }, 'Compounding failed');
  }
  
  return result;
}

/**
 * 运行 Compounding 提炼所有组
 */
export async function runCompoundingForAllGroups(): Promise<CompoundingResult[]> {
  const results: CompoundingResult[] = [];
  const groupFolders = getAllGroupFolders();
  
  logger.info({ groupCount: groupFolders.length }, 'Starting compounding for all groups');
  
  for (const folder of groupFolders) {
    const result = await runCompounding(folder);
    results.push(result);
  }
  
  const totalInsights = results.reduce((sum, r) => sum + r.insights_generated, 0);
  const totalLessons = results.reduce((sum, r) => sum + r.lessons_generated, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
  
  logger.info({
    groupCount: groupFolders.length,
    totalInsights,
    totalLessons,
    totalErrors,
  }, 'Compounding completed for all groups');
  
  return results;
}
