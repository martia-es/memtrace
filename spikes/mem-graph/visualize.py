"""Genera `out/graph.html`, una página autocontenida para ver el grafo (vis-network desde cdnjs).

Dos vistas: «Agregado» (intenciones, herramientas y señales de todos los episodios, con el grosor de cada arista = nº de episodios)
y «Episodio» (el grafo completo de una traza: pasos, herramienta, ciudades, señales).

  python visualize.py && open out/graph.html
"""
import json
from pathlib import Path

HERE = Path(__file__).parent

HTML = r"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Qué hace el asistente del tiempo</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/vis-network/9.1.9/standalone/umd/vis-network.min.js"></script>
<style>
  /* Tokens de MemTrace (dashboard/src/styles/app.css). Sin degradados ni fuentes externas. */
  :root { --bg:#f2faf9; --panel:#ffffff; --ink:#0a2321; --muted:#4d6a67; --faint:#6f8a87; --soft:#ebf5f4; --line:#d6e9e7; --line2:#e5f1ef;
          --accent:#00857f; --accent-ink:#fff; --accent-soft:#c8f0ee; --accent-text:#00605c;
          --intent:#00857f; --tool:#0f62b8; --signal:#ff6b4a; --city:#f59e0b; --llm:#6f8a87; --episode:#8a3ffc; --model:#4d6a67;
          --sans:"Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",sans-serif; --mono:"JetBrains Mono",ui-monospace,Menlo,monospace; --r:6px; --rl:8px; }
  @media (prefers-color-scheme: dark) { :root { --bg:#081716; --panel:#0e2221; --ink:#e6f4f2; --muted:#8fb0ac; --faint:#6c8d89; --soft:#132b2a; --line:#1d3c3a; --line2:#17302f;
          --accent:#2bc4bd; --accent-ink:#04201f; --accent-soft:#0f3b3a; --accent-text:#86e8e2;
          --intent:#2bc4bd; --tool:#5aa2f0; --signal:#ff8a6b; --city:#f5b13d; --llm:#6c8d89; --episode:#b48cff; --model:#8fb0ac; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.5 var(--sans); }
  header { padding:18px 24px 14px; background:var(--bg); }
  h1 { margin:0 0 4px; font-size:20px; font-weight:700; letter-spacing:-.01em; } .sub { color:var(--muted); font-size:13px; max-width:900px; }
  .card { margin:0 24px 16px; background:var(--panel); border:1px solid var(--line); border-radius:var(--rl); overflow:hidden; }
  .bar { display:flex; flex-wrap:wrap; gap:10px 16px; padding:12px 16px; align-items:flex-end; border-bottom:1px solid var(--line); }
  label { color:var(--muted); font-size:12px; font-weight:600; display:flex; flex-direction:column; gap:4px; }
  select, button { font:inherit; color:var(--ink); background:var(--panel); border:1px solid var(--line); border-radius:var(--r); padding:6px 10px; max-width:340px; }
  select:hover, button:hover { border-color:var(--accent); } select:focus-visible, button:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
  button { cursor:pointer; font-weight:600; } button.on { background:var(--accent-soft); border-color:var(--accent); color:var(--accent-text); }
  .main { display:grid; grid-template-columns: minmax(0,1fr) 340px; }
  #net { height:620px; background:var(--panel); }
  aside { border-left:1px solid var(--line); background:var(--panel); padding:16px; overflow:auto; max-height:620px; }
  aside h2 { font-size:13px; margin:0 0 6px; font-weight:700; } aside p { margin:4px 0; } .k { color:var(--muted); }
  aside a { color:var(--accent-text); text-decoration:none; } aside a:hover { text-decoration:underline; }
  .chip { display:inline-block; padding:1px 8px; border-radius:var(--r); font-size:12px; font-weight:600; margin:0 4px 4px 0; color:#fff; }
  .legend { display:flex; flex-wrap:wrap; gap:6px 16px; padding:10px 16px; font-size:12px; color:var(--muted); border-top:1px solid var(--line); background:var(--soft); }
  .dot { display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:6px; vertical-align:-1px; }
  section { padding:16px; } section h2 { font-size:14px; font-weight:700; }
  table { border-collapse:collapse; font-size:13px; } th,td { padding:6px 12px; border-bottom:1px solid var(--line2); text-align:right; }
  th:first-child,td:first-child { text-align:left; } th { color:var(--muted); font-weight:600; font-size:12px; background:var(--soft); }
  pre { white-space:pre-wrap; word-break:break-word; background:var(--soft); border:1px solid var(--line); border-radius:var(--r); padding:8px; font:12px var(--mono); }
  @media (max-width: 860px) { .main { grid-template-columns: 1fr; } aside { border-left:0; border-top:1px solid var(--line); max-height:none; } #net { height:480px; } }
</style>
</head>
<body>
<header>
  <h1>Qué hace el asistente del tiempo</h1>
  <div class="sub" id="sub"></div>
</header>
<div class="card">
<div class="bar">
  <div><button id="v-agg" class="on">Visión general</button> <button id="v-ep">Una conversación</button></div>
  <label>Qué pide el usuario <select id="f-intent"></select></label>
  <label>Algo a revisar <select id="f-signal"></select></label>
  <label>Resultado <select id="f-verdict"></select></label>
  <label id="l-ep" style="display:none">Conversación <select id="f-ep"></select></label>
</div>
<div class="main"><div id="net"></div><aside id="detail"><p class="k">Pulsa una bolita o una flecha para ver el detalle.</p></aside></div>
<div class="legend" id="legend"></div>
</div>
<div class="card"><section><h2 style="margin:0 0 4px">Dónde se equivoca el asistente</h2>
<p class="k" style="max-width:820px;margin:0 0 10px" id="pat-sub"></p><div id="pat"></div></section></div>
<div class="card"><section><h2 style="margin:0 0 8px">Cosas a revisar, según lo que pide el usuario (nº de conversaciones)</h2><div id="tbl"></div>
<p class="k" style="max-width:760px">Son avisos automáticos que comparan lo que pidió el usuario con lo que hizo el asistente. Son pistas para revisar, no un veredicto de que algo falló.</p></section></div>
<script>
const D = __DATA__;
// Vocabulario de MemTrace (igual para cualquier agente). Los nombres de peticiones, herramientas y datos vienen de los datos, no de aquí.
const L = {
  signal: {no_tool:'Responde sin consultar nada', tool_error:'La consulta devolvió un error', repeated_call:'Repite la misma consulta',
           ignored_user_entity:'Ignora algo que pidió el usuario', invented_argument:'Consulta un dato que el usuario no dio', blocked:'Bloqueado por seguridad'},
  edge: {intent:'pide', entity:'nombra', first:'empieza con', next:'después', tool:'usa', signal:'aviso'},
};
const VERDICT = {ok:'Bien', partial:'A medias', bad:'Mal', unsure:'Dudosa'};
const name = (kind, id) => kind === 'tool' ? (id === 'none' ? 'Responde sin consultar nada' : ((D.tools[id] || {}).name || id)) : ((L[kind] && L[kind][id]) || id);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const COLOR = () => ({intent:css('--intent'), tool:css('--tool'), signal:css('--signal'), entity:css('--city'), step_llm:css('--llm'), step_tool:css('--tool'),
                      episode:css('--episode'), model:css('--model'), none:css('--muted')});
const NAMES = {intent:'Lo que pide el usuario', tool:'Lo que consulta el asistente', signal:'Algo a revisar', entity:'Dato que nombra el usuario', step_llm:'El modelo piensa o responde', step_tool:'Consulta', episode:'Conversación', model:'Modelo de IA', none:'No consulta nada'};
const $ = id => document.getElementById(id);
let view = 'agg', net = null;

$('sub').textContent = `${D.episodes.length} conversaciones de prueba · cada bolita es algo que ocurre (una petición, una consulta, un aviso) y cada flecha une dos cosas relacionadas` + (D.quality && D.quality.categories ? (D.judge ? ` · el veredicto coincide entre dos modelos en el ${Math.round(D.judge.agreement * 100)} % de los casos` : '') + ` · ${D.quality.categories} tipos de petición` + (D.quality.stability_vs_other_model != null ? `, coincidencia entre dos modelos ${D.quality.stability_vs_other_model} (1 = igual)` : '') : '');
const intents = [...new Set(D.episodes.map(e => e.intent))].sort();
const sigs = [...new Set(D.episodes.flatMap(e => e.signals))].sort();
$('f-intent').innerHTML = '<option value="">Todo</option>' + intents.map(i => `<option value="${i}">${name('intent', i)}</option>`).join('');
$('f-signal').innerHTML = '<option value="">Todo</option>' + sigs.map(i => `<option value="${i}">${name('signal', i)}</option>`).join('');
$('f-verdict').innerHTML = '<option value="">Todo</option>' + Object.entries(VERDICT).map(([k, v]) => `<option value="${k}">${v}${k === 'unsure' ? ' (los dos modelos no coinciden)' : ''}</option>`).join('');
$('legend').innerHTML = Object.keys(NAMES).filter(k => !['step_tool', 'model'].includes(k)).map(k => `<span><i class="dot" style="background:var(--${({step_llm:'llm',none:'muted',entity:'city'})[k] || k})"></i>${NAMES[k]}</span>`).join('');

const selected = () => D.episodes.filter(e => (!$('f-intent').value || e.intent === $('f-intent').value) && (!$('f-signal').value || e.signals.includes($('f-signal').value)) && (!$('f-verdict').value || e.verdict === $('f-verdict').value));
const tools = e => e.steps.filter(s => s.kind === 'tool');

function opts(hier) {
  const f = {color: css('--ink'), size: 13, face: 'Plus Jakarta Sans, system-ui, sans-serif'};
  return hier ? {layout:{hierarchical:{direction:'LR', sortMethod:'directed', levelSeparation:170, nodeSpacing:70}}, physics:false,
                 nodes:{font:f, shape:'dot', borderWidth:2, color:{border:css('--panel')}, shadow:false}, edges:{arrows:'to', smooth:{type:'cubicBezier'}, font:{color:css('--muted'), size:11, strokeWidth:0}}, interaction:{hover:true}}
              : {physics:{solver:'forceAtlas2Based', forceAtlas2Based:{gravitationalConstant:-70, springLength:150}, stabilization:{iterations:200}},
                 nodes:{font:f, shape:'dot', borderWidth:2, color:{border:css('--panel')}, shadow:false}, edges:{arrows:'to', smooth:{type:'continuous'}, font:{color:css('--muted'), size:12, strokeWidth:0}}, interaction:{hover:true}};
}

function aggregate() {
  const eps = selected(), c = COLOR(), N = {}, E = {};
  const node = (id, type, label) => { (N[id] ||= {id, type, label, n:0}).n++; };
  const edge = (a, b, ep, label) => { const k = a + '→' + b; (E[k] ||= {from:a, to:b, n:0, eps:[]}).n++; E[k].eps.push(ep.id); };
  for (const e of eps) {
    const i = 'intent:' + e.intent, ts = tools(e);
    node(i, 'intent', name('intent', e.intent));
    const names = [...new Set(ts.map(s => s.tool))];
    if (!names.length) { node('tool:none', 'none', name('tool', 'none')); edge(i, 'tool:none', e); }
    names.forEach(t => { node('tool:' + t, 'tool', name('tool', t)); edge(i, 'tool:' + t, e); });
    ts.slice(1).forEach((s, k) => { edge('tool:' + ts[k].tool, 'tool:' + s.tool, e); });
    e.signals.filter(s => s !== 'no_tool').forEach(s => { node('signal:' + s, 'signal', name('signal', s)); edge(i, 'signal:' + s, e); }); // «no consulta nada» ya es el nodo gris
  }
  const nodes = Object.values(N).map(n => ({id:n.id, label:`${n.label.replace(/(.{1,26})(\s|$)/g, '$1\n').trim()}\n(${n.n})`, value:n.n, color:c[n.type], title:`${NAMES[n.type]}: ${n.label} · ${n.n} conversaciones`, _t:n.type}));
  const edges = Object.values(E).map(x => ({from:x.from, to:x.to, value:x.n, label:String(x.n), arrows:'to', color:{color:css('--line'), highlight:css('--accent')}, _eps:x.eps, title:`${x.n} conversaciones siguen este camino`}));
  return {nodes, edges, eps};
}

function episodeGraph(e) {
  const c = COLOR(), nodes = [], edges = [], add = (id, type, label, extra={}) => { if (!nodes.find(n => n.id === id)) nodes.push({id, label, color:c[type], _t:type, ...extra}); };
  const ep = 'ep'; add(ep, 'episode', e.text.slice(0, 38) + (e.text.length > 38 ? '…' : ''), {size:22});
  add('i', 'intent', name('intent', e.intent)); edges.push({from:ep, to:'i', label:L.edge.intent});
  e.entities.forEach(x => { add('x:' + x.value, 'entity', x.value, {title:'Tipo: ' + x.type}); edges.push({from:ep, to:'x:' + x.value, label:L.edge.entity}); });
  let prev = null;
  e.steps.forEach((s, k) => {
    const id = 's' + k, lab = s.kind === 'llm' ? (k === e.steps.length - 1 ? 'El modelo responde' : 'El modelo piensa') : name('tool', s.tool);
    add(id, s.kind === 'llm' ? 'step_llm' : 'step_tool', lab, {title:s.kind === 'tool' ? 'Pidió: ' + s.args + '\nResultado: ' + s.result : s.tokens + ' tokens (entrada → salida)', shape:'square'});
    edges.push({from:prev || ep, to:id, label:prev ? L.edge.next : L.edge.first}); prev = id;
    if (s.kind === 'tool') { add('t:' + s.tool, 'tool', name('tool', s.tool)); edges.push({from:id, to:'t:' + s.tool, label:L.edge.tool});
    }
  });
  e.signals.forEach(sg => { add('g:' + sg, 'signal', name('signal', sg)); edges.push({from:ep, to:'g:' + sg, label:L.edge.signal}); });
  return {nodes, edges};
}

function show(g, hier) {
  const data = {nodes:new vis.DataSet(g.nodes), edges:new vis.DataSet(g.edges)};
  net && net.destroy(); net = new vis.Network($('net'), data, opts(hier));
  net.on('click', p => {
    if (view === 'agg') {
      const n = p.nodes[0];
      if (n) { const nd = g.nodes.find(x => x.id === n), eps = D.episodes.filter(e => nodeEps(n, e));
        detail(`<h2>${NAMES[nd._t]}: ${nd.label.split('\n')[0]}</h2><p>${eps.length} conversaciones</p>` + epList(eps)); }
    }
  });
  net.on('selectEdge', p => { if (view !== 'agg' || !p.edges.length || p.nodes.length) return;
    const x = data.edges.get(p.edges[0]); if (x && x._eps) { const eps = D.episodes.filter(e => x._eps.includes(e.id));
      detail(`<h2>${g.nodes.find(n => n.id === x.from).label.split('\n')[0]} → ${g.nodes.find(n => n.id === x.to).label.split('\n')[0]}</h2><p>${x.value} conversaciones</p>` + epList(eps)); } });
  net.on('selectNode', p => { if (view === 'ep') { const nd = data.nodes.get(p.nodes[0]); if (nd) { detail(`<h2>${NAMES[nd._t]}: ${nd.label}</h2>` + (nd.title ? `<pre>${esc(nd.title)}</pre>` : '')); } } });
}
const nodeEps = (id, e) => id.startsWith('intent:') ? e.intent === id.slice(7) : id === 'tool:none' ? !tools(e).length : id.startsWith('tool:') ? tools(e).some(s => s.tool === id.slice(5)) : id.startsWith('signal:') ? e.signals.includes(id.slice(7)) : false;
const esc = s => String(s).replace(/[&<>]/g, m => ({'&':'&amp;', '<':'&lt;', '>':'&gt;'}[m]));
const detail = h => $('detail').innerHTML = h;
const epList = eps => '<p class="k">Haz clic en una conversación para ver su recorrido:</p>' + eps.slice(0, 40).map(e => `<p><a href="#" data-ep="${e.id}">${esc(e.text.slice(0, 54))}</a> <span class="k">${name('intent', e.intent)}</span></p>`).join('') + (eps.length > 40 ? `<p class="k">… y ${eps.length - 40} más</p>` : '');
$('detail').addEventListener('click', ev => { const a = ev.target.closest('a[data-ep]'); if (a) { ev.preventDefault(); openEp(a.dataset.ep); } });

function episodeDetail(e) {
  const c = COLOR();
  return `<h2>${esc(e.text)}</h2><p><span class="k">Respuesta del asistente:</span> ${esc(e.reply || '—')}</p>
    <p><span class="k">Pide:</span> ${name('intent', e.intent)} · <span class="k">idioma:</span> ${e.lang} · <span class="k">tardó</span> ${(e.latency_ms / 1000).toFixed(1)} s</p>
    <p><span class="chip" style="background:${({ok:'#00857f', partial:'#f59e0b', bad:'#ff6b4a', unsure:'#6f8a87'})[e.verdict] || '#6f8a87'}">${VERDICT[e.verdict] || 'Sin juzgar'}</span> <span class="k">${esc(e.reason || '')}</span></p>
    <p>${e.signals.map(s => `<span class="chip" style="background:${c.signal}">${name('signal', s)}</span>`).join('') || '<span class="k">Sin nada que revisar</span>'}</p>
    <h2>Qué hizo el asistente, paso a paso</h2>` + e.steps.map((s, k) => `<p>${k + 1}. ${s.kind === 'llm' ? (k === e.steps.length - 1 ? 'El modelo redacta la respuesta' : 'El modelo decide qué hacer') : '<b>' + name('tool', s.tool) + '</b> <span class="k">' + esc(s.args) + '</span>' + (s.failed ? ' ⚠ devolvió error' : '')}</p>`).join('');
}
function openEp(id) { view = 'ep'; setView(); $('f-ep').value = id; render(); }

function setView() {
  $('v-agg').classList.toggle('on', view === 'agg'); $('v-ep').classList.toggle('on', view === 'ep'); $('l-ep').style.display = view === 'ep' ? '' : 'none';
  if (view === 'ep') { const eps = selected(); const cur = $('f-ep').value;
    $('f-ep').innerHTML = eps.map(e => `<option value="${e.id}">${name('intent', e.intent)} · ${esc(e.text.slice(0, 44))}${e.signals.length ? ' ⚑' : ''}</option>`).join('');
    if (eps.some(e => e.id === cur)) $('f-ep').value = cur; }
}
function render() {
  if (view === 'agg') { const g = aggregate(); show(g, false); detail(`<h2>Visión general</h2><p>${g.eps.length} conversaciones.</p><p><span class="k">Cómo leerlo:</span> las bolitas <b style="color:var(--intent)">turquesa</b> son lo que pide el usuario, las <b style="color:var(--tool)">azules</b> lo que consulta el asistente y las <b style="color:var(--signal)">coral</b> avisos a revisar. Cada flecha lleva un número: cuántas conversaciones siguen ese camino. Cuanto más gruesa, más conversaciones.</p><p>Ejemplo: si una petición tiene una flecha hacia «Responde sin consultar nada», el asistente contestó sin usar ninguna herramienta. Púlsala para ver cuáles.</p><p class="k">Pulsa una bolita o una flecha para listar sus conversaciones.</p>`); }
  else { const e = D.episodes.find(x => x.id === $('f-ep').value) || selected()[0]; if (!e) { net && net.destroy(); detail('<p class="k">Ninguna conversación con ese filtro.</p>'); return; } show(episodeGraph(e), true); detail(episodeDetail(e)); }
}
function table() {
  const rows = intents.map(i => { const eps = D.episodes.filter(e => e.intent === i); return [name('intent', i), eps.length, ...sigs.map(s => eps.filter(e => e.signals.includes(s)).length)]; });
  $('tbl').innerHTML = '<table><tr><th>Qué pide el usuario</th><th>Conversaciones</th>' + sigs.map(s => `<th>${name('signal', s)}</th>`).join('') + '</tr>' +
    rows.map(r => '<tr>' + r.map((v, k) => `<td>${k > 1 && v ? `<b>${v}</b>` : v}</td>`).join('') + '</tr>').join('') + '</table>';
}
$('v-agg').onclick = () => { view = 'agg'; setView(); render(); }; $('v-ep').onclick = () => { view = 'ep'; setView(); render(); };
$('f-intent').onchange = $('f-signal').onchange = $('f-verdict').onchange = () => { setView(); render(); }; $('f-ep').onchange = render;
function patterns() {
  const P = D.patterns || {patterns: []}, J = D.judge || {};
  $('pat-sub').textContent = `Un modelo (confirmado por otro) revisó si cada conversación dio al usuario lo que pidió: ${P.judged || 0} con veredicto claro, ${P.failed || 0} salieron mal. ` +
    `Solo se listan diferencias que se mantienen al comparar con el resto y se confirman en conversaciones que no se usaron para descubrirlas.`;
  $('pat').innerHTML = !P.patterns.length ? '<p class="k">Todavía no hay ningún patrón con evidencia suficiente.</p>' : '<table><tr><th>Patrón</th><th>Conversaciones</th><th>Acaban mal</th><th>En el resto</th><th>Se confirma</th></tr>' +
    P.patterns.map((p, i) => `<tr><td><a href="#" data-pat="${i}">${esc(p.text)}</a></td><td>${p.n}</td><td><b>${Math.round(p.rate * 100)} %</b> (${p.fail})</td><td>${Math.round(p.rest_rate * 100)} %</td><td>${p.validated ? 'Sí' : 'Aún no'}</td></tr>`).join('') + '</table>';
}
$('pat').addEventListener('click', ev => { const a = ev.target.closest('a[data-pat]'); if (!a) return; ev.preventDefault(); const p = D.patterns.patterns[a.dataset.pat];
  detail(`<h2>${esc(p.text)}</h2><p>${p.fail} de ${p.n} acaban mal, frente a ${Math.round(p.rest_rate * 100)} % en el resto.</p>` + epList(D.episodes.filter(e => p.episodes.includes(e.id)))); window.scrollTo({top: 0, behavior: 'smooth'}); });
table(); patterns(); render();
if (location.hash.startsWith('#ep=')) openEp(location.hash.slice(4));
</script>
</body>
</html>
"""

if __name__ == "__main__":
    data = (HERE / "out" / "graph.json").read_text().replace("</", "<\\/")
    (HERE / "out" / "graph.html").write_text(HTML.replace("__DATA__", data))
    print("out/graph.html")
