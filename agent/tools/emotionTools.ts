/**
 * 情感系统 Agent 工具
 */
import type { AgentTool } from '../../types/agent';
import { useCharacterMindStore } from '../../store/characterMindStore';
import { useCharacterStore } from '../../store/characterStore';
import { useDebugLog } from '../../store/debugLogStore';

export const emotionTools: AgentTool[] = [
  {
    id: 'emotion_get_current',
    name: '获取当前情绪',
    description: '获取当前角色的多维情绪状态',
    category: 'emotion',
    permissionLevel: 'low',
    executionSite: 'frontend',
    parameters: [],
    execute: async () => {
      const charId = useCharacterStore.getState().selectedCharacterId;
      if (!charId) return { success: false, error: '未选择角色' };
      const emotion = useCharacterMindStore.getState().getMultiEmotion(charId);
      return {
        success: true,
        message: `情绪: 快乐${emotion.values.joy ?? 50}, 悲伤${emotion.values.sadness ?? 30}, 愤怒${emotion.values.anger ?? 10}, 恐惧${emotion.values.fear ?? 10}, 惊讶${emotion.values.surprise ?? 20}`,
        data: emotion.values,
      };
    },
  },
  {
    id: 'emotion_set',
    name: '设置情绪',
    description: '设置当前角色的指定情绪维度值（0-100）',
    category: 'emotion',
    permissionLevel: 'medium',
    executionSite: 'frontend',
    parameters: [
      { name: 'emotion', type: 'string', description: 'joy/sadness/anger/fear/surprise', required: true, enum: ['joy', 'sadness', 'anger', 'fear', 'surprise'] },
      { name: 'value', type: 'number', description: '情绪值（0-100）', required: true },
    ],
    execute: async (params) => {
      const charId = useCharacterStore.getState().selectedCharacterId;
      if (!charId) return { success: false, error: '未选择角色' };
      const mind = useCharacterMindStore.getState();
      const cur = mind.getMultiEmotion(charId);
      const newValue = Math.max(0, Math.min(100, params.value as number));
      mind.setMultiEmotion(charId, { ...cur, values: { ...cur.values, [params.emotion as string]: newValue } });
      useDebugLog.getState().add('system', `[情感] 设置 ${params.emotion} = ${newValue}`);
      return { success: true, message: `${params.emotion} 已设为 ${newValue}` };
    },
  },
  {
    id: 'emotion_boost',
    name: '情绪增益',
    description: '对指定情绪维度增减一定数值',
    category: 'emotion',
    permissionLevel: 'medium',
    executionSite: 'frontend',
    parameters: [
      { name: 'emotion', type: 'string', description: 'joy/sadness/anger/fear/surprise', required: true, enum: ['joy', 'sadness', 'anger', 'fear', 'surprise'] },
      { name: 'delta', type: 'number', description: '变化量（正增负减）', required: true },
    ],
    execute: async (params) => {
      const charId = useCharacterStore.getState().selectedCharacterId;
      if (!charId) return { success: false, error: '未选择角色' };
      const mind = useCharacterMindStore.getState();
      const cur = mind.getMultiEmotion(charId);
      const currentVal = cur.values[params.emotion as string] ?? 50;
      const newVal = Math.max(0, Math.min(100, currentVal + (params.delta as number)));
      mind.setMultiEmotion(charId, { ...cur, values: { ...cur.values, [params.emotion as string]: newVal } });
      useDebugLog.getState().add('system', `[情感] ${params.emotion}: ${currentVal} → ${newVal}`);
      return { success: true, message: `${params.emotion}: ${currentVal} → ${newVal}` };
    },
  },
];
