# 樱花插图

本轮参考用户提供的两张图片：第一张的透光粉白花瓣、自然枝条与景深，第二张的柔和手绘边缘、细花蕊及虚实层次。页面使用重新生成的原创构图，参考截图不随应用打包。

## 素材

- 页面素材：[`src/assets/sakura-bough-painted.webp`](../src/assets/sakura-bough-painted.webp)
- 尺寸：1774 × 887，保留透明通道。
- 文件大小：247,668 字节，约 242 KiB。
- 生成方式：内置 `image_gen` 工具，单张素材，使用两张用户图片作视觉参考；未使用 CLI 或额外模型 API。
- 原始 PNG 在本地 `artifacts/imagegen/sakura-bough-painted.png` 留档（Git 忽略），生成工具的原件也保留。页面引用的 WebP 已加入源码管理。
- WebP 编码：sharp，quality 86、alphaQuality 100、effort 6，保持原始尺寸。裁切、夜间配色和动态由 SVG / CSS 实现。

## 页面中的使用

花簇从横幅右上方伸入，左侧保留标题和操作区。淡蓝雾光、低对比远山和少量圆形光斑提供景深；夜间降低花瓣亮度并显示柔和月光。手机端使用更靠右的裁切及更低的整体透明度。

枝条、花瓣和光斑只使用 CSS transform / opacity 做持续动画，没有逐帧 React 更新。沿用暂停偏好、可见区域与页面可见性监听，遵循系统减少动态效果设置。小屏减少花瓣与光斑数量。

## 最终生成提示词

```text
Use case: stylized-concept
Asset type: original transparent cherry-blossom bough illustration for the right side of Sakura's desktop web dashboard hero.
Input images: image 1 is a lighting and botanical reference only (ignore all desktop icons and interface); image 2 is a brushwork, petal-shape, and gentle depth-of-field reference only. Do not copy either composition.
Primary request: paint a graceful Japanese sakura branch with small, natural five-petal blossoms, inspired by translucent sunlit petals from reference 1 and the restrained hand-painted style of reference 2.
Composition: wide 2:1 landscape, ideally 1536 x 768. A slender mauve-brown bough enters from the upper right and arcs down toward the middle-left, with three airy clusters of blossoms. The upper/right two-thirds hold the subject; keep the left quarter and bottom quarter mostly empty transparent negative space for integration. Keep every important blossom fully in frame. About 18-24 small blossoms and a few buds, some front-facing and some tilted. Individual flowers occupy only 4-7 percent of image width. Clusters have breathing room.
Style: refined Japanese animation background painting with gouache and translucent watercolor edges; subtly irregular scalloped and notched petals, pale blush pink and ivory, deeper dusty-rose centers, very fine wine-pink stamens, very few tiny muted leaves. Soft rim light, delicate petal veins, gentle layered shadows, lightly softened background blossoms and crisp middle-distance flowers. Natural asymmetry; mature, quiet, elegant.
Constraints: genuinely transparent alpha background, including spaces between branches and petals; no solid background and no checkerboard drawn into pixels. No scenery, sun, moon, mountain, vase, ground, lettering, logos, border, sparkle icons, desktop icons, or watermark. Do not produce a UI mockup. Render only the reusable botanical artwork; avoid a round bouquet, giant flowers, hard vector outlines, saturated hot pink, and dense opaque foliage.
```
