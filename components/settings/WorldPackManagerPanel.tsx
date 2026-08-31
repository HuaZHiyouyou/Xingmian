/**
 * 世界设定包管理面板
 * - 浏览所有已注册的世界设定包
 * - 查看包内角色列表与详情
 * - 删除非内置/自定义的世界设定包
 */
import { useState, useEffect, useCallback } from "react";
import {
  dbGetWorldConfigs,
  dbDeleteWorldConfig,
  WorldConfigRecord,
} from "../../lib/tauriBridge";
import { useDebugLog } from "../../store/debugLogStore";

interface PackStats {
  charCount: number;
  hasNick: boolean;
  hasRel: boolean;
  hasAff: boolean;
  hasDeeds: boolean;
}

export function WorldPackManagerPanel() {
  const [packs, setPacks] = useState<WorldConfigRecord[]>([]);
  const [selected, setSelected] = useState<WorldConfigRecord | null>(null);
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const addLog = useDebugLog((s) => s.add);

  const load = useCallback(async () => {
    try {
      const all = await dbGetWorldConfigs();
      setPacks(all.sort((a, b) => a.name.localeCompare(b.name, "zh")));
    } catch (e) {
      useDebugLog.getState().add("system", `[世界包管理] 加载失败: ${e}`);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = packs.filter(
    (p) =>
      !search.trim() ||
      p.name.includes(search) ||
      p.worldType.includes(search) ||
      p.config.source?.includes(search)
  );

  const stats = (p: WorldConfigRecord): PackStats => {
    const chars = p.config.characters || [];
    return {
      charCount: chars.length,
      hasNick: chars.every((c) => c.nickname),
      hasRel: chars.every((c) => c.relation),
      hasAff: chars.every((c) => c.affiliation),
      hasDeeds: chars.every((c) => c.deeds),
    };
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(`确定删除此世界设定包？\nID: ${id}\n\n删除后不可恢复！`)) return;
    try {
      await dbDeleteWorldConfig(id);
      addLog("system", `[世界包管理] 已删除: ${id}`);
      if (selected?.id === id) setSelected(null);
      await load();
    } catch (e) {
      addLog("system", `[世界包管理] 删除失败: ${e}`);
    }
    setConfirmDelete(null);
  };

  const exportPack = (p: WorldConfigRecord) => {
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${p.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-3 p-4 max-h-[80vh] overflow-y-auto">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-bold text-gray-800 dark:text-gray-100">🌍 世界设定包管理</h2>
        <span className="text-xs text-gray-400">{filtered.length} / {packs.length} 包</span>
        <button onClick={load} className="ml-auto text-xs px-2 py-1 rounded bg-blue-500 text-white hover:bg-blue-600">
          🔄 刷新
        </button>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="搜索包名、类型或来源…"
        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
      />

      {/* 包列表 */}
      <div className="space-y-1.5">
        {filtered.map((p) => {
          const s = stats(p);
          const isSel = selected?.id === p.id;
          return (
            <div
              key={p.id}
              className={`rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                isSel
                  ? "border-violet-400 bg-violet-50 dark:bg-violet-900/20"
                  : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
              }`}
              onClick={() => setSelected(isSel ? null : p)}
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium truncate">{p.name}</span>
                    {p.isBuiltin && (
                      <span className="text-[10px] px-1 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                        内置
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-400">
                    <span>{s.charCount} 角色</span>
                    <span>·</span>
                    <span>{p.worldType}</span>
                    {!s.hasNick && <span className="text-orange-400">缺外号</span>}
                    {!s.hasRel && <span className="text-orange-400">缺关系</span>}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(p.id); }}
                  title={p.isBuiltin ? "删除（退役内置包永久移除；仍在用的内置包重启后会自动重播）" : "删除"}
                  className="shrink-0 ml-2 text-xs px-2 py-1 rounded transition-colors text-red-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                >
                  🗑
                </button>
              </div>

              {/* 确认删除 */}
              {confirmDelete === p.id && (
                <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 rounded text-xs">
                  <p>确定要删除「{p.name}」吗？</p>
                  <div className="flex gap-2 mt-1.5">
                    <button onClick={() => handleDelete(p.id)} className="px-2 py-0.5 bg-red-500 text-white rounded text-[10px]">
                      确认删除
                    </button>
                    <button onClick={() => setConfirmDelete(null)} className="px-2 py-0.5 bg-gray-300 rounded text-[10px]">
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 详情面板 */}
      {selected && (
        <div className="border border-violet-200 dark:border-violet-800 rounded-xl p-4 bg-white dark:bg-gray-800/60 shadow-sm space-y-3 overflow-y-auto max-h-[60vh]">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-bold text-violet-700 dark:text-violet-300">{selected.name}</h3>
              <p className="text-xs text-gray-500">{selected.config.source}</p>
            </div>
            <button
              onClick={() => exportPack(selected)}
              className="text-xs px-2 py-1 rounded bg-green-500 text-white hover:bg-green-600"
            >
              📤 导出 JSON
            </button>
          </div>

          {selected.config.description && (
            <p className="text-xs text-gray-500">{selected.config.description}</p>
          )}

          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
            <span>📅 统计: {selected.config.statsAsOf || "未标注"}</span>
            <span>🏷 版本: {selected.config.gameVersion || "未标注"}</span>
            <span>👥 角色: {(selected.config.characters || []).length}</span>
            <span>📍 地点: {(selected.config.locations || []).length}</span>
          </div>

          {/* 角色列表 */}
          <details open>
            <summary className="cursor-pointer text-xs font-bold text-violet-600">
              角色列表 ({(selected.config.characters || []).length})
            </summary>
            <div className="mt-2 space-y-1.5 max-h-[40vh] overflow-y-auto">
              {(selected.config.characters || []).map((c, i) => (
                <div key={i} className="px-2 py-1.5 rounded bg-gray-50 dark:bg-gray-700/40 text-xs space-y-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold">{c.name}</span>
                    {c.rarity && <span className="text-[9px] px-1 rounded bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">{c.rarity}</span>}
                    {c.nickname && <span className="text-[9px] text-gray-400">「{c.nickname}」</span>}
                  </div>
                  {c.affiliation && <p className="text-[10px] text-gray-400">📍 {c.affiliation}</p>}
                  {c.role && <p className="text-[10px] text-gray-400">🎭 {c.role}</p>}
                  {c.deeds && <p className="text-[10px] text-gray-400">⭐ {c.deeds}</p>}
                  {c.relation && <p className="text-[10px] text-violet-400">🔗 {c.relation}</p>}
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
