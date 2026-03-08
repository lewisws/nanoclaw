/**
 * Migration - CLAUDE.md to Memory System
 * 迁移现有 CLAUDE.md 到三层记忆架构
 */

import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { initializeMemoryDir, updateL0Stats, updateL0Summary } from './l0-index.js';
import { saveInsight } from './l1-insights.js';
import { saveLesson } from './l1-lessons.js';
import type { MigrationResult, Priority, InsightType, LessonType } from './types.js';

/**
 * 迁移提示词模板
 */
const MIGRATION_PROMPT = `你是一个记忆迁移助手。分析以下 CLAUDE.md 内容，将其分类并转换为结构化记忆。

## 输出格式
请以 JSON 格式输出：
{
  "insights": [
    {
      "type": "long_term" | "phase" | "behavior",
      "priority": "P0" | "P1",
      "content": "洞察内容"
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

## 分类指南

### Insight 类型和优先级
- long_term + P0: 用户的核心身份、长期特征（如名字、职业、基本偏好）
- phase + P1: 当前项目或阶段性信息（如正在进行的项目、临时偏好）
- behavior + P1: 交互习惯和行为模式

### Lesson 类型
- mistake: 过去的错误和教训
- success: 成功经验
- pattern: 发现的规律

## CLAUDE.md 内容
`;

interface MigrationResponse {
  insights: Array<{
    type: InsightType;
    priority: Priority;
    content: string;
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
 * 调用 Claude API 进行迁移分析
 */
async function callClaudeForMigration(claudeMdContent: string): Promise<MigrationResponse | null> {
  const envConfig = readEnvFile(['ANTHROPIC_API_KEY']);
  const apiKey = process.env.ANTHROPIC_API_KEY || envConfig.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    logger.warn('ANTHROPIC_API_KEY not set, using simple migration');
    return null;
  }
  
  const prompt = MIGRATION_PROMPT + claudeMdContent;
  
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
      logger.error({ status: response.status, error: errorText }, 'Claude API error during migration');
      return null;
    }
    
    const data = await response.json() as {
      content: Array<{ type: string; text: string }>;
    };
    
    const textContent = data.content.find((c: { type: string }) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return null;
    }
    
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('No JSON found in Claude migration response');
      return null;
    }
    
    return JSON.parse(jsonMatch[0]) as MigrationResponse;
    
  } catch (err) {
    logger.error({ err }, 'Failed to call Claude for migration');
    return null;
  }
}

/**
 * 简单迁移：直接将 CLAUDE.md 内容作为一个 insight 保存
 */
function simpleMigration(groupFolder: string, content: string): MigrationResult {
  const result: MigrationResult = {
    group_folder: groupFolder,
    executed_at: new Date().toISOString(),
    source_file: 'CLAUDE.md',
    backup_file: 'CLAUDE.md.backup',
    insights_created: 0,
    lessons_created: 0,
    logs_created: 0,
    errors: [],
  };
  
  try {
    // 将整个 CLAUDE.md 作为一个长期 insight 保存
    saveInsight(groupFolder, {
      priority: 'P0',
      type: 'long_term',
      content: content,
      source: 'migration_from_claude_md',
    });
    result.insights_created = 1;
    
    // 更新摘要
    const summaryLines = content.split('\n')
      .filter((line: string) => line.trim().startsWith('- ') || line.trim().startsWith('* '))
      .slice(0, 5)
      .map((line: string) => line.replace(/^[-*]\s*/, '').trim());
    
    if (summaryLines.length > 0) {
      updateL0Summary(groupFolder, summaryLines);
    }
    
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    result.errors.push(errorMessage);
  }
  
  return result;
}

/**
 * 迁移单个组的 CLAUDE.md
 */
export async function migrateClaudeMd(groupFolder: string): Promise<MigrationResult> {
  const result: MigrationResult = {
    group_folder: groupFolder,
    executed_at: new Date().toISOString(),
    source_file: 'CLAUDE.md',
    backup_file: 'CLAUDE.md.backup',
    insights_created: 0,
    lessons_created: 0,
    logs_created: 0,
    errors: [],
  };
  
  const groupDir = path.join(GROUPS_DIR, groupFolder);
  const claudeMdPath = path.join(groupDir, 'CLAUDE.md');
  const backupPath = path.join(groupDir, 'CLAUDE.md.backup');
  
  // 检查 CLAUDE.md 是否存在
  if (!fs.existsSync(claudeMdPath)) {
    logger.debug({ groupFolder }, 'No CLAUDE.md found, skipping migration');
    return result;
  }
  
  try {
    // 读取 CLAUDE.md 内容
    const claudeMdContent = fs.readFileSync(claudeMdPath, 'utf-8');
    
    if (!claudeMdContent.trim()) {
      logger.debug({ groupFolder }, 'CLAUDE.md is empty, skipping migration');
      return result;
    }
    
    // 初始化记忆目录
    initializeMemoryDir(groupFolder);
    
    // 尝试使用 AI 进行智能迁移
    const migrationResponse = await callClaudeForMigration(claudeMdContent);
    
    if (migrationResponse) {
      // 保存洞察
      for (const insight of migrationResponse.insights) {
        try {
          saveInsight(groupFolder, {
            priority: insight.priority,
            type: insight.type,
            content: insight.content,
            source: 'migration_from_claude_md',
          });
          result.insights_created++;
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          result.errors.push(`Failed to save insight: ${errorMessage}`);
        }
      }
      
      // 保存教训
      for (const lesson of migrationResponse.lessons) {
        try {
          saveLesson(groupFolder, {
            priority: lesson.priority,
            type: lesson.type,
            lesson: lesson.lesson,
            context: lesson.context,
          });
          result.lessons_created++;
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          result.errors.push(`Failed to save lesson: ${errorMessage}`);
        }
      }
      
      // 更新摘要
      if (migrationResponse.summary.length > 0) {
        updateL0Summary(groupFolder, migrationResponse.summary);
      }
    } else {
      // 回退到简单迁移
      const simpleResult = simpleMigration(groupFolder, claudeMdContent);
      result.insights_created = simpleResult.insights_created;
      result.errors.push(...simpleResult.errors);
    }
    
    // 更新 L0 统计
    updateL0Stats(groupFolder);
    
    // 备份原文件
    fs.copyFileSync(claudeMdPath, backupPath);
    result.backup_file = backupPath;
    
    logger.info({
      groupFolder,
      insightsCreated: result.insights_created,
      lessonsCreated: result.lessons_created,
    }, 'Migration completed');
    
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    result.errors.push(errorMessage);
    logger.error({ err, groupFolder }, 'Migration failed');
  }
  
  return result;
}

/**
 * 迁移所有组的 CLAUDE.md
 */
export async function migrateAllGroups(): Promise<MigrationResult[]> {
  const results: MigrationResult[] = [];
  
  if (!fs.existsSync(GROUPS_DIR)) {
    logger.warn('Groups directory does not exist');
    return results;
  }
  
  const groupFolders = fs.readdirSync(GROUPS_DIR)
    .filter((f: string) => {
      const fullPath = path.join(GROUPS_DIR, f);
      return fs.statSync(fullPath).isDirectory() && !f.startsWith('.');
    });
  
  logger.info({ groupCount: groupFolders.length }, 'Starting migration for all groups');
  
  for (const folder of groupFolders) {
    const result = await migrateClaudeMd(folder);
    results.push(result);
  }
  
  const totalInsights = results.reduce((sum, r) => sum + r.insights_created, 0);
  const totalLessons = results.reduce((sum, r) => sum + r.lessons_created, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
  
  logger.info({
    groupCount: groupFolders.length,
    totalInsights,
    totalLessons,
    totalErrors,
  }, 'Migration completed for all groups');
  
  return results;
}
