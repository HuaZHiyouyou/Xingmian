/**
 * ============================================================
 * 日历层（B6.1）
 * 工作日/周末/节假日判断，日程生成约束的数据源。
 * 内置 2026 年法定节假日表 + 用户自定义（config.extra.customHolidays）。
 * ============================================================
 */

export interface WorkCalendar {
  /** 工作日（周一=1） */
  workdays: number[];
  /** 上班时间 '09:00' */
  shiftStart: string;
  /** 下班时间 '18:00' */
  shiftEnd: string;
  /** 通勤分钟数（迟到判断提前量） */
  commuteMinutes: number;
  /** 节假日（YYYY-MM-DD → 名称） */
  holidays: Record<string, string>;
  /** 已请假日期 */
  personalLeaveDays: string[];
}

/** 内置 2026 年法定节假日（YYYY-MM-DD；调休补班日不单独建模，周末+节假日即休） */
export const BUILTIN_HOLIDAYS_2026: Record<string, string> = {
  // 元旦
  '2026-01-01': '元旦', '2026-01-02': '元旦', '2026-01-03': '元旦',
  // 春节
  '2026-02-15': '除夕', '2026-02-16': '春节', '2026-02-17': '春节', '2026-02-18': '春节',
  '2026-02-19': '春节', '2026-02-20': '春节', '2026-02-21': '春节', '2026-02-22': '春节',
  // 清明
  '2026-04-04': '清明', '2026-04-05': '清明', '2026-04-06': '清明',
  // 劳动节
  '2026-05-01': '劳动节', '2026-05-02': '劳动节', '2026-05-03': '劳动节', '2026-05-04': '劳动节', '2026-05-05': '劳动节',
  // 端午
  '2026-06-19': '端午', '2026-06-20': '端午', '2026-06-21': '端午',
  // 中秋
  '2026-09-25': '中秋', '2026-09-26': '中秋', '2026-09-27': '中秋',
  // 国庆
  '2026-10-01': '国庆', '2026-10-02': '国庆', '2026-10-03': '国庆', '2026-10-04': '国庆',
  '2026-10-05': '国庆', '2026-10-06': '国庆', '2026-10-07': '国庆', '2026-10-08': '国庆',
};

export function defaultWorkCalendar(): WorkCalendar {
  return {
    workdays: [1, 2, 3, 4, 5],
    shiftStart: '09:00',
    shiftEnd: '18:00',
    commuteMinutes: 30,
    holidays: { ...BUILTIN_HOLIDAYS_2026 },
    personalLeaveDays: [],
  };
}

export type DayKind = 'workday' | 'weekend' | 'holiday' | 'leave';

/** 判断某日期的性质（优先级：请假 > 节假日 > 周末 > 工作日） */
export function classifyDay(date: Date, cal: WorkCalendar): DayKind {
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  if (cal.personalLeaveDays.includes(key)) return 'leave';
  if (cal.holidays[key]) return 'holiday';
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return 'weekend';
  return cal.workdays.includes(dow) ? 'workday' : 'weekend';
}

/** 日程生成的日期性质描述（注入 timeRule） */
export function describeDayKind(date: Date, cal: WorkCalendar): string {
  const kind = classifyDay(date, cal);
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  switch (kind) {
    case 'holiday': return `节假日（${cal.holidays[key] || '法定假日'}，不用上班）`;
    case 'leave': return '请假/病假日（在家休养，当日无薪）';
    case 'weekend': return '周末（不用上班）';
    default: return `工作日（上班 ${cal.shiftStart}-${cal.shiftEnd}）`;
  }
}

/** 从角色生活配置读取日历（config.extra.workCalendar，缺省默认） */
export function readWorkCalendar(extra: Record<string, unknown> | undefined): WorkCalendar {
  const cal = extra?.workCalendar as Partial<WorkCalendar> | undefined;
  if (!cal) return defaultWorkCalendar();
  return {
    ...defaultWorkCalendar(),
    ...cal,
    holidays: { ...BUILTIN_HOLIDAYS_2026, ...(cal.holidays || {}) },
  };
}

/** 病假登记（B3 后果链触发时调用：当日无薪） */
export function markLeaveDay(cal: WorkCalendar, date: Date): WorkCalendar {
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  if (!cal.personalLeaveDays.includes(key)) {
    cal.personalLeaveDays.push(key);
  }
  return cal;
}
