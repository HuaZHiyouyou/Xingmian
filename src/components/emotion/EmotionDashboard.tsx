import { useMemo, useState, useEffect } from 'react';
import { useChatStore } from '../../store/chatStore';
import { useCharacterStore } from '../../store/characterStore';
import { useCharacterMindStore } from '../../store/characterMindStore';
import { emotionColors } from '../../utils/constants';
import { EmotionType } from '../../types';
import { ArrowLeft, Clock, TrendingUp, Activity } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ParticleHeart } from './ParticleHeart';
import { DateTimeline, getTodayStr } from '../common/DateTimeline';
import { getAffinityStage, calcDecay } from '../../services/aiService';

const emotionLabels: Record<EmotionType, string> = {
  joy: '喜悦', sadness: '悲伤', anger: '愤怒', fear: '恐惧',
  surprise: '惊讶', love: '爱意', neutral: '平静', shy: '害羞',
  lonely: '孤独', grateful: '感激', brave: '勇敢', curiosity: '好奇',
  excitement: '兴奋', pride: '骄傲', disappointment: '失落', confusion: '困惑',
  contentment: '满足', nostalgia: '怀念', jealousy: '嫉妒', hope: '希望',
  relief: '释然', regret: '后悔', admiration: '钦佩',
  anxious: '焦虑', embarrassed: '尴尬', tender: '温柔',
  disgusted: '厌恶', jealous: '嫉妒', confused: '困惑',
  nostalgic: '怀念', proud: '自豪', surprised: '惊讶',
};

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

type SpecialEffect = 'none' | 'ringExpand' | 'dimGlow' | 'flash' | 'flicker' | 'shrink';

interface EmotionBehavior {
  hue: number;
  satMul: number;
  particleSpeed: number;
  particleCount: number;
  glowLayers: number;
  glowOpacity: number;
  breatheSpeed: number;
  specialEffect: SpecialEffect;
  orbitRadiusMul: number;
}

const emotionBehaviorMap: Record<string, EmotionBehavior> = {
  neutral:        { hue: 180, satMul: 0.55, particleSpeed: 12, particleCount: 7, glowLayers: 2, glowOpacity: 0.45, breatheSpeed: 4.5, specialEffect: 'none', orbitRadiusMul: 1 },
  contentment:    { hue: 160, satMul: 0.6,  particleSpeed: 14, particleCount: 6, glowLayers: 2, glowOpacity: 0.4,  breatheSpeed: 5,   specialEffect: 'dimGlow', orbitRadiusMul: 1 },
  relief:         { hue: 150, satMul: 0.6,  particleSpeed: 14, particleCount: 6, glowLayers: 2, glowOpacity: 0.4,  breatheSpeed: 5,   specialEffect: 'dimGlow', orbitRadiusMul: 1 },
  grateful:       { hue: 140, satMul: 0.65, particleSpeed: 11, particleCount: 7, glowLayers: 2, glowOpacity: 0.4,  breatheSpeed: 4.5, specialEffect: 'none', orbitRadiusMul: 1 },
  hope:           { hue: 130, satMul: 0.65, particleSpeed: 10, particleCount: 8, glowLayers: 3, glowOpacity: 0.45, breatheSpeed: 4,   specialEffect: 'ringExpand', orbitRadiusMul: 1 },
  joy:            { hue: 45,  satMul: 0.85, particleSpeed: 7,  particleCount: 10,glowLayers: 3, glowOpacity: 0.55, breatheSpeed: 3.5, specialEffect: 'ringExpand', orbitRadiusMul: 1.05 },
  excitement:     { hue: 25,  satMul: 0.9,  particleSpeed: 6,  particleCount: 12,glowLayers: 3, glowOpacity: 0.6,  breatheSpeed: 3,   specialEffect: 'ringExpand', orbitRadiusMul: 1.1 },
  pride:          { hue: 340, satMul: 0.7,  particleSpeed: 10, particleCount: 8, glowLayers: 2, glowOpacity: 0.45, breatheSpeed: 4,   specialEffect: 'none', orbitRadiusMul: 1 },
  proud:          { hue: 340, satMul: 0.7,  particleSpeed: 10, particleCount: 8, glowLayers: 2, glowOpacity: 0.45, breatheSpeed: 4,   specialEffect: 'none', orbitRadiusMul: 1 },
  love:           { hue: 320, satMul: 0.75, particleSpeed: 11, particleCount: 8, glowLayers: 3, glowOpacity: 0.5,  breatheSpeed: 5,   specialEffect: 'none', orbitRadiusMul: 1 },
  tender:         { hue: 320, satMul: 0.6,  particleSpeed: 13, particleCount: 6, glowLayers: 2, glowOpacity: 0.35, breatheSpeed: 5.5, specialEffect: 'dimGlow', orbitRadiusMul: 0.9 },
  admiration:     { hue: 300, satMul: 0.7,  particleSpeed: 11, particleCount: 7, glowLayers: 2, glowOpacity: 0.45, breatheSpeed: 4.5, specialEffect: 'none', orbitRadiusMul: 1 },
  surprise:       { hue: 270, satMul: 0.7,  particleSpeed: 8,  particleCount: 8, glowLayers: 2, glowOpacity: 0.45, breatheSpeed: 3.5, specialEffect: 'flicker', orbitRadiusMul: 1 },
  surprised:      { hue: 270, satMul: 0.7,  particleSpeed: 8,  particleCount: 8, glowLayers: 2, glowOpacity: 0.45, breatheSpeed: 3.5, specialEffect: 'flicker', orbitRadiusMul: 1 },
  confusion:      { hue: 250, satMul: 0.6,  particleSpeed: 10, particleCount: 7, glowLayers: 2, glowOpacity: 0.35, breatheSpeed: 4,   specialEffect: 'flicker', orbitRadiusMul: 1 },
  confused:       { hue: 250, satMul: 0.6,  particleSpeed: 10, particleCount: 7, glowLayers: 2, glowOpacity: 0.35, breatheSpeed: 4,   specialEffect: 'flicker', orbitRadiusMul: 1 },
  shy:            { hue: 330, satMul: 0.5,  particleSpeed: 13, particleCount: 5, glowLayers: 2, glowOpacity: 0.3,  breatheSpeed: 5,   specialEffect: 'shrink', orbitRadiusMul: 0.85 },
  embarrassed:    { hue: 330, satMul: 0.55, particleSpeed: 12, particleCount: 6, glowLayers: 2, glowOpacity: 0.3,  breatheSpeed: 4.5, specialEffect: 'shrink', orbitRadiusMul: 0.85 },
  nostalgia:      { hue: 210, satMul: 0.5,  particleSpeed: 16, particleCount: 6, glowLayers: 2, glowOpacity: 0.25, breatheSpeed: 6,   specialEffect: 'dimGlow', orbitRadiusMul: 0.95 },
  nostalgic:      { hue: 210, satMul: 0.5,  particleSpeed: 16, particleCount: 6, glowLayers: 2, glowOpacity: 0.25, breatheSpeed: 6,   specialEffect: 'dimGlow', orbitRadiusMul: 0.95 },
  curiosity:      { hue: 170, satMul: 0.65, particleSpeed: 10, particleCount: 7, glowLayers: 2, glowOpacity: 0.4,  breatheSpeed: 4,   specialEffect: 'none', orbitRadiusMul: 1 },
  sadness:        { hue: 215, satMul: 0.6,  particleSpeed: 18, particleCount: 5, glowLayers: 2, glowOpacity: 0.2,  breatheSpeed: 6.5, specialEffect: 'dimGlow', orbitRadiusMul: 0.9 },
  lonely:         { hue: 225, satMul: 0.55, particleSpeed: 20, particleCount: 5, glowLayers: 2, glowOpacity: 0.18, breatheSpeed: 7,   specialEffect: 'dimGlow', orbitRadiusMul: 0.85 },
  fear:           { hue: 260, satMul: 0.7,  particleSpeed: 8,  particleCount: 8, glowLayers: 2, glowOpacity: 0.4,  breatheSpeed: 3.5, specialEffect: 'flicker', orbitRadiusMul: 1 },
  anxious:        { hue: 260, satMul: 0.65, particleSpeed: 7,  particleCount: 9, glowLayers: 2, glowOpacity: 0.4,  breatheSpeed: 3,   specialEffect: 'flicker', orbitRadiusMul: 1.05 },
  anger:          { hue: 5,   satMul: 0.85, particleSpeed: 5,  particleCount: 10,glowLayers: 3, glowOpacity: 0.6,  breatheSpeed: 3,   specialEffect: 'flash', orbitRadiusMul: 1.1 },
  jealousy:       { hue: 15,  satMul: 0.8,  particleSpeed: 6,  particleCount: 9, glowLayers: 3, glowOpacity: 0.55, breatheSpeed: 3.2, specialEffect: 'flash', orbitRadiusMul: 1.05 },
  jealous:        { hue: 15,  satMul: 0.8,  particleSpeed: 6,  particleCount: 9, glowLayers: 3, glowOpacity: 0.55, breatheSpeed: 3.2, specialEffect: 'flash', orbitRadiusMul: 1.05 },
  disgusted:      { hue: 120, satMul: 0.6,  particleSpeed: 15, particleCount: 5, glowLayers: 2, glowOpacity: 0.25, breatheSpeed: 5.5, specialEffect: 'dimGlow', orbitRadiusMul: 0.9 },
  disappointment: { hue: 200, satMul: 0.5,  particleSpeed: 18, particleCount: 5, glowLayers: 2, glowOpacity: 0.2,  breatheSpeed: 6.5, specialEffect: 'dimGlow', orbitRadiusMul: 0.9 },
  regret:         { hue: 190, satMul: 0.5,  particleSpeed: 17, particleCount: 5, glowLayers: 2, glowOpacity: 0.22, breatheSpeed: 6,   specialEffect: 'dimGlow', orbitRadiusMul: 0.9 },
  brave:          { hue: 350, satMul: 0.75, particleSpeed: 9,  particleCount: 8, glowLayers: 3, glowOpacity: 0.5,  breatheSpeed: 3.8, specialEffect: 'ringExpand', orbitRadiusMul: 1.05 },
};

function getBehavior(emotion: EmotionType): EmotionBehavior {
  return emotionBehaviorMap[emotion] || emotionBehaviorMap.neutral;
}

function getEmotionColor(emotion: EmotionType, intensity: number): { hsl: string; hsla: (a: number) => string } {
  const b = getBehavior(emotion);
  const sat = 70 + intensity * 0.25;
  const light = 46 + intensity * 0.15;
  return {
    hsl: `hsl(${b.hue}, ${sat}%, ${light}%)`,
    hsla: (a: number) => `hsla(${b.hue}, ${sat}%, ${light}%, ${a})`,
  };
}

function AffinityBall({ emotion, intensity }: { emotion: EmotionType; intensity: number }) {
  const behavior = getBehavior(emotion);
  const { hsl: color, hsla } = getEmotionColor(emotion, intensity);
  const label = emotionLabels[emotion];

  // 随机但保证最小间距的角度分布（不等距也不聚堆）
  function spreadAngles(count: number, r: () => number, minGap: number): number[] {
    const angles: number[] = [];
    let attempts = 0;
    while (angles.length < count && attempts < count * 50) {
      const a = r() * 360;
      const ok = angles.every(existing => {
        const diff = Math.abs(existing - a);
        return Math.min(diff, 360 - diff) >= minGap;
      });
      if (ok) angles.push(a);
      attempts++;
    }
    // 兜底：如果放不下，用均分 + 随机偏移
    while (angles.length < count) {
      const base = (360 / count) * angles.length;
      angles.push(base + (r() - 0.5) * minGap * 0.5);
    }
    return angles;
  }

  // 种子随机数据: 8外轨道 + 10散点 = 18组
  const seeds = useMemo(() => {
    const r = seededRandom(42);
    const outerAngles = spreadAngles(8, r, 25);
    const scatterAngles = spreadAngles(10, r, 20);
    return Array.from({ length: 18 }, (_, i) => ({
      angle: i < 8 ? outerAngles[i] : scatterAngles[i - 8],
      size: r(),
      radius: r(),
      opacity: r(),
      delay: r(),
    }));
  }, []);

  // 强度影响
  const intensityNorm = intensity / 100;
  const particleScale = 0.7 + intensityNorm * 0.6; // 粒子大小缩放
  const extraParticles = Math.round(intensityNorm * 3); // 额外粒子数
  const glowBoost = 0.5 + intensityNorm * 0.8; // 辉光增强
  const totalParticles = behavior.particleCount + extraParticles;

  // 特殊效果样式
  const specialStyle: React.CSSProperties = {};
  if (behavior.specialEffect === 'shrink') {
    specialStyle.transform = `scale(${0.88 + intensityNorm * 0.1})`;
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative w-44 h-44" style={{ ...specialStyle, overflow: 'visible' }}>
        {/* 外部扩散层（辉光层数随情绪变化） */}
        {Array.from({ length: behavior.glowLayers }, (_, g) => {
          const inset = -16 - g * 8;
          const opacity = behavior.glowOpacity * glowBoost - g * 0.05;
          const dur = behavior.breatheSpeed + g * 0.8;
          return (
            <div
              key={`glow${g}`}
              className="absolute rounded-full"
              style={{
                inset: `${inset}px`,
                opacity: Math.max(0.05, opacity),
                background: `radial-gradient(circle, ${color}, transparent 70%)`,
                animation: `pulse ${dur}s ease-in-out infinite ${g * 0.4}s`,
              }}
            />
          );
        })}

        {/* 特殊效果: ringExpand */}
        {behavior.specialEffect === 'ringExpand' && (
          <div
            className="absolute rounded-full border"
            style={{
              inset: '-8px',
              borderColor: hsla(0.3),
              animation: `ringExpand ${behavior.breatheSpeed * 1.5}s ease-out infinite`,
            }}
          />
        )}

        {/* 特殊效果: flash */}
        {behavior.specialEffect === 'flash' && (
          <div
            className="absolute rounded-full"
            style={{
              inset: '-15px',
              background: `radial-gradient(circle, ${hsla(0.4)}, transparent 60%)`,
              animation: `flash ${behavior.breatheSpeed * 0.6}s steps(3) infinite`,
            }}
          />
        )}

        {/* 特殊效果: flicker */}
        {behavior.specialEffect === 'flicker' && (
          <div
            className="absolute rounded-full"
            style={{
              inset: '-12px',
              background: `radial-gradient(circle, ${hsla(0.35)}, transparent 65%)`,
              animation: `flicker ${behavior.breatheSpeed * 0.8}s steps(5) infinite`,
            }}
          />
        )}

        {/* 外轨道粒子 - 随机种子角度，辉光外围环绕 */}
        <div className="absolute inset-0 flex items-center justify-center" style={{ animation: `orbit ${behavior.particleSpeed * 2}s linear infinite` }}>
          {Array.from({ length: Math.min(totalParticles, 8) }, (_, i) => {
            const s = seeds[i];
            const sz = (4 + s.size * 3) * particleScale;
            const orbit = 100 + s.radius * 30;
            const opa = 0.55 + s.opacity * 0.4;
            return (
              <div
                key={`out${i}`}
                className="absolute rounded-full"
                style={{
                  width: `${sz}px`, height: `${sz}px`,
                  backgroundColor: color,
                  opacity: opa,
                  boxShadow: `0 0 ${sz * 4}px ${color}, 0 0 ${sz * 8}px ${color}55`,
                  transform: `rotate(${s.angle}deg) translateY(${-orbit}px)`,
                }}
              />
            );
          })}
        </div>

        {/* 散点粒子 - 在辉光外围漂浮 */}
        {seeds.slice(11, 11 + Math.min(totalParticles, 10)).map((s, i) => {
          const angle = s.angle;
          const dist = (50 + s.radius * 30) * behavior.orbitRadiusMul;
          const sz = (2.5 + s.size * 3) * particleScale;
          const clusterAngle = s.angle + s.delay * 120;
          const driftX = Math.cos(clusterAngle * Math.PI / 180) * 8;
          const driftY = Math.sin(clusterAngle * Math.PI / 180) * 8;
          const dur = 3 + s.delay * 4;
          return (
            <div
              key={`p${i}`}
              className="absolute rounded-full"
              style={{
                width: `${sz}px`, height: `${sz}px`,
                backgroundColor: color,
                opacity: 0.5 + s.opacity * 0.4,
                left: `calc(50% + ${Math.cos(angle * Math.PI / 180) * dist}px - ${sz / 2}px)`,
                top: `calc(50% + ${Math.sin(angle * Math.PI / 180) * dist}px - ${sz / 2}px)`,
                animation: `clusterFloat ${dur}s ease-in-out infinite`,
                animationDelay: `${s.delay * 3}s`,
                ['--drift-x' as string]: `${driftX}px`,
                ['--drift-y' as string]: `${driftY}px`,
                boxShadow: `0 0 ${sz * 4}px ${color}`,
              }}
            />
          );
        })}

        {/* 球体主体 */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `radial-gradient(circle at 35% 30%, ${color}dd, ${color}88 50%, ${color}44)`,
            boxShadow: `0 0 60px ${color}44, 0 0 120px ${color}22, inset 0 0 40px rgba(255,255,255,0.15)`,
            animation: 'breathe 4s ease-in-out infinite',
          }}
        />

        {/* 内部高光 */}
        <div
          className="absolute inset-[15%] rounded-full"
          style={{
            background: `radial-gradient(circle at 40% 35%, rgba(255,255,255,0.35), transparent 60%)`,
          }}
        />

        {/* 标签 */}
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
          <span className="text-xl font-bold text-white drop-shadow-lg">{label}</span>
          <span className="text-xs text-white/70 mt-0.5">{intensity}%</span>
        </div>
      </div>
    </div>
  );
}


function seededHeight(i: number): number {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return 20 + (s - Math.floor(s)) * 80;
}

function EmotionTimeline({ records }: { records: Array<{ emotion: EmotionType; timestamp: Date }> }) {
  const recent = useMemo(() => records.slice(0, 30).reverse(), [records]);
  if (recent.length === 0) return <div className="text-center py-6 text-gray-400 text-sm">暂无情绪记录</div>;

  return (
    <div className="flex items-end gap-[3px] h-12 justify-center px-1">
      {recent.map((r, i) => (
        <div
          key={i}
          className="flex-1 max-w-4 rounded-t-sm transition-all duration-300 hover:opacity-80 relative group"
          style={{
            height: i === recent.length - 1 ? '100%' : `${seededHeight(i)}%`,
            backgroundColor: emotionColors[r.emotion],
            minHeight: '4px',
          }}
        >
          <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block whitespace-nowrap bg-gray-900 text-white text-[10px] px-2 py-1 rounded-md shadow-lg z-10">
            {emotionLabels[r.emotion]}
          </div>
        </div>
      ))}
    </div>
  );
}

function DistributionBars({ counts, total }: { counts: Record<string, number>; total: number }) {
  const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a).filter(([, c]) => c > 0);
  if (sorted.length === 0) return <div className="text-center py-6 text-gray-400 text-sm">暂无分布数据</div>;
  const maxCount = sorted[0]?.[1] || 1;

  return (
    <div className="space-y-3">
      {sorted.map(([emotion, count]) => {
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <div key={emotion} className="flex items-center gap-3">
            <div className="flex items-center gap-2 w-20 flex-shrink-0">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: emotionColors[emotion as EmotionType] }} />
              <span className="text-xs text-gray-600 dark:text-gray-400">{emotionLabels[emotion as EmotionType]}</span>
            </div>
            <div className="flex-1 h-3 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500 ease-out" style={{ width: `${(count / maxCount) * 100}%`, backgroundColor: emotionColors[emotion as EmotionType] }} />
            </div>
            <span className="text-xs text-gray-500 w-12 text-right font-mono">{count}次 · {pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

function RecordList({ records }: { records: Array<{ id: string; emotion: EmotionType; intensity: number; context: string }> }) {
  if (records.length === 0) return <div className="text-center py-10 text-gray-400 text-sm">开始对话后会记录情感变化</div>;

  return (
    <div className="space-y-2">
      {records.map((record) => (
        <div key={record.id} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: emotionColors[record.emotion] + '18' }}>
            <div className="w-4 h-4 rounded-full" style={{ backgroundColor: emotionColors[record.emotion] }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{emotionLabels[record.emotion]}</span>
              <div className="h-1.5 rounded-full" style={{ width: `${Math.max(record.intensity * 0.4, 8)}px`, backgroundColor: emotionColors[record.emotion] }} />
              <span className="text-[10px] text-gray-400">{record.intensity}%</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-2">{record.context}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

interface EmotionData {
  id: string;
  emotion: EmotionType;
  intensity: number;
  timestamp: Date;
  context: string;
}

export function EmotionDashboard() {
  const records = useChatStore((s) => s.emotionRecords);
  const currentId = useChatStore((s) => s.currentConversationId);
  const conversations = useChatStore((s) => s.conversations);
  const characters = useCharacterStore((s) => s.characters);
  const navigate = useNavigate();
  const [selectedCharId, setSelectedCharId] = useState<string>('__all__');
  const [selectedDate, setSelectedDate] = useState<string>(getTodayStr());
  const [showAllDates, setShowAllDates] = useState(false);

  const conversation = conversations.find(c => c.id === currentId);
  const currentCharId = conversation?.characterId || '';
  const emotionCharId = selectedCharId === '__all__' ? currentCharId : selectedCharId;

  const charEmotionState = useCharacterMindStore(s => emotionCharId ? s.emotionStates[emotionCharId] : null);
  const currentEmotion = charEmotionState?.emotion || 'neutral' as EmotionType;
  const emotionIntensity = charEmotionState?.intensity || 0;

  const affinityStates = useCharacterMindStore(s => s.affinityStates);
  const affinityLevel = useMemo(() => {
    if (!emotionCharId) return 0;
    const state = affinityStates[emotionCharId];
    if (!state) return 0;
    const lastInteraction = state.lastInteraction instanceof Date ? state.lastInteraction : new Date(state.lastInteraction);
    const decay = calcDecay(lastInteraction, state.level, 0.5);
    if (decay !== 0) {
      return Math.round(Math.max(-100, Math.min(100, state.level + decay)) * 100) / 100;
    }
    return Math.round(state.level * 100) / 100;
  }, [emotionCharId, affinityStates]);

  const filteredRecords = useMemo(() => {
    let result: EmotionData[];

    if (selectedCharId === '__all__') {
      result = records;
    } else {
      // Build a set of message contents+timestamps belonging to this character
      const charConvIds = new Set(conversations.filter(c => c.characterId === selectedCharId).map(c => c.id));
      const charMsgKeys = new Set<string>();
      for (const conv of conversations) {
        if (!charConvIds.has(conv.id)) continue;
        for (const msg of conv.messages) {
          if (msg.sender === 'user') {
            // Use content + timestamp hour as a matching key
            const ts = new Date(msg.timestamp).getTime();
            charMsgKeys.add(`${msg.content}|${ts}`);
          }
        }
      }

      // Match emotion records by characterId OR by context matching
      result = records.filter(r => {
        if (r.characterId === selectedCharId) return true;
        const rTime = new Date(r.timestamp).getTime();
        for (const key of charMsgKeys) {
          const [content, tsStr] = key.split('|');
          const ts = Number(tsStr);
          if (r.context === content && Math.abs(rTime - ts) < 2000) return true;
        }
        return false;
      });
    }

    if (!showAllDates) {
      const dayStart = new Date(selectedDate + 'T00:00:00');
      const dayEnd = new Date(selectedDate + 'T00:00:00');
      dayEnd.setDate(dayEnd.getDate() + 1);
      result = result.filter(r => {
        const t = new Date(r.timestamp).getTime();
        return t >= dayStart.getTime() && t < dayEnd.getTime();
      });
    }

    return result;
  }, [selectedCharId, records, conversations, selectedDate, showAllDates]);

  const stats = useMemo(() => {
    const total = filteredRecords.length;
    const emotionCounts: Record<string, number> = {};
    for (const r of filteredRecords) {
      emotionCounts[r.emotion] = (emotionCounts[r.emotion] || 0) + 1;
    }
    const dominant = Object.entries(emotionCounts).sort(([, a], [, b]) => b - a)[0];

    let spanMin = 0;
    if (total > 1) {
      const timestamps = filteredRecords.map(r => new Date(r.timestamp).getTime());
      const minTime = Math.min(...timestamps);
      const maxTime = Math.max(...timestamps);
      spanMin = Math.round((maxTime - minTime) / (1000 * 60));
    }

    return { total, emotionCounts, dominant, spanMin };
  }, [filteredRecords]);

  const charOptions = useMemo(() => {
    const used = new Set(conversations.map(c => c.characterId).filter(Boolean));
    return characters.filter(c => used.has(c.id));
  }, [characters, conversations]);

  useEffect(() => {
    const id = 'emotion-dashboard-keyframes';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      @keyframes orbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @keyframes float { 0%,100%{transform:translate(0,0) scale(1);opacity:0.3} 50%{transform:translate(0,-6px) scale(1.3);opacity:0.6} }
      @keyframes clusterFloat { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(var(--drift-x,3px),var(--drift-y,-3px)) scale(1.4)} }
      @keyframes breathe { 0%,100%{transform:scale(1)} 50%{transform:scale(1.03)} }
      @keyframes pulse { 0%,100%{opacity:var(--pulse-min,0.15)} 50%{opacity:var(--pulse-max,0.35)} }
      @keyframes ringExpand { 0%{transform:scale(0.8);opacity:0.5} 100%{transform:scale(1.6);opacity:0} }
      @keyframes flash { 0%{opacity:0.5} 33%{opacity:0.1} 66%{opacity:0.6} 100%{opacity:0.2} }
      @keyframes flicker { 0%{opacity:0.4} 20%{opacity:0.1} 40%{opacity:0.5} 60%{opacity:0.15} 80%{opacity:0.45} 100%{opacity:0.3} }
    `;
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, []);

  return (<div className="flex-1 min-h-0 bg-gray-50 dark:bg-gray-950 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 pt-6">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => navigate('/chat')} className="p-2.5 rounded-xl bg-white dark:bg-gray-900 shadow-sm hover:shadow-md transition-all shrink-0">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">情感面板</h1>
            <p className="text-xs text-gray-500">实时情绪状态</p>
          </div>
        </div>

        {charOptions.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto py-1 px-1">
            <button
              onClick={() => setSelectedCharId('__all__')}
              className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-all shrink-0 ${
                selectedCharId === '__all__'
                  ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 ring-1 ring-violet-300 dark:ring-violet-700 shadow-sm font-medium'
                  : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              全部
            </button>
            {charOptions.map(c => (
              <button
                key={c.id}
                onClick={() => setSelectedCharId(c.id)}
                className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-all shrink-0 ${
                  selectedCharId === c.id
                    ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 ring-1 ring-violet-300 dark:ring-violet-700 shadow-sm font-medium'
                    : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        {/* Date Timeline */}
        <div className="mb-5">
          <DateTimeline
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
            showAll={true}
            showAllMode={showAllDates}
            onToggleAll={() => setShowAllDates(!showAllDates)}
          />
        </div>

        {/* Affinity Ball */}
        <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-sm p-8 mb-5 overflow-hidden min-h-[340px] flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={14} className="text-violet-500" />
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">当前情绪</h2>
          </div>
          <div className="flex-1 flex items-center justify-center">
            <AffinityBall emotion={currentEmotion} intensity={emotionIntensity} />
          </div>
        </div>

        {/* Affinity Heart */}
        <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-sm p-8 mb-5 relative flex flex-col items-center">
          <div className="self-stretch relative z-10 flex items-center gap-2 mb-6">
            <div className="w-3.5 h-3.5 rounded-full bg-pink-500" />
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">好感度</h2>
          </div>
          <div className="w-full flex-1 flex items-center justify-center" style={{ minHeight: 0 }}>
            <ParticleHeart progress={Math.max(0, affinityLevel)} />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm p-4 text-center">
            <div className="text-3xl font-black text-gray-900 dark:text-gray-100">{stats.total}</div>
            <div className="text-[11px] text-gray-500 mt-1">记录总数</div>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm p-4 text-center">
            <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {stats.dominant ? emotionLabels[stats.dominant[0] as EmotionType] : '-'}
            </div>
            <div className="text-[11px] text-gray-500 mt-1">主导情绪</div>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm p-4 text-center">
            <div className="text-3xl font-black text-gray-900 dark:text-gray-100">
              {stats.total < 2 ? '-' : stats.spanMin < 60 ? `${stats.spanMin}m` : `${Math.round(stats.spanMin / 60)}h`}
            </div>
            <div className="text-[11px] text-gray-500 mt-1">时间跨度</div>
          </div>
        </div>

        {/* Timeline */}
        <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-sm p-5 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={14} className="text-violet-500" />
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">情绪走势</h2>
            <span className="text-[10px] text-gray-400 ml-auto">最近30条</span>
          </div>
          <EmotionTimeline records={filteredRecords} />
        </div>

        {/* Distribution */}
        <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-sm p-5 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={14} className="text-violet-500" />
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">情绪分布</h2>
          </div>
          <DistributionBars counts={stats.emotionCounts} total={stats.total} />
        </div>

        {/* Records */}
        <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-sm p-5 pb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">最近记录</h2>
            <span className="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">{filteredRecords.length}</span>
          </div>
          <RecordList records={filteredRecords.slice(0, 20)} />
        </div>
      </div>
    </div>
  );
}
