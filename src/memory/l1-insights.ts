/**
 * L1 Insights Management
 * 洞察层：用户特征和模式识别
 */

import fs from 'fs';
import path from 'path';

import { logger } from '../logger.js';
import { getMemoryDir, updateL0Stats } from './l0-index.js';
import {
  L1_INSIGHTS_DIR,
} from './constants.js';
import type { Insight, InsightType, Priority } from './types.js';

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `ins_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 获取洞察目录路径
 */
function getInsightsDir(groupFolder: string): string {
  return path.join(getMemoryDir(groupFolder), L1_INSIGHTS_DIR);
}

/**
 * 获取月度洞察文件路径
 */
function getMonthlyInsightFile(groupFolder: string, month?: string): string {
  const targetMonth = month || new Date().toISOString().slice(0, 7); // YYYY-MM
  return path.join(getInsightsDir(groupFolder), `${targetMonth}.md`);
}

/**
 * 解析 Markdown 格式的洞察文件
 */
function parseInsightsFile(content: string): Insight[] {
  const insights: Insight[] = [];
  const blocks = content.split(/^## /m).filter((b: string) => b.trim());
  
  for (const block of blocks) {
    try {
      const lines = block.split('\n');
      const headerLine = lines[0]?.trim();
      if (!headerLine) continue;
      
      // 解析 header: [P0] preference - 2025-03-08T10:00:00Z
      const headerMatch = headerLine.match(/\[(P[012])\]\s+(\w+)\s+-\s+(.+)/);
      if (!headerMatch) continue;
      
      const [, priority, type, timestamp] = headerMatch;
      
      // 提取内容（跳过元数据行）
      const contentLines: string[] = [];
      let id = '';
      let context = '';
      let source = '';
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('- id: ')) {
          id = line.replace('- id: ', '').trim();
        } else if (line.startsWith('- context: ')) {
          context = line.replace('- context: ', '').trim();
        } else if (line.startsWith('- source: ')) {
          source = line.replace('- source: ', '').trim();
        } else if (line.trim() && !line.startsWith('-')) {
          contentLines.push(line);
        }
      }
      
      insights.push({
        id: id || generateId(),
        timestamp: timestamp.trim(),
        priority: priority as Priority,
        type: type as InsightType,
        content: contentLines.join('\n').trim(),
        context: context || undefined,
        source: source || undefined,
      });
    } catch {
      // 忽略解析错误的块
    }
  }
  
  return insights;
}

/**
 * 格式化洞察为 Markdown
 */
function formatInsightToMarkdown(insight: Insight): string {
  const lines = [
    `## [${insight.priority}] ${insight.type} - ${insight.timestamp}`,
    `- id: ${insight.id}`,
  ];
  
  if (insight.context) {
    lines.push(`- context: ${insight.context}`);
  }
  if (insight.source) {
    lines.push(`- source: ${insight.source}`);
  }
  
  lines.push('');
  lines.push(insight.content);
  lines.push('');
  
  return lines.join('\n');
}

/**
 * 保存洞察
 */
export function saveInsight(groupFolder: string, insight: Omit<Insight, 'id' | 'timestamp'>): Insight {
  const fullInsight: Insight = {
    ...insight,
    id: generateId(),
    timestamp: new Date().toISOString(),
  };
  
  const insightsDir = getInsightsDir(groupFolder);
  
  // 确保目录存在
  if (!fs.existsSync(insightsDir)) {
    fs.mkdirSync(insightsDir, { recursive: true });
  }
  
  const filePath = getMonthlyInsightFile(groupFolder);
  const markdownContent = formatInsightToMarkdown(fullInsight);
  
  // 追加到文件
  if (fs.existsSync(filePath)) {
    fs.appendFileSync(filePath, markdownContent, 'utf-8');
  } else {
    // 创建新文件，添加头部
    const month = new Date().toISOString().slice(0, 7);
    const header = `# Insights - ${month}\n\n`;
    fs.writeFileSync(filePath, header + markdownContent, 'utf-8');
  }
  
  // 更新 L0 统计
  updateL0Stats(groupFolder);
  
  logger.debug({ groupFolder, insightId: fullInsight.id }, 'Insight saved');
  
  return fullInsight;
}

/**
 * 获取指定月份的洞察
 */
export function getInsights(groupFolder: string, month?: string): Insight[] {
  const filePath = getMonthlyInsightFile(groupFolder, month);
  
  if (!fs.existsSync(filePath)) {
    return [];
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return parseInsightsFile(content);
  } catch (err) {
    logger.error({ err, groupFolder, month }, 'Failed to read insights');
    return [];
  }
}

/**
 * 获取所有洞察
 */
export function getAllInsights(groupFolder: string): Insight[] {
  const insightsDir = getInsightsDir(groupFolder);
  
  if (!fs.existsSync(insightsDir)) {
    return [];
  }
  
  const files = fs.readdirSync(insightsDir)
    .filter((f: string) => f.endsWith('.md') && !f.startsWith('.'))
    .sort()
    .reverse();
  
  const allInsights: Insight[] = [];
  
  for (const file of files) {
    const month = file.replace('.md', '');
    const insights = getInsights(groupFolder, month);
    allInsights.push(...insights);
  }
  
  return allInsights;
}

/**
 * 搜索洞察（简单关键词匹配）
 */
export function searchInsights(groupFolder: string, query: string): Insight[] {
  const allInsights = getAllInsights(groupFolder);
  const lowerQuery = query.toLowerCase();
  
  return allInsights.filter((insight: Insight) => {
    const searchText = `${insight.content} ${insight.context || ''} ${insight.type}`.toLowerCase();
    return searchText.includes(lowerQuery);
  });
}

/**
 * 按类型获取洞察
 */
export function getInsightsByType(groupFolder: string, type: InsightType): Insight[] {
  const allInsights = getAllInsights(groupFolder);
  return allInsights.filter((insight: Insight) => insight.type === type);
}

/**
 * 按优先级获取洞察
 */
export function getInsightsByPriority(groupFolder: string, priority: Priority): Insight[] {
  const allInsights = getAllInsights(groupFolder);
  return allInsights.filter((insight: Insight) => insight.priority === priority);
}

/**
 * 获取最近的洞察
 */
export function getRecentInsights(groupFolder: string, limit: number = 10): Insight[] {
  const allInsights = getAllInsights(groupFolder);
  
  // 按时间戳排序
  return allInsights
    .sort((a: Insight, b: Insight) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}
