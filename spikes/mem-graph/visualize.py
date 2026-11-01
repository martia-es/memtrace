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
<title>Grafo de trazas (spike 2)</title>
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
  <h1>Grafo de trazas del asistente del tiempo</h1>
  <div class="sub" id="sub"></div>
</header>
<div class="bar">
  <div><button id="v-agg" class="on">Agregado</button> <button id="v-ep">Episodio</button></div>
  <label>Intención <select id="f-intent"></select></label>
  <label>Señal <select id="f-signal"></select></label>
  <label id="l-ep" style="display:none">Episodio <select id="f-ep"></select></label>
</div>
<div class="legend" id="legend"></div>
<div class="main"><div id="net"></div><aside id="detail"><p class="k">Pulsa un nodo o una arista para ver el detalle.</p></aside></div>
<section><h2 style="font-size:14px;margin:0 0 8px">Señales por intención (nº de episodios)</h2><div id="tbl"></div>
<p class="k" style="max-width:760px">Las señales son comprobaciones deterministas que cruzan el texto del usuario con lo que hizo el agente. No son un veredicto de fallo: no hay etiqueta de éxito.</p></section>
<script>
const D = __DATA__;
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const COLOR = () => ({intent:css('--intent'), tool:css('--tool'), signal:css('--signal'), city:css('--city'), step_llm:css('--llm'), step_tool:css('--tool'),
                      episode:css('--episode'), model:css('--model'), none:css('--muted')});
const NAMES = {intent:'Intención', tool:'Herramienta', signal:'Señal', city:'Ciudad', step_llm:'Paso LLM', step_tool:'Paso herramienta', episode:'Episodio', model:'Modelo', none:'Sin herramienta'};
const $ = id => document.getElementById(id);
let view = 'agg', net = null;

$('sub').textContent = `${D.episodes.length} episodios · ${D.nodes.length} nodos · ${D.edges.length} aristas · construido solo con spans y reglas (sin etiqueta de éxito)`;
const intents = [...new Set(D.episodes.map(e => e.intent))].sort();
const sigs = [...new Set(D.episodes.flatMap(e => e.signals))].sort();
$('f-intent').innerHTML = '<option value="">Todas</option>' + intents.map(i => `<option>${i}</option>`).join('');
$('f-signal').innerHTML = '<option value="">Todas</option>' + sigs.map(i => `<option>${i}</option>`).join('');
$('legend').innerHTML = Object.keys(NAMES).filter(k => k !== 'step_tool').map(k => `<span><i class="dot" style="background:var(--${({step_llm:'llm',none:'muted'})[k] || k})"></i>${NAMES[k]}</span>`).join('');

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
    node(i, 'intent', e.intent);
    const names = [...new Set(ts.map(s => s.tool))];
    if (!names.length) { node('tool:none', 'none', '(sin herramienta)'); edge(i, 'tool:none', e); }
    names.forEach(t => { node('tool:' + t, 'tool', t); edge(i, 'tool:' + t, e); });
    ts.slice(1).forEach((s, k) => { edge('tool:' + ts[k].tool, 'tool:' + s.tool, e); });
    e.signals.forEach(s => { node('signal:' + s, 'signal', s); edge(i, 'signal:' + s, e); });
  }
  const nodes = Object.values(N).map(n => ({id:n.id, label:`${n.label}\n${n.n}`, value:n.n, color:c[n.type], title:`${NAMES[n.type]}: ${n.label} (${n.n} episodios)`, _t:n.type}));
  const edges = Object.values(E).map(x => ({from:x.from, to:x.to, value:x.n, label:String(x.n), arrows:'to', color:{color:css('--line'), highlight:css('--accent')}, _eps:x.eps, title:`${x.n} episodios`}));
  return {nodes, edges, eps};
}

function episodeGraph(e) {
  const c = COLOR(), nodes = [], edges = [], add = (id, type, label, extra={}) => { if (!nodes.find(n => n.id === id)) nodes.push({id, label, color:c[type], _t:type, ...extra}); };
  const ep = 'ep'; add(ep, 'episode', e.text.slice(0, 38) + (e.text.length > 38 ? '…' : ''), {size:22});
  add('i', 'intent', e.intent); edges.push({from:ep, to:'i', label:'tiene intención'});
  e.cities.forEach(ci => { add('c:' + ci, 'city', ci); edges.push({from:ep, to:'c:' + ci, label:'menciona'}); });
  let prev = null;
  e.steps.forEach((s, k) => {
    const id = 's' + k; add(id, s.kind === 'llm' ? 'step_llm' : 'step_tool', s.label, {title:s.kind === 'tool' ? s.result : s.tokens, shape:'square'});
    edges.push({from:prev || ep, to:id, label:prev ? 'siguiente' : 'primer paso'}); prev = id;
    if (s.kind === 'tool') { add('t:' + s.tool, 'tool', s.tool); edges.push({from:id, to:'t:' + s.tool, label:'llama'});
      if (s.city) { add('c:' + s.city, 'city', s.city); edges.push({from:id, to:'c:' + s.city, label:'argumento'}); } }
  });
  e.signals.forEach(sg => { add('g:' + sg, 'signal', sg); edges.push({from:ep, to:'g:' + sg, label:'señal'}); });
  return {nodes, edges};
}

function show(g, hier) {
  const data = {nodes:new vis.DataSet(g.nodes), edges:new vis.DataSet(g.edges)};
  net && net.destroy(); net = new vis.Network($('net'), data, opts(hier));
  net.on('click', p => {
    if (view === 'agg') {
      const n = p.nodes[0];
      if (n) { const nd = g.nodes.find(x => x.id === n), eps = D.episodes.filter(e => nodeEps(n, e));
        detail(`<h2>${NAMES[nd._t]}: ${nd.label.split('\n')[0]}</h2><p>${eps.length} episodios en la selección actual</p>` + epList(eps)); }
    }
  });
  net.on('selectEdge', p => { if (view !== 'agg' || !p.edges.length || p.nodes.length) return;
    const x = data.edges.get(p.edges[0]); if (x && x._eps) { const eps = D.episodes.filter(e => x._eps.includes(e.id));
      detail(`<h2>${x.from.split(':')[1]} → ${x.to.split(':')[1]}</h2><p>${x.value} episodios</p>` + epList(eps)); } });
  net.on('selectNode', p => { if (view === 'ep') { const nd = data.nodes.get(p.nodes[0]); if (nd) { detail(`<h2>${NAMES[nd._t]}: ${nd.label}</h2>` + (nd.title ? `<pre>${esc(nd.title)}</pre>` : '')); } } });
}
const nodeEps = (id, e) => id.startsWith('intent:') ? e.intent === id.slice(7) : id === 'tool:none' ? !tools(e).length : id.startsWith('tool:') ? tools(e).some(s => s.tool === id.slice(5)) : id.startsWith('signal:') ? e.signals.includes(id.slice(7)) : false;
const esc = s => String(s).replace(/[&<>]/g, m => ({'&':'&amp;', '<':'&lt;', '>':'&gt;'}[m]));
const detail = h => $('detail').innerHTML = h;
const epList = eps => '<p class="k">Haz clic en un episodio para abrirlo:</p>' + eps.slice(0, 40).map(e => `<p><a href="#" data-ep="${e.id}">${esc(e.text.slice(0, 54))}</a> <span class="k">${e.intent}</span></p>`).join('') + (eps.length > 40 ? `<p class="k">… y ${eps.length - 40} más</p>` : '');
$('detail').addEventListener('click', ev => { const a = ev.target.closest('a[data-ep]'); if (a) { ev.preventDefault(); openEp(a.dataset.ep); } });

function episodeDetail(e) {
  const c = COLOR();
  return `<h2>${esc(e.text)}</h2><p><span class="k">Respuesta:</span> ${esc(e.reply || '—')}</p>
    <p><span class="k">Intención:</span> ${e.intent} · <span class="k">idioma:</span> ${e.lang} · <span class="k">${e.latency_ms} ms</span> · <span class="k">sesión</span> ${e.session} t${e.turn}</p>
    <p>${e.signals.map(s => `<span class="chip" style="background:${c.signal}">${s}</span>`).join('') || '<span class="k">Sin señales</span>'}</p>
    <h2>Pasos</h2>` + e.steps.map((s, k) => `<p>${k + 1}. ${s.kind === 'llm' ? 'LLM <span class="k">' + s.tokens + ' tokens</span>' : '<b>' + esc(s.label) + '</b>' + (s.failed ? ' ⚠' : '')}</p>`).join('');
}
function openEp(id) { view = 'ep'; setView(); $('f-ep').value = id; render(); }

function setView() {
  $('v-agg').classList.toggle('on', view === 'agg'); $('v-ep').classList.toggle('on', view === 'ep'); $('l-ep').style.display = view === 'ep' ? '' : 'none';
  if (view === 'ep') { const eps = selected(); const cur = $('f-ep').value;
    $('f-ep').innerHTML = eps.map(e => `<option value="${e.id}">${e.id} · ${e.intent} · ${esc(e.text.slice(0, 40))}${e.signals.length ? ' ⚑' : ''}</option>`).join('');
    if (eps.some(e => e.id === cur)) $('f-ep').value = cur; }
}
function render() {
  if (view === 'agg') { const g = aggregate(); show(g, false); detail(`<h2>Vista agregada</h2><p>${g.eps.length} episodios. El tamaño de cada nodo y el grosor de cada arista cuentan episodios. Pulsa un nodo o una arista para listarlos.</p>`); }
  else { const e = D.episodes.find(x => x.id === $('f-ep').value) || selected()[0]; if (!e) { net && net.destroy(); detail('<p class="k">Ningún episodio con ese filtro.</p>'); return; } show(episodeGraph(e), true); detail(episodeDetail(e)); }
}
function table() {
  const rows = intents.map(i => { const eps = D.episodes.filter(e => e.intent === i); return [i, eps.length, ...sigs.map(s => eps.filter(e => e.signals.includes(s)).length)]; });
  $('tbl').innerHTML = '<table><tr><th>Intención</th><th>Episodios</th>' + sigs.map(s => `<th>${s}</th>`).join('') + '</tr>' +
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
