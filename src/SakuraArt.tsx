import { memo, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Pause, Play, Wind } from 'lucide-react';
import paintedBough from './assets/sakura-bough-painted.webp';
import './sakura-art.css';

const petals = [
  { x: 346, y: 139, dx: -66, dy: 158, seconds: 17, delay: -4, scale: 0.72 },
  { x: 455, y: 77, dx: -88, dy: 219, seconds: 20, delay: -13, scale: 0.6 },
  { x: 515, y: 61, dx: -64, dy: 218, seconds: 18, delay: -8, scale: 0.7 },
  { x: 560, y: 162, dx: -91, dy: 128, seconds: 16, delay: -2, scale: 0.83 },
  { x: 607, y: 84, dx: -77, dy: 209, seconds: 19, delay: -11, scale: 0.62 },
  { x: 640, y: 161, dx: -97, dy: 125, seconds: 15, delay: -7, scale: 0.76 },
  { x: 408, y: 119, dx: -75, dy: 167, seconds: 21, delay: -17, scale: 0.48 },
  { x: 549, y: 104, dx: -107, dy: 183, seconds: 22, delay: -15, scale: 0.52 },
] as const;

const glimmers = [
  [292, 116, 13],
  [378, 201, 8],
  [478, 165, 18],
  [571, 231, 12],
  [624, 113, 10],
] as const;

/** Local painted artwork with SVG atmosphere. Motion uses transforms and opacity, never a frame loop. */
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
      <svg
        className="sakura-scene"
        viewBox="0 0 680 280"
        preserveAspectRatio="xMaxYMid slice"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={id + '-fade'}>
            <stop stopColor="white" stopOpacity="0" />
            <stop offset=".28" stopColor="white" stopOpacity=".2" />
            <stop offset=".5" stopColor="white" />
          </linearGradient>
          <mask id={id + '-scene-mask'}>
            <rect width="680" height="280" fill={url('fade')} />
          </mask>
          <radialGradient id={id + '-sky'}>
            <stop className="sky-blue" stopOpacity=".72" />
            <stop offset=".57" className="sky-rose" stopOpacity=".34" />
            <stop offset="1" className="sky-rose" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={id + '-light'}>
            <stop stopColor="white" stopOpacity=".65" />
            <stop offset=".55" stopColor="white" stopOpacity=".22" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={id + '-petal'} cx=".5" cy=".9" r=".9">
            <stop className="petal-center" />
            <stop offset=".48" className="petal-middle" />
            <stop offset="1" className="petal-edge" />
          </radialGradient>
          <linearGradient id={id + '-land-fade'} x2="0" y2="1">
            <stop stopColor="white" stopOpacity="0" />
            <stop offset=".65" stopColor="white" stopOpacity=".7" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <mask id={id + '-land-mask'}>
            <rect width="680" height="280" fill={url('land-fade')} />
          </mask>
        </defs>
        <g mask={url('scene-mask')}>
          <ellipse cx="517" cy="126" rx="245" ry="190" fill={url('sky')} />
          <circle className="garden-sun" cx="452" cy="103" r="77" fill={url('light')} />
          <g className="garden-moon">
            <circle className="moon-halo" cx="452" cy="103" r="82" fill={url('light')} />
            <circle className="moon-disc" cx="452" cy="103" r="39" />
          </g>
          <g mask={url('land-mask')} className="garden-landscape">
            <path
              className="distant-ridge"
              d="M162 247 293 188c15-7 29-4 42-12l53-35c5-3 8-2 13 3l77 66 83-34 137 65v45H162Z"
            />
            <path
              className="near-ridge"
              d="M155 261c67-15 112-38 155-38s87 28 127 20c46-9 55-40 103-36s83 22 150 9v70H155Z"
            />
          </g>
          <g className="garden-bokeh">
            {glimmers.map(([x, y, radius], index) => (
              <g key={x} transform={`translate(${x} ${y})`}>
                <circle
                  className="garden-glimmer"
                  r={radius}
                  fill={url('light')}
                  style={{ '--glimmer-delay': `${index * -3.7}s` } as CSSProperties}
                />
              </g>
            ))}
          </g>
          <g className="sakura-bough">
            <image
              className="sakura-painted-bough"
              href={paintedBough}
              x="150"
              y="-24"
              width="590"
              height="295"
            />
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
                      '--flutter-duration': `${4.6 + index * 0.45}s`,
                    } as CSSProperties
                  }
                >
                  <path
                    className="petal-flutter"
                    fill={url('petal')}
                    d="M0 6C-4 3-9-3-6-8Q-4-11-1-8L1-10C6-10 8-4 5 0Q3 4 0 6Z"
                  />
                </g>
              </g>
            ))}
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
