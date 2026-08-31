/**
 * 更多页面 - 承载侧边栏放不下的模块入口
 * 采用卡片网格布局，分类清晰
 */
import { useNavigate } from 'react-router-dom';
import {
  Puzzle, Wand2, Fingerprint, Network, BookOpen,
  Terminal, Key, Wifi, FolderOpen, Database, Palette, Settings,
  User, Sparkles, Brain, Server,
  ChevronRight, Search, Blocks, Activity
} from 'lucide-react';
import { useState, useMemo } from 'react';

interface ModuleCard {
  id: string;
  icon: React.ElementType;
  label: string;
  description: string;
  path: string;
  category: string;
  color: string;
}

const allModules: ModuleCard[] = [
  // AI 核心
  { id: 'mbti', icon: Fingerprint, label: 'MBTI', description: '性格测试与分析', path: '/mbti', category: 'AI 核心', color: 'violet' },
  { id: 'memory-network', icon: Network, label: '记忆网络', description: '神经网络记忆可视化', path: '/memory-network', category: 'AI 核心', color: 'blue' },
  { id: 'learning', icon: BookOpen, label: '学习系统', description: 'AI 自主学习面板', path: '/learning', category: 'AI 核心', color: 'emerald' },
  { id: 'ai-life', icon: Sparkles, label: 'AI 一天', description: 'AI 日常活动时间线', path: '/ai-life', category: 'AI 核心', color: 'amber' },
  { id: 'emotion', icon: Activity, label: '情感系统', description: '多维情绪分析仪表盘', path: '/emotion', category: 'AI 核心', color: 'rose' },

  // 扩展能力
  { id: 'plugins', icon: Puzzle, label: '插件', description: 'MCP 插件管理', path: '/plugins', category: '扩展能力', color: 'indigo' },
  { id: 'skills', icon: Wand2, label: 'Skills', description: 'Agent 技能管理', path: '/skills', category: '扩展能力', color: 'purple' },
  { id: 'feature-module', icon: Blocks, label: '功能模块', description: '自定义功能与定时任务', path: '/feature-module', category: '扩展能力', color: 'cyan' },
  { id: 'integrations', icon: Wifi, label: '接入管理', description: 'QQ/微信智能体接入', path: '/integrations', category: '扩展能力', color: 'teal' },
  { id: 'mcp', icon: Server, label: 'MCP 工具', description: 'MCP 服务器接入与工具管理', path: '/mcp', category: '扩展能力', color: 'blue' },

  // 数据与管理
  { id: 'user-profile', icon: User, label: '我的信息', description: '用户个人资料', path: '/user-profile', category: '数据管理', color: 'orange' },
  { id: 'files', icon: FolderOpen, label: '文件管理', description: '项目文件浏览', path: '/files', category: '数据管理', color: 'slate' },
  { id: 'backups', icon: Database, label: '数据备份', description: '备份与恢复', path: '/backups', category: '数据管理', color: 'green' },
  { id: 'memory', icon: Brain, label: '记忆管理', description: '对话记忆条目', path: '/memory', category: '数据管理', color: 'sky' },

  // 系统设置
  { id: 'api-config', icon: Key, label: 'API 配置', description: 'AI 模型接入', path: '/api-config', category: '系统', color: 'yellow' },
  { id: 'appearance', icon: Palette, label: '外观', description: '主题与壁纸', path: '/appearance', category: '系统', color: 'pink' },
  { id: 'settings', icon: Settings, label: '全局设置', description: '系统偏好', path: '/settings', category: '系统', color: 'gray' },
  { id: 'logs', icon: Terminal, label: '调试日志', description: '系统运行日志', path: '/logs', category: '系统', color: 'red' },
];

const categoryOrder = ['AI 核心', '扩展能力', '数据管理', '系统'];

const colorMap: Record<string, { bg: string; text: string; iconBg: string }> = {
  violet: { bg: 'bg-slate-700/8', text: 'text-slate-700 dark:text-slate-500', iconBg: 'bg-slate-700/10' },
  blue:   { bg: 'bg-blue-500/8',   text: 'text-blue-600 dark:text-blue-400',   iconBg: 'bg-blue-500/10' },
  emerald:{ bg: 'bg-slate-700/8',text: 'text-slate-700 dark:text-slate-500', iconBg: 'bg-slate-700/10' },
  amber:  { bg: 'bg-amber-500/8',  text: 'text-amber-600 dark:text-amber-400',  iconBg: 'bg-amber-500/10' },
  rose:   { bg: 'bg-rose-500/8',   text: 'text-rose-600 dark:text-rose-400',   iconBg: 'bg-rose-500/10' },
  indigo: { bg: 'bg-indigo-500/8', text: 'text-indigo-600 dark:text-indigo-400', iconBg: 'bg-indigo-500/10' },
  purple: { bg: 'bg-slate-700/8', text: 'text-slate-700 dark:text-slate-500', iconBg: 'bg-slate-700/10' },
  cyan:   { bg: 'bg-cyan-500/8',   text: 'text-cyan-600 dark:text-cyan-400',   iconBg: 'bg-cyan-500/10' },
  teal:   { bg: 'bg-slate-700/8',   text: 'text-slate-700 dark:text-slate-500',   iconBg: 'bg-slate-700/10' },
  orange: { bg: 'bg-orange-500/8', text: 'text-orange-600 dark:text-orange-400', iconBg: 'bg-orange-500/10' },
  slate:  { bg: 'bg-slate-500/8',  text: 'text-slate-600 dark:text-slate-400', iconBg: 'bg-slate-500/10' },
  green:  { bg: 'bg-green-500/8',  text: 'text-green-600 dark:text-green-400',  iconBg: 'bg-green-500/10' },
  sky:    { bg: 'bg-sky-500/8',    text: 'text-sky-600 dark:text-sky-400',    iconBg: 'bg-sky-500/10' },
  yellow: { bg: 'bg-yellow-500/8', text: 'text-yellow-600 dark:text-yellow-400', iconBg: 'bg-yellow-500/10' },
  pink:   { bg: 'bg-pink-500/8',   text: 'text-pink-600 dark:text-pink-400',   iconBg: 'bg-pink-500/10' },
  gray:   { bg: 'bg-gray-500/8',   text: 'text-gray-600 dark:text-gray-400',   iconBg: 'bg-gray-500/10' },
  red:    { bg: 'bg-red-500/8',    text: 'text-red-600 dark:text-red-400',     iconBg: 'bg-red-500/10' },
};

export function MorePage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredModules = useMemo(() => {
    if (!searchQuery) return allModules;
    const q = searchQuery.toLowerCase();
    return allModules.filter(
      m => m.label.toLowerCase().includes(q) || m.description.toLowerCase().includes(q) || m.category.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const groupedModules = useMemo(() => {
    const groups: Record<string, ModuleCard[]> = {};
    for (const cat of categoryOrder) {
      const items = filteredModules.filter(m => m.category === cat);
      if (items.length > 0) groups[cat] = items;
    }
    return groups;
  }, [filteredModules]);

  return (
    <div className="h-full overflow-y-auto px-4 py-6 lg:px-8 lg:py-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">更多</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">所有功能模块与系统设置</p>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索模块..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm
              bg-black/[0.03] dark:bg-white/[0.04]
              border border-black/[0.04] dark:border-white/[0.06]
              focus:outline-none focus:border-slate-500/40 dark:focus:border-slate-500/30
              text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600
              transition-colors"
          />
        </div>

        {/* Module Groups */}
        {Object.entries(groupedModules).map(([category, modules]) => (
          <div key={category} className="mb-6">
            <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3 px-1">
              {category}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {modules.map((mod) => {
                const colors = colorMap[mod.color] || colorMap.gray;
                return (
                  <button
                    key={mod.id}
                    onClick={() => navigate(mod.path)}
                    className={`
                      group flex items-center gap-3 p-3 rounded-xl text-left
                      ${colors.bg}
                      hover:brightness-95 active:scale-[0.98]
                      transition-all duration-150
                    `}
                  >
                    <div className={`w-9 h-9 rounded-xl ${colors.iconBg} flex items-center justify-center flex-shrink-0`}>
                      <mod.icon size={18} className={colors.text} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${colors.text}`}>{mod.label}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{mod.description}</p>
                    </div>
                    <ChevronRight size={14} className="text-gray-300 dark:text-gray-600 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Empty state */}
        {filteredModules.length === 0 && (
          <div className="text-center py-16">
            <Search size={32} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
            <p className="text-sm text-gray-400 dark:text-gray-500">没有找到匹配的模块</p>
          </div>
        )}
      </div>
    </div>
  );
}
