"use strict";var PABrand=(()=>{var r=Object.defineProperty;var i=Object.getOwnPropertyDescriptor;var o=Object.getOwnPropertyNames;var p=Object.prototype.hasOwnProperty;var l=(e,a)=>{for(var t in a)r(e,t,{get:a[t],enumerable:!0})},s=(e,a,t,d)=>{if(a&&typeof a=="object"||typeof a=="function")for(let n of o(a))!p.call(e,n)&&n!==t&&r(e,n,{get:()=>a[n],enumerable:!(d=i(a,n))||d.enumerable});return e};var g=e=>s(r({},"__esModule",{value:!0}),e);var c={};l(c,{BRAND_CSS:()=>h,brandSvg:()=>x});var h=`
  .brand { display: inline-flex; align-items: center; gap: 12px; }
  .brand img { display: block; height: auto; width: auto; }
  .brand-stack { flex-direction: column; gap: 10px; text-align: center; }

  /* inline-flex, not inline: padding on an inline box does not enclose the
     image, which renders the dark-mode plate as a bar beside the artwork. */
  .brand-plate { display: inline-flex; align-items: center; justify-content: center;
    border-radius: 10px; padding: 0; background: none; }

  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) .brand-plate {
      background: #ffffff;
      padding: 6px 9px;
      box-shadow: 0 1px 2px rgba(0,0,0,.35);
    }
    /* The login lockup is larger, so it earns more room on its tile. */
    :root:where(:not([data-theme="light"])) .brand-stack .brand-plate {
      padding: 14px 18px;
    }
  }
  :root[data-theme="dark"] .brand-plate {
    background: #ffffff;
    padding: 6px 9px;
    box-shadow: 0 1px 2px rgba(0,0,0,.35);
  }
  :root[data-theme="dark"] .brand-stack .brand-plate {
    padding: 14px 18px;
  }
`;function x(e="mark",a=38){return e==="mark"?`<span class="brand-plate"><img src="/logo-mark.png" alt="Prime Aurora"
      style="height:${a}px" width="189" height="172"></span>`:`<span class="brand-plate"><img src="/logo.png" alt="Prime Aurora, Mattegoda"
    style="width:${Math.min(a,289)}px" width="289" height="363"></span>`}return g(c);})();
