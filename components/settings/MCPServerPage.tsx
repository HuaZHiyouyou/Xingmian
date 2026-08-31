/**
 * ============================================================
 * MCP 服务器管理页面（完全参考插件模块：ModulePageShell 体系）
 *   - 顶部统计卡片 + 添加入口（点击可切换展开/收起）
 *   - 服务器卡片与插件卡片同结构：渐变图标+状态点 · 右上 连/断+删除
 *     · 底部「配置详情」展开/收起（平滑动画，可反复切换）
 *   - 展开区直接内嵌编辑表单与工具列表
 * ============================================================
 */
import { useEffect, useState, useRef } from 'react';
import {
  Server, Wrench, Plus, Trash2, RefreshCcw, Play, PlugZap, Square, Package,
  Settings, ChevronDown,
} from 'lucide-react';
import {
  ModulePageShell, ModuleSection, ToolbarButton, ModuleEmptyState, ConfirmModal,
} from './ModulePageShell';
import { useMcpStore } from '../../store/mcpStore';
import { mcpCallTool, type McpServer, type McpTool } from '../../lib/tauriBridge';

/** 稳定的空数组引用：避免 zustand selector 每次返回新数组导致无限重渲染 */
const EMPTY_TOOLS: McpTool[] = [];

/* ─────────── 常量与工具 ─────────── */

function genId(): string {
  return `mcp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function emptyServer(): McpServer {
  return {
    id: genId(),
    name: '',
    transport: 'stdio',
    enabled: true,
    command: '',
    args: [],
    env: {},
    url: '',
    headers: {},
    description: '',
  };
}

/** 多行文本 ↔ 记录（key=value 格式） */
function parseLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const idx = t.indexOf('=');
    if (idx > 0) out[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
  }
  return out;
}

function mapToLines(map: Record<string, string>): string {
  return Object.entries(map || {}).map(([k, v]) => `${k}=${v}`).join('\n');
}

const inputCls = 'mt-1 w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-slate-700 hover:border-gray-300 dark:hover:border-gray-600 transition-all duration-200';
const labelCls = 'text-[11px] font-medium text-gray-500 dark:text-gray-400 tracking-wide';

/* ─────────── 自定义下拉框（原生 select 弹出层无法自定义圆角） ─────────── */

const TRANSPORT_OPTIONS = [
  { value: 'stdio', label: 'stdio（本地进程，如 npx/uvx 启动）' },
  { value: 'http', label: 'HTTP（远程 streamable HTTP 服务器）' },
];

function TransportSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const current = TRANSPORT_OPTIONS.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative mt-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 text-left flex items-center justify-between gap-2 focus:outline-none focus:ring-1 focus:ring-slate-700 hover:border-gray-300 dark:hover:border-gray-600 transition-all duration-200"
      >
        <span className="truncate">{current?.label || value}</span>
        <ChevronDown size={14} className={`shrink-0 text-gray-400 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden animate-[fadeUp_0.15s_ease-out]">
          {TRANSPORT_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors duration-150
                ${o.value === value
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/60'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────── 编辑表单 ─────────── */

function McpServerForm({
  draft, argsText, envText, headersText, busy, isConnected,
  onDraft, onArgs, onEnv, onHeaders, onSave, onConnect, onDisconnect, onDelete,
}: {
  draft: McpServer;
  argsText: string; envText: string; headersText: string;
  busy: boolean; isConnected: boolean;
  onDraft: (s: McpServer) => void;
  onArgs: (v: string) => void;
  onEnv: (v: string) => void;
  onHeaders: (v: string) => void;
  onSave: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className={labelCls}>名称</label>
        <input
          value={draft.name}
          onChange={(e) => onDraft({ ...draft, name: e.target.value })}
          placeholder="例如：filesystem"
          className={inputCls}
        />
      </div>
      <div>
        <label className={labelCls}>传输方式</label>
        <TransportSelect
          value={draft.transport}
          onChange={(v) => onDraft({ ...draft, transport: v })}
        />
      </div>

      {draft.transport === 'stdio' ? (
        <>
          <div>
            <label className={labelCls}>启动命令</label>
            <input
              value={draft.command}
              onChange={(e) => onDraft({ ...draft, command: e.target.value })}
              placeholder={'例如：npx 或 C:\\path\\to\\server.exe'}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>参数（每行一个）</label>
            <textarea
              value={argsText}
              onChange={(e) => onArgs(e.target.value)}
              rows={3}
              placeholder={'例如：\n-y\n@modelcontextprotocol/server-filesystem\nC:\\Users\\me\\Documents'}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>环境变量（每行 KEY=value）</label>
            <textarea
              value={envText}
              onChange={(e) => onEnv(e.target.value)}
              rows={2}
              className={inputCls}
            />
          </div>
        </>
      ) : (
        <>
          <div>
            <label className={labelCls}>服务器 URL</label>
            <input
              value={draft.url}
              onChange={(e) => onDraft({ ...draft, url: e.target.value })}
              placeholder="https://example.com/mcp"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>自定义请求头（每行 Key=value）</label>
            <textarea
              value={headersText}
              onChange={(e) => onHeaders(e.target.value)}
              rows={2}
              placeholder="Authorization=Bearer xxx"
              className={inputCls}
            />
          </div>
        </>
      )}

      <div>
        <label className={labelCls}>备注</label>
        <input
          value={draft.description}
          onChange={(e) => onDraft({ ...draft, description: e.target.value })}
          className={inputCls}
        />
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onSave}
          className="flex-1 py-2 rounded-lg bg-slate-700 text-white text-sm hover:bg-slate-600 transition-colors active:scale-[0.98]"
        >
          保存
        </button>
        <ToolbarButton
          onClick={isConnected ? onDisconnect : onConnect}
          icon={isConnected ? Square : PlugZap}
          label={isConnected ? '断开' : busy ? '连接中...' : '连接'}
          disabled={busy}
        />
        <ToolbarButton onClick={onDelete} icon={Trash2} label="删除" variant="danger" />
      </div>
    </div>
  );
}

/* ─────────── 服务器卡片（与插件卡片同结构） ─────────── */

function McpServerCard({
  server, staggerDelay, expanded, connected, onToggle, onConnectToggle, onDeleteRequest, children,
}: {
  server: McpServer; staggerDelay: string; expanded: boolean; connected: boolean;
  onToggle: () => void; onConnectToggle: () => void; onDeleteRequest: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`bg-white dark:bg-gray-900 rounded-2xl border p-4 transition-all duration-200
        animate-[scaleIn_0.25s_ease-out_both] hover:shadow-md hover:-translate-y-0.5
        ${expanded
          ? 'border-slate-300 dark:border-slate-900 shadow-lg'
          : 'border-gray-100 dark:border-gray-800 hover:border-slate-300 dark:hover:border-slate-900'}
      `}
      style={{ animationDelay: staggerDelay } as React.CSSProperties}
    >
      <div className="flex items-start gap-3">
        {/* 渐变图标 + 状态点（与插件卡片一致） */}
        <div className="relative shrink-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-700 to-indigo-500 flex items-center justify-center shadow-sm transition-transform duration-200 hover:scale-110">
            <Wrench className="w-5 h-5 text-white" />
          </div>
          <div
            className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-gray-900
              ${connected ? 'bg-green-500' : server.enabled ? 'bg-amber-400' : 'bg-gray-300 dark:bg-gray-600'}`}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-sm font-medium ${server.enabled ? 'text-gray-800 dark:text-gray-100' : 'text-gray-400'}`}>
              {server.name || '未命名'}
            </span>
            <span className="rounded-full bg-gradient-to-r from-slate-700 to-indigo-500 text-white text-[9px] px-1.5 py-0.5">
              {server.transport === 'http' ? 'HTTP' : 'stdio'}
            </span>
            <span
              className={`rounded-full text-[9px] px-1.5 py-0.5 border
                ${connected
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800'
                  : server.enabled
                    ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-400 border-gray-200 dark:border-gray-700'}`}
            >
              {connected ? '已连接' : server.enabled ? '未连接' : '已停用'}
            </span>
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">
            {server.transport === 'http' ? server.url : `${server.command} ${(server.args || []).join(' ')}`}
            {server.description ? ` · ${server.description}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <ToolbarButton
            onClick={onConnectToggle}
            icon={connected ? Square : PlugZap}
            label={connected ? '断' : '连'}
          />
          <ToolbarButton variant="danger" onClick={onDeleteRequest} icon={Trash2} label="删除" />
        </div>
      </div>

      {/* 配置详情 toggle（与插件模块一致，点击展开/收起） */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1 mt-2.5 text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors duration-150"
      >
        <Settings size={10} />
        <span>配置详情</span>
        <ChevronDown size={10} className={`ml-auto transition-transform duration-300 ease-out ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* 平滑展开动画 — grid 高度过渡 */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
}

/* ─────────── 工具列表（连接后展示） ─────────── */

function ToolList({ serverId }: { serverId: string }) {
  const serverTools = useMcpStore((s) => s.tools[serverId] ?? EMPTY_TOOLS);
  const loadTools = useMcpStore((s) => s.loadTools);
  const [testTool, setTestTool] = useState<{ toolName: string; argsJson: string; result: string; error: string } | null>(null);

  const handleRunTool = async (toolName: string) => {
    const argsJson = testTool?.argsJson || '{}';
    setTestTool({ toolName, argsJson, result: '', error: '' });
    try {
      const result = await mcpCallTool(serverId, toolName, argsJson);
      setTestTool((t) => t && { ...t, result });
    } catch (e) {
      setTestTool((t) => t && { ...t, error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 tracking-wide">
          工具列表（{serverTools.length}）
        </span>
        <button
          onClick={() => loadTools(serverId)}
          className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-slate-700 transition-colors"
        >
          <RefreshCcw size={10} /> 刷新
        </button>
      </div>
      {serverTools.length === 0 ? (
        <p className="text-[11px] text-gray-400 py-1">暂无工具——请先连接服务器</p>
      ) : (
        <div className="space-y-1.5">
          {serverTools.map((tool) => (
            <div key={tool.name} className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/60">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
                    {tool.name}
                    {tool.llmName && tool.llmName !== tool.name && (
                      <span className="ml-1.5 text-[10px] text-gray-400 font-normal">{tool.llmName}</span>
                    )}
                  </div>
                  {tool.description && (
                    <div className="text-[10px] text-gray-400 line-clamp-2">{tool.description}</div>
                  )}
                </div>
                <ToolbarButton
                  onClick={() => setTestTool({ toolName: tool.name, argsJson: '{}', result: '', error: '' })}
                  icon={Play}
                  label="测试"
                />
              </div>
              {testTool?.toolName === tool.name && (
                <div className="mt-2 space-y-1.5">
                  <textarea
                    value={testTool.argsJson}
                    onChange={(e) => setTestTool({ ...testTool, argsJson: e.target.value })}
                    rows={2}
                    placeholder='{"path": "..."}'
                    className="w-full px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-[11px] font-mono text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-slate-700"
                  />
                  <button
                    onClick={() => handleRunTool(tool.name)}
                    className="px-2 py-1 rounded bg-slate-700 text-white text-[11px] hover:bg-slate-600 transition-colors"
                  >
                    执行
                  </button>
                  {testTool.result && (
                    <pre className="p-2 rounded bg-gray-100 dark:bg-gray-900 text-[10px] text-gray-700 dark:text-gray-300 whitespace-pre-wrap max-h-40 overflow-y-auto">{testTool.result}</pre>
                  )}
                  {testTool.error && <div className="text-[10px] text-red-500">{testTool.error}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────── Main ─────────── */

export function MCPServerPage() {
  const {
    servers, connected, tools, loading, lastError,
    loadServers, addServer, updateServer, removeServer,
    connect, disconnect,
  } = useMcpStore();

  const [draft, setDraft] = useState<McpServer | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [argsText, setArgsText] = useState('');
  const [envText, setEnvText] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<McpServer | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  const fillDraft = (server: McpServer) => {
    setDraft({ ...server });
    setArgsText((server.args || []).join('\n'));
    setEnvText(mapToLines(server.env || {}));
    setHeadersText(mapToLines(server.headers || {}));
  };

  const cancelPendingClose = () => {
    if (closeTimer.current !== undefined) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    }
  };

  /** 收起：先播放收起动画，动画结束后再清空草稿（保证内容在动画期间保持挂载） */
  const collapse = () => {
    cancelPendingClose();
    setOpenId(null);
    closeTimer.current = window.setTimeout(() => {
      setDraft(null);
      setArgsText('');
      setEnvText('');
      setHeadersText('');
      closeTimer.current = undefined;
    }, 320);
  };

  /** 卡片「配置详情」点击：展开 / 收起 切换 */
  const toggleEdit = (server: McpServer) => {
    if (openId === server.id) {
      collapse();
    } else {
      cancelPendingClose();
      fillDraft(server);
      setOpenId(server.id);
    }
  };

  const addOpen = !!draft && isNewDraft(draft, servers) && openId === draft.id;

  /** 「添加服务器」点击：切换新建表单展开/收起 */
  const toggleAdd = () => {
    if (addOpen) {
      collapse();
      return;
    }
    cancelPendingClose();
    const s = emptyServer();
    fillDraft(s);
    setOpenId(s.id);
  };

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      useMcpStore.setState({ lastError: '请填写服务器名称' });
      return;
    }
    const server: McpServer = {
      ...draft,
      args: argsText.split('\n').map((s) => s.trim()).filter(Boolean),
      env: parseLines(envText),
      headers: parseLines(headersText),
    };
    const isNew = !servers.some((x) => x.id === server.id);
    const ok = isNew ? await addServer(server) : await updateServer(server);
    if (ok) collapse();
  };

  const handleConnect = async (id: string) => {
    setBusyId(id);
    try {
      await connect(id);
    } finally {
      setBusyId(null);
    }
  };

  const connectedCount = servers.filter((s) => connected[s.id]).length;
  const toolCount = Object.values(tools).reduce((n, list) => n + list.length, 0);

  return (
    <ModulePageShell
      title="MCP 工具"
      subtitle="连接 MCP 服务器（stdio / HTTP），工具自动注入 LLM 调用"
      icon={Package}
      stats={[
        { label: '服务器', value: servers.length, color: 'text-slate-700', delay: '0.1s' },
        { label: '已连接', value: connectedCount, color: connectedCount > 0 ? 'text-green-600' : 'text-gray-400', delay: '0.15s' },
        { label: '工具数', value: toolCount, color: 'text-slate-700', delay: '0.2s' },
      ]}
      headerAction={
        <button
          onClick={toggleAdd}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs transition-all duration-200 active:scale-95
            ${addOpen
              ? 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
              : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/20'}`}
        >
          {addOpen ? <Square size={12} /> : <Plus size={12} />}
          {addOpen ? '收起表单' : '添加服务器'}
        </button>
      }
    >
      {lastError && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-xs text-red-600 dark:text-red-400">
          {lastError}
        </div>
      )}

      {/* 新建表单卡片：grid 高度过渡展开/收起 */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: addOpen ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          {draft && isNewDraft(draft, servers) && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-slate-300 dark:border-slate-900 shadow-lg p-4 mt-1 mb-1">
              <McpServerForm
                draft={draft}
                argsText={argsText} envText={envText} headersText={headersText}
                busy={busyId === draft.id} isConnected={false}
                onDraft={setDraft} onArgs={setArgsText} onEnv={setEnvText} onHeaders={setHeadersText}
                onSave={handleSave}
                onConnect={() => handleConnect(draft.id)}
                onDisconnect={() => disconnect(draft.id)}
                onDelete={async () => { await removeServer(draft.id); collapse(); }}
              />
            </div>
          )}
        </div>
      </div>

      {/* 服务器列表 */}
      {loading ? (
        <div className="text-center py-10 text-gray-400 text-sm">加载中...</div>
      ) : servers.length === 0 && !addOpen ? (
        <ModuleEmptyState icon={Server} label="暂无 MCP 服务器——点击右上角「添加服务器」开始" />
      ) : (
        <div className="space-y-3">
          {servers.map((server, i) => {
            const isConnected = !!connected[server.id];
            const expanded = openId === server.id;
            return (
              <McpServerCard
                key={server.id}
                server={server}
                staggerDelay={`${i * 0.05}s`}
                expanded={expanded}
                connected={isConnected}
                onToggle={() => toggleEdit(server)}
                onConnectToggle={() => (isConnected ? disconnect(server.id) : handleConnect(server.id))}
                onDeleteRequest={() => setDeleteTarget(server)}
              >
                {draft?.id === server.id && (
                  <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 space-y-3">
                    <McpServerForm
                      draft={draft}
                      argsText={argsText} envText={envText} headersText={headersText}
                      busy={busyId === server.id} isConnected={isConnected}
                      onDraft={setDraft} onArgs={setArgsText} onEnv={setEnvText} onHeaders={setHeadersText}
                      onSave={handleSave}
                      onConnect={() => handleConnect(server.id)}
                      onDisconnect={() => disconnect(server.id)}
                      onDelete={() => setDeleteTarget(server)}
                    />
                    {(isConnected || (tools[server.id] || []).length > 0) && (
                      <div className="pt-1">
                        <ToolList serverId={server.id} />
                      </div>
                    )}
                  </div>
                )}
              </McpServerCard>
            );
          })}
        </div>
      )}

      {/* 使用说明 */}
      <ModuleSection title="使用说明" icon={Wrench} defaultOpen={false} animateDelay="0.3s">
        <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed space-y-1.5">
          <p>· 已启用的服务器会在应用启动时自动连接</p>
          <p>· 连接成功后其工具会以 function calling 形式注入主聊天与各类 LLM 调用，模型按需自主调用（最多 5 轮）</p>
          <p>· stdio 示例：<code className="mx-1 px-1 rounded bg-gray-100 dark:bg-gray-800">npx -y @modelcontextprotocol/server-filesystem C:\path</code></p>
          <p>· HTTP 示例：填入远程 streamable HTTP 端点（如 <code className="px-1 rounded bg-gray-100 dark:bg-gray-800">https://example.com/mcp</code>），需要鉴权时在请求头中加 Authorization</p>
        </div>
      </ModuleSection>

      {/* 删除确认 */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) { removeServer(deleteTarget.id); if (draft?.id === deleteTarget.id) collapse(); } }}
        title="删除此 MCP 服务器？"
        description={`确定要删除「${deleteTarget?.name || ''}」？删除后需重新添加。`}
        icon={Trash2}
        confirmLabel="删除"
      />
    </ModulePageShell>
  );
}

/** 草稿是否为新建（不在已保存列表中） */
function isNewDraft(draft: McpServer, servers: McpServer[]): boolean {
  return !servers.some((x) => x.id === draft.id);
}
