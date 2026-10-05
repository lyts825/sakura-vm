# 前端界面优化 - 视觉指南

## 🎨 核心改进概览

### 1. 深色主题 - 表面层级系统

#### 改进前
```css
--canvas: #201b24;
--surface: #29232f;
--surface-soft: #302936;
--sidebar: #251e2a;
```
- 通过 4 个主要变量定义画布和表面
- 夜间背景相对本次调色板更浅
- ❌ 缺乏深度感

#### 改进后
```css
--canvas: #0a0810;      /* 深近黑画布 */
--surface-1: #15111d;   /* 第一层 */
--surface-2: #1d1825;   /* 第二层 */
--surface-3: #261f2f;   /* 第三层 */
--surface-4: #302938;   /* 第四层 */
--surface-5: #3a3342;   /* 第五层 */
```
- ✅ 6 层表面阶梯（包含画布）
- ✅ 从深近黑逐步上升
- ✅ 丰富的视觉层次

**视觉效果：** 夜间模式下，界面呈现出更深邃的空间感，卡片和面板在深色背景上"浮起"。

---

### 2. 流体排版系统

#### 改进前
```css
font-size: 14px;
.brand > span {
  font-size: 30px;
}
.stat strong {
  font-size: 27px;
}
```
- ❌ 固定尺寸
- ❌ 小屏幕上过大，大屏幕上过小
- ❌ 需要多个媒体查询

#### 改进后
```css
font-size: clamp(13px, 0.95vw, 14px);
.brand > span {
  font-size: clamp(26px, 2.2vw, 30px);
}
.stat strong {
  font-size: clamp(24px, 2.5vw, 27px);
}
```
- ✅ 响应式字体
- ✅ 平滑缩放
- ✅ 在指定上下限内按视口宽度调整

**视觉效果：** 根字号在 13–14px 之间调整，品牌和统计数字分别使用自己的字号范围；其他固定字号规则仍保留。

---

### 3. 圆润几何系统

#### 改进前
```css
border-radius: 9px;   /* 按钮 */
border-radius: 12px;  /* 卡片 */
border-radius: 5px;   /* 小元素 */
border-radius: 6px;   /* 徽章 */
```
- ❌ 混合的圆角值
- ❌ 缺乏统一感

#### 改进后
```css
/* 设计代币 */
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 16px;
--radius-pill: 999px;

/* 应用 */
.primary { border-radius: var(--radius-pill); }
.badge { border-radius: var(--radius-pill); }
.icon-button { border-radius: var(--radius-sm); }
.stat { border-radius: var(--radius-md); }
```
- ✅ 统一的代币系统
- ✅ 胶囊形的主操作按钮和徽章
- ✅ 和谐的视觉语言

**视觉效果：** 界面呈现柔和、现代的外观，按钮像药丸一样圆润。

---

### 4. 微交互动画

#### 改进前
```css
button {
  transition: background 160ms ease, color 160ms ease;
}
```
- ❌ 基础过渡
- ❌ 缺少反馈

#### 改进后
```css
.primary, .secondary, .danger {
  transition: all 180ms cubic-bezier(0.2, 0, 0.3, 1);
}
.primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px #9f456c28;
}
.stat:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-float);
}
input:focus {
  transform: scale(1.005);
}
```
- ✅ 贝塞尔曲线的自然过渡
- ✅ hover 时微妙抬升
- ✅ focus 时轻微放大

**视觉效果：** 交互时有轻盈的"浮起"感，焦点时有呼吸感。

---

### 5. 阴影系统升级

#### 改进前
```css
--shadow: 0 4px 20px #57344c06, 0 1px 3px #57344c04;
box-shadow: var(--shadow);
```
- 普通卡片使用 `--shadow`，其中包含两层阴影
- ❌ 缺少深度

#### 改进后
```css
--shadow-soft: 0 4px 20px #57344c06, 0 1px 3px #57344c04;
--shadow-float: 0 20px 70px #3b203222;

.system-card {
  box-shadow:
    var(--shadow-soft),
    inset 0 1px 0 color-mix(in srgb, white 8%, transparent);
}
.system-card:hover {
  box-shadow: var(--shadow-float), inset 0 1px 0 color-mix(in srgb, white 8%, transparent);
}
```
- ✅ 普通阴影和浮起阴影分别使用变量
- ✅ 内阴影增强质感
- ✅ hover 时阴影加深

**视觉效果：** 卡片拥有真实的材质感，hover 时"飞离"页面。

---

### 6. 状态指示增强

#### 改进前
```css
.tiny-dot.running {
  background: var(--green);
}
```
- ❌ 纯色指示器
- ❌ 不够醒目

#### 改进后
```css
.tiny-dot.running {
  background: var(--green);
  box-shadow: 0 0 8px color-mix(in srgb, var(--green) 60%, transparent);
}
.tiny-dot.error {
  background: var(--danger);
  box-shadow: 0 0 8px color-mix(in srgb, var(--danger) 60%, transparent);
}
```
- ✅ 发光效果
- ✅ 更强的视觉提示

**视觉效果：** 状态点像 LED 灯一样发光，运行状态呈绿色光晕，错误状态呈红色光晕。

---

### 7. 搜索框优化

#### 改进前
```css
.search-box {
  border-radius: 9px;
  border: 1px solid var(--line);
}
.search-box:focus-within {
  border-color: var(--accent-line);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
```
- ❌ 方形外观
- ❌ 焦点效果平淡

#### 改进后
```css
.search-box {
  border-radius: var(--radius-pill);
  transition: all 180ms ease;
}
.search-box:focus-within {
  border-color: var(--accent-line);
  box-shadow: 0 0 0 3px var(--accent-soft);
  transform: scale(1.01);
}
```
- ✅ 药丸形状
- ✅ 焦点时轻微放大

**视觉效果：** 搜索框像一个精致的胶囊，聚焦时有"充能"的感觉。

---

### 8. 导航栏交互

#### 改进前
```css
.nav-item.selected::before {
  content: '';
  position: absolute;
  left: 0;
  width: 3px;
  height: 16px;
  border-radius: 0 3px 3px 0;
  background: var(--accent);
}
```
- ❌ 小型左侧指示条
- ❌ 需要伪元素

#### 改进后
```css
.nav-item {
  transition: all 180ms cubic-bezier(0.2, 0, 0.3, 1);
}
.nav-item.selected {
  box-shadow: inset 3px 0 0 var(--accent);
}
.nav-item:not(.selected):hover {
  transform: translateX(2px);
}
```
- ✅ 内嵌阴影指示器
- ✅ hover 时向右滑动

**视觉效果：** 选中项有清晰的左侧边框，未选中项 hover 时向右"探出"。

---

## 🎯 设计原则总结

### 层次感（Depth）
通过包含画布的 6 层表面阶梯，以及普通、浮起和内阴影，表达视觉深度。

### 流动性（Fluidity）
使用 clamp() 在限定范围内调整字号、间距和内边距。

### 一致性（Consistency）
将部分间距和圆角接入设计变量，沿用已有主题颜色变量。

### 圆润感（Softness）
主操作按钮、徽章和搜索框容器使用胶囊形圆角；普通输入控件使用 8px 圆角。

### 反馈性（Responsiveness）
微交互动画在用户操作时提供即时的视觉反馈。

---

## 📊 验证范围

- 提交前验证结果见[优化总结](../FRONTEND_OPTIMIZATION.md)。
- 动画使用 transform、opacity，也包含颜色、边框和阴影过渡；未测量 GPU 合成或帧率。
- 保留已有 `prefers-reduced-motion` 规则；未进行完整的无障碍或跨浏览器审计。

---

## 🚀 技术亮点

1. **CSS 自定义属性** - 完整的主题化系统
2. **color-mix()** - 动态颜色混合
3. **clamp()** - 响应式尺寸
4. **CSS Grid** - 现代布局系统
5. **贝塞尔曲线** - 自然的动画曲线

---

## 📱 响应式支持

- ≥1500px：沿用 236px 侧栏和对应主内容左边距。
- 1181–1499px：默认 220px 侧栏。
- 1021–1180px：沿用 198px 侧栏。
- 601–1020px：沿用 72px 图标侧栏。
- ≤600px：沿用顶部导航和纵向主布局。

主容器保留 Flex 布局，使固定侧栏、主内容左边距和移动端纵向布局相互匹配。
