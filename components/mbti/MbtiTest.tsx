import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, RotateCcw, Clock, Trash2 } from 'lucide-react';
import { useMbtiStore } from '../../store/mbtiStore';
import { MbtiType } from '../../types';

const DIMENSION_LABELS: Record<string, { left: string; right: string; label: string; desc: string }> = {
  EI: { left: '外向 (E)', right: '内向 (I)', label: '精力来源', desc: '你从哪里获得能量？' },
  SN: { left: '实感 (S)', right: '直觉 (N)', label: '信息获取', desc: '你如何接收信息？' },
  TF: { left: '思考 (T)', right: '情感 (F)', label: '决策方式', desc: '你如何做决定？' },
  JP: { left: '判断 (J)', right: '感知 (P)', label: '生活方式', desc: '你如何应对外部世界？' },
};

const MBTI_DESCRIPTIONS: Record<MbtiType, { emoji: string; title: string; desc: string; strengths: string; weaknesses: string; careers: string }> = {
  INTJ: { emoji: '🔬', title: '建筑师', desc: '富有想象力和战略性的思想家，一切皆在计划之中。', strengths: '独立思考、逻辑严密、意志坚定、高效率', weaknesses: '过于理性、不善表达情感、对他人要求高', careers: '科学家、系统架构师、投资分析师、战略顾问' },
  INTP: { emoji: '🧠', title: '逻辑学家', desc: '具有创造力的发明家，对知识有着永不满足的渴求。', strengths: '善于分析、创造力强、客观公正、求知欲强', weaknesses: '优柔寡断、不善社交、容易走神、过于理论化', careers: '程序员、数学家、物理学家、数据科学家' },
  ENTJ: { emoji: '👑', title: '指挥官', desc: '大胆、富有想象力且意志坚强的领导者。', strengths: '天生领导力、果断决策、战略思维、高效执行', weaknesses: '固执、缺乏耐心、过于强势、不善倾听', careers: 'CEO、企业家、律师、管理顾问' },
  ENTP: { emoji: '💡', title: '辩论家', desc: '聪明好奇的思想者，不会放过任何智力挑战。', strengths: '思维敏捷、创新能力强、适应力好、知识面广', weaknesses: '缺乏专注力、喜欢争论、不善处理细节、三分钟热度', careers: '创业者、记者、营销策划、律师' },
  INFJ: { emoji: '🌟', title: '提倡者', desc: '安静而神秘，同时鼓舞人心且不知疲倦的理想主义者。', strengths: '洞察力强、有同理心、坚持理想、善于理解他人', weaknesses: '容易疲惫、过于理想化、回避冲突、完美主义', careers: '心理咨询师、作家、人力资源、社会工作者' },
  INFP: { emoji: '🦋', title: '调停者', desc: '诗意、善良的利他主义者，总是热衷于为正义事业提供帮助。', strengths: '富有同情心、创造力强、忠于价值观、善于理解', weaknesses: '过于理想化、不切实际、容易逃避现实、情绪化', careers: '作家、艺术家、心理咨询师、非营利组织工作者' },
  ENFJ: { emoji: '🎭', title: '主人公', desc: '富有魅力且鼓舞人心的领导者，能够着迷他的听众。', strengths: '有感染力、善于激励他人、组织能力强、可靠', weaknesses: '过于在意他人评价、不善拒绝、忽略自身需求', careers: '教师、项目经理、公关、政治家' },
  ENFP: { emoji: '🌈', title: '竞选者', desc: '热情、有创造力、社交能力强，总能找到理由微笑。', strengths: '热情洋溢、创造力强、善于社交、乐观积极', weaknesses: '注意力分散、过度乐观、不善处理细节、情绪波动', careers: '记者、演员、营销、创意总监' },
  ISTJ: { emoji: '📋', title: '物流师', desc: '实际且注重事实的个人，其可靠性不容怀疑。', strengths: '责任心强、有条理、务实可靠、注重细节', weaknesses: '过于刻板、不善变通、情感表达少、固执己见', careers: '会计师、审计员、项目经理、军事人员' },
  ISFJ: { emoji: '🛡️', title: '守卫者', desc: '非常专注且温暖的守护者，时刻准备着保护所爱的人。', strengths: '忠诚可靠、体贴入微、善于观察、有奉献精神', weaknesses: '过于自我牺牲、不善拒绝、逃避冲突、过度担忧', careers: '护士、教师、社会工作者、行政助理' },
  ESTJ: { emoji: '⚖️', title: '总经理', desc: '出色的管理者，在管理事物或人员方面无与伦比。', strengths: '组织能力强、可靠务实、果断决策、重视秩序', weaknesses: '过于强势、不善变通、缺乏同理心、过于传统', careers: '企业管理者、法官、项目经理、银行经理' },
  ESFJ: { emoji: '🤝', title: '执政官', desc: '非常关心他人的人，社交能力强，受欢迎，热衷助人。', strengths: '善解人意、有责任心、热心助人、善于社交', weaknesses: '过于在意他人评价、不善处理冲突、缺乏独立性', careers: '销售、客户服务、人力资源、活动策划' },
  ISTP: { emoji: '🔧', title: '鉴赏家', desc: '大胆而实际的实验家，擅长使用各种形式的工具。', strengths: '动手能力强、冷静理性、适应力好、善于解决问题', weaknesses: '不善表达情感、不喜欢承诺、容易冒险、孤立自己', careers: '工程师、消防员、飞行员、机械师' },
  ISFP: { emoji: '🎨', title: '探险家', desc: '灵活而有魅力的艺术家，时刻准备着探索和体验新事物。', strengths: '艺术感强、善良温和、活在当下、适应力好', weaknesses: '回避冲突、容易受伤、不善计划、过度自谦', careers: '设计师、摄影师、厨师、动物护理' },
  ESTP: { emoji: '🏃', title: '企业家', desc: '聪明、精力充沛且非常善于感知的人，真正享受活在当下。', strengths: '行动力强、勇敢果断、善于社交、务实高效', weaknesses: '冲动冒险、缺乏耐心、不善规划、容易无聊', careers: '企业家、运动员、销售、急救人员' },
  ESFP: { emoji: '🎉', title: '表演者', desc: '自发的、精力充沛的、热情的娱乐者，生活永远不会无聊。', strengths: '热情开朗、善于社交、乐观积极、感染力强', weaknesses: '注意力分散、回避问题、容易冲动、不善规划', careers: '演员、主持人、导游、活动策划' },
};

const DIMENSION_ANALYSIS: Record<string, { strong: string; mild: string; balanced: string }> = {
  EI: { strong: '你有明确的能量偏好。', mild: '你能在社交和独处间灵活切换。', balanced: '你是真正的 ambivert。' },
  SN: { strong: '你有明确的信息处理偏好。', mild: '你能在事实和概念间灵活切换。', balanced: '你兼顾实际与想象。' },
  TF: { strong: '你的决策风格有明确倾向。', mild: '你能在理性和感性间找到平衡。', balanced: '你完美融合了理性和感性。' },
  JP: { strong: '你有明确的生活节奏偏好。', mild: '你能在秩序和变化间找到平衡。', balanced: '你兼具计划性和灵活性。' },
};

export function MbtiTest() {
  const navigate = useNavigate();
  const { questions, currentQuestion, answers, result, isCompleted, history, answerQuestion, goBack, calculateResult, resetTest, loadHistory, deleteTest } = useMbtiStore();
  const [showIntro, setShowIntro] = useState(!isCompleted && currentQuestion === 0);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const totalQuestions = questions.length;
  const progress = (currentQuestion / totalQuestions) * 100;
  const question = questions[currentQuestion];
  const isLastQuestion = currentQuestion === totalQuestions - 1;
  const hasAnswered = question ? !!answers[question.id] : false;

  const handleAnswer = (choice: 'A' | 'B') => {
    answerQuestion(question.id, choice);
    if (isLastQuestion) {
      setTimeout(() => calculateResult(), 300);
    }
  };

  const handleRetake = () => {
    resetTest();
    setShowIntro(true);
  };

  // ===== 结果页面 =====
  if (isCompleted && result) {
    const info = MBTI_DESCRIPTIONS[result.type];
    return (
      <div className="flex-1 bg-gray-50 dark:bg-gray-950 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 pt-6 pb-8">
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => navigate('/chat')} className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors">
              <ArrowLeft size={18} className="text-gray-500" />
            </button>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">MBTI 测试结果</h1>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-sm mb-4">
            <div className="text-center mb-6">
              <div className="text-5xl mb-3">{info.emoji}</div>
              <div className="text-3xl font-bold text-slate-700 dark:text-slate-500 mb-1">{result.type}</div>
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{info.title}</div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{info.desc}</p>
            </div>

            <div className="space-y-5">
              {(['EI', 'SN', 'TF', 'JP'] as const).map(dim => {
                const dimInfo = DIMENSION_LABELS[dim];
                const value = result.dimensions[dim];
                const absVal = Math.abs(value);
                const leftPercent = Math.round(((100 - value) / 200) * 100);
                const rightPercent = 100 - leftPercent;
                const leftActive = value < 0;
                const lean = leftActive ? dimInfo.left : dimInfo.right;
                const strength = absVal > 60 ? 'strong' : absVal > 20 ? 'mild' : 'balanced';
                const analysis = DIMENSION_ANALYSIS[dim][strength];

                return (
                  <div key={dim} className="pb-4 border-b border-gray-100 dark:border-gray-800 last:border-0 last:pb-0">
                    <div className="flex justify-between text-[10px] text-gray-400 dark:text-gray-500 mb-1">
                      <span className={leftActive ? 'font-bold text-slate-700 dark:text-slate-300' : ''}>{dimInfo.left}</span>
                      <span className="text-[9px] opacity-60">{dimInfo.label}</span>
                      <span className={!leftActive ? 'font-bold text-slate-700 dark:text-slate-300' : ''}>{dimInfo.right}</span>
                    </div>
                    <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden flex mb-2">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${leftPercent}%`, backgroundColor: leftActive ? '#475569' : '#d1d5db' }} />
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${rightPercent}%`, backgroundColor: !leftActive ? '#475569' : '#d1d5db' }} />
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                      <span className="font-medium text-slate-700 dark:text-slate-300">{lean}</span> {absVal > 60 ? '倾向明显' : absVal > 20 ? '略偏' : '较均衡'}（{absVal}%）· {analysis}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={handleRetake} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
              <RotateCcw size={16} />
              重新测试
            </button>
            <button onClick={() => navigate('/chat')} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 transition-colors">
              返回聊天
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ===== 介绍页面 =====
  if (showIntro) {
    return (
      <div className="flex-1 bg-gray-50 dark:bg-gray-950 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 pt-6 pb-8">
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => navigate('/chat')} className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors">
              <ArrowLeft size={18} className="text-gray-500" />
            </button>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">MBTI 性格测试</h1>
          </div>

          {/* 主介绍 */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-sm mb-4">
            <div className="text-center mb-5">
              <div className="text-5xl mb-3">🧬</div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">发现你的性格类型</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                MBTI（迈尔斯-布里格斯类型指标）通过四个维度将人的性格分为 16 种类型，帮助你更好地了解自己。
              </p>
            </div>

            <div className="space-y-3 mb-5">
              {Object.entries(DIMENSION_LABELS).map(([, v]) => (
                <div key={v.label} className="px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs font-medium text-gray-700 dark:text-gray-300">{v.left} <span className="text-gray-400 mx-1">vs</span> {v.right}</div>
                    <span className="text-[10px] text-slate-700 dark:text-slate-300 font-medium">{v.label}</span>
                  </div>
                  <p className="text-[11px] text-gray-400 leading-relaxed">{v.desc}</p>
                </div>
              ))}
            </div>

            <button onClick={() => setShowIntro(false)} className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 transition-colors">
              开始测试
            </button>
          </div>

          {/* 测试说明 */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 shadow-sm mb-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">测试说明</h3>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-800/30 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-slate-700 dark:text-slate-500">1</span>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300">凭直觉选择</p>
                  <p className="text-[11px] text-gray-400 leading-relaxed">不要过度思考，选择第一反应更符合你真实感受的选项。MBTI 测量的是你的自然偏好，而非"正确答案"。</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-800/30 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-slate-700 dark:text-slate-500">2</span>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300">没有对错之分</p>
                  <p className="text-[11px] text-gray-400 leading-relaxed">每种性格类型都有独特的优势和魅力，不存在"更好"或"更差"的类型。结果只是帮助你理解自己。</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-800/30 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-slate-700 dark:text-slate-500">3</span>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300">考虑情境</p>
                  <p className="text-[11px] text-gray-400 leading-relaxed">请在放松、自然的状态下答题。如果你正在经历特殊时期（如考试、工作高压），结果可能会有偏差。</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-800/30 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-slate-700 dark:text-slate-500">4</span>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300">可重复测试</p>
                  <p className="text-[11px] text-gray-400 leading-relaxed">你的性格会随着成长而变化。建议每隔一段时间重新测试，观察自己的变化轨迹。</p>
                </div>
              </div>
            </div>
          </div>

          {/* 16 种人格类型 */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">16 种人格类型</h3>
            <div className="grid grid-cols-1 gap-3">
              {(Object.entries(MBTI_DESCRIPTIONS) as [MbtiType, typeof MBTI_DESCRIPTIONS[MbtiType]][]).map(([type, info]) => (
                <div key={type} className="px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-800/50">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-lg">{info.emoji}</span>
                    <div>
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-500">{type}</span>
                      <span className="text-[11px] text-gray-500 dark:text-gray-400 ml-1.5">{info.title}</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed mb-2">{info.desc}</p>
                  <div className="flex flex-wrap gap-1.5 text-[10px]">
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800/20 text-slate-700 dark:text-slate-500">优势：{info.strengths}</span>
                    <span className="px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400">劣势：{info.weaknesses}</span>
                    <span className="px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">适合：{info.careers}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 测试历史 */}
          {history.length > 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Clock size={14} className="text-gray-400" />
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">测试历史</h3>
                  <span className="text-[10px] text-gray-400">({history.length} 次)</span>
                </div>
              </div>
              <div className="space-y-2">
                {history.map(record => {
                  const info = MBTI_DESCRIPTIONS[record.type];
                  const date = new Date(record.completedAt);
                  return (
                    <div key={record.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/50 group">
                      <span className="text-lg">{info.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-500">{record.type}</span>
                          <span className="text-[11px] text-gray-500 dark:text-gray-400">{info.title}</span>
                        </div>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })}
                          {' '}
                          {date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <button
                        onClick={() => deleteTest(record.id)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                        title="删除记录"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===== 答题页面 =====
  return (
    <div className="flex-1 bg-gray-50 dark:bg-gray-950 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/chat')} className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors">
              <ArrowLeft size={18} className="text-gray-500" />
            </button>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">MBTI 测试</h1>
          </div>
          <span className="text-xs text-gray-400">{currentQuestion + 1} / {totalQuestions}</span>
        </div>

        <div className="h-1.5 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden mb-6">
          <div className="h-full bg-slate-700 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>

        {question && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-sm mb-4">
            <div className="text-[10px] text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2 font-medium">
              {DIMENSION_LABELS[question.dimension]?.label}
            </div>
            <h2 className="text-base font-medium text-gray-900 dark:text-gray-100 mb-5 leading-relaxed">
              {question.text}
            </h2>

            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={() => handleAnswer('A')}
                className={`w-full text-left px-4 py-3.5 rounded-xl border text-sm transition-all ${
                  answers[question.id] === 'A'
                    ? 'border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                    : 'border-gray-200 dark:border-gray-700 hover:border-slate-400 dark:hover:border-slate-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                <span className="font-medium mr-2 opacity-40">A</span>
                {question.optionA.label}
              </button>
              <button
                onClick={() => handleAnswer('B')}
                className={`w-full text-left px-4 py-3.5 rounded-xl border text-sm transition-all ${
                  answers[question.id] === 'B'
                    ? 'border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                    : 'border-gray-200 dark:border-gray-700 hover:border-slate-400 dark:hover:border-slate-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                <span className="font-medium mr-2 opacity-40">B</span>
                {question.optionB.label}
              </button>
            </div>
          </div>
        )}

        <div className="flex justify-between">
          <button
            onClick={goBack}
            disabled={currentQuestion === 0}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ArrowLeft size={16} />
            上一题
          </button>

          {isLastQuestion && hasAnswered && (
            <button onClick={calculateResult} className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 transition-colors">
              查看结果
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
