/**
 * 模块职责（中文）：编辑语言、时区与数字格式偏好，并提供语言包安装入口。
 * Module responsibility (English): Editing language, time-zone and numeric-format preferences.
 * 详细范围（中文）：公开入口包括 LocaleSettings；职责覆盖编辑语言、时区和数字格式偏好，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include LocaleSettings. The scope covers Editing language, time-zone and numeric-format preferences. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useState } from 'react';
import {
  formatDateTime, formatNumber, readLocalePreferences, saveLocalePreferences,
  timeZoneOptions, validTimeZone, type LocalePreferences,
} from './localization';

/**
 * 中文：呈现编辑语言、时区和数字格式偏好中的 LocaleSettings 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the LocaleSettings surface for Editing language, time-zone and numeric-format preferences. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
export function LocaleSettings() {
  const [draft, setDraft] = useState<LocalePreferences>(readLocalePreferences);
  const [error, setError] = useState('');
  const saved = readLocalePreferences();
  /**
   * 中文：在编辑语言、时区和数字格式偏好流程中编辑草稿，错误反馈；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Editing language, time-zone and numeric-format preferences, editing draft, error feedback. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：part：签名所示 Partial<LocalePreferences> 业务值
   * English: Inputs: part: the Partial<LocalePreferences> domain value in the signature
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const update = (part: Partial<LocalePreferences>) => { setDraft((value) => ({ ...value, ...part })); setError(''); };
  const preview = validTimeZone(draft.timeZone)
    ? new Date().toLocaleString(draft.language, { timeZone: draft.timeZone }) : '时区无效';
  const previewNumber = new Intl.NumberFormat(draft.numberLocale, { minimumFractionDigits: 2 }).format(1234567.89);
  return <section className="system-card" aria-label="语言与区域设置">
    <h3>语言与区域</h3>
    <p>界面可切换简体或繁体中文；日期时间与数值按所选区域展示。</p>
    <div className="feature-grid">
      <label>界面语言
        <select aria-label="界面语言" value={draft.language}
          onChange={(event) => update({ language: event.target.value as LocalePreferences['language'] })}>
          <option value="zh-CN">简体中文</option>
          <option value="zh-TW">繁體中文（臺灣）</option>
        </select>
      </label>
      <label>时间区域
        <input aria-label="时间区域" list="sakura-time-zones" value={draft.timeZone}
          onChange={(event) => update({ timeZone: event.target.value })} />
        <datalist id="sakura-time-zones">{timeZoneOptions().map((zone) => <option key={zone} value={zone} />)}</datalist>
      </label>
      <label>数字格式
        <select aria-label="数字格式" value={draft.numberLocale}
          onChange={(event) => update({ numberLocale: event.target.value as LocalePreferences['numberLocale'] })}>
          <option value="zh-CN">中文 / 1,234.56</option>
          <option value="en-US">English (US) / 1,234.56</option>
          <option value="de-DE">Deutsch / 1.234,56</option>
        </select>
      </label>
    </div>
    <p className="subtle-note">预览：{preview} · {previewNumber}</p>
    {error && <p role="alert" className="error-banner">{error}</p>}
    <button className="primary compact" disabled={!validTimeZone(draft.timeZone) || JSON.stringify(saved) === JSON.stringify(draft)}
      onClick={/** 中文：在编辑语言、时区和数字格式偏好流程中错误反馈，触发所属资源重新读取；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Editing language, time-zone and numeric-format preferences, error feedback, trigger rereading of the owned resource. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
        try { saveLocalePreferences(draft); window.location.reload(); }
        catch (failure) { setError((failure as Error).message); }
      }}>保存语言与区域</button>
    <p className="subtle-note">当前：{formatDateTime(new Date())} · {formatNumber(1234567.89, { minimumFractionDigits: 2 })}</p>
  </section>;
}
