# NanoClaw 三层记忆架构设计

> 设计日期：2026-03-08
> 状态：已确认，待实现

## 1. 背景与目标

### 1.1 问题

NanoClaw 当前使用单一 `CLAUDE.md` 文件管理记忆，存在以下问题：
- **Token 爆炸**：全量加载导致 Token 消耗随时间线性增长
- **响应延迟**：文件变大后加载时间增加
- **信息淹没**：重要信息被日志淹没，难以检索
- **无自动维护**：需要手动清理，缺乏归档机制

### 1.2 目标

参考 OpenClaw 社区的 L0/L1/L2 三层架构方案，为 NanoClaw 实现：
- Token 消耗降低 80%+
- 响应延迟降低至 <50ms
- 自动归档过期记忆
- 自动提炼模式和教训

## 2. 设计决策

| 决策点 | 选择 |
|--------|------|
| 改造范围 | 仅组级记忆，全局保持简单 |
| L2 存储 | 文件系统 + 简单搜索，不引入向量数据库 |
| 自动化触发 | Janitor 每天 / Compounding 每3天 + 监管机制 |
| Compounding 实现 | Claude Agent 智能提炼 |
| 优先级判断 | AI 自动判断 |
| 与现有架构 | 完全替换 CLAUDE.md |
| 记忆加载 | L0 自动注入 + L1/L2 通过 MCP 按需查询 |
| 显式"记住" | 直接写 L1 |
| 普通对话 | 全记录到 L2，靠 TTL 清理 |
| 数据迁移 | 自动迁移现有 CLAUDE.md |

## 3. 目录结构

```
groups/{group_name}/
├── memory/
│   ├── .abstract              # L0: 热索引（YAML）
│   │
│   ├── insights/              # L1: 洞察子系统
│   │   ├── .abstract          # 洞察索引
│   │   └── {YYYY-MM}.md       # 月度洞察报告
│   │
│   ├── lessons/               # L1: 教训子系统
│   │   ├── .abstract          # 教训索引
│   │   └── lessons.jsonl      # 结构化教训记录
│   │
│   ├── logs/                  # L2: 日志存储
│   │   ├── {YYYY-MM-DD}.md    # 每日日志
│   │   └── ...
│   │
│   └── archive/               # L2: 归档存储
│       └── archived_{date}.md # 过期归档
│
└── (不再有 CLAUDE.md)
```

全局记忆 `groups/global/CLAUDE.md` 保持不变。

## 4. 数据格式

### 4.1 L0 索引（.abstract）

```yaml
meta:
  last_updated: "2026-03-08T10:30:00"
  version: 1

stats:
  total_insights: 12
  total_lessons: 8
  active_logs: 3
  archived_logs: 15

recent:
  latest_insight: "2026-03"
  latest_lesson: "2026-03-07"
  today_log: "2026-03-08"

summary:
  - "用户是程序员，偏好简洁回复"
  - "用户周三常加班，注意关心情绪"
```

### 4.2 L1 洞察（insights/{YYYY-MM}.md）

```markdown
# 2026-03 月度洞察

## 长期特征 [P0]
- 用户是后端程序员，主要用 TypeScript

## 阶段模式 [P1]
- 用户最近在做 NanoClaw 项目改造（有效期至 2026-04-08）
```

### 4.3 L1 教训（lessons/lessons.jsonl）

```jsonl
{"ts":"2026-03-05","priority":"P0","type":"mistake","lesson":"用户不喜欢被频繁提醒"}
{"ts":"2026-03-07","priority":"P0","type":"success","lesson":"讨论技术方案时先问清需求"}
```

### 4.4 L2 日志（logs/{YYYY-MM-DD}.md）

```markdown
# 2026-03-08 对话日志

## 10:15 [P2]
用户: 这个项目是干嘛的
AI: 介绍了 NanoClaw 的核心功能...
```

## 5. 核心流程

### 5.1 记忆写入

```
用户消息 → 是否包含"记住"？
  ├─ 是 → Agent 判断优先级 → 写入 L1
  └─ 否 → 写入 L2 日志 (P2)
→ 更新 L0 索引
```

### 5.2 记忆读取

```
Agent 启动 → 加载 L0 索引注入 prompt
Agent 需要记忆 → 调用 mcp__memory__search
→ 系统搜索 L1/L2 返回相关内容
```

### 5.3 Janitor 清理（每日）

```
扫描 L2 logs/ → 检查 TTL
  - P0: 永不清理
  - P1: 30天后归档
  - P2: 7天后归档
→ 更新 L0 索引 → 记录监管日志
```

### 5.4 Compounding 提炼（每3天）

```
加载最近3天 L2 日志 → Claude Agent 分析
→ 生成洞察/教训 → 写入 L1
→ 更新 L0 索引 → 记录监管日志
```

## 6. 代码改动

### 6.1 修改现有文件

| 文件 | 改动 |
|------|------|
| `src/container-runner.ts` | 记忆加载改为 L0 索引 |
| `src/ipc.ts` | 新增记忆写入 IPC |
| `src/task-scheduler.ts` | 新增定时任务 |
| `src/db.ts` | 新增监管记录表 |
| `container/agent-runner/src/index.ts` | prompt 注入 |

### 6.2 新增文件

| 文件 | 职责 |
|------|------|
| `src/memory/index.ts` | 记忆系统入口 |
| `src/memory/l0-index.ts` | L0 索引管理 |
| `src/memory/l1-insights.ts` | L1 洞察管理 |
| `src/memory/l1-lessons.ts` | L1 教训管理 |
| `src/memory/l2-logs.ts` | L2 日志管理 |
| `src/memory/janitor.ts` | 清理逻辑 |
| `src/memory/compounding.ts` | 提炼逻辑 |
| `src/memory/migration.ts` | 迁移脚本 |
| `container/agent-runner/src/memory-mcp.ts` | MCP 工具 |

## 7. MCP 工具

```typescript
// memory_search - 搜索记忆
{ query: string, scope?: "all"|"insights"|"lessons"|"logs", limit?: number }

// memory_save - 保存到 L1
{ content: string, type: "insight"|"lesson", priority?: "P0"|"P1" }

// memory_stats - 获取统计
{}
```

## 8. 监管机制

```sql
CREATE TABLE memory_task_logs (
  id INTEGER PRIMARY KEY,
  task_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  details TEXT,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0
);
```

失败重试：最多 3 次，间隔 5 分钟。

## 9. 迁移方案

1. 读取现有 CLAUDE.md
2. Claude Agent 分类内容
3. 分别写入 L1/L2
4. 生成 L0 索引
5. 备份原文件为 CLAUDE.md.backup

## 10. 回滚方案

1. 停止服务
2. 恢复 CLAUDE.md.backup
3. 回滚代码
4. 重启服务
