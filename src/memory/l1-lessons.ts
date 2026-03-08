/**
 * L1 Lessons Management
 * 教训层：失误、成功经验和模式识别
 */

import fs from 'fs';
import path from 'path';

import { logger } from '../logger.js';
import { getMemoryDir, updateL0Stats } from './l0-index.js';
import {
  L1_LESSONS_DIR,
  L1_LESSONS_FILE,
} from './constants.js';
import type { Lesson, LessonType, Priority } from './types.js';

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `les_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 获取教训目录路径
 */
function getLessonsDir(groupFolder: string): string {
  return path.join(getMemoryDir(groupFolder), L1_LESSONS_DIR);
}

/**
 * 获取教训文件路径
 */
function getLessonsFile(groupFolder: string): string {
  return path.join(getLessonsDir(groupFolder), L1_LESSONS_FILE);
}

/**
 * 保存教训（追加到 JSONL 文件）
 */
export function saveLesson(groupFolder: string, lesson: Omit<Lesson, 'id' | 'timestamp'>): Lesson {
  const fullLesson: Lesson = {
    ...lesson,
    id: generateId(),
    timestamp: new Date().toISOString(),
  };
  
  const lessonsDir = getLessonsDir(groupFolder);
  
  // 确保目录存在
  if (!fs.existsSync(lessonsDir)) {
    fs.mkdirSync(lessonsDir, { recursive: true });
  }
  
  const filePath = getLessonsFile(groupFolder);
  const jsonLine = JSON.stringify(fullLesson) + '\n';
  
  // 追加到文件
  fs.appendFileSync(filePath, jsonLine, 'utf-8');
  
  // 更新 L0 统计
  updateL0Stats(groupFolder);
  
  logger.debug({ groupFolder, lessonId: fullLesson.id }, 'Lesson saved');
  
  return fullLesson;
}

/**
 * 读取所有教训
 */
export function getLessons(groupFolder: string): Lesson[] {
  const filePath = getLessonsFile(groupFolder);
  
  if (!fs.existsSync(filePath)) {
    return [];
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter((l: string) => l.trim());
    
    const lessons: Lesson[] = [];
    for (const line of lines) {
      try {
        const lesson = JSON.parse(line) as Lesson;
        lessons.push(lesson);
      } catch {
        // 忽略解析错误的行
      }
    }
    
    return lessons;
  } catch (err) {
    logger.error({ err, groupFolder }, 'Failed to read lessons');
    return [];
  }
}

/**
 * 搜索教训（简单关键词匹配）
 */
export function searchLessons(groupFolder: string, query: string): Lesson[] {
  const allLessons = getLessons(groupFolder);
  const lowerQuery = query.toLowerCase();
  
  return allLessons.filter((lesson: Lesson) => {
    const searchText = `${lesson.lesson} ${lesson.context || ''} ${lesson.type}`.toLowerCase();
    return searchText.includes(lowerQuery);
  });
}

/**
 * 按类型获取教训
 */
export function getLessonsByType(groupFolder: string, type: LessonType): Lesson[] {
  const allLessons = getLessons(groupFolder);
  return allLessons.filter((lesson: Lesson) => lesson.type === type);
}

/**
 * 按优先级获取教训
 */
export function getLessonsByPriority(groupFolder: string, priority: Priority): Lesson[] {
  const allLessons = getLessons(groupFolder);
  return allLessons.filter((lesson: Lesson) => lesson.priority === priority);
}

/**
 * 获取最近的教训
 */
export function getRecentLessons(groupFolder: string, limit: number = 10): Lesson[] {
  const allLessons = getLessons(groupFolder);
  
  // 按时间戳排序
  return allLessons
    .sort((a: Lesson, b: Lesson) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

/**
 * 删除指定教训（重写文件）
 */
export function deleteLesson(groupFolder: string, lessonId: string): boolean {
  const allLessons = getLessons(groupFolder);
  const filtered = allLessons.filter((lesson: Lesson) => lesson.id !== lessonId);
  
  if (filtered.length === allLessons.length) {
    return false; // 没有找到要删除的教训
  }
  
  const filePath = getLessonsFile(groupFolder);
  
  if (filtered.length === 0) {
    // 如果全部删除，清空文件
    fs.writeFileSync(filePath, '', 'utf-8');
  } else {
    // 重写文件
    const content = filtered.map((lesson: Lesson) => JSON.stringify(lesson)).join('\n') + '\n';
    fs.writeFileSync(filePath, content, 'utf-8');
  }
  
  // 更新 L0 统计
  updateL0Stats(groupFolder);
  
  logger.debug({ groupFolder, lessonId }, 'Lesson deleted');
  
  return true;
}

/**
 * 批量保存教训
 */
export function saveLessons(groupFolder: string, lessons: Omit<Lesson, 'id' | 'timestamp'>[]): Lesson[] {
  const savedLessons: Lesson[] = [];
  
  for (const lesson of lessons) {
    const saved = saveLesson(groupFolder, lesson);
    savedLessons.push(saved);
  }
  
  return savedLessons;
}

/**
 * 统计教训数量
 */
export function getLessonsCount(groupFolder: string): number {
  return getLessons(groupFolder).length;
}

/**
 * 获取教训统计信息
 */
export function getLessonsStats(groupFolder: string): {
  total: number;
  by_type: Record<LessonType, number>;
  by_priority: Record<Priority, number>;
} {
  const allLessons = getLessons(groupFolder);
  
  const byType: Record<LessonType, number> = {
    mistake: 0,
    success: 0,
    pattern: 0,
  };
  
  const byPriority: Record<Priority, number> = {
    P0: 0,
    P1: 0,
    P2: 0,
  };
  
  for (const lesson of allLessons) {
    byType[lesson.type]++;
    byPriority[lesson.priority]++;
  }
  
  return {
    total: allLessons.length,
    by_type: byType,
    by_priority: byPriority,
  };
}
