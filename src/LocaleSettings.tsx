import { useState } from 'react';
import {
  formatDateTime, formatNumber, readLocalePreferences, saveLocalePreferences,
  timeZoneOptions, validTimeZone, type LocalePreferences,
} from './localization';

export function LocaleSettings() {
  const [draft, setDraft] = useState<LocalePreferences>(readLocalePreferences);
  const [error, setError] = useState('');
  const saved = readLocalePreferences();
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
      onClick={() => {
        try { saveLocalePreferences(draft); window.location.reload(); }
        catch (failure) { setError((failure as Error).message); }
      }}>保存语言与区域</button>
    <p className="subtle-note">当前：{formatDateTime(new Date())} · {formatNumber(1234567.89, { minimumFractionDigits: 2 })}</p>
  </section>;
}
