var PABrand=(()=>{var d=Object.defineProperty;var o=Object.getOwnPropertyDescriptor;var i=Object.getOwnPropertyNames;var l=Object.prototype.hasOwnProperty;var s=(a,e)=>{for(var r in e)d(a,r,{get:e[r],enumerable:!0})},f=(a,e,r,t)=>{if(e&&typeof e=="object"||typeof e=="function")for(let n of i(e))!l.call(a,n)&&n!==r&&d(a,n,{get:()=>e[n],enumerable:!(t=o(e,n))||t.enumerable});return a};var g=a=>f(d({},"__esModule",{value:!0}),a);var c={};s(c,{BRAND_CSS:()=>b,brandSvg:()=>p});var b=`
  :root {
    --brand-navy:   #1c2e4e;
    --brand-red:    #a81e2d;
    --brand-green:  #1b5e3a;
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) {
      --brand-navy:  #cfd8e8;
      --brand-red:   #e0475a;
      --brand-green: #34a06a;
    }
  }
  :root[data-theme="dark"] {
    --brand-navy:  #cfd8e8;
    --brand-red:   #e0475a;
    --brand-green: #34a06a;
  }
  .brand { display: inline-flex; align-items: center; gap: 12px; }
  .brand svg { display: block; height: auto; }
  .brand-stack { flex-direction: column; gap: 10px; text-align: center; }
`;function p(a="mark",e=40){let r="pa-"+a,t=`
    <g>
      <defs>
        <linearGradient id="${r}" x1="0" y1="0.2" x2="1" y2="0.4">
          <stop offset="0%"   stop-color="var(--brand-red)"/>
          <stop offset="55%"  stop-color="var(--brand-red)"/>
          <stop offset="100%" stop-color="var(--brand-navy)"/>
        </linearGradient>
      </defs>
      <path fill="url(#${r})" fill-rule="evenodd" d="
        M44 12
        a42 42 0 1 0 0 84
        a42 42 0 1 0 0-84
        Z
        M44 39
        a15 15 0 1 1 0 30
        a15 15 0 1 1 0-30
        Z"/>
      <path fill="var(--brand-navy)" d="M64 12 L88 6 L88 96 L64 96 Z"/>
    </g>`;return a==="mark"?`<svg viewBox="0 0 92 102" width="${e}" height="${Math.round(e*102/92)}"
      role="img" aria-label="Prime Aurora">${t}</svg>`:`<svg viewBox="0 0 300 212" width="${e*3}" role="img" aria-label="Prime Aurora, Mattegoda">
    <g transform="translate(104 0)">${t}</g>
    <text x="150" y="152" text-anchor="middle" fill="var(--brand-navy)"
      font-family="system-ui, -apple-system, 'Segoe UI', sans-serif"
      font-size="52" font-weight="800" letter-spacing="1">AURORA</text>
    <text x="150" y="182" text-anchor="middle" fill="var(--brand-red)"
      font-family="system-ui, -apple-system, 'Segoe UI', sans-serif"
      font-size="24" font-weight="700" letter-spacing="6">MATTEGODA</text>
    <rect x="138" y="194" width="24" height="7" rx="1.5" fill="var(--brand-green)"/>
  </svg>`}return g(c);})();
