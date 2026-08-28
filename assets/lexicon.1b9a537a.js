import"./style.7f2dd081.js";const g=document.getElementById("empty-state"),i=document.getElementById("status-area"),p=document.getElementById("lexicon-content"),b=document.getElementById("load-file-input");function o(e){return String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function d(e,t=!1){i.textContent=e,i.className=`mt-4 text-center ${t?"text-red-600 font-medium":"text-slate-500"}`}function x(e,t){var r,s;return(s=(r=e.find(a=>a.id===t))==null?void 0:r.label)!=null?s:`#${t}`}function y(e,t){return`
        <section class="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
            <h2 class="text-lg font-bold text-slate-800 px-4 pt-4">Sources</h2>
            <div class="overflow-x-auto">
                <table class="w-full text-sm mt-2">
                    <thead>
                        <tr class="text-left text-xs uppercase tracking-wide text-slate-400">
                            <th class="px-3 py-2">Source</th>
                            <th class="px-3 py-2">Collector</th>
                            <th class="px-3 py-2 text-right">Tokens</th>
                            <th class="px-3 py-2 text-right">Vocab size</th>
                            <th class="px-3 py-2 text-right">Range score</th>
                        </tr>
                    </thead>
                    <tbody>${e.map(s=>{var l;const a=t.find(f=>f.sourceId===s.id),n=a!=null&&a.insufficientData?`<span class="text-amber-600" title="fewer than the rarefaction target's worth of tokens">insufficient data</span>`:(l=a==null?void 0:a.rangeScore)!=null?l:"\u2014";return`
            <tr class="border-t border-slate-200">
                <td class="px-3 py-2 font-medium text-slate-800">${o(s.label)}</td>
                <td class="px-3 py-2 text-slate-500">${o(s.collector)}</td>
                <td class="px-3 py-2 text-right">${o(s.tokenCount)}</td>
                <td class="px-3 py-2 text-right">${o(s.vocabSize)}</td>
                <td class="px-3 py-2 text-right font-semibold text-sky-700">${n}</td>
            </tr>`}).join("")}</tbody>
                </table>
            </div>
        </section>`}function v(e,t){return t.length===0?"":`
        <section class="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
            <h2 class="text-lg font-bold text-slate-800 px-4 pt-4">Overlap</h2>
            <p class="px-4 text-sm text-slate-500">Morisita\u2013Horn index, 0 = disjoint vocabularies, 1 = identical relative-frequency distributions.</p>
            <div class="overflow-x-auto">
                <table class="w-full text-sm mt-2">
                    <thead>
                        <tr class="text-left text-xs uppercase tracking-wide text-slate-400">
                            <th class="px-3 py-2">Source A</th>
                            <th class="px-3 py-2">Source B</th>
                            <th class="px-3 py-2 text-right">Overlap</th>
                        </tr>
                    </thead>
                    <tbody>${t.slice().sort((s,a)=>a.score-s.score).map(s=>`
            <tr class="border-t border-slate-200">
                <td class="px-3 py-2 font-medium text-slate-800">${o(x(e,s.a))}</td>
                <td class="px-3 py-2 font-medium text-slate-800">${o(x(e,s.b))}</td>
                <td class="px-3 py-2 text-right font-semibold text-sky-700">${o(s.score)}</td>
            </tr>`).join("")}</tbody>
                </table>
            </div>
        </section>`}function c(e,t,r=25){const s=t.slice(0,r).map(a=>`
        <tr class="border-t border-slate-100">
            <td class="px-2 py-1 text-slate-800">${o(a.ngram)}</td>
            <td class="px-2 py-1 text-right text-slate-500">${o(a.count)}</td>
            <td class="px-2 py-1 text-right text-slate-400">${o(a.per1k)}</td>
        </tr>`).join("");return`
        <div>
            <h3 class="text-sm font-semibold text-slate-600 mb-1">${o(e)}</h3>
            <div class="border border-slate-200 rounded-lg overflow-hidden">
                <table class="w-full text-xs">
                    <thead>
                        <tr class="text-left text-slate-400 bg-slate-50">
                            <th class="px-2 py-1 font-medium">n-gram</th>
                            <th class="px-2 py-1 font-medium text-right">count</th>
                            <th class="px-2 py-1 font-medium text-right">/1k tok</th>
                        </tr>
                    </thead>
                    <tbody>${s||'<tr><td class="px-2 py-2 text-slate-400" colspan="3">no data</td></tr>'}</tbody>
                </table>
            </div>
        </div>`}function w(e,t){const r=s=>{var a,n;return(n=(a=t.find(l=>l.sourceId===e.id&&l.n===s))==null?void 0:a.top)!=null?n:[]};return`
        <section class="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
            <h2 class="text-lg font-bold text-slate-800 mb-3">${o(e.label)}</h2>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                ${c("Unigrams",r(1))}
                ${c("Bigrams",r(2))}
                ${c("Trigrams",r(3))}
            </div>
        </section>`}function $(e){const{sources:t=[],range:r=[],overlap:s=[],ngrams:a=[]}=e;p.innerHTML=[y(t,r),v(t,s),...t.map(n=>w(n,a))].join(""),g.classList.add("hidden"),p.classList.remove("hidden")}function u(e){try{$(e),d("")}catch(t){d(`Could not render lexicon data: ${t.message}`,!0)}}async function m(e){try{u(JSON.parse(await e.text()))}catch(t){d(`Could not read "${e.name}": ${t.message}`,!0)}}async function S(e){d(`Loading ${e}...`);try{const t=await fetch(e);if(!t.ok)throw new Error(`HTTP ${t.status}`);u(await t.json())}catch(t){d(`Could not load "${e}": ${t.message}`,!0)}}b.addEventListener("change",e=>{const t=e.target.files[0];t&&m(t),e.target.value=null});["dragenter","dragover"].forEach(e=>{document.body.addEventListener(e,t=>{t.dataTransfer.types.includes("Files")&&t.preventDefault()})});document.body.addEventListener("drop",e=>{e.preventDefault();const t=e.dataTransfer.files[0];t&&m(t)});const h=new URLSearchParams(window.location.search).get("data");h&&S(h);
