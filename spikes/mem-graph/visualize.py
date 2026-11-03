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
  :root { --bg:#f6f7f9; --panel:#ffffff; --ink:#1c2230; --muted:#5d6678; --line:#d9dde5; --accent:#3b6ef5;
          --intent:#3b6ef5; --tool:#1f9d73; --signal:#e0533a; --city:#c08a00; --llm:#8a93a3; --episode:#7a5cd6; --model:#556070; }
  @media (prefers-color-scheme: dark) { :root { --bg:#141821; --panel:#1c212c; --ink:#e7eaf0; --muted:#9aa4b5; --line:#2b3240; --accent:#6b93ff;
          --intent:#6b93ff; --tool:#3ec796; --signal:#ff7a63; --city:#e3b341; --llm:#8a93a3; --episode:#a58bff; --model:#8793a6; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif; }
  header { padding:14px 20px; border-bottom:1px solid var(--line); background:var(--panel); }
  h1 { margin:0 0 2px; font-size:17px; } .sub { color:var(--muted); font-size:13px; }
  .bar { display:flex; flex-wrap:wrap; gap:10px 16px; padding:10px 20px; align-items:center; border-bottom:1px solid var(--line); background:var(--panel); }
  label { color:var(--muted); font-size:12px; display:flex; flex-direction:column; gap:3px; }
  select, button { font:inherit; color:var(--ink); background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:6px 8px; max-width:340px; }
  button { cursor:pointer; } button.on { background:var(--accent); border-color:var(--accent); color:#fff; }
  .main { display:grid; grid-template-columns: minmax(0,1fr) 340px; gap:0; }
  #net { height:620px; background:var(--bg); }
  aside { border-left:1px solid var(--line); background:var(--panel); padding:14px 16px; overflow:auto; max-height:620px; }
  aside h2 { font-size:13px; margin:0 0 6px; } aside p { margin:4px 0; } .k { color:var(--muted); }
  .chip { display:inline-block; padding:1px 8px; border-radius:10px; font-size:12px; margin:0 4px 4px 0; color:#fff; }
  .legend { display:flex; flex-wrap:wrap; gap:6px 14px; padding:8px 20px; font-size:12px; color:var(--muted); border-bottom:1px solid var(--line); background:var(--panel); }
  .dot { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:5px; vertical-align:-1px; }
  section { padding:16px 20px; } table { border-collapse:collapse; font-size:13px; } th,td { padding:5px 10px; border-bottom:1px solid var(--line); text-align:right; }
  th:first-child,td:first-child { text-align:left; } th { color:var(--muted); font-weight:600; }
  pre { white-space:pre-wrap; word-break:break-word; background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:8px; font-size:12px; }
  @media (max-width: 860px) { .main { grid-template-columns: 1fr; } aside { border-left:0; border-top:1px solid var(--line); max-height:none; } #net { height:480px; } }
</style>
</head>
<body>
<header>
  <h1>Qué hace el asistente del tiempo</h1>
  <div class="sub" id="sub"></div>
</header>
<div class="bar">
  <div><button id="v-agg" class="on">Visión general</button> <button id="v-ep">Una conversación</button></div>
  <label>Qué pide el usuario <select id="f-intent"></select></label>
  <label>Algo a revisar <select id="f-signal"></select></label>
  <label id="l-ep" style="display:none">Conversación <select id="f-ep"></select></label>
</div>
<div class="legend" id="legend"></div>
<div class="main"><div id="net"></div><aside id="detail"><p class="k">Pulsa una bolita o una flecha para ver el detalle.</p></aside></div>
<section><h2 style="font-size:14px;margin:0 0 8px">Cosas a revisar, según lo que pide el usuario (nº de conversaciones)</h2><div id="tbl"></div>
<p class="k" style="max-width:760px">Son avisos automáticos que comparan lo que pidió el usuario con lo que hizo el asistente. Son pistas para revisar, no un veredicto de que algo falló.</p></section>
<script>
const D = __DATA__;
// Vocabulario de MemTrace (igual para cualquier agente). Los nombres de peticiones, herramientas y datos vienen de los datos, no de aquí.
const L = {
  signal: {no_tool:'Responde sin consultar nada', tool_error:'La consulta devolvió un error', repeated_call:'Repite la misma consulta',
           ignored_user_entity:'Ignora algo que pidió el usuario', invented_argument:'Consulta un dato que el usuario no dio', blocked:'Bloqueado por seguridad'},
  edge: {intent:'pide', entity:'nombra', first:'empieza con', next:'después', tool:'usa', signal:'aviso'},
};
const name = (kind, id) => kind === 'tool' ? (id === 'none' ? 'Responde sin consultar nada' : ((D.tools[id] || {}).name || id)) : ((L[kind] && L[kind][id]) || id);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const COLOR = () => ({intent:css('--intent'), tool:css('--tool'), signal:css('--signal'), entity:css('--city'), step_llm:css('--llm'), step_tool:css('--tool'),
                      episode:css('--episode'), model:css('--model'), none:css('--muted')});
const NAMES = {intent:'Lo que pide el usuario', tool:'Lo que consulta el asistente', signal:'Algo a revisar', entity:'Dato que nombra el usuario', step_llm:'El modelo piensa o responde', step_tool:'Consulta', episode:'Conversación', model:'Modelo de IA', none:'No consulta nada'};
const $ = id => document.getElementById(id);
let view = 'agg', net = null;

$('sub').textContent = `${D.episodes.length} conversaciones de prueba · cada bolita es algo que ocurre (una petición, una consulta, un aviso) y cada flecha une dos cosas relacionadas` + (D.quality && D.quality.categories ? ` · ${D.quality.categories} tipos de petición` + (D.quality.stability_vs_other_model != null ? `, coincidencia entre dos modelos ${D.quality.stability_vs_other_model} (1 = igual)` : '') : '');
const intents = [...new Set(D.episodes.map(e => e.intent))].sort();
const sigs = [...new Set(D.episodes.flatMap(e => e.signals))].sort();
$('f-intent').innerHTML = '<option value="">Todo</option>' + intents.map(i => `<option value="${i}">${name('intent', i)}</option>`).join('');
$('f-signal').innerHTML = '<option value="">Todo</option>' + sigs.map(i => `<option value="${i}">${name('signal', i)}</option>`).join('');
$('legend').innerHTML = Object.keys(NAMES).filter(k => !['step_tool', 'model'].includes(k)).map(k => `<span><i class="dot" style="background:var(--${({step_llm:'llm',none:'muted',entity:'city'})[k] || k})"></i>${NAMES[k]}</span>`).join('');

const selected = () => D.episodes.filter(e => (!$('f-intent').value || e.intent === $('f-intent').value) && (!$('f-signal').value || e.signals.includes($('f-signal').value)));
const tools = e => e.steps.filter(s => s.kind === 'tool');

function opts(hier) {
  const f = {color: css('--ink'), size: 13};
  return hier ? {layout:{hierarchical:{direction:'LR', sortMethod:'directed', levelSeparation:170, nodeSpacing:70}}, physics:false,
                 nodes:{font:f, shape:'dot'}, edges:{arrows:'to', smooth:{type:'cubicBezier'}, font:{color:css('--muted'), size:11, strokeWidth:0}}, interaction:{hover:true}}
              : {physics:{solver:'forceAtlas2Based', forceAtlas2Based:{gravitationalConstant:-70, springLength:150}, stabilization:{iterations:200}},
                 nodes:{font:f, shape:'dot'}, edges:{arrows:'to', smooth:{type:'continuous'}, font:{color:css('--muted'), size:12, strokeWidth:0}}, interaction:{hover:true}};
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
  const nodes = Object.values(N).map(n => ({id:n.id, label:`${n.label.replace(/(.{1,22})(\s|$)/g, '$1\n').trim()}\n(${n.n})`, value:n.n, color:c[n.type], title:`${NAMES[n.type]}: ${n.label} · ${n.n} conversaciones`, _t:n.type}));
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
  if (view === 'agg') { const g = aggregate(); show(g, false); detail(`<h2>Visión general</h2><p>${g.eps.length} conversaciones.</p><p><span class="k">Cómo leerlo:</span> las bolitas <b style="color:var(--intent)">azules</b> son lo que pide el usuario, las <b style="color:var(--tool)">verdes</b> lo que consulta el asistente y las <b style="color:var(--signal)">rojas</b> avisos a revisar. Cada flecha lleva un número: cuántas conversaciones siguen ese camino. Cuanto más gruesa, más conversaciones.</p><p>Ejemplo: si una petición tiene una flecha hacia «Responde sin consultar nada», el asistente contestó sin usar ninguna herramienta. Púlsala para ver cuáles.</p><p class="k">Pulsa una bolita o una flecha para listar sus conversaciones.</p>`); }
  else { const e = D.episodes.find(x => x.id === $('f-ep').value) || selected()[0]; if (!e) { net && net.destroy(); detail('<p class="k">Ninguna conversación con ese filtro.</p>'); return; } show(episodeGraph(e), true); detail(episodeDetail(e)); }
}
function table() {
  const rows = intents.map(i => { const eps = D.episodes.filter(e => e.intent === i); return [name('intent', i), eps.length, ...sigs.map(s => eps.filter(e => e.signals.includes(s)).length)]; });
  $('tbl').innerHTML = '<table><tr><th>Qué pide el usuario</th><th>Conversaciones</th>' + sigs.map(s => `<th>${name('signal', s)}</th>`).join('') + '</tr>' +
    rows.map(r => '<tr>' + r.map((v, k) => `<td>${k > 1 && v ? `<b>${v}</b>` : v}</td>`).join('') + '</tr>').join('') + '</table>';
}
$('v-agg').onclick = () => { view = 'agg'; setView(); render(); }; $('v-ep').onclick = () => { view = 'ep'; setView(); render(); };
$('f-intent').onchange = $('f-signal').onchange = () => { setView(); render(); }; $('f-ep').onchange = render;
table(); render();
if (location.hash.startsWith('#ep=')) openEp(location.hash.slice(4));
</script>
</body>
</html>
"""

if __name__ == "__main__":
    data = (HERE / "out" / "graph.json").read_text().replace("</", "<\\/")
    (HERE / "out" / "graph.html").write_text(HTML.replace("__DATA__", data))
    print("out/graph.html")
