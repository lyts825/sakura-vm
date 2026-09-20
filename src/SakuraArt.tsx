import { memo, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Pause, Play, Wind } from 'lucide-react';
import './sakura-art.css';

const blossoms = [
  [352, 88, -20, 0.56],
  [401, 114, 14, 0.76],
  [449, 71, -9, 0.68],
  [466, 138, 30, 0.96],
  [517, 168, -17, 0.67],
  [548, 103, 9, 0.88],
  [593, 187, 18, 0.78],
  [634, 150, -5, 0.52],
] as const;

const petals = [
  { x: 355, y: 82, dx: -88, dy: 171, seconds: 12, delay: -3, scale: 0.9 },
  { x: 449, y: 67, dx: -67, dy: 210, seconds: 14, delay: -9, scale: 0.7 },
  { x: 470, y: 137, dx: -104, dy: 145, seconds: 11, delay: -6, scale: 0.85 },
  { x: 550, y: 98, dx: -123, dy: 181, seconds: 13, delay: -1, scale: 1 },
  { x: 597, y: 180, dx: -98, dy: 104, seconds: 10, delay: -7, scale: 0.75 },
  { x: 405, y: 106, dx: -122, dy: 178, seconds: 15, delay: -12, scale: 0.6 },
] as const;

/** A local SVG scene. Only CSS transforms and opacity animate; React never runs per frame. */
export const SakuraArt = memo(function SakuraArt() {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(() => {
    try {
      return localStorage.getItem('sakura-motion') === 'paused';
    } catch {
      return false;
    }
  });
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [inView, setInView] = useState(true);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => setReduced(media.matches);
    const updateVisibility = () => setPageVisible(!document.hidden);
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0 });
    if (ref.current) observer.observe(ref.current);
    media.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    updateMotion();
    updateVisibility();
    return () => {
      observer.disconnect();
      media.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);
  const playing = !paused && !reduced && inView && pageVisible;
  const url = (name: string) => `url(#${id}-${name})`;
  const toggle = () => {
    const next = !paused;
    setPaused(next);
    try {
      localStorage.setItem('sakura-motion', next ? 'paused' : 'playing');
    } catch {
      // The control remains usable when browser storage is disabled.
    }
  };
  return (
    <div
      ref={ref}
      className="sakura-illustration"
      data-motion={playing ? 'playing' : 'paused'}
      data-reduced-motion={reduced}
    >
      <svg className="sakura-scene" viewBox="0 0 680 280" fill="none" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={id + '-fade'}>
            <stop stopColor="white" stopOpacity="0" />
            <stop offset=".25" stopColor="white" stopOpacity=".65" />
            <stop offset=".46" stopColor="white" />
          </linearGradient>
          <mask id={id + '-scene-mask'}>
            <rect width="680" height="280" fill={url('fade')} />
          </mask>
          <radialGradient id={id + '-petal'} cx=".5" cy=".95" r=".95">
            <stop className="petal-center" />
            <stop offset=".52" className="petal-middle" />
            <stop offset="1" className="petal-edge" />
          </radialGradient>
          <linearGradient id={id + '-land-fade'} x2="0" y2="1">
            <stop stopColor="white" />
            <stop offset=".76" stopColor="white" stopOpacity=".7" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <mask id={id + '-land-mask'}>
            <rect width="680" height="280" fill={url('land-fade')} />
          </mask>
          <pattern id={id + '-paper'} width="64" height="48" patternUnits="userSpaceOnUse">
            <path d="m9 8 2 5m20 7 4-2m17 15 2 5M6 39l5-2m32-32-1 4m-19 29 2 3" className="paper-fiber" />
            <g className="paper-fleck">
              <circle cx="18" cy="22" r=".65" />
              <circle cx="55" cy="9" r=".45" />
              <circle cx="35" cy="43" r=".6" />
            </g>
          </pattern>
          <pattern id={id + '-waves'} width="64" height="32" patternUnits="userSpaceOnUse">
            <path
              d="M0 32a32 32 0 0 1 64 0M6 32a26 26 0 0 1 52 0M12 32a20 20 0 0 1 40 0M18 32a14 14 0 0 1 28 0M24 32a8 8 0 0 1 16 0"
              className="wave-line"
            />
          </pattern>
          <g id={id + '-blossom'}>
            {[0, 72, 144, 216, 288].map((angle) => (
              <g key={angle} transform={`rotate(${angle})`}>
                <path
                  d="M0 3C-7-1-19-12-17-24C-16-30-10-34-5-33L0-27L5-33C10-34 16-30 17-24C19-12 7-1 0 3Z"
                  fill={url('petal')}
                  className="blossom-outline"
                />
                <path d="M0-3C-3-10-5-16-5-23M1-5C4-11 6-17 7-24" className="petal-vein" />
              </g>
            ))}
            {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
              <g key={angle} transform={`rotate(${angle})`}>
                <path d="M0 0 1-12" className="flower-filament" />
                <circle cx="1" cy="-12" r="1.35" className="flower-pollen" />
              </g>
            ))}
            <circle r="3.6" className="flower-heart" />
          </g>
        </defs>

        <g mask={url('scene-mask')}>
          <g className="garden-sky">
            <circle className="garden-sun" cx="468" cy="88" r="59" />
            <g className="garden-moon">
              <circle cx="468" cy="88" r="58" />
              <circle className="moon-mark" cx="447" cy="64" r="13" />
              <circle className="moon-mark" cx="490" cy="106" r="8" />
              <path className="moon-mark" d="M455 115c5-8 19-10 23-4s-7 16-13 14-14-5-10-10Z" />
            </g>
            <g className="garden-stars">
              <path d="M347 35v7m-3.5-3.5h7M577 37v9m-4.5-4.5h9M390 58v5m-2.5-2.5h5" />
              <circle cx="541" cy="27" r="1.1" />
              <circle cx="304" cy="77" r=".9" />
            </g>
          </g>
          <g mask={url('land-mask')}>
            <path
              className="distant-ridge"
              d="M102 247 263 175c15-7 29-4 42-12l67-45c5-3 8-2 13 3l93 89 83-34 137 65v45H102Z"
            />
            <path className="ridge-snow" d="m327 149 45-31c5-3 8-2 13 3l32 31-29-10-9 7-10-16-20 20-8-10Z" />
            <path
              className="near-ridge"
              d="M155 261c67-15 112-53 155-53s87 43 127 35c46-9 55-57 103-53s83 31 150 18v78H155Z"
            />
            <path
              className="garden-mist"
              d="M132 224c85-10 122 8 189 6s100-16 171-11 113 12 191-3v12c-99 12-136-2-205-1s-119 17-173 13-114-9-173-5Z"
            />
            <rect x="148" y="243" width="540" height="45" fill={url('waves')} />
          </g>
          <rect width="680" height="280" fill={url('paper')} opacity=".42" />

          <g className="sakura-bough">
            <g className="branch-ink" strokeLinecap="round" strokeLinejoin="round">
              <path
                d="M701 271C650 235 622 217 585 198S530 163 506 145 446 116 399 105 355 86 325 79"
                strokeWidth="5.6"
              />
              <path
                d="M584 198c-17-31-23-65-35-91s-27-39-36-56M475 129c-5-19-15-39-28-59s-30-27-52-29M541 171c37-3 64-8 91-22s40-31 51-44"
                strokeWidth="2.8"
              />
              <path
                d="M399 105c-2-20-10-34-22-42M558 129c20-10 36-24 41-47M451 79l20-26M610 158l-1-25M350 87l-10-26M520 67l19-13M426 114l-6 27"
                strokeWidth="1.4"
              />
              <path
                className="branch-highlight"
                d="M690 265c-47-33-65-44-104-64s-61-39-77-49"
                strokeWidth="1.2"
              />
            </g>
            <g className="sakura-leaves">
              <path d="M556 123c5-15 19-17 22-13-1 9-11 14-22 13Z" />
              <path d="M513 153c-6-15-17-18-21-14 1 9 12 15 21 14Z" />
              <path d="M610 159c2 11 14 17 20 12-5-8-13-12-20-12Z" />
              <path className="leaf-vein" d="m557 121 16-9m-62 38-14-9m116 19 12 9" />
            </g>
            {blossoms.map(([x, y, angle, scale]) => (
              <use
                key={x}
                href={`#${id}-blossom`}
                transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}
              />
            ))}
            <g className="sakura-buds">
              <path d="M378 66c-11-5-14-19-6-21s14 13 6 21ZM472 55c-2-13 4-22 11-19s3 17-11 19ZM600 84c-6-12-1-22 6-20s6 17-6 20ZM339 63c-13-3-16-14-9-17s13 8 9 17ZM634 149c10-11 18-11 20-5s-8 11-20 5Z" />
            </g>
          </g>

          <g className="sakura-petal-field">
            {petals.map((petal, index) => (
              <g
                key={index}
                className="petal-origin"
                transform={`translate(${petal.x} ${petal.y}) scale(${petal.scale})`}
              >
                <g
                  className="petal-fall"
                  style={
                    {
                      '--petal-x': `${petal.dx}px`,
                      '--petal-y': `${petal.dy}px`,
                      '--fall-duration': `${petal.seconds}s`,
                      '--fall-delay': `${petal.delay}s`,
                      '--flutter-duration': `${3.2 + index * 0.4}s`,
                    } as CSSProperties
                  }
                >
                  <path className="petal-flutter" d="M0 6C-12 0-11-11-5-13L-1-9 2-13C10-9 9 1 0 6Z" />
                </g>
              </g>
            ))}
          </g>
          <g className="resting-petals">
            <path d="M288 236c-3-8 8-11 15-5-4 6-10 8-15 5ZM425 262c-7-4-5-11 2-10s13 7 10 9c-4 2-8 2-12 1Z" />
          </g>
        </g>
        <g className="garden-inscription">
          <text x="651" y="61" className="garden-poem">
            春風に、ひとひら。
          </text>
          <g transform="translate(638 16) rotate(-4 12 13)" className="garden-seal">
            <path d="m1 1 22 1 1 24-23-1Z" />
            <path className="seal-border" d="m4 4 16 1 1 17-17-1Z" />
            <text x="12" y="19" textAnchor="middle">
              桜
            </text>
          </g>
        </g>
      </svg>
      <div className="garden-caption" aria-hidden="true">
        <span>春の庭</span>
        <i />
        SAKURA GARDEN
      </div>
      <button
        className="art-motion-toggle"
        disabled={reduced}
        aria-label={reduced ? '已跟随系统减少动态效果' : paused ? '播放樱花动画' : '暂停樱花动画'}
        title={reduced ? '已遵循系统的减少动态效果设置' : paused ? '播放樱花动画' : '暂停樱花动画'}
        onClick={toggle}
      >
        {reduced ? <Wind size={12} /> : paused ? <Play size={11} /> : <Pause size={11} />}
        <span>{reduced ? '静态插图' : paused ? '动画已暂停' : '花瓣飘落'}</span>
      </button>
    </div>
  );
});
