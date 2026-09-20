/** A small, local vector illustration; no remote artwork or animation loop. */
export function SakuraArt() {
  return (
    <svg className="sakura-art" viewBox="0 0 480 240" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="petal" cx=".45" cy=".8" r=".85">
          <stop stopColor="#D986A5" />
          <stop offset=".55" stopColor="#F4C8D7" />
          <stop offset="1" stopColor="#FFF5F7" />
        </radialGradient>
        <linearGradient id="branch" x1="170" y1="40" x2="470" y2="240" gradientUnits="userSpaceOnUse">
          <stop stopColor="#C899A7" />
          <stop offset="1" stopColor="#8F6E84" />
        </linearGradient>
        <g id="blossom">
          {[0, 72, 144, 216, 288].map((angle) => (
            <path
              key={angle}
              transform={`rotate(${angle})`}
              d="M0 3C-17-5-24-25-13-33C-8-37-3-32 0-28C3-32 8-37 13-33C24-25 17-5 0 3Z"
              fill="url(#petal)"
              stroke="#DCA3B8"
              strokeWidth=".65"
            />
          ))}
          {[0, 72, 144, 216, 288].map((angle) => (
            <g key={angle} transform={`rotate(${angle})`}>
              <path d="M0 0 0-10M0 0 5-8" stroke="#BD718C" strokeWidth=".8" />
              <circle cy="-11" r="1.6" fill="#C59470" />
              <circle cx="5.5" cy="-9" r="1.3" fill="#C59470" />
            </g>
          ))}
          <circle r="3.5" fill="#B77592" />
        </g>
      </defs>
      <circle cx="316" cy="123" r="94" className="sakura-halo" />
      <circle cx="316" cy="123" r="111" stroke="currentColor" opacity=".12" />
      <g stroke="url(#branch)" strokeLinecap="round">
        <path d="M494 235C412 201 351 174 284 121C244 90 217 76 170 70" strokeWidth="5" />
        <path
          d="M365 178C349 140 351 98 336 52M290 125C290 99 275 70 249 45M402 197C415 173 429 158 455 145"
          strokeWidth="2.8"
        />
        <path
          d="M224 87 203 40M353 131 384 90M333 58 362 31M301 135 252 143M251 77 283 56"
          strokeWidth="1.7"
        />
      </g>
      <use href="#blossom" transform="translate(216 81) rotate(-18) scale(.75)" />
      <use href="#blossom" transform="translate(285 121) rotate(24) scale(1.02)" />
      <use href="#blossom" transform="translate(346 94) rotate(-6) scale(.9)" />
      <use href="#blossom" transform="translate(374 168) rotate(26) scale(.72)" />
      <use href="#blossom" transform="translate(434 159) rotate(-18) scale(.55)" />
      <use href="#blossom" transform="translate(332 49) rotate(20) scale(.48)" />
      <g fill="#E3A8BE" stroke="#CF91A9" strokeWidth=".8">
        <path d="M201 44C187 32 193 23 202 27C211 28 212 38 201 44Z" />
        <path d="M251 49C237 36 239 27 248 30C258 31 260 39 251 49Z" />
        <path d="M382 93C378 77 387 69 394 76C399 83 391 91 382 93Z" />
        <path d="M167 73C153 66 153 54 162 57C174 59 177 67 167 73Z" />
      </g>
      <g fill="#E6ACC1" opacity=".8">
        <path d="M128 136C130 122 143 118 146 125C148 134 136 140 128 136Z" />
        <path d="M223 198C225 184 238 180 241 187C243 196 231 202 223 198Z" />
        <path d="M389 28C391 17 401 14 403 20C405 27 395 32 389 28Z" />
      </g>
      <g fill="currentColor" opacity=".28">
        <circle cx="148" cy="182" r="1.6" />
        <circle cx="297" cy="204" r="1.7" />
        <circle cx="424" cy="55" r="1.8" />
        <circle cx="107" cy="89" r="1.2" />
      </g>
    </svg>
  );
}
