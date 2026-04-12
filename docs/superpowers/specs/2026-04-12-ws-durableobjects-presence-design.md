# WS + DurableObjects Presence 实时消息方案

**Date**: 2026-04-12
**Status**: Approved for Implementation

## 1. 架构概览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Browser (SolidJS)                                 │
│  ┌──────────────────┐     ┌──────────────────────┐                      │
│  │  FriendsService  │     │  WebSocket Client WS  │                      │
│  │  (Vinxi SSR /api) │     │  (直连 Worker /ws)    │                      │
│  └────────┬─────────┘     └──────────┬───────────┘                      │
│           │ fetch /api               │ 升级连接                           │
└───────────┼──────────────────────────┼──────────────────────────────────┘
            │                           │
    ┌───────▼────────────────┐  ┌──────▼──────────────────────────┐
    │   Vinxi SSR API routes  │  │   Cloudflare Worker            │
    │   /api/friends         │  │   (WS Server + DurableObjects) │
    │   /api/tickets         │  │                               │
    └────────────────────────┘  │  ┌─────────────────────────┐ │
                                 │  │  PresenceDO              │ │
                                 │  │  - user_id → devices[]    │ │
                                 │  │  - device_id → presence  │ │
                                 │  └─────────────────────────┘ │
                                 │  ┌─────────────────────────┐ │
                                 │  │  WS Handler              │ │
                                 │  │  - 握手认证 (Clerk JWT)   │ │
                                 │  │  - 广播设备状态           │ │
                                 │  └─────────────────────────┘ │
                                 └───────────────────────────────┘
```

## 2. DurableObjects 数据模型

### PresenceDO

```typescript
interface DeviceEntry {
  device_id: string;       // 设备唯一 ID
  name: string;            // "MacBook Pro", "iPhone" 等
  online: boolean;         // 在线状态
  last_seen: number;      // timestamp (ms)
  ws_client_id?: string;  // 当前 WS 连接 ID
}

interface PresenceState {
  user_id: string;         // 用户 ID (Clerk sub)
  devices: DeviceEntry[]; // 该用户的所有设备
  friends: string[];      // 好友 user_id 列表
}

// DurableObjects storage schema
// storage.put("state", PresenceState)
// storage.get("state") → PresenceState
```

### WS 消息类型

```typescript
// Client → Server
type ClientMessage =
  | { type: "register"; device_id: string; device_name: string }
  | { type: "unregister"; device_id: string }
  | { type: "ping" };

// Server → Client
type ServerMessage =
  | { type: "presence_update"; user_id: string; devices: DeviceEntry[] }
  | { type: "friend_online"; user_id: string; devices: DeviceEntry[] }
  | { type: "friend_offline"; user_id: string }
  | { type: "pong" }
  | { type: "error"; message: string };
```

## 3. 认证流程

```
Browser WS ──[Upgrade Request + Authorization: Bearer <Clerk JWT>]──► Worker
                                                                    │
                                                               auth.ts 验证 JWT
                                                                    │
                                                           通过 ──► 建立 WS 连接
                                                           拒绝 ──► 关闭连接 (401)
```

- JWT 验证使用 Clerk 的 verifyToken (使用 @clerk/backend)
- 提取 user_id (sub) 作为 PresenceDO 的 key
- WS 连接时记录 ws_client_id，离线时清除

## 4. Cloudflare Worker 结构

```
sendme-presence/                    # 新建 Worker 项目
├── wrangler.toml                   # DurableObjects session 配置
├── src/
│   ├── index.ts                   # Worker 入口，/ws 升级，HTTP 路由
│   ├── presence.do.ts             # DurableObjects PresenceDO 类
│   ├── ws-handler.ts              # WebSocket 握手、保活、广播逻辑
│   ├── auth.ts                    # Clerk JWT 验证
│   ├── router.ts                  # HTTP 路由 (/api/presence/*)
│   └── types.ts                   # 共享类型定义
└── package.json
```

## 5. API 设计

### HTTP API (Vinxi SSR → Worker)

```
GET    /api/presence/friends           → 获取所有好友的在线状态
GET    /api/presence/friends/:userId  → 获取特定好友的在线状态
POST   /api/presence/register         → 注册设备到当前用户
DELETE /api/presence/unregister        → 注销设备
```

### WebSocket 端点

```
WS  wss://<worker>.workers.dev/ws
    或 ws://localhost:8787/ws (本地开发)

查询参数:
  - token: Clerk JWT (握手前通过 URL 参数或 Header 传递)
```

## 6. 前端变更

```
app/src/lib/
  ws-client.ts      → 新增 WebSocket 客户端，订阅 presence 事件
  store.tsx         → 新增 wsConnected, friendPresence 状态
  friends.ts        → 集成 WS 推送更新 friendPresence
```

### WS 客户端接口

```typescript
interface WSClient {
  connect(token: string): Promise<void>;
  disconnect(): void;
  onFriendOnline(handler: (userId: string, devices: DeviceEntry[]) => void): () => void;
  onFriendOffline(handler: (userId: string) => void): () => void;
  onError(handler: (err: string) => void): () => void;
  isConnected(): boolean;
}
```

## 7. 实现步骤

1. 创建 Cloudflare Worker 项目结构
2. 实现 PresenceDO (DurableObjects 类)
3. 实现 Clerk JWT 验证
4. 实现 WS Handler (握手、保活、广播)
5. 实现 Worker 入口 (index.ts)
6. 实现前端 ws-client.ts
7. 集成到 store 和 FriendsService
8. 验证 build

## 8. 依赖

```json
// Worker package.json
{
  "dependencies": {
    "@clerk/backend": "^1.0.0",
    "hono": "^4.0.0"
  },
  "devDependencies": {
    "wrangler": "^3.0.0",
    "@cloudflare/workers-types": "^4.20240620.0"
  }
}
```

```toml
# wrangler.toml
main = "src/index.ts"
compatibility_date = "2024-04-15"

[[durable_objects.bindings]]
name = "PRESENCE"
class_name = "PresenceDO"
```
