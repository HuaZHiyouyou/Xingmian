/**
 * ============================================================
 * AI 一日 · 内置世界设定包注册表（v2 规范）
 *  - 数据源：docs/world-packs/*.json（单一数据源，文档即代码）
 *  - 覆盖 2026 年主流二次元游戏世界观，供角色创建与日程生成使用
 *  - 由 worldConfig.ensureBuiltinWorlds() 在应用启动时幂等播种
 *
 *  注：所有游戏世界包均为非官方同人参考资料，仅用于本地个人化
 *  AI 陪伴场景，不含任何官方素材。
 * ============================================================
 */
import genshinPack from '../../../docs/world-packs/genshin.json';
import hsrPack from '../../../docs/world-packs/honkai-star-rail.json';
import zzzPack from '../../../docs/world-packs/zenless-zone-zero.json';
import wuwaPack from '../../../docs/world-packs/wuthering-waves.json';
import endfieldPack from '../../../docs/world-packs/arknights-endfield.json';
import arknightsPack from '../../../docs/world-packs/arknights.json';
import nikkiPack from '../../../docs/world-packs/infinity-nikki.json';
import baPack from '../../../docs/world-packs/blue-archive.json';
import reverse1999Pack from '../../../docs/world-packs/reverse-1999.json';
import nikkePack from '../../../docs/world-packs/nikke.json';
import azurlanePack from '../../../docs/world-packs/azur-lane.json';
import ptnPack from '../../../docs/world-packs/path-to-nowhere.json';
import lightnightPack from '../../../docs/world-packs/light-and-night.json';
import gfl2Pack from '../../../docs/world-packs/gfl2.json';
import fgoPack from '../../../docs/world-packs/fgo.json';
import pgrPack from '../../../docs/world-packs/punishing-gray-raven.json';
import hi3Pack from '../../../docs/world-packs/honkai-impact-3.json';
import touhouPack from '../../../docs/world-packs/touhou.json';
import anantaPack from '../../../docs/world-packs/ananta.json';
import dnaPack from '../../../docs/world-packs/duet-night-abyss.json';
import atriPack from '../../../docs/world-packs/atri.json';
import senrenPack from '../../../docs/world-packs/senren-banka.json';
import ggzPack from '../../../docs/world-packs/guns-girlz.json';
import rocoPack from '../../../docs/world-packs/roco-kingdom.json';
import nekoparaPack from '../../../docs/world-packs/nekopara.json';
import whmxPack from '../../../docs/world-packs/whmx.json';
import sanobaPack from '../../../docs/world-packs/sanoba-witch.json';
import jjkPack from '../../../docs/world-packs/jujutsu-kaisen.json';
import frierenPack from '../../../docs/world-packs/frieren.json';
import kimetsuPack from '../../../docs/world-packs/kimetsu-no-yaiba.json';
import bocchiPack from '../../../docs/world-packs/bocchi-the-rock.json';
import clannadPack from '../../../docs/world-packs/clannad.json';
import mikuPack from '../../../docs/world-packs/hatsune-miku.json';
import tianyiPack from '../../../docs/world-packs/luo-tianyi.json';
import noellePack from '../../../docs/world-packs/noelle.json';
import jiufoxPack from '../../../docs/world-packs/jiu-fox.json';
import spyfamilyPack from '../../../docs/world-packs/spy-x-family.json';
import kusuriyaPack from '../../../docs/world-packs/kusuriya.json';
import oshinokoPack from '../../../docs/world-packs/oshi-no-ko.json';
import fatesfPack from '../../../docs/world-packs/fate-strange-fake.json';
import chiikawaPack from '../../../docs/world-packs/chiikawa.json';
import cafestellaPack from '../../../docs/world-packs/cafe-stella.json';
import summerpocketsPack from '../../../docs/world-packs/summer-pockets.json';
import dracuriotPack from '../../../docs/world-packs/dracu-riot.json';
import steinsgatePack from '../../../docs/world-packs/steins-gate.json';
import aotPack from '../../../docs/world-packs/attack-on-titan.json';
import madokaPack from '../../../docs/world-packs/madoka-magica.json';
import evaPack from '../../../docs/world-packs/evangelion.json';
import violetPack from '../../../docs/world-packs/violet-evergarden.json';
import rezeroPack from '../../../docs/world-packs/re-zero.json';
import saoPack from '../../../docs/world-packs/sword-art-online.json';
import csmPack from '../../../docs/world-packs/chainsaw-man.json';
import monogatariPack from '../../../docs/world-packs/monogatari.json';
import gintamaPack from '../../../docs/world-packs/gintama.json';
import codegeassPack from '../../../docs/world-packs/code-geass.json';
import fmaPack from '../../../docs/world-packs/fullmetal-alchemist.json';
import strPack from '../../../docs/world-packs/summer-time-rendering.json';
import anohanaPack from '../../../docs/world-packs/anohana.json';
import kimiusoPack from '../../../docs/world-packs/kimi-no-uso.json';
import aobutaPack from '../../../docs/world-packs/aobuta.json';
import natsumePack from '../../../docs/world-packs/natsume-yuujinchou.json';
import haikyuuPack from '../../../docs/world-packs/haikyuu.json';
import fsnPack from '../../../docs/world-packs/fate-stay-night.json';
import tsukihimePack from '../../../docs/world-packs/tsukihime.json';
import amachocoPack from '../../../docs/world-packs/amairo-chocolata.json';
import wa2Pack from '../../../docs/world-packs/white-album-2.json';
import ddlcPack from '../../../docs/world-packs/ddlc.json';
import aokanaPack from '../../../docs/world-packs/aokana.json';
import hamidashiPack from '../../../docs/world-packs/hamidashi-creative.json';
import subahibiPack from '../../../docs/world-packs/subarashiki-hibi.json';
import gsenkiPack from '../../../docs/world-packs/g-senjou.json';
import nineninePack from '../../../docs/world-packs/nine-nine.json';
import riddlejokerPack from '../../../docs/world-packs/riddle-joker.json';
import starrailPack from '../../../docs/world-packs/stellarrail-shiro.json';
import eternityPack from '../../../docs/world-packs/eternity-stars-daily.json';
import onimaiPack from '../../../docs/world-packs/onimai.json';
import kaguyahimePack from '../../../docs/world-packs/kaguya-hime.json';
import pigeongamesPack from '../../../docs/world-packs/pigeongames.json';
import kobayashiPack from '../../../docs/world-packs/kobayashi-maid.json';
import chuunibyouPack from '../../../docs/world-packs/chuunibyou.json';

import {
  WorldCharacterTemplate,
  WorldConfigData,
  WorldConfigRecord,
  WorldFaction,
} from '../../lib/tauriBridge';

/** 世界设定包文档文件格式（formatVersion 2） */
export interface WorldPackFileV2 {
  formatVersion: number;
  id: string;
  name: string;
  worldType: string;
  isBuiltin?: boolean;
  config: WorldConfigData;
}

/** 全部内置二游世界包（按主流度排序） */
export const BUILTIN_GAME_WORLD_PACKS: WorldPackFileV2[] = [
  genshinPack,
  hsrPack,
  zzzPack,
  wuwaPack,
  endfieldPack,
  arknightsPack,
  nikkiPack,
  baPack,
  reverse1999Pack,
  nikkePack,
  azurlanePack,
  ptnPack,
  lightnightPack,
  gfl2Pack,
  fgoPack,
  pgrPack,
  hi3Pack,
  touhouPack,
  anantaPack,
  dnaPack,
  atriPack,
  senrenPack,
  ggzPack,
  rocoPack,
  nekoparaPack,
  whmxPack,
  sanobaPack,
  jjkPack,
  frierenPack,
  kimetsuPack,
  bocchiPack,
  clannadPack,
  mikuPack,
  tianyiPack,
  noellePack,
  jiufoxPack,
  spyfamilyPack,
  kusuriyaPack,
  oshinokoPack,
  fatesfPack,
  chiikawaPack,
  cafestellaPack,
  summerpocketsPack,
  dracuriotPack,
  steinsgatePack,
  aotPack,
  madokaPack,
  evaPack,
  violetPack,
  rezeroPack,
  saoPack,
  csmPack,
  monogatariPack,
  gintamaPack,
  codegeassPack,
  fmaPack,
  strPack,
  anohanaPack,
  kimiusoPack,
  aobutaPack,
  natsumePack,
  haikyuuPack,
  fsnPack,
  tsukihimePack,
  amachocoPack,
  wa2Pack,
  ddlcPack,
  ddlcPack,
  aokanaPack,
  hamidashiPack,
  subahibiPack,
  gsenkiPack,
  nineninePack,
  riddlejokerPack,
  starrailPack,
  eternityPack,
  onimaiPack,
  kaguyahimePack,
  pigeongamesPack,
  kobayashiPack,
  chuunibyouPack,
] as unknown as WorldPackFileV2[];

/** 字符串数组字段清洗：仅保留非空字符串项 */
function strArr(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  return out.length ? out : undefined;
}

/** 截断到指定长度（Prompt 预算保护用） */
export function clipText(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/**
 * 世界设定包数据规范化：
 * - 兼容 v1/v2 导入与 JSON 文档播种
 * - 对已知字段做类型清洗，非法值静默剔除
 */
export function normalizeWorldConfigData(raw: Partial<WorldConfigData> | undefined | null): WorldConfigData {
  const c: WorldConfigData = {};
  if (!raw || typeof raw !== 'object') return c;
  if (typeof raw.description === 'string') c.description = raw.description;
  c.locations = strArr(raw.locations);
  c.transport = strArr(raw.transport);
  c.currency = strArr(raw.currency);
  if (raw.activities && typeof raw.activities === 'object') {
    const a = raw.activities as Record<string, unknown>;
    c.activities = {
      daily: strArr(a.daily),
      work: strArr(a.work),
      leisure: strArr(a.leisure),
      social: strArr(a.social),
      special: strArr(a.special),
    };
  }
  c.events = strArr(raw.events);
  if (raw.items && typeof raw.items === 'object') c.items = raw.items;
  // ---- v2 ----
  if (typeof raw.source === 'string') c.source = raw.source;
  if (typeof raw.era === 'string') c.era = clipText(raw.era, 120);
  if (typeof raw.lore === 'string') c.lore = clipText(raw.lore, 400);
  if (raw.terminology && typeof raw.terminology === 'object') {
    const terms: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.terminology as Record<string, unknown>)) {
      if (typeof k === 'string' && k.trim() && typeof v === 'string' && v.trim()) terms[k.trim()] = clipText(v, 60);
    }
    if (Object.keys(terms).length) c.terminology = terms;
  }
  if (Array.isArray(raw.factions)) {
    const fs: WorldFaction[] = [];
    for (const f of raw.factions.slice(0, 12)) {
      if (f && typeof f.name === 'string' && f.name.trim()) {
        fs.push({ name: f.name.trim(), description: typeof f.description === 'string' ? clipText(f.description, 40) : undefined });
      }
    }
    if (fs.length) c.factions = fs;
  }
  if (Array.isArray(raw.characters)) {
    const cs: WorldCharacterTemplate[] = [];
    for (const ch of raw.characters.slice(0, 2000)) {
      if (ch && typeof ch.name === 'string' && ch.name.trim()) {
        cs.push({
          name: ch.name.trim(),
          nickname: typeof ch.nickname === 'string' ? clipText(ch.nickname, 30) : undefined,
          role: typeof ch.role === 'string' ? ch.role.trim() : undefined,
          affiliation: typeof ch.affiliation === 'string' ? clipText(ch.affiliation, 30) : undefined,
          rarity: typeof ch.rarity === 'string' ? clipText(ch.rarity, 10) : undefined,
          personality: typeof ch.personality === 'string' ? clipText(ch.personality, 40) : undefined,
          speechStyle: typeof ch.speechStyle === 'string' ? clipText(ch.speechStyle, 40) : undefined,
          deeds: typeof ch.deeds === 'string' ? clipText(ch.deeds, 80) : undefined,
          relation: typeof ch.relation === 'string' ? clipText(ch.relation, 40) : undefined,
        });
      }
    }
    if (cs.length) c.characters = cs;
  }
  c.taboos = strArr(raw.taboos)?.slice(0, 8);
  if (typeof raw.timeNotes === 'string') c.timeNotes = clipText(raw.timeNotes, 80);
  // ---- 元数据（统计时间 / 版本 / 免责声明）----
  if (typeof raw.statsAsOf === 'string') c.statsAsOf = clipText(raw.statsAsOf, 20);
  if (typeof raw.gameVersion === 'string') c.gameVersion = clipText(raw.gameVersion, 20);
  if (typeof raw.disclaimer === 'string') c.disclaimer = clipText(raw.disclaimer, 160);
  return c;
}

/** 文档格式 → 数据库记录 */
export function packToRecord(pack: WorldPackFileV2): WorldConfigRecord {
  return {
    id: pack.id,
    name: pack.name,
    worldType: pack.worldType,
    isBuiltin: true,
    updatedAt: new Date().toISOString(),
    config: normalizeWorldConfigData(pack.config),
  };
}
