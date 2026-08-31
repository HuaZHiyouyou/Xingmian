import { EmotionType, MultiEmotionState } from '../types';
import { MODEL_ROLES } from '../store/modelRoleStore';

interface KeywordEntry { kw: string; weight: number }

const emotionKeywords: Record<EmotionType, KeywordEntry[]> = {
  joy: [
    { kw: '太开心', weight: 3 }, { kw: '好开心', weight: 3 }, { kw: '很开心', weight: 3 },
    { kw: '太高兴', weight: 3 }, { kw: '很高兴', weight: 3 }, { kw: '真高兴', weight: 3 },
    { kw: '真开心', weight: 3 }, { kw: '开心', weight: 2 },
    { kw: '太喜欢', weight: 3 }, { kw: '好喜欢', weight: 3 }, { kw: '喜欢', weight: 2 },
    { kw: '哈哈', weight: 3 }, { kw: '哈哈哈', weight: 4 }, { kw: '呵呵', weight: 2 },
    { kw: '嘿嘿', weight: 2 }, { kw: '嘻嘻', weight: 2 },
    { kw: '太棒', weight: 3 }, { kw: '好棒', weight: 3 }, { kw: '棒', weight: 2 },
    { kw: '太完美', weight: 3 }, { kw: '太幸福', weight: 3 }, { kw: '幸福', weight: 2 },
    { kw: '爽', weight: 2 }, { kw: '好爽', weight: 3 }, { kw: 'nice', weight: 2 },
    { kw: 'great', weight: 2 }, { kw: 'happy', weight: 2 }, { kw: 'awesome', weight: 3 },
    { kw: 'amazing', weight: 3 }, { kw: 'wow', weight: 2 }, { kw: '耶', weight: 2 },
    { kw: '好耶', weight: 3 }, { kw: '终于', weight: 2 }, { kw: '完美', weight: 2 },
    { kw: '可爱', weight: 2 }, { kw: '萌', weight: 2 },
  ],
  trust: [
    { kw: '好爱你', weight: 3 }, { kw: '好想你', weight: 3 }, { kw: '想你', weight: 2 },
    { kw: '抱抱', weight: 2 }, { kw: '抱你', weight: 2 }, { kw: '亲亲', weight: 2 },
    { kw: '好关心', weight: 3 }, { kw: '好温暖', weight: 3 }, { kw: '温暖', weight: 2 },
    { kw: '好贴心', weight: 3 }, { kw: '贴心', weight: 2 }, { kw: '乖', weight: 2 },
    { kw: 'love you', weight: 3 }, { kw: 'miss you', weight: 3 },
    { kw: 'sweet', weight: 2 }, { kw: 'dear', weight: 2 },
    { kw: '非常感谢', weight: 3 }, { kw: '太谢谢', weight: 3 }, { kw: '真感恩', weight: 3 },
    { kw: '多谢', weight: 2 }, { kw: 'thanks', weight: 2 }, { kw: 'grateful', weight: 2 },
    { kw: 'appreciate', weight: 2 },
  ],
  fear: [
    { kw: '好害怕', weight: 3 }, { kw: '害怕', weight: 2 }, { kw: '怕', weight: 2 },
    { kw: '好担心', weight: 3 }, { kw: '担心', weight: 2 }, { kw: '忧虑', weight: 2 },
    { kw: '好紧张', weight: 3 }, { kw: '紧张', weight: 2 }, { kw: '好恐惧', weight: 3 },
    { kw: '恐惧', weight: 2 }, { kw: '好不安', weight: 3 }, { kw: '不安', weight: 2 },
    { kw: '真恐慌', weight: 3 }, { kw: '恐慌', weight: 2 }, { kw: '慌', weight: 2 },
    { kw: 'scared', weight: 2 }, { kw: 'afraid', weight: 2 }, { kw: 'nervous', weight: 2 },
    { kw: 'worried', weight: 2 }, { kw: '完了', weight: 2 }, { kw: '糟了', weight: 2 },
  ],
  surprise: [
    { kw: '哇塞', weight: 3 }, { kw: '天哪', weight: 3 }, { kw: '真的假的', weight: 3 },
    { kw: '真意外', weight: 3 }, { kw: '居然', weight: 2 }, { kw: '震惊', weight: 3 },
    { kw: '太震惊', weight: 3 }, { kw: '没想到', weight: 3 }, { kw: '不可能', weight: 2 },
    { kw: '什么', weight: 1 }, { kw: '哈？', weight: 2 }, { kw: '?', weight: 1 },
    { kw: '???', weight: 2 }, { kw: 'wow', weight: 2 }, { kw: 'omg', weight: 3 },
    { kw: 'surprise', weight: 2 }, { kw: 'unbelievable', weight: 3 },
  ],
  sadness: [
    { kw: '太难过', weight: 3 }, { kw: '好难过', weight: 3 }, { kw: '难过', weight: 2 },
    { kw: '好伤心', weight: 3 }, { kw: '伤心', weight: 2 }, { kw: '想哭', weight: 3 },
    { kw: '哭', weight: 2 }, { kw: '好痛苦', weight: 3 }, { kw: '痛苦', weight: 2 },
    { kw: '太糟糕', weight: 3 }, { kw: '糟糕', weight: 2 },
    { kw: '好失望', weight: 3 }, { kw: '失望', weight: 2 },
    { kw: '好累', weight: 3 }, { kw: '累', weight: 2 }, { kw: '疲惫', weight: 2 },
    { kw: '好烦', weight: 2 }, { kw: '好郁闷', weight: 3 }, { kw: '郁闷', weight: 2 },
    { kw: '好不幸', weight: 3 }, { kw: '好悲伤', weight: 3 }, { kw: '悲伤', weight: 2 },
    { kw: '不开心', weight: 2 }, { kw: '心情不好', weight: 3 },
    { kw: '烦死了', weight: 3 }, { kw: '去死', weight: 3 }, { kw: '不想活', weight: 3 },
    { kw: '没意思', weight: 2 }, { kw: '无意义', weight: 2 }, { kw: '算了', weight: 1 },
    { kw: 'depressed', weight: 3 }, { kw: 'tired', weight: 2 }, { kw: 'sad', weight: 2 },
    { kw: 'cry', weight: 2 }, { kw: 'low', weight: 2 },
  ],
  disgust: [
    { kw: '好恶心', weight: 3 }, { kw: '恶心', weight: 2 }, { kw: '真讨厌', weight: 3 },
    { kw: '讨厌', weight: 2 }, { kw: '受不了', weight: 3 }, { kw: '烦死', weight: 2 },
    { kw: 'disgusted', weight: 3 }, { kw: 'gross', weight: 3 },
  ],
  anger: [
    // 强信号短语
    { kw: '好生气', weight: 3 }, { kw: '太愤怒', weight: 3 }, { kw: '愤怒', weight: 2 },
    { kw: '太垃圾', weight: 3 }, { kw: '垃圾', weight: 2 }, { kw: '太差劲', weight: 3 },
    { kw: '差劲', weight: 2 }, { kw: '真不满', weight: 3 }, { kw: '太可恶', weight: 3 },
    { kw: '可恶', weight: 2 }, { kw: '气死', weight: 3 }, { kw: '气死我', weight: 3 },
    { kw: '不耐烦', weight: 2 }, { kw: '烦躁', weight: 2 }, { kw: '心烦', weight: 2 },
    { kw: '恼火', weight: 3 },     { kw: '别吵', weight: 2 }, { kw: '闭嘴', weight: 3 },
    { kw: '滚', weight: 3 }, { kw: '杂鱼', weight: 3 }, { kw: 'zako', weight: 3 },
    // 移除亲昵语境常用的"蠢/笨蛋/傻/呆/呆瓜"等单字（避免"小傻蛋"被误判为愤怒）
    // 改为更明确的辱骂强信号（需结合上下文才能判断为怒骂）
    { kw: '蠢货', weight: 3 }, { kw: '呆子', weight: 2 }, { kw: '找打', weight: 2 },
    { kw: '欠揍', weight: 3 }, { kw: '无能', weight: 2 },
    { kw: '去死吧', weight: 3 }, { kw: '打死', weight: 2 }, { kw: '打死你', weight: 3 },
    { kw: '给你死', weight: 3 }, { kw: '想打你', weight: 2 },
    { kw: 'angry', weight: 2 }, { kw: 'hate', weight: 2 }, { kw: 'annoyed', weight: 2 },
    { kw: 'mad', weight: 2 }, { kw: 'furious', weight: 3 },
    { kw: '喂我去死', weight: 3 },
    // 语气加权：感叹号/连续问号
  ],
  anticipation: [
    { kw: '好兴奋', weight: 3 }, { kw: '兴奋', weight: 2 }, { kw: '好期待', weight: 3 },
    { kw: '期待', weight: 2 }, { kw: '迫不及待', weight: 3 }, { kw: '太好啦', weight: 3 },
    { kw: '耶', weight: 2 }, { kw: '终于', weight: 2 }, { kw: 'excited', weight: 2 },
    { kw: 'thrilled', weight: 3 }, { kw: '好希望', weight: 3 }, { kw: '希望', weight: 2 },
    { kw: '相信', weight: 2 }, { kw: '会好的', weight: 3 }, { kw: '未来', weight: 1 },
    { kw: 'hope', weight: 2 }, { kw: 'believe', weight: 2 }, { kw: 'wish', weight: 2 },
    { kw: '想喝', weight: 2 }, { kw: '想喝奶', weight: 3 }, { kw: '想', weight: 1 },
    { kw: '好奇', weight: 3 }, { kw: '疑惑', weight: 2 }, { kw: '奇怪', weight: 2 },
    { kw: '怎么办', weight: 2 }, { kw: '为什么', weight: 2 }, { kw: '怎么回事', weight: 2 },
    { kw: 'curious', weight: 3 }, { kw: 'wonder', weight: 2 },
  ],
  pride: [
    { kw: '好骄傲', weight: 3 }, { kw: '骄傲', weight: 2 }, { kw: '好自豪', weight: 3 },
    { kw: '自豪', weight: 2 }, { kw: '真厉害', weight: 3 }, { kw: '厉害', weight: 2 },
    { kw: '做到了', weight: 3 }, { kw: '成功了', weight: 3 }, { kw: 'proud', weight: 2 },
    { kw: 'accomplished', weight: 3 },
  ],
  guilt: [
    { kw: '好后悔', weight: 3 }, { kw: '后悔', weight: 2 }, { kw: '早知道', weight: 3 },
    { kw: '真不该', weight: 3 }, { kw: '好遗憾', weight: 3 }, { kw: '遗憾', weight: 2 },
    { kw: '对不起', weight: 2 }, { kw: '抱歉', weight: 2 }, { kw: '抱歉了', weight: 3 },
    { kw: 'regret', weight: 2 }, { kw: 'sorry', weight: 2 },
  ],
  embarrassment: [
    { kw: '好害羞', weight: 3 }, { kw: '害羞', weight: 2 }, { kw: '好脸红', weight: 3 },
    { kw: '脸红', weight: 2 }, { kw: '不好意思', weight: 3 }, { kw: '羞涩', weight: 2 },
    { kw: '害羞了', weight: 3 }, { kw: 'shy', weight: 2 }, { kw: 'blush', weight: 2 },
    { kw: '好尴尬', weight: 3 }, { kw: '尴尬', weight: 2 }, { kw: '窘', weight: 2 },
    { kw: '出糗', weight: 3 }, { kw: '丢脸', weight: 3 }, { kw: '丢人', weight: 2 },
    { kw: '社死', weight: 3 }, { kw: 'awkward', weight: 2 }, { kw: 'embarrassed', weight: 2 },
  ],
  jealousy: [
    { kw: '好嫉妒', weight: 3 }, { kw: '嫉妒', weight: 2 }, { kw: '好羡慕', weight: 3 },
    { kw: '羡慕', weight: 2 }, { kw: '真羡慕', weight: 3 }, { kw: '不公平', weight: 3 },
    { kw: '凭什么', weight: 2 }, { kw: 'jealous', weight: 2 }, { kw: 'envious', weight: 2 },
  ],
  curiosity: [
    // 好奇/疑惑（独立的即时情绪，从 anticipation 拆出）
    { kw: '好奇', weight: 3 }, { kw: '很好奇', weight: 3 }, { kw: '好想知道', weight: 3 },
    { kw: '想知道', weight: 2 }, { kw: '疑惑', weight: 3 }, { kw: '困惑', weight: 2 },
    { kw: '奇怪', weight: 2 }, { kw: '好奇怪', weight: 3 }, { kw: '怎么会', weight: 2 },
    { kw: '为什么', weight: 2 }, { kw: '怎么回事', weight: 3 }, { kw: '怎么回事啊', weight: 3 },
    { kw: '什么情况', weight: 3 }, { kw: '啥情况', weight: 3 }, { kw: '不懂', weight: 2 },
    { kw: '没搞懂', weight: 3 }, { kw: '想不明白', weight: 3 }, { kw: '怎么会这样', weight: 3 },
    { kw: '这个什么', weight: 2 }, { kw: '啥', weight: 1 }, { kw: '那是什么', weight: 2 },
    { kw: 'curious', weight: 3 }, { kw: 'wonder', weight: 2 }, { kw: 'confused', weight: 3 },
    { kw: 'puzzled', weight: 3 }, { kw: 'how', weight: 1 }, { kw: 'what', weight: 1 },
    { kw: 'why', weight: 1 }, { kw: 'interesting', weight: 2 }, { kw: '想知道呢', weight: 2 },
  ],
  love: [
    // 爱慕/依恋（猫娘亲密场景高频的即时情绪 + 撒娇白话）
    { kw: '好爱你', weight: 3 }, { kw: '爱你', weight: 2 }, { kw: '我爱你', weight: 3 },
    { kw: '最喜欢你', weight: 3 }, { kw: '最喜欢', weight: 3 }, { kw: '好喜欢你', weight: 3 },
    { kw: '想抱抱', weight: 3 }, { kw: '想亲亲', weight: 3 }, { kw: '想你了', weight: 3 },
    { kw: '想你', weight: 2 }, { kw: '你是我的', weight: 3 }, { kw: '别离开', weight: 3 },
    { kw: '离不开', weight: 3 }, { kw: '只喜欢你', weight: 3 }, { kw: '心里都是你', weight: 3 },
    { kw: '都是你', weight: 2 }, { kw: '宝宝', weight: 2 }, { kw: '宝贝', weight: 2 },
    { kw: '老婆', weight: 2 }, { kw: '老公', weight: 2 }, { kw: '在一起', weight: 3 },
    { kw: 'love you', weight: 3 }, { kw: 'i love', weight: 3 }, { kw: 'miss you', weight: 2 },
    { kw: 'adore', weight: 3 }, { kw: 'want you', weight: 2 },
    { kw: '离不开你', weight: 3 }, { kw: '只要你在', weight: 2 },
    // 🆕 撒娇/亲昵白话（覆盖常见昵称、撒娇、腻歪表达）
    { kw: '小傻蛋', weight: 3 }, { kw: '小笨蛋', weight: 3 }, { kw: '小傻瓜', weight: 3 },
    { kw: '小可爱', weight: 3 }, { kw: '小笨蛋', weight: 3 },
    { kw: '小秘密', weight: 2 }, { kw: '腻', weight: 2 }, { kw: '腻歪', weight: 3 },
    { kw: '撒', weight: 1 }, { kw: '撒娇', weight: 3 }, { kw: '嗲', weight: 2 },
    { kw: '哼', weight: 1 }, { kw: '哼唧', weight: 2 }, { kw: '哼', weight: 1 },
    { kw: '呜', weight: 1 }, { kw: '呜哇', weight: 2 }, { kw: '呜', weight: 1 },
    { kw: '喵', weight: 2 }, { kw: '喵呜', weight: 2 }, { kw: '喵呜', weight: 2 },
    { kw: '呜~', weight: 1 }, { kw: '嘤', weight: 2 }, { kw: '嘤嘤', weight: 2 },
    { kw: '撒娇呢', weight: 3 }, { kw: '陪我', weight: 2 }, { kw: '抱抱', weight: 2 },
    { kw: '亲亲', weight: 2 }, { kw: '睡觉', weight: 1 }, { kw: '一起睡', weight: 3 },
    { kw: '好不好', weight: 1 }, { kw: '好不好嘛', weight: 3 }, { kw: '行不行', weight: 1 },
    { kw: '行不行嘛', weight: 3 }, { kw: '嗯', weight: 1 }, { kw: '嗯呢', weight: 2 },
    { kw: '么么', weight: 3 }, { kw: '么么哒', weight: 3 }, { kw: '爱你哟', weight: 3 },
    { kw: '要抱抱', weight: 3 }, { kw: '要亲亲', weight: 3 }, { kw: '别走', weight: 2 },
    { kw: '别走嘛', weight: 3 }, { kw: '留', weight: 1 }, { kw: '留下', weight: 2 },
    { kw: '留下嘛', weight: 3 }, { kw: '陪我', weight: 2 }, { kw: '陪我嘛', weight: 3 },
    { kw: 'baby', weight: 2 }, { kw: 'darling', weight: 3 }, { kw: 'hun', weight: 2 },
    { kw: 'dear', weight: 2 }, { kw: 'sweetie', weight: 3 },
  ],
  gratitude: [
    { kw: '谢谢', weight: 2 }, { kw: '非常感谢', weight: 3 }, { kw: '太谢谢', weight: 3 },
    { kw: '真感恩', weight: 3 }, { kw: '感恩', weight: 2 }, { kw: '多谢', weight: 2 },
    { kw: '谢谢你', weight: 3 }, { kw: '谢谢您', weight: 3 }, { kw: '辛苦了', weight: 3 },
    { kw: '太贴心了', weight: 3 }, { kw: '有你真好', weight: 3 }, { kw: '真的好', weight: 2 },
    { kw: 'thanks', weight: 2 }, { kw: 'thank you', weight: 3 }, { kw: 'grateful', weight: 3 },
    { kw: 'appreciate', weight: 2 }, { kw: 'touched', weight: 2 },
  ],
  empathy: [
    { kw: '我理解你', weight: 3 }, { kw: '我能感受到', weight: 3 }, { kw: '心疼你', weight: 3 },
    { kw: '心疼', weight: 2 }, { kw: '我懂你', weight: 3 }, { kw: '你的心情', weight: 2 },
    { kw: '你的感受', weight: 2 }, { kw: '你的难过', weight: 3 }, { kw: '你的痛苦', weight: 3 },
    { kw: '你的开心', weight: 2 }, { kw: '为你高兴', weight: 3 }, { kw: '为你开心', weight: 3 },
    { kw: '一起分担', weight: 3 }, { kw: '分担', weight: 2 }, { kw: '共情', weight: 3 },
    { kw: '同感', weight: 2 }, { kw: 'i understand', weight: 3 }, { kw: 'i feel', weight: 2 },
    { kw: 'empathy', weight: 3 }, { kw: 'for you', weight: 1 },
  ],
  anxiety: [
    { kw: '好焦虑', weight: 3 }, { kw: '焦虑', weight: 2 }, { kw: '好慌张', weight: 3 },
    { kw: '慌张', weight: 2 }, { kw: '心神不宁', weight: 3 }, { kw: '坐立不安', weight: 3 },
    { kw: '怎么办', weight: 2 }, { kw: '好迷茫', weight: 3 }, { kw: '迷茫', weight: 2 },
    { kw: '压力好大', weight: 3 }, { kw: '压力大', weight: 2 }, { kw: '喘不过气', weight: 3 },
    { kw: '好忐忑', weight: 3 }, { kw: '忐忑', weight: 2 }, { kw: '七上八下', weight: 3 },
    { kw: 'anxious', weight: 3 }, { kw: 'worried', weight: 2 }, { kw: 'nervous', weight: 2 },
    { kw: 'stressed', weight: 2 }, { kw: 'overwhelmed', weight: 3 }, { kw: 'panic', weight: 3 },
  ],
  loneliness: [
    { kw: '好孤独', weight: 3 }, { kw: '孤独', weight: 2 }, { kw: '好寂寞', weight: 3 },
    { kw: '寂寞', weight: 2 }, { kw: '一个人', weight: 2 }, { kw: '没人陪', weight: 3 },
    { kw: '好无聊', weight: 2 }, { kw: '无聊', weight: 1 }, { kw: '空虚', weight: 2 },
    { kw: '没人理', weight: 3 }, { kw: '被遗忘', weight: 3 }, { kw: '好孤单', weight: 3 },
    { kw: '孤单', weight: 2 }, { kw: 'lonely', weight: 3 }, { kw: 'alone', weight: 2 },
    { kw: 'miss', weight: 1 }, { kw: '想有人', weight: 3 }, { kw: '谁在', weight: 2 },
  ],
  disappointment: [
    { kw: '好失望', weight: 3 }, { kw: '失望', weight: 2 }, { kw: '太失望了', weight: 3 },
    { kw: '好失落', weight: 3 }, { kw: '失落', weight: 2 }, { kw: '白期待了', weight: 3 },
    { kw: '不开心', weight: 2 }, { kw: '心情不好', weight: 3 }, { kw: '不好', weight: 1 },
    { kw: '没达到', weight: 2 }, { kw: '不满足', weight: 2 }, { kw: '辜负', weight: 3 },
    { kw: 'disappointed', weight: 3 }, { kw: 'let down', weight: 3 }, { kw: 'letdown', weight: 3 },
    { kw: 'expected', weight: 1 }, { kw: 'not what i', weight: 2 },
  ],
};

/** 标点/语气加权：感叹号、连续问号、连续相同字（强调） */
function getPunctuationBoost(lowerText: string): { angry: number; surprise: number; intensityMul: number } {
  let angry = 0;
  let surprise = 0;
  let intensityMul = 1.0;
  const exclamCount = (lowerText.match(/[!！]/g) || []).length;
  const questionCount = (lowerText.match(/[?？]/g) || []).length;
  if (exclamCount >= 3) {
    angry += 2;
    intensityMul += 0.3;
  } else if (exclamCount >= 1) {
    intensityMul += 0.1;
  }
  if (questionCount >= 3) {
    surprise += 2;
    angry += 1;
  }
  // 连续重复字：xxx/啊啊啊 表达强烈
  if (/(.)\1{2,}/.test(lowerText)) {
    intensityMul += 0.2;
  }
  return { angry, surprise, intensityMul };
}

/**
 * 关键词分析用户消息情绪（覆盖短语 + 单字/双字强信号词 + 网络挑衅词典）。
 * 无法命中任何关键词时返回 null（中性），避免默认 joy:0 的噪声记录。
 */
export function analyzeKeyword(text: string): { emotion: EmotionType; intensity: number } | null {
  if (!text || !text.trim()) return null;
  const lowerText = text.toLowerCase();
  let maxScore = 0;
  let detectedEmotion: EmotionType | null = null;

  // 🆕 情绪分类：仅即时情绪可作为用户消息的主导情绪。
  // trust/pride/guilt 是关系/性格/自我评价维度，由用户消息推断它们不准确（容易把
  // AI 人设的"信任/骄傲"误判为用户情绪），因此不进入候选。
  // curiosity/love 为新增即时情绪（好奇疑惑、爱慕依恋）。
  const IMOTION_DIMS: ReadonlySet<EmotionType> = new Set<EmotionType>([
    'joy', 'fear', 'surprise', 'sadness', 'disgust', 'anger', 'anticipation', 'jealousy',
    'curiosity', 'love', 'gratitude', 'empathy', 'anxiety', 'loneliness', 'disappointment',
  ]);

  for (const [emotion, entries] of Object.entries(emotionKeywords)) {
    const e = emotion as EmotionType;
    if (!IMOTION_DIMS.has(e)) continue; // 关系/性格维度不参与用户情绪主导判定
    let score = 0;
    for (const { kw, weight } of entries) {
      if (lowerText.includes(kw)) {
        score += weight;
      }
    }
    if (score > maxScore) {
      maxScore = score;
      detectedEmotion = e;
    }
  }

  // 标点/语气加权（全局增强）
  const boost = getPunctuationBoost(lowerText);
  if (boost.angry > 0 && (detectedEmotion === 'anger' || detectedEmotion === null)) {
    if (detectedEmotion === null) detectedEmotion = 'anger';
    maxScore += boost.angry;
  }
  if (boost.surprise > 0 && (detectedEmotion === 'surprise' || detectedEmotion === null)) {
    if (detectedEmotion === null) detectedEmotion = 'surprise';
    maxScore += boost.surprise;
  }

  // 无命中 → 返回 null（中性消息不记录情绪，避免 joy:0 噪声）
  if (maxScore === 0 || detectedEmotion === null) return null;

  const intensity = Math.min(Math.round(maxScore * 18 * boost.intensityMul), 100);
  return { emotion: detectedEmotion, intensity };
}

export async function analyzeEmotion(text: string): Promise<{ emotion: EmotionType; intensity: number } | null> {
  const { getConfig, callAI } = await import('../services/aiService');
  const config = getConfig();
  if (!config.apiKey) {
    return analyzeKeyword(text);
  }

  const prompt = `分析以下用户消息的情绪。只返回JSON，不要其他内容。

消息：${text}

要求：
- 从以下情绪中选择最匹配的一个：joy, trust, fear, surprise, sadness, disgust, anger, anticipation, pride, guilt, embarrassment, jealousy, curiosity, love, gratitude, empathy, anxiety, loneliness, disappointment
- intensity 0-100，表示情绪强度
- 仔细分析语气词、表情符号、感叹号、重复词、标点符号等细节
- 同样的文字在不同语境下可能表达不同情绪，请结合上下文判断
- 避免总是返回相同的默认值，每次分析都应该根据具体内容给出不同的判断
- 如果用户消息确实没有情绪（中性陈述），返回 {"emotion":"joy","intensity":0}

返回格式：{"emotion":"情绪类型","intensity":0-100}`;

  try {
    const reply = await callAI([{ role: 'user', content: prompt }], undefined, 150, undefined, MODEL_ROLES.COGNITIVE);
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return analyzeKeyword(text);

    const result = JSON.parse(jsonMatch[0]);
    const validEmotions: EmotionType[] = ['joy', 'trust', 'fear', 'surprise', 'sadness', 'disgust', 'anger', 'anticipation', 'pride', 'guilt', 'embarrassment', 'jealousy', 'curiosity', 'love', 'gratitude', 'empathy', 'anxiety', 'loneliness', 'disappointment'];
    const emotion = validEmotions.includes(result.emotion) ? result.emotion : 'joy';
    const intensity = Math.min(100, Math.max(0, result.intensity || 0));
    // 强度为 0 视为中性（返回 null，避免噪声记录）
    if (intensity === 0) return null;
    return { emotion, intensity };
  } catch (e) {
    console.warn('[emotionAnalyzer] AI analysis failed, falling back to keyword:', e);
    return analyzeKeyword(text);
  }
}

// (多维情感模型已迁移到 emotionStateManager.ts)

/** 取当前主导情绪（最高维度值） */
export function getDominantEmotion(state: MultiEmotionState): { type: EmotionType; intensity: number } {
  // 🆕 仅即时情绪可作主导：排除 trust/pride/guilt（关系/性格/自我评价维度，
  // 衰减慢、基数高，不能体现即时情绪特征），避免"永远信任"掩盖情绪转换。
  const IMOTION_DIMS: ReadonlySet<EmotionType> = new Set<EmotionType>([
    'joy', 'fear', 'surprise', 'sadness', 'disgust', 'anger', 'anticipation', 'jealousy',
    'curiosity', 'love', 'gratitude', 'empathy', 'anxiety', 'loneliness', 'disappointment',
  ]);
  const entries = (Object.entries(state.values) as [EmotionType, number][]).filter(([t]) => IMOTION_DIMS.has(t));
  if (entries.length === 0) return { type: 'anticipation', intensity: 50 };

  entries.sort((a, b) => (b[1] || 0) - (a[1] || 0));
  const [topType, topValue] = entries[0];
  const intensity = Math.min(100, Math.max(0, topValue || 0));

  if (intensity < 5) return { type: 'anticipation', intensity: 50 };

  const validEmotions: EmotionType[] = ['joy', 'trust', 'fear', 'surprise', 'sadness', 'disgust', 'anger', 'anticipation', 'pride', 'guilt', 'embarrassment', 'jealousy', 'curiosity', 'love', 'gratitude', 'empathy', 'anxiety', 'loneliness', 'disappointment'];
  const type = validEmotions.includes(topType) ? topType : 'anticipation';
  return { type, intensity };
}
